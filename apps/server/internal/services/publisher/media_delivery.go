package publisher

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/posttext"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/services/publicationauth"
	"github.com/openpost/backend/internal/services/publicurl"
	"github.com/openpost/backend/internal/textutil"
	"github.com/uptrace/bun"
)

const (
	providerMediaStatusReady  = "ready"
	providerMediaStatusFailed = "failed"
)

// mediaUploadTarget is one destination output's media delivery context. The
// rendition carries the segment's body, description and settings; related
// cover, thumbnail and caption media are resolved once per target.
type mediaUploadTarget struct {
	publication *models.Publication
	rendition   *models.Rendition
	account     *models.SocialAccount
	provider    platform.Publisher
	token       string
	relations   *renditionMediaRelations
}

func (s *Service) platformMediaID(ctx context.Context, target *mediaUploadTarget, media models.MediaAttachment) (string, error) {
	if usesPublicMediaURLForRendition(target.account.Platform, target.rendition, media.MimeType) {
		return s.uploadRenditionMediaToPlatform(ctx, target, media)
	}
	if err := s.validateRenditionMediaDeliveryOwner(ctx, target.publication, target.rendition, target.account, media); err != nil {
		return "", err
	}
	if target.relations == nil {
		relations, err := s.renditionMediaRelations(ctx, target.publication.WorkspaceID, target.rendition.SettingsJSON)
		if err != nil {
			return "", err
		}
		target.relations = &relations
	}
	relations := *target.relations
	if uploader, ok := target.provider.(platform.ResumableMetadataMediaUploader); ok {
		return s.resumablePlatformMediaID(ctx, target, uploader, media, relations)
	}
	publication, rendition, account := target.publication, target.rendition, target.account
	return cachedPlatformMediaID(media.ID,
		func() (string, error) {
			return s.loadReadyRenditionMediaDelivery(ctx, publication, rendition, account, media.ID, relations)
		},
		func() (string, error) {
			return s.uploadRenditionMediaToPlatform(ctx, target, media)
		},
		func(platformMediaID, status string, retryClassification platform.MediaRetryClassification, errorMessage string) error {
			state := platform.ResumableMediaUploadState{
				ProviderMediaID:     platformMediaID,
				TotalBytes:          media.Size,
				Status:              platform.MediaUploadStatus(status),
				RetryClassification: retryClassification,
			}
			return s.saveRenditionMediaDelivery(ctx, publication, rendition, account, media.ID, relations, state, errorMessage)
		})
}

func cachedPlatformMediaID(mediaID string, load func() (string, error), upload func() (string, error), save func(string, string, platform.MediaRetryClassification, string) error) (string, error) {
	platformMediaID, err := load()
	if err != nil || platformMediaID != "" {
		return platformMediaID, err
	}
	platformMediaID, err = upload()
	if err != nil {
		retryClassification, classified := platform.MediaRetryClassificationForError(err)
		if !classified || retryClassification == platform.MediaRetryNone {
			retryClassification = platform.MediaRetrySafeResume
		}
		if saveErr := save("", providerMediaStatusFailed, retryClassification, err.Error()); saveErr != nil {
			log.Printf("[Publisher] Failed to record provider media upload failure for media %s: %v", mediaID, saveErr)
		}
		return "", err
	}
	if saveErr := save(platformMediaID, providerMediaStatusReady, platform.MediaRetryNone, ""); saveErr != nil {
		log.Printf("[Publisher] Failed to record provider media state for media %s: %v", mediaID, saveErr)
	}
	return platformMediaID, nil
}

// validateRenditionMediaDeliveryOwner proves the media is attached to this
// rendition, either directly or through one of its segments (generated text
// cards exist only on segments), and that every party shares one workspace.
func (s *Service) validateRenditionMediaDeliveryOwner(ctx context.Context, publication *models.Publication, rendition *models.Rendition, account *models.SocialAccount, media models.MediaAttachment) error {
	var count int
	err := s.db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("renditions AS rendition").
		Join("JOIN publications AS publication ON publication.id = rendition.publication_id").
		Join("JOIN social_accounts AS account ON account.id = rendition.social_account_id").
		Join("JOIN media_attachments AS media ON media.id = ?", media.ID).
		Where("rendition.id = ?", rendition.ID).
		Where("rendition.publication_id = ?", publication.ID).
		Where("publication.workspace_id = ?", publication.WorkspaceID).
		Where("rendition.social_account_id = ?", account.ID).
		Where("rendition.platform = ?", account.Platform).
		Where("account.workspace_id = publication.workspace_id").
		Where("media.workspace_id = publication.workspace_id").
		Where(`(EXISTS (SELECT 1 FROM rendition_media AS rm WHERE rm.rendition_id = rendition.id AND rm.media_id = media.id)
			OR EXISTS (SELECT 1 FROM rendition_segment_media AS rsm
				JOIN rendition_segments AS rs ON rs.id = rsm.rendition_segment_id
				WHERE rs.rendition_id = rendition.id AND rsm.media_id = media.id))`).
		Scan(ctx, &count)
	if err != nil {
		return fmt.Errorf("validating rendition media delivery owner: %w", err)
	}
	if count != 1 {
		return fmt.Errorf("media %s does not belong to rendition %s and account %s", media.ID, rendition.ID, account.ID)
	}
	return nil
}

type renditionMediaRelations struct {
	coverID     string
	thumbnailID string
	captionID   string
}

func (s *Service) renditionMediaRelations(ctx context.Context, workspaceID, settingsJSON string) (renditionMediaRelations, error) {
	settings := map[string]interface{}{}
	_ = json.Unmarshal([]byte(settingsJSON), &settings)
	relations := renditionMediaRelations{
		coverID:     localSettingMediaID(settings, "cover_media_id"),
		thumbnailID: localSettingMediaID(settings, "thumbnail_media_id"),
		captionID:   localSettingMediaID(settings, "caption_media_id"),
	}
	for role, mediaID := range map[string]string{
		"cover": relations.coverID, "thumbnail": relations.thumbnailID, "caption": relations.captionID,
	} {
		if mediaID == "" {
			continue
		}
		var count int
		if err := s.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("media_attachments").
			Where("id = ? AND workspace_id = ?", mediaID, workspaceID).Scan(ctx, &count); err != nil {
			return renditionMediaRelations{}, fmt.Errorf("validating %s media relation: %w", role, err)
		}
		if count != 1 {
			return renditionMediaRelations{}, fmt.Errorf("%s media %s does not belong to workspace %s", role, mediaID, workspaceID)
		}
	}
	return relations, nil
}

func localSettingMediaID(settings map[string]interface{}, key string) string {
	value := settingStringPublisher(settings, key)
	if strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") {
		return ""
	}
	return value
}

func (s *Service) resumablePlatformMediaID(
	ctx context.Context,
	target *mediaUploadTarget,
	uploader platform.ResumableMetadataMediaUploader,
	media models.MediaAttachment,
	relations renditionMediaRelations,
) (string, error) {
	publication, rendition, account := target.publication, target.rendition, target.account
	state, storedRelations, err := s.loadRenditionMediaDeliveryState(ctx, publication, rendition, account, media.ID)
	if err != nil {
		return "", err
	}
	if expiredReadyMedia(account.Platform, state) {
		state = platform.ResumableMediaUploadState{TotalBytes: media.Size}
	}
	if state.Status == platform.MediaUploadReady && state.ProviderMediaID != "" {
		if storedRelations == relations {
			return state.ProviderMediaID, nil
		}
		state.Status = platform.MediaUploadUploaded
		state.RetryClassification = platform.MediaRetryReconcile
	}
	if state.Status == platform.MediaUploadFailed && state.RetryClassification == platform.MediaRetryTerminal {
		return "", fmt.Errorf("provider media delivery is terminal; replace the media before retrying")
	}
	if state.TotalBytes == 0 {
		state.TotalBytes = media.Size
	}
	checkpoint := func(next platform.ResumableMediaUploadState) error {
		state = next
		return s.saveRenditionMediaDelivery(ctx, publication, rendition, account, media.ID, relations, next, "")
	}
	req, closeReaders, err := s.renditionUploadRequest(ctx, publication.WorkspaceID, rendition, media, uploadSettings(rendition), false)
	if err != nil {
		return "", err
	}
	defer closeReaders()
	providerMediaID, uploadErr := uploader.UploadMediaResumable(ctx, target.token, account.AccountID, req, state, checkpoint)
	if uploadErr != nil {
		return "", s.recordRenditionMediaUploadFailure(ctx, target, media.ID, relations, state, uploadErr)
	}
	if providerMediaID == "" {
		return "", fmt.Errorf("provider resumable upload returned an empty media id")
	}
	state.ProviderMediaID = providerMediaID
	state.Status = platform.MediaUploadReady
	state.RetryClassification = platform.MediaRetryNone
	state.UploadedBytes = state.TotalBytes
	state.OpaqueState = ""
	if account.Platform != "x" {
		state.SessionExpiresAt = time.Time{}
	}
	state.LastCheckedAt = time.Now().UTC()
	if err := checkpoint(state); err != nil {
		return "", fmt.Errorf("persisting completed rendition media delivery: %w", err)
	}
	return providerMediaID, nil
}

func (s *Service) recordRenditionMediaUploadFailure(
	ctx context.Context,
	target *mediaUploadTarget,
	mediaID string,
	relations renditionMediaRelations,
	state platform.ResumableMediaUploadState,
	uploadErr error,
) error {
	uploadErr = redactResumableMediaStateFromError(uploadErr, state.OpaqueState)
	state.Status = platform.MediaUploadFailed
	classification, classified := platform.MediaRetryClassificationForError(uploadErr)
	switch {
	case classified:
		state.RetryClassification = classification
	case state.ProviderMediaID != "":
		state.RetryClassification = platform.MediaRetryReconcile
	case state.OpaqueState != "":
		state.RetryClassification = platform.MediaRetrySafeResume
	case isExpiredTokenError(uploadErr), ClassifyFailure(uploadErr).Code == "youtube:daily_upload_quota_exceeded":
		// The provider rejected the request before accepting media: an expired
		// credential is refreshed and retried, and a quota rejection keeps a later
		// explicit attempt possible while the publication policy stops retries.
		state.RetryClassification = platform.MediaRetrySafeResume
	default:
		state.RetryClassification = platform.MediaRetryTerminal
	}
	if saveErr := s.saveRenditionMediaDelivery(ctx, target.publication, target.rendition, target.account, mediaID, relations, state, uploadErr.Error()); saveErr != nil {
		log.Printf("[Publisher] Failed to checkpoint resumable media error for rendition %s media %s: %v", target.rendition.ID, mediaID, saveErr)
	}
	return uploadErr
}

type redactedMediaError struct {
	message string
	cause   error
}

func (e *redactedMediaError) Error() string { return e.message }
func (e *redactedMediaError) Unwrap() error { return e.cause }

type redactedNetError struct {
	message string
	timeout bool
}

func (e *redactedNetError) Error() string   { return e.message }
func (e *redactedNetError) Timeout() bool   { return e.timeout }
func (e *redactedNetError) Temporary() bool { return false }

func redactResumableMediaStateFromError(err error, opaqueState string) error {
	if err == nil || opaqueState == "" {
		return err
	}
	message := err.Error()
	secrets := []string{opaqueState}
	var decoded any
	if json.Unmarshal([]byte(opaqueState), &decoded) == nil {
		secrets = append(secrets, resumableStateStrings(decoded)...)
	}
	for _, secret := range secrets {
		if secret != "" {
			message = strings.ReplaceAll(message, secret, "[redacted provider state]")
		}
	}
	if message == err.Error() {
		return err
	}
	var cause error
	var httpErr *platform.HTTPError
	var netErr net.Error
	switch {
	case errors.As(err, &httpErr):
		cloned := *httpErr
		cause = &cloned
	case errors.Is(err, context.DeadlineExceeded):
		cause = context.DeadlineExceeded
	case errors.As(err, &netErr):
		cause = &redactedNetError{message: message, timeout: netErr.Timeout()}
	}
	redacted := errors.New(message)
	if cause != nil {
		redacted = &redactedMediaError{message: message, cause: cause}
	}
	if classification, ok := platform.MediaRetryClassificationForError(err); ok {
		return &platform.MediaUploadError{RetryClassification: classification, Err: redacted}
	}
	return redacted
}

func resumableStateStrings(value any) []string {
	switch typed := value.(type) {
	case string:
		return []string{typed}
	case []any:
		var values []string
		for _, item := range typed {
			values = append(values, resumableStateStrings(item)...)
		}
		return values
	case map[string]any:
		var values []string
		for _, item := range typed {
			values = append(values, resumableStateStrings(item)...)
		}
		return values
	default:
		return nil
	}
}

func (s *Service) loadReadyRenditionMediaDelivery(ctx context.Context, publication *models.Publication, rendition *models.Rendition, account *models.SocialAccount, mediaID string, expectedRelations renditionMediaRelations) (string, error) {
	state, storedRelations, err := s.loadRenditionMediaDeliveryState(ctx, publication, rendition, account, mediaID)
	if err != nil {
		return "", err
	}
	if state.Status == platform.MediaUploadReady && storedRelations == expectedRelations {
		return state.ProviderMediaID, nil
	}
	if state.Status == platform.MediaUploadFailed && state.RetryClassification == platform.MediaRetryTerminal {
		return "", &platform.MediaUploadError{
			RetryClassification: platform.MediaRetryTerminal,
			Err:                 errors.New("the previous provider media upload ended with an unknown or rejected outcome; OpenPost did not upload it again"),
		}
	}
	return "", nil
}

func (s *Service) loadRenditionMediaDeliveryState(ctx context.Context, publication *models.Publication, rendition *models.Rendition, account *models.SocialAccount, mediaID string) (platform.ResumableMediaUploadState, renditionMediaRelations, error) {
	var delivery models.RenditionMediaDelivery
	err := s.db.NewSelect().Model(&delivery).
		Where("workspace_id = ?", publication.WorkspaceID).
		Where("publication_id = ?", publication.ID).
		Where("rendition_id = ?", rendition.ID).
		Where("social_account_id = ?", account.ID).
		Where("media_id = ?", mediaID).
		Where("platform = ?", account.Platform).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return platform.ResumableMediaUploadState{Status: platform.MediaUploadPending, RetryClassification: platform.MediaRetrySafeResume}, renditionMediaRelations{}, nil
	}
	if err != nil {
		return platform.ResumableMediaUploadState{}, renditionMediaRelations{}, fmt.Errorf("loading rendition media delivery: %w", err)
	}
	var rows []models.RenditionMediaDeliveryRelation
	if err := s.db.NewSelect().Model(&rows).
		Where("rendition_id = ? AND delivery_media_id = ?", rendition.ID, mediaID).
		Scan(ctx); err != nil {
		return platform.ResumableMediaUploadState{}, renditionMediaRelations{}, fmt.Errorf("loading rendition media delivery relations: %w", err)
	}
	var storedRelations renditionMediaRelations
	for _, row := range rows {
		switch row.Role {
		case "cover":
			storedRelations.coverID = row.RelatedMediaID
		case "thumbnail":
			storedRelations.thumbnailID = row.RelatedMediaID
		case "caption":
			storedRelations.captionID = row.RelatedMediaID
		}
	}
	opaqueState := ""
	if len(delivery.SessionStateEnc) > 0 {
		if s.mediaStateEncryptor == nil {
			return platform.ResumableMediaUploadState{}, renditionMediaRelations{}, fmt.Errorf("media upload state encryption is not configured")
		}
		opaqueState, err = s.mediaStateEncryptor.Decrypt(delivery.SessionStateEnc)
		if err != nil {
			return platform.ResumableMediaUploadState{}, renditionMediaRelations{}, fmt.Errorf("decrypting rendition media delivery state: %w", err)
		}
	}
	return platform.ResumableMediaUploadState{
		ProviderMediaID:     delivery.ProviderMediaID,
		OpaqueState:         opaqueState,
		UploadedBytes:       delivery.UploadedBytes,
		TotalBytes:          delivery.TotalBytes,
		SessionExpiresAt:    delivery.SessionExpiresAt,
		LastCheckedAt:       delivery.LastCheckedAt,
		Status:              platform.MediaUploadStatus(delivery.Status),
		RetryClassification: platform.MediaRetryClassification(delivery.RetryClassification),
	}, storedRelations, nil
}

func (s *Service) saveRenditionMediaDelivery(
	ctx context.Context,
	publication *models.Publication,
	rendition *models.Rendition,
	account *models.SocialAccount,
	mediaID string,
	relations renditionMediaRelations,
	state platform.ResumableMediaUploadState,
	errorMessage string,
) error {
	var encryptedState []byte
	if state.OpaqueState != "" {
		if s.mediaStateEncryptor == nil {
			return fmt.Errorf("media upload state encryption is not configured")
		}
		var err error
		encryptedState, err = s.mediaStateEncryptor.Encrypt(state.OpaqueState)
		if err != nil {
			return fmt.Errorf("encrypting rendition media delivery state: %w", err)
		}
	}
	now := time.Now().UTC()
	delivery := &models.RenditionMediaDelivery{
		WorkspaceID:         publication.WorkspaceID,
		PublicationID:       publication.ID,
		RenditionID:         rendition.ID,
		SocialAccountID:     account.ID,
		MediaID:             mediaID,
		Platform:            account.Platform,
		ProviderMediaID:     state.ProviderMediaID,
		Status:              string(state.Status),
		SessionStateEnc:     encryptedState,
		UploadedBytes:       state.UploadedBytes,
		TotalBytes:          state.TotalBytes,
		SessionExpiresAt:    state.SessionExpiresAt,
		LastCheckedAt:       state.LastCheckedAt,
		RetryClassification: string(state.RetryClassification),
		ErrorMessage:        errorMessage,
		CreatedAt:           now,
		UpdatedAt:           now,
	}
	return s.fencedTx(ctx, func(ctx context.Context, tx bun.Tx) error {
		// YouTube creates the video during upload, before thumbnail/caption
		// finalization. Other providers' upload IDs are not publication IDs.
		if account.Platform == "youtube" && state.ProviderMediaID != "" {
			if err := saveRenditionExternalIdentity(ctx, tx, rendition.ID, state.ProviderMediaID, "https://www.youtube.com/watch?v="+url.QueryEscape(state.ProviderMediaID)); err != nil {
				return err
			}
		}
		if _, err := tx.NewInsert().Model(delivery).
			On("CONFLICT (rendition_id, media_id) DO UPDATE").
			Set("workspace_id = EXCLUDED.workspace_id").
			Set("publication_id = EXCLUDED.publication_id").
			Set("social_account_id = EXCLUDED.social_account_id").
			Set("platform = EXCLUDED.platform").
			Set("provider_media_id = EXCLUDED.provider_media_id").
			Set("status = EXCLUDED.status").
			Set("session_state_encrypted = EXCLUDED.session_state_encrypted").
			Set("uploaded_bytes = EXCLUDED.uploaded_bytes").
			Set("total_bytes = EXCLUDED.total_bytes").
			Set("session_expires_at = EXCLUDED.session_expires_at").
			Set("last_checked_at = EXCLUDED.last_checked_at").
			Set("retry_classification = EXCLUDED.retry_classification").
			Set("error_message = EXCLUDED.error_message").
			Set("updated_at = EXCLUDED.updated_at").
			Exec(ctx); err != nil {
			return fmt.Errorf("saving rendition media delivery: %w", err)
		}
		if _, err := tx.NewDelete().Model((*models.RenditionMediaDeliveryRelation)(nil)).
			Where("rendition_id = ? AND delivery_media_id = ?", rendition.ID, mediaID).
			Exec(ctx); err != nil {
			return fmt.Errorf("replacing rendition media delivery relations: %w", err)
		}
		rows := make([]models.RenditionMediaDeliveryRelation, 0, 3)
		for _, relation := range [...]struct{ role, mediaID string }{
			{"cover", relations.coverID}, {"thumbnail", relations.thumbnailID}, {"caption", relations.captionID},
		} {
			if relation.mediaID != "" {
				rows = append(rows, models.RenditionMediaDeliveryRelation{
					WorkspaceID: publication.WorkspaceID, RenditionID: rendition.ID,
					DeliveryMediaID: mediaID, Role: relation.role, RelatedMediaID: relation.mediaID,
				})
			}
		}
		if len(rows) == 0 {
			return nil
		}
		if _, err := tx.NewInsert().Model(&rows).Exec(ctx); err != nil {
			return fmt.Errorf("saving rendition media delivery relations: %w", err)
		}
		return nil
	})
}

// uploadSettings returns the rendition's provider settings without the
// authored mention projection, which is never sent with media uploads.
func uploadSettings(rendition *models.Rendition) map[string]interface{} {
	settings := map[string]interface{}{}
	_ = json.Unmarshal([]byte(rendition.SettingsJSON), &settings)
	delete(settings, posttext.NativeSettingsKey)
	return settings
}

func (s *Service) uploadRenditionMediaToPlatform(ctx context.Context, target *mediaUploadTarget, media models.MediaAttachment) (string, error) {
	account, rendition := target.account, target.rendition
	settings := uploadSettings(rendition)
	if requiresPublicMedia(account.Platform, rendition.Profile) && !usesTikTokFileUpload(account.Platform, settings, media.MimeType) {
		return s.getPublicMediaURL(media), nil
	}
	if err := publicationauth.RequireReview(ctx, s.db, rendition.PublicationID); err != nil {
		return "", err
	}
	if uploader, ok := target.provider.(platform.MetadataMediaUploader); ok {
		req, closeReaders, err := s.renditionUploadRequest(ctx, target.publication.WorkspaceID, rendition, media, settings, true)
		if err != nil {
			return "", err
		}
		defer closeReaders()
		return uploader.UploadMediaWithMetadata(ctx, target.token, account.AccountID, req)
	}
	uploader, ok := target.provider.(platform.MediaUploader)
	if !ok {
		return "", fmt.Errorf("provider does not support media uploads")
	}
	if s.storage == nil {
		return "", fmt.Errorf("media storage is not configured")
	}
	data, err := s.storage.Open(ctx, filepath.Base(media.FilePath))
	if err != nil {
		return "", fmt.Errorf("opening media file %s: %w", media.FilePath, err)
	}
	defer data.Close()
	return uploader.UploadMedia(ctx, target.token, account.AccountID, media.MimeType, data)
}

func (s *Service) renditionUploadRequest(ctx context.Context, workspaceID string, rendition *models.Rendition, media models.MediaAttachment, settings map[string]interface{}, openPrimaryReader bool) (platform.UploadMediaRequest, func(), error) {
	if s.storage == nil {
		return platform.UploadMediaRequest{}, nil, fmt.Errorf("media storage is not configured")
	}
	storageKey := filepath.Base(media.FilePath)
	readers := make([]io.ReadCloser, 0, 3)
	closeReaders := func() {
		for _, reader := range readers {
			_ = reader.Close()
		}
	}
	var data io.ReadCloser
	if openPrimaryReader {
		var err error
		if data, err = s.storage.Open(ctx, storageKey); err != nil {
			return platform.UploadMediaRequest{}, nil, fmt.Errorf("opening media file %s: %w", media.FilePath, err)
		}
		readers = append(readers, data)
	}
	thumbnailID := textutil.FirstNonEmptyRaw(settingStringPublisher(settings, "thumbnail_media_id"), settingStringPublisher(settings, "cover_media_id"))
	thumbnail, thumbnailReader, err := s.openSettingMedia(ctx, workspaceID, "thumbnail", thumbnailID, true)
	if err != nil {
		closeReaders()
		return platform.UploadMediaRequest{}, nil, err
	}
	if thumbnailReader != nil {
		readers = append(readers, thumbnailReader)
	}
	caption, captionReader, err := s.openSettingMedia(ctx, workspaceID, "caption", settingStringPublisher(settings, "caption_media_id"), false)
	if err != nil {
		closeReaders()
		return platform.UploadMediaRequest{}, nil, err
	}
	if captionReader != nil {
		readers = append(readers, captionReader)
	}
	req := platform.UploadMediaRequest{
		// A media upload can create the provider post (YouTube). Recheck the
		// review gate and the worker lease immediately before the write.
		BeforeWrite: func(writeCtx context.Context) error {
			if err := publicationauth.RequireReview(writeCtx, s.db, rendition.PublicationID); err != nil {
				return &platform.MediaUploadError{RetryClassification: platform.MediaRetrySafeResume, Err: err}
			}
			if err := providerwrite.RequireCurrentJobExecution(writeCtx, s.db, ""); err != nil {
				return &platform.MediaUploadError{RetryClassification: platform.MediaRetrySafeResume, Err: err}
			}
			return nil
		},
		MimeType:    media.MimeType,
		Filename:    textutil.FirstNonEmptyRaw(media.OriginalFilename, storageKey),
		Size:        media.Size,
		Width:       media.Width,
		Height:      media.Height,
		DurationMS:  media.DurationMS,
		Title:       textutil.FirstNonEmptyRaw(rendition.Title, firstContentLine(rendition.Body)),
		Description: strings.TrimSpace(textutil.FirstNonEmptyRaw(rendition.Description, rendition.Body)),
		Settings:    settings,
		Reader:      data,
		OpenReaderAt: func(offset int64) (io.ReadCloser, error) {
			return s.openMediaReaderAt(ctx, storageKey, offset)
		},
	}
	if thumbnail != nil {
		req.ThumbnailMimeType = thumbnail.MimeType
		req.ThumbnailFilename = textutil.FirstNonEmptyRaw(thumbnail.OriginalFilename, filepath.Base(thumbnail.FilePath))
		req.ThumbnailSize = thumbnail.Size
		req.ThumbnailReader = thumbnailReader
	}
	if caption != nil {
		req.CaptionMimeType = caption.MimeType
		req.CaptionFilename = textutil.FirstNonEmptyRaw(caption.OriginalFilename, filepath.Base(caption.FilePath))
		req.CaptionSize = caption.Size
		req.CaptionReader = captionReader
	}
	return req, closeReaders, nil
}

func (s *Service) openMediaReaderAt(ctx context.Context, storageKey string, offset int64) (io.ReadCloser, error) {
	if offset < 0 {
		return nil, fmt.Errorf("invalid media offset %d", offset)
	}
	if ranged, ok := s.storage.(mediastore.RangeBlobStorage); ok {
		return ranged.OpenRange(ctx, storageKey, offset)
	}
	reader, err := s.storage.Open(ctx, storageKey)
	if err != nil {
		return nil, err
	}
	if offset == 0 {
		return reader, nil
	}
	if _, err := io.CopyN(io.Discard, reader, offset); err != nil {
		_ = reader.Close()
		return nil, fmt.Errorf("positioning media reader at byte %d: %w", offset, err)
	}
	return reader, nil
}

// openSettingMedia opens related media named by a destination setting. The
// lookup is scoped to the publication's workspace: a setting can never read
// another workspace's media.
func (s *Service) openSettingMedia(ctx context.Context, workspaceID, role, mediaID string, requireImage bool) (*models.MediaAttachment, io.ReadCloser, error) {
	if mediaID == "" {
		return nil, nil, nil
	}
	if s.db == nil {
		return nil, nil, fmt.Errorf("%s media lookup requires a database", role)
	}
	if s.storage == nil {
		return nil, nil, fmt.Errorf("media storage is not configured")
	}
	var media models.MediaAttachment
	if err := s.db.NewSelect().Model(&media).Where("id = ? AND workspace_id = ?", mediaID, workspaceID).Scan(ctx); err != nil {
		return nil, nil, fmt.Errorf("loading %s media %s: %w", role, mediaID, err)
	}
	if requireImage && !strings.HasPrefix(strings.ToLower(media.MimeType), "image/") {
		return nil, nil, fmt.Errorf("%s media %s must be an image", role, mediaID)
	}
	reader, err := s.storage.Open(ctx, filepath.Base(media.FilePath))
	if err != nil {
		return nil, nil, fmt.Errorf("opening %s media file %s: %w", role, media.FilePath, err)
	}
	return &media, reader, nil
}

// hydratePublicSettingMediaURLs replaces a cover media ID with its signed
// public URL for providers that fetch the cover themselves.
func (s *Service) hydratePublicSettingMediaURLs(ctx context.Context, workspaceID, provider string, settings map[string]interface{}) error {
	if provider != "instagram" && provider != "pinterest" {
		return nil
	}
	mediaID := settingStringPublisher(settings, "cover_media_id")
	if mediaID == "" || strings.HasPrefix(mediaID, "https://") {
		return nil
	}
	var media models.MediaAttachment
	if err := s.db.NewSelect().Model(&media).Where("id = ? AND workspace_id = ?", mediaID, workspaceID).Scan(ctx); err != nil {
		return fmt.Errorf("loading cover_media_id media %s: %w", mediaID, err)
	}
	settings["cover_media_id"] = s.getPublicMediaURL(media)
	return nil
}

func requiresPublicMedia(platformName, profile string) bool {
	if profile != "" {
		if capability, ok := capabilities.Find(platformName, profile); ok {
			return capability.RequiresPublicMedia || capability.Media.RequiresPublicURL
		}
	}
	for _, capability := range capabilities.All() {
		if capability.Provider == platformName && (capability.RequiresPublicMedia || capability.Media.RequiresPublicURL) {
			return true
		}
	}
	return false
}

func usesPublicMediaURLForRendition(platformName string, rendition *models.Rendition, mimeType string) bool {
	if rendition == nil || !requiresPublicMedia(platformName, rendition.Profile) {
		return false
	}
	return !usesTikTokFileUpload(platformName, uploadSettings(rendition), mimeType)
}

func usesTikTokFileUpload(platformName string, settings map[string]interface{}, mimeType string) bool {
	if platformName != "tiktok" {
		return false
	}
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(mimeType)), "video/") {
		return false
	}
	mode := strings.ToUpper(strings.TrimSpace(settingStringPublisher(settings, "content_posting_method")))
	return mode == "UPLOAD" || mode == "MEDIA_UPLOAD"
}

func (s *Service) getPublicMediaURL(media models.MediaAttachment) string {
	return publicurl.ResolveMediaURL(
		s.publicMediaURL,
		s.storage,
		s.mediaSigner,
		media,
		time.Now().UTC().Add(15*time.Minute),
	)
}

func expiredReadyMedia(provider string, state platform.ResumableMediaUploadState) bool {
	return provider == "x" && state.Status == platform.MediaUploadReady && !state.SessionExpiresAt.IsZero() && !time.Now().UTC().Before(state.SessionExpiresAt)
}
