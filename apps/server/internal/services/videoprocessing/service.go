package videoprocessing

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/mediaanalysis"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/uptrace/bun"
)

const (
	JobTypeAnalyze = jobregistry.TypeMediaAnalyze

	statusPending    = "pending"
	statusProcessing = "processing"
	statusReady      = "ready"
	statusFailed     = "failed"
)

type Service struct {
	db       *bun.DB
	storage  mediastore.BlobStorage
	analyzer mediaanalysis.Analyzer
}

type analysisJobPayload struct {
	MediaID string `json:"media_id"`
}

func NewService(db *bun.DB, storage mediastore.BlobStorage, analyzer mediaanalysis.Analyzer) *Service {
	if analyzer == nil {
		analyzer = mediaanalysis.DisabledAnalyzer{}
	}
	return &Service{db: db, storage: storage, analyzer: analyzer}
}

func (s *Service) EnqueueAnalysis(ctx context.Context, mediaID string) error {
	mediaID = strings.TrimSpace(mediaID)
	if mediaID == "" {
		return errors.New("media ID is required")
	}
	payload, err := json.Marshal(analysisJobPayload{MediaID: mediaID})
	if err != nil {
		return fmt.Errorf("encode media analysis job: %w", err)
	}
	jobID := analysisJobID(mediaID)
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var workspaceID string
		if err := tx.NewSelect().Model((*models.MediaAttachment)(nil)).Column("workspace_id").Where("id = ?", mediaID).Scan(txCtx, &workspaceID); err != nil {
			return err
		}
		if err := organizationguard.LockWorkspace(txCtx, tx, workspaceID); err != nil {
			return err
		}
		return enqueueAnalysisJob(txCtx, tx, jobID, string(payload))
	})
}

func enqueueAnalysisJob(ctx context.Context, db bun.IDB, jobID, payload string) error {
	var existing models.Job
	err := db.NewSelect().Model(&existing).Where("id = ?", jobID).Scan(ctx)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		job, newJobErr := jobregistry.NewJob(JobTypeAnalyze, payload, time.Now().UTC())
		if newJobErr != nil {
			return newJobErr
		}
		job.ID = jobID
		_, err = db.NewInsert().Model(job).Ignore().Exec(ctx)
		return err
	case err != nil:
		return err
	case existing.Status == statusPending || existing.Status == statusProcessing:
		return nil
	default:
		_, err = db.NewUpdate().
			Model((*models.Job)(nil)).
			Set("type = ?", JobTypeAnalyze).
			Set("payload = ?", payload).
			Set("status = ?", statusPending).
			Set("run_at = ?", time.Now().UTC()).
			Set("attempts = 0").
			Set("max_attempts = 3").
			Set("last_error = ''").
			Set("locked_at = NULL").
			Set("locked_by = ''").
			Where("id = ?", jobID).
			Exec(ctx)
		return err
	}
}

func (s *Service) EnqueuePendingAnalysis(ctx context.Context) error {
	var mediaIDs []string
	if err := s.db.NewSelect().
		Model((*models.MediaAttachment)(nil)).
		Column("id").
		Where("mime_type LIKE 'video/%'").
		Where("processing_status != ?", "uploading").
		WhereGroup(" AND ", func(query *bun.SelectQuery) *bun.SelectQuery {
			return query.
				Where("analysis_status = ?", statusPending).
				WhereOr("(analysis_status != ? AND analysis_status != ?)", statusReady, statusFailed).
				WhereOr("(analysis_status = ? AND (width <= 0 OR height <= 0 OR duration_ms <= 0))", statusReady)
		}).
		Scan(ctx, &mediaIDs); err != nil {
		return err
	}
	for _, mediaID := range mediaIDs {
		if err := s.EnqueueAnalysis(ctx, mediaID); err != nil {
			return fmt.Errorf("enqueue analysis for media %s: %w", mediaID, err)
		}
	}
	return nil
}

func (s *Service) HandleJob(ctx context.Context, jobType, payload string) error {
	if jobType != JobTypeAnalyze {
		return fmt.Errorf("unsupported video processing job type %q", jobType)
	}
	var job analysisJobPayload
	if err := json.Unmarshal([]byte(payload), &job); err != nil {
		return fmt.Errorf("decode media analysis job: %w", err)
	}
	if strings.TrimSpace(job.MediaID) == "" {
		return errors.New("media analysis job is missing media_id")
	}
	return s.analyze(ctx, job.MediaID)
}

func (s *Service) analyze(ctx context.Context, mediaID string) error {
	if s.db == nil || s.storage == nil {
		return errors.New("video processing is not configured")
	}
	media, eligible, err := s.loadVideo(ctx, mediaID)
	if err != nil || !eligible {
		return err
	}
	if err := s.beginAnalysis(ctx, media.ID); err != nil {
		return err
	}
	result, err := s.analyzeMedia(ctx, media)
	if err != nil {
		return s.failAnalysis(ctx, media.ID, err)
	}
	posterKey, err := s.savePoster(ctx, media, result)
	if err != nil {
		return s.failAnalysis(ctx, media.ID, err)
	}
	if err := s.persistResult(ctx, media.ID, posterKey, result); err != nil {
		return s.failAnalysis(ctx, media.ID, err)
	}
	return nil
}

func (s *Service) loadVideo(ctx context.Context, mediaID string) (models.MediaAttachment, bool, error) {
	var media models.MediaAttachment
	if err := s.db.NewSelect().Model(&media).Where("id = ?", mediaID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return media, false, nil
		}
		return media, false, err
	}
	return media, strings.HasPrefix(media.MimeType, "video/"), nil
}

func (s *Service) beginAnalysis(ctx context.Context, mediaID string) error {
	_, err := s.db.NewUpdate().
		Model((*models.MediaAttachment)(nil)).
		Set("processing_status = ?", statusProcessing).
		Set("processing_progress = 5").
		Set("analysis_status = ?", statusPending).
		Set("analysis_error = ''").
		Where("id = ?", mediaID).
		Exec(ctx)
	return err
}

func (s *Service) analyzeMedia(ctx context.Context, media models.MediaAttachment) (mediaanalysis.Result, error) {
	stagedPath, err := s.stageMedia(ctx, media)
	if err != nil {
		return mediaanalysis.Result{}, fmt.Errorf("stage video for analysis: %w", err)
	}
	defer os.Remove(stagedPath)
	if err := s.setProgress(ctx, media.ID, 30); err != nil {
		return mediaanalysis.Result{}, err
	}

	result, err := s.analyzer.Analyze(ctx, mediaanalysis.Input{
		Filename: stagedPath,
		MIMEType: media.MimeType,
	})
	if err != nil {
		return mediaanalysis.Result{}, err
	}
	if result.AnalysisStatus != "" && result.AnalysisStatus != mediaanalysis.AnalysisStatusReady {
		return mediaanalysis.Result{}, errors.New(firstNonEmpty(result.AnalysisError, "video analysis did not complete"))
	}
	if result.Width <= 0 || result.Height <= 0 || result.DurationMS <= 0 {
		return mediaanalysis.Result{}, errors.New("video analysis returned incomplete dimensions or duration")
	}
	if err := s.setProgress(ctx, media.ID, 70); err != nil {
		return mediaanalysis.Result{}, err
	}
	return result, nil
}

func (s *Service) savePoster(ctx context.Context, media models.MediaAttachment, result mediaanalysis.Result) (string, error) {
	posterKey := media.ThumbnailObjectKey
	if len(result.PosterContent) == 0 {
		return posterKey, nil
	}
	key := media.ID + ".poster.jpg"
	if _, err := mediastore.SaveWithContentType(ctx, s.storage, key, bytes.NewReader(result.PosterContent), "image/jpeg"); err != nil {
		return "", fmt.Errorf("save video poster: %w", err)
	}
	return key, nil
}

func (s *Service) persistResult(
	ctx context.Context,
	mediaID string,
	posterKey string,
	result mediaanalysis.Result,
) error {
	_, err := s.db.NewUpdate().
		Model((*models.MediaAttachment)(nil)).
		Set("processing_status = ?", statusReady).
		Set("processing_progress = 100").
		Set("analysis_status = ?", mediaanalysis.AnalysisStatusReady).
		Set("analysis_error = ''").
		Set("width = ?", result.Width).
		Set("height = ?", result.Height).
		Set("duration_ms = ?", result.DurationMS).
		Set("frame_rate = ?", result.FrameRate).
		Set("aspect_ratio = ?", result.AspectRatio).
		Set("dominant_type = ?", "video").
		Set("container_format = ?", result.ContainerFormat).
		Set("video_codec = ?", result.VideoCodec).
		Set("video_profile = ?", result.VideoProfile).
		Set("audio_codec = ?", result.AudioCodec).
		Set("pixel_format = ?", result.PixelFormat).
		Set("color_space = ?", result.ColorSpace).
		Set("bit_rate = ?", result.BitRate).
		Set("rotation = ?", result.Rotation).
		Set("audio_channels = ?", result.AudioChannels).
		Set("thumbnail_object_key = ?", posterKey).
		Where("id = ?", mediaID).
		Exec(ctx)
	return err
}

func (s *Service) stageMedia(ctx context.Context, media models.MediaAttachment) (string, error) {
	reader, err := s.storage.Open(ctx, filepath.Base(media.FilePath))
	if err != nil {
		return "", err
	}
	defer reader.Close()

	extension := filepath.Ext(media.OriginalFilename)
	if len(extension) > 12 || strings.ContainsAny(extension, `/\`) {
		extension = ""
	}
	temp, err := os.CreateTemp("", "openpost-video-*"+extension)
	if err != nil {
		return "", err
	}
	path := temp.Name()
	cleanup := true
	defer func() {
		_ = temp.Close()
		if cleanup {
			_ = os.Remove(path)
		}
	}()

	copyReader := io.Reader(reader)
	if media.Size > 0 {
		copyReader = io.LimitReader(reader, media.Size+1)
	}
	written, err := io.Copy(temp, &contextReader{ctx: ctx, reader: copyReader})
	if err != nil {
		return "", err
	}
	if media.Size > 0 && written != media.Size {
		return "", fmt.Errorf("stored video size mismatch: expected %d bytes, read %d", media.Size, written)
	}
	if err := temp.Close(); err != nil {
		return "", err
	}
	cleanup = false
	return path, nil
}

func (s *Service) failAnalysis(ctx context.Context, mediaID string, cause error) error {
	message := strings.TrimSpace(cause.Error())
	if len(message) > 1000 {
		message = message[:1000]
	}
	_, updateErr := s.db.NewUpdate().
		Model((*models.MediaAttachment)(nil)).
		Set("processing_status = ?", statusFailed).
		Set("processing_progress = 0").
		Set("analysis_status = ?", mediaanalysis.AnalysisStatusFailed).
		Set("analysis_error = ?", message).
		Where("id = ?", mediaID).
		Exec(ctx)
	if updateErr != nil {
		return fmt.Errorf("%v; persist analysis failure: %w", cause, updateErr)
	}
	return cause
}

func (s *Service) setProgress(ctx context.Context, mediaID string, progress int) error {
	_, err := s.db.NewUpdate().
		Model((*models.MediaAttachment)(nil)).
		Set("processing_progress = ?", progress).
		Where("id = ?", mediaID).
		Exec(ctx)
	return err
}

func analysisJobID(mediaID string) string {
	return "media-analysis-" + mediaID
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r *contextReader) Read(buffer []byte) (int, error) {
	select {
	case <-r.ctx.Done():
		return 0, r.ctx.Err()
	default:
		return r.reader.Read(buffer)
	}
}
