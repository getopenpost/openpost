// Package publicationcards snapshots generated text cards as ordinary media.
// The authored text and attachments remain separate from these delivery assets.
package publicationcards

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/gif" // Decode connected-account avatars.
	_ "image/png"
	"io"
	"path"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/avatarfetch"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/medialifecycle"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/textcards"
	"github.com/uptrace/bun"
	_ "golang.org/x/image/webp" // Decode connected-account avatars.
)

// Rendering includes avatar I/O and image buffers. Share slots across REST,
// MCP and publication mutation owners so new handlers cannot bypass the bound.
// A render takes tens of milliseconds, so callers wait briefly for a slot
// instead of failing a live preview.
var renderSlots = make(chan struct{}, max(2, runtime.GOMAXPROCS(0)))

const renderSlotWait = 5 * time.Second

var ErrRenderBusy = errors.New("text card rendering is busy")

// avatarCacheTTL keeps provider avatars across preview keystrokes. Profile
// photos change rarely; a refresh or new URL fetches again.
const (
	avatarCacheTTL     = 10 * time.Minute
	avatarCacheEntries = 128
)

type cachedAvatar struct {
	photo   image.Image
	expires time.Time
}

var avatarCache = struct {
	sync.Mutex
	entries map[string]cachedAvatar
}{entries: map[string]cachedAvatar{}}

type Service struct {
	db      *bun.DB
	storage mediastore.BlobStorage
	quota   entitlements.Service
}

func New(db *bun.DB, storage mediastore.BlobStorage, quota entitlements.Service) *Service {
	if quota == nil {
		quota = entitlements.NewSelfHostedService()
	}
	return &Service{db: db, storage: storage, quota: quota}
}

type cleanupKey struct{}
type pendingAsset struct{ id, key, workspaceID string }

// Mutation compensates blob writes if the surrounding database transaction
// rolls back. Nested application calls share one cleanup scope.
func (s *Service) Mutation(ctx context.Context) (context.Context, func()) {
	if s == nil {
		return ctx, func() {}
	}
	if ctx.Value(cleanupKey{}) != nil {
		return ctx, func() {}
	}
	pending := []pendingAsset{}
	return context.WithValue(ctx, cleanupKey{}, &pending), func() {
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		defer cancel()
		for _, asset := range pending {
			exists, err := s.db.NewSelect().Model((*models.MediaAttachment)(nil)).Where("id = ?", asset.id).Exists(cleanupCtx)
			if err == nil && !exists {
				_ = s.storage.Delete(cleanupCtx, asset.key)
			}
		}
	}
}

func Identity(account models.SocialAccount) textcards.Identity {
	name := strings.TrimSpace(account.Alias)
	if name == "" {
		name = account.AccountUsername
	}
	if name == "" {
		name = account.Slug
	}
	return textcards.Identity{Name: name, Handle: account.AccountUsername}
}

func (s *Service) Preview(ctx context.Context, account models.SocialAccount, body, output string, style textcards.Style, attachments int) ([]textcards.Image, error) {
	images, _, err := s.render(ctx, account, body, output, style, attachments)
	return images, err
}

// Avatar outcomes recorded in the render receipt. "missing" means no photo
// was configured, so the monogram fallback is final until the URL changes.
// "failed" means a configured photo could not be fetched or decoded, so the
// next save retries the fetch explicitly instead of reusing the fallback.
const (
	avatarOK      = "ok"
	avatarMissing = "missing"
	avatarFailed  = "failed"
)

func (s *Service) render(ctx context.Context, account models.SocialAccount, body, output string, style textcards.Style, attachments int) ([]textcards.Image, string, error) {
	if err := ctx.Err(); err != nil {
		return nil, avatarFailed, err
	}
	wait := time.NewTimer(renderSlotWait)
	defer wait.Stop()
	select {
	case renderSlots <- struct{}{}:
		defer func() { <-renderSlots }()
	case <-ctx.Done():
		return nil, avatarFailed, ctx.Err()
	case <-wait.C:
		return nil, avatarFailed, ErrRenderBusy
	}

	avatar, outcome := s.avatar(ctx, account.AccountAvatarURL)
	images, err := textcards.Render(ctx, body, output, style, Identity(account), avatar, attachments)
	if err != nil {
		return nil, avatarFailed, err
	}
	return images, outcome, nil
}

func (s *Service) avatar(ctx context.Context, raw string) (image.Image, string) {
	if raw == "" {
		return nil, avatarMissing
	}
	now := time.Now()
	avatarCache.Lock()
	cached, ok := avatarCache.entries[raw]
	avatarCache.Unlock()
	if ok && now.Before(cached.expires) {
		return cached.photo, avatarOK
	}
	data, ok := s.avatarBytes(ctx, raw)
	if !ok {
		return nil, avatarFailed
	}
	photo, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, avatarFailed
	}
	// Only successful decodes are cached, so a failed fetch retries next time.
	avatarCache.Lock()
	if len(avatarCache.entries) >= avatarCacheEntries {
		for key, entry := range avatarCache.entries {
			if !now.Before(entry.expires) || len(avatarCache.entries) >= avatarCacheEntries {
				delete(avatarCache.entries, key)
			}
		}
	}
	avatarCache.entries[raw] = cachedAvatar{photo: photo, expires: now.Add(avatarCacheTTL)}
	avatarCache.Unlock()
	return photo, avatarOK
}

// avatarBytes reads the stored photo without network for rehosted /avatars/
// URLs, and fetches provider URLs through the shared bounded adapter. Any
// fetch failure keeps the monogram fallback and records a retryable outcome.
func (s *Service) avatarBytes(ctx context.Context, raw string) ([]byte, bool) {
	if strings.HasPrefix(raw, "/avatars/") && s.storage != nil {
		reader, err := s.storage.Open(ctx, path.Base(raw))
		if err != nil {
			return nil, false
		}
		defer reader.Close()
		data, err := io.ReadAll(io.LimitReader(reader, 4*1024*1024+1))
		if err != nil || len(data) > 4*1024*1024 {
			return nil, false
		}
		if config, _, err := image.DecodeConfig(bytes.NewReader(data)); err != nil || config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > 16_000_000 {
			return nil, false
		}
		return data, true
	}
	result, err := avatarfetch.Fetch(ctx, raw, avatarfetch.Bounds{
		Label: "profile photo", Timeout: 5 * time.Second,
		MaxBytes: 4 * 1024 * 1024, MaxPixels: 16_000_000,
	})
	if err != nil {
		return nil, false
	}
	return result.Data, true
}

// RefreshSegment changes only generated media relations. Existing output bytes
// are retained when the text, layout, identity and attachment count are unchanged.
// A previously failed avatar fetch retries on the next save; any other unchanged
// receipt reuses the saved output without fetching the photo.
func (s *Service) RefreshSegment(ctx context.Context, db bun.IDB, account models.SocialAccount, rendition models.Rendition, segment models.RenditionSegment, settings map[string]any) error {
	var rows []models.RenditionSegmentMedia
	if err := db.NewSelect().Model(&rows).Where("rendition_segment_id = ?", segment.ID).Order("display_order ASC").Scan(ctx); err != nil {
		return err
	}
	attachments, previous := segmentAttachments(rows)
	style, err := textcards.Parse(settings)
	if err != nil {
		return err
	}
	applies := style.Applies(account.Platform, rendition.OutputProfile, segment.Body, attachments)
	source := textCardSource(account, rendition, segment.Body, style, attachments)
	previousSource, previousAvatar := parseReceipt(previous)
	if applies && len(previous) > 0 && previousSource == source && previousAvatar != avatarFailed {
		return nil
	}
	// A previously failed avatar retries on the next save without requiring
	// an authored-text edit. The comparison above needs no network; only this
	// explicit retry path fetches the photo again.
	if !applies {
		return clearGeneratedCards(ctx, db, segment.ID)
	}
	if _, err := textcards.Layout(segment.Body, rendition.OutputProfile); err != nil {
		// Keep incomplete drafts editable without a generated card.
		return clearGeneratedCards(ctx, db, segment.ID)
	}
	images, outcome, err := s.renderSegmentCards(ctx, account, rendition, segment, style, attachments)
	if err != nil {
		return err
	}
	if len(previous) > 0 && previousSource == source && outcome == avatarFailed {
		return nil
	} // The retry is still failing; keep the existing fallback without churning media.
	if err := clearGeneratedCards(ctx, db, segment.ID); err != nil {
		return err
	}
	receipt := string(mustJSON(map[string]string{"text_card_source": source, "text_card_avatar": outcome}))
	return s.persistGeneratedCards(ctx, db, account, segment, images, receipt)
}

// renderSegmentCards refuses to render when the service has no storage, then
// renders one segment with the caller's resolved style and attachments.
func (s *Service) renderSegmentCards(ctx context.Context, account models.SocialAccount, rendition models.Rendition, segment models.RenditionSegment, style textcards.Style, attachments int) ([]textcards.Image, string, error) {
	if s == nil || s.storage == nil {
		return nil, "", errors.New("text card storage is unavailable")
	}
	return s.render(ctx, account, segment.Body, rendition.OutputProfile, style, attachments)
}

// clearGeneratedCards removes the generated text-card relations for one segment.
func clearGeneratedCards(ctx context.Context, db bun.IDB, segmentID string) error {
	_, err := db.NewDelete().
		Model((*models.RenditionSegmentMedia)(nil)).
		Where("rendition_segment_id = ? AND role = ?", segmentID, textcards.MediaRole).
		Exec(ctx)
	return err
}

// textCardSource hashes everything the renderer reads, so an unchanged hash
// allows a saved card to be reused without rendering or fetching.
func textCardSource(account models.SocialAccount, rendition models.Rendition, body string, style textcards.Style, attachments int) string {
	fingerprint, _ := json.Marshal(struct {
		Version              int
		Body, Output, Avatar string
		Style                textcards.Style
		Identity             textcards.Identity
		Attachments          int
		// Version 2 covers the renderer change that ellipsizes clipped
		// identity names and handles instead of dropping wrapped lines
		// silently, so existing cards pick up the fix on the next save.
	}{2, body, rendition.OutputProfile, account.AccountAvatarURL, style, Identity(account), attachments})
	hash := sha256.Sum256(fingerprint)
	return hex.EncodeToString(hash[:])
}

func (s *Service) persistGeneratedCards(ctx context.Context, db bun.IDB, account models.SocialAccount, segment models.RenditionSegment, images []textcards.Image, receipt string) error {
	for index, img := range images {
		media, err := s.persist(ctx, db, account.WorkspaceID, segment.Body, img)
		if err != nil {
			return err
		}
		row := models.RenditionSegmentMedia{RenditionSegmentID: segment.ID, MediaID: media.ID, Role: textcards.MediaRole, DisplayOrder: index - len(images), AltText: segment.Body, SettingsJSON: receipt}
		if _, err := db.NewInsert().Model(&row).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

// parseReceipt reads the internal render receipt stored on generated media
// relations. Receipts written before avatar outcomes existed carry no avatar
// field and are treated as reusable, so existing cards are never re-rendered
// merely for missing the new field.
func parseReceipt(previous []models.RenditionSegmentMedia) (string, string) {
	if len(previous) == 0 {
		return "", ""
	}
	var receipt map[string]string
	if err := json.Unmarshal([]byte(previous[0].SettingsJSON), &receipt); err != nil {
		return "", ""
	}
	return receipt["text_card_source"], receipt["text_card_avatar"]
}

func (s *Service) persist(ctx context.Context, db bun.IDB, workspaceID, body string, img textcards.Image) (models.MediaAttachment, error) {
	hash := sha256.Sum256(img.JPEG)
	fileHash := hex.EncodeToString(hash[:])
	var existing models.MediaAttachment
	err := db.NewSelect().Model(&existing).Where("workspace_id = ? AND file_hash = ? AND trashed_at IS NULL", workspaceID, fileHash).Scan(ctx)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return existing, err
	}
	id := uuid.NewString()
	key := id + ".jpg"
	storedPath, err := mediastore.SaveWithContentType(ctx, s.storage, key, bytes.NewReader(img.JPEG), "image/jpeg")
	if err != nil {
		_ = mediastore.DeleteForCleanup(ctx, s.storage, key)
		return existing, err
	}
	if pending, ok := ctx.Value(cleanupKey{}).(*[]pendingAsset); ok {
		*pending = append(*pending, pendingAsset{id: id, key: key, workspaceID: workspaceID})
	} else {
		_ = mediastore.DeleteForCleanup(ctx, s.storage, key)
		return existing, errors.New("text card mutation scope is missing")
	}
	media := models.MediaAttachment{ID: id, WorkspaceID: workspaceID, FilePath: storedPath, StorageType: s.storage.Driver(), MimeType: "image/jpeg", Size: int64(len(img.JPEG)), Width: img.Width, Height: img.Height, OriginalFilename: "text-card.jpg", FileHash: fileHash, Source: "text_card", AssetKind: "library", RetentionClass: "temporary", AltText: body, ProcessingStatus: "ready", ProcessingProgress: 100, AnalysisStatus: "ready", DominantType: "image", AspectRatio: fmt.Sprintf("%d:%d", img.Width, img.Height), ThumbnailsJSON: "{}", LastUsedAt: time.Now().UTC(), CreatedAt: time.Now().UTC()}
	_, err = db.NewInsert().Model(&media).Exec(ctx)
	return media, err
}

// Finalize runs after every rendition's delivery relations are restored. This
// admits the replacement's net storage, while transaction rollback restores old
// media and the Mutation scope removes any new files if admission fails.
func (s *Service) Finalize(ctx context.Context, tx bun.Tx, workspaceID string, previousIDs []string) error {
	if err := medialifecycle.RetireTextCards(ctx, tx, workspaceID, previousIDs); err != nil {
		return err
	}
	pending, _ := ctx.Value(cleanupKey{}).(*[]pendingAsset)
	if pending == nil {
		return nil
	}
	var ids []string
	for _, asset := range *pending {
		if asset.workspaceID == workspaceID {
			ids = append(ids, asset.id)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	var added int64
	if err := tx.NewSelect().Model((*models.MediaAttachment)(nil)).ColumnExpr("COALESCE(SUM(size), 0)").Where("id IN (?)", bun.List(ids)).Scan(ctx, &added); err != nil {
		return err
	}
	if added == 0 {
		return nil
	}
	stored, err := medialifecycle.StoredBytes(ctx, tx, workspaceID, "")
	if err != nil {
		return err
	}
	decision, err := s.quota.Check(ctx, entitlements.Request{WorkspaceID: workspaceID, Limit: entitlements.LimitMediaBytesStored, Current: stored - added, Amount: added})
	if err != nil {
		return err
	}
	if !decision.Allowed {
		return fmt.Errorf("text card storage: %s", decision.Reason)
	}
	return nil
}

func mustJSON(value any) []byte { data, _ := json.Marshal(value); return data }

func segmentAttachments(rows []models.RenditionSegmentMedia) (int, []models.RenditionSegmentMedia) {
	attachments := 0
	var previous []models.RenditionSegmentMedia
	for _, row := range rows {
		if row.Role == textcards.MediaRole {
			previous = append(previous, row)
		} else {
			attachments++
		}
	}
	return attachments, previous
}
