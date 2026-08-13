package posts

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/uptrace/bun"
)

const (
	ThreadDraftPrefix = "__openpost_thread__:"
	severityError     = "error"
)

type UserError struct {
	Message string
}

func (e UserError) Error() string {
	return e.Message
}

type Service struct {
	db *bun.DB
}

func NewService(db *bun.DB) *Service {
	platform.RegisterAllMediaValidators()
	return &Service{db: db}
}

func (s *Service) ValidateScheduledProviderMedia(ctx context.Context, workspaceID string, accountIDs []string, mediaIDs []string) error {
	return validateScheduledProviderMedia(ctx, s.db, workspaceID, accountIDs, mediaIDs)
}

// ValidateScheduledProviderMediaTx performs scheduled-provider validation on
// the caller's transaction. Mutation handlers must use this form after they
// lock and reload an aggregate so SQLite does not need a second connection and
// the validation sees the same snapshot that will be committed.
func (s *Service) ValidateScheduledProviderMediaTx(ctx context.Context, tx bun.IDB, workspaceID string, accountIDs []string, mediaIDs []string) error {
	return validateScheduledProviderMedia(ctx, tx, workspaceID, accountIDs, mediaIDs)
}

func validateScheduledProviderMedia(ctx context.Context, db bun.IDB, workspaceID string, accountIDs []string, mediaIDs []string) error {
	if len(accountIDs) == 0 {
		return nil
	}

	accounts, err := activeAccounts(ctx, db, workspaceID, accountIDs)
	if err != nil {
		return err
	}
	if len(accounts) == 0 {
		return nil
	}

	mediaItems, err := mediaItemsForIDs(ctx, db, workspaceID, mediaIDs)
	if err != nil {
		return err
	}

	for _, account := range accounts {
		for _, issue := range platform.ValidateMedia(account.Platform, mediaItems) {
			if issue.Severity != severityError {
				continue
			}
			return UserError{Message: ProviderMediaIssueMessage(issue)}
		}
		if err := validateStoredXMediaLimits(account, mediaItems, time.Now().UTC()); err != nil {
			return err
		}
	}
	return nil
}

// ValidateScheduledProviderOutput validates the effective content and media for
// one destination through the same provider capability paths used elsewhere.
func (s *Service) ValidateScheduledProviderOutput(ctx context.Context, workspaceID, accountID, content string, mediaIDs []string) error {
	account, err := s.activeAccount(ctx, workspaceID, accountID)
	if err != nil {
		return err
	}
	if account == nil {
		return nil
	}
	provider := account.Platform
	limit, hasLimit := storedAccountTextLimit(*account, time.Now().UTC())
	if hasLimit && capabilities.TextLength(provider, content) > limit {
		return UserError{Message: fmt.Sprintf("Text is over the %d character limit", limit)}
	}
	return s.ValidateScheduledProviderMedia(ctx, workspaceID, []string{accountID}, mediaIDs)
}

func (s *Service) activeAccount(ctx context.Context, workspaceID, accountID string) (*models.SocialAccount, error) {
	var account models.SocialAccount
	if err := s.db.NewSelect().
		Model(&account).
		Column("id", "platform", "capability_state_json", "capability_checked_at").
		Where("workspace_id = ?", workspaceID).
		Where("id = ?", strings.TrimSpace(accountID)).
		Where("is_active = ?", true).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to load social account: %w", err)
	}
	return &account, nil
}

func storedAccountTextLimit(account models.SocialAccount, now time.Time) (int, bool) {
	if account.Platform == capabilities.ProviderX &&
		platform.XStoredCapabilityHasPremiumLimits(account.CapabilityState, account.CapabilityCheckedAt, now) {
		return platform.XPremiumTextLimit, true
	}
	return capabilities.ProviderTextLimit(account.Platform)
}

func activeAccounts(ctx context.Context, db bun.IDB, workspaceID string, accountIDs []string) ([]models.SocialAccount, error) {
	uniqueIDs := uniqueNonEmptyStrings(accountIDs)
	if len(uniqueIDs) == 0 {
		return nil, nil
	}
	var accounts []models.SocialAccount
	if err := db.NewSelect().
		Model(&accounts).
		Column("id", "platform", "capability_state_json", "capability_checked_at").
		Where("workspace_id = ?", workspaceID).
		Where("is_active = ?", true).
		Where("id IN (?)", bun.List(uniqueIDs)).
		Scan(ctx); err != nil {
		return nil, fmt.Errorf("failed to load social accounts: %w", err)
	}
	return accounts, nil
}

func validateStoredXMediaLimits(account models.SocialAccount, media []platform.MediaItem, now time.Time) error {
	if account.Platform != capabilities.ProviderX {
		return nil
	}
	maxSize := int64(platform.XStandardVideoSizeBytes)
	maxDurationSeconds := platform.XStandardVideoDurationSeconds
	sizeLabel := "512 MiB"
	if platform.XStoredCapabilityHasPremiumLimits(account.CapabilityState, account.CapabilityCheckedAt, now) {
		maxSize = platform.XPremiumVideoSizeBytes
		maxDurationSeconds = platform.XPremiumVideoDurationSeconds
		sizeLabel = "16 GiB"
	}
	for _, item := range media {
		if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(item.MimeType)), "video/") {
			continue
		}
		if item.Size > maxSize {
			return UserError{Message: "X video exceeds this account's " + sizeLabel + " size limit"}
		}
		if item.DurationMS > int64(maxDurationSeconds)*1000 {
			return UserError{Message: fmt.Sprintf("X video exceeds this account's %d-second duration limit", maxDurationSeconds)}
		}
	}
	return nil
}

func (s *Service) MediaIDs(ctx context.Context, postID string) ([]string, error) {
	var media []models.PostMedia
	if err := s.db.NewSelect().
		Model(&media).
		Column("media_id", "display_order").
		Where("post_id = ?", postID).
		Order("display_order ASC").
		Scan(ctx); err != nil {
		return nil, fmt.Errorf("failed to load post media: %w", err)
	}

	mediaIDs := make([]string, 0, len(media))
	for _, item := range media {
		mediaIDs = append(mediaIDs, item.MediaID)
	}
	return mediaIDs, nil
}

func IsThreadDraft(content string) bool {
	return len(content) > len(ThreadDraftPrefix) && strings.HasPrefix(content, ThreadDraftPrefix)
}

func ResolveThreadDraftInput(content string, threadDraftField *string) (contentToStore string, draftJSON *string) {
	if threadDraftField != nil {
		if IsThreadDraft(*threadDraftField) && len(*threadDraftField) > len(ThreadDraftPrefix) {
			draft := *threadDraftField
			draftJSON = &draft
		}
		return content, draftJSON
	}
	if IsThreadDraft(content) {
		draft := content
		draftJSON = &draft
		return "", draftJSON
	}
	return content, nil
}

func ThreadDraftMediaIDs(encoded string) []string {
	if !IsThreadDraft(encoded) {
		return nil
	}
	var draft struct {
		P []struct {
			M []string `json:"m"`
		} `json:"p"`
	}
	if err := json.Unmarshal([]byte(encoded[len(ThreadDraftPrefix):]), &draft); err != nil {
		return nil
	}
	var mediaIDs []string
	for _, item := range draft.P {
		mediaIDs = append(mediaIDs, item.M...)
	}
	return mediaIDs
}

func UpsertThreadDraftTx(ctx context.Context, tx bun.Tx, postID string, draftJSON *string) error {
	if draftJSON == nil || *draftJSON == "" {
		_, err := tx.NewDelete().Model((*models.ThreadDraft)(nil)).Where("post_id = ?", postID).Exec(ctx)
		if err != nil {
			return fmt.Errorf("failed to clear thread_drafts for %s: %w", postID, err)
		}
		return nil
	}

	_, err := tx.NewRaw(`
		INSERT INTO thread_drafts (post_id, draft_json, created_at, updated_at)
		VALUES (?, ?, current_timestamp, current_timestamp)
		ON CONFLICT(post_id) DO UPDATE SET
			draft_json = excluded.draft_json,
			updated_at = current_timestamp
	`, postID, *draftJSON).Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to upsert thread_drafts for %s: %w", postID, err)
	}
	return nil
}

func (s *Service) LoadThreadDraft(ctx context.Context, postID string) (*string, error) {
	var draft models.ThreadDraft
	err := s.db.NewSelect().Model(&draft).Where("post_id = ?", postID).Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to load thread_drafts for %s: %w", postID, err)
	}
	return &draft.DraftJSON, nil
}

func GetThreadPostIDsTx(ctx context.Context, tx bun.Tx, rootPostID string, includeRoot bool) ([]string, error) {
	cte := `WITH RECURSIVE thread AS (
		SELECT id FROM posts WHERE id = ?
		UNION ALL
		SELECT p.id FROM posts p JOIN thread t ON p.parent_post_id = t.id
	) SELECT id FROM thread`

	var ids []string
	if err := tx.NewRaw(cte, rootPostID).Scan(ctx, &ids); err != nil {
		return nil, fmt.Errorf("failed to fetch thread posts: %w", err)
	}
	if includeRoot || len(ids) == 0 {
		return ids, nil
	}
	return ids[1:], nil
}

func DeletePostsCascadeTx(ctx context.Context, tx bun.Tx, postIDs []string) error {
	if len(postIDs) == 0 {
		return nil
	}
	if _, err := tx.NewDelete().Model(&models.PostMedia{}).Where("post_id IN (?)", bun.List(postIDs)).Exec(ctx); err != nil {
		return fmt.Errorf("failed to delete post media: %w", err)
	}
	if _, err := tx.NewDelete().Model(&models.PostDestination{}).Where("post_id IN (?)", bun.List(postIDs)).Exec(ctx); err != nil {
		return fmt.Errorf("failed to delete destinations: %w", err)
	}
	if _, err := tx.NewDelete().Model(&models.PostVariant{}).Where("post_id IN (?)", bun.List(postIDs)).Exec(ctx); err != nil {
		return fmt.Errorf("failed to delete variants: %w", err)
	}
	if _, err := tx.NewDelete().Model(&models.Post{}).Where("id IN (?)", bun.List(postIDs)).Exec(ctx); err != nil {
		return fmt.Errorf("failed to delete posts: %w", err)
	}
	return nil
}

func ApplyRandomDelay(scheduledAt time.Time, randomDelayMinutes int) time.Time {
	if randomDelayMinutes <= 0 {
		return scheduledAt
	}

	maxOffset := 2*randomDelayMinutes + 1
	randomOffset := secureRandomInt(maxOffset) - randomDelayMinutes
	return scheduledAt.Add(time.Duration(randomOffset) * time.Minute)
}

func ProviderMediaIssueMessage(issue platform.MediaValidationIssue) string {
	message := strings.TrimSpace(issue.Message)
	if message == "" {
		message = "media is not compatible with this provider"
	}
	if issue.Provider == "" {
		return message
	}
	return fmt.Sprintf("%s: %s", issue.Provider, message)
}

func mediaItemsForIDs(ctx context.Context, db bun.IDB, workspaceID string, mediaIDs []string) ([]platform.MediaItem, error) {
	uniqueIDs := uniqueNonEmptyStrings(mediaIDs)
	if len(uniqueIDs) == 0 {
		return nil, nil
	}

	var media []models.MediaAttachment
	if err := db.NewSelect().
		Model(&media).
		Column("id", "mime_type", "size", "duration_ms", "original_filename").
		Where("workspace_id = ?", workspaceID).
		Where("id IN (?)", bun.List(uniqueIDs)).
		Scan(ctx); err != nil {
		return nil, fmt.Errorf("failed to load media metadata: %w", err)
	}

	mediaByID := make(map[string]models.MediaAttachment, len(media))
	for _, item := range media {
		mediaByID[item.ID] = item
	}

	items := make([]platform.MediaItem, 0, len(mediaIDs))
	for _, mediaID := range mediaIDs {
		item, ok := mediaByID[mediaID]
		if !ok {
			continue
		}
		items = append(items, platform.MediaItem{
			ID:               item.ID,
			MimeType:         item.MimeType,
			Size:             item.Size,
			DurationMS:       item.DurationMS,
			OriginalFilename: item.OriginalFilename,
		})
	}
	return items, nil
}

func uniqueNonEmptyStrings(values []string) []string {
	unique := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		unique = append(unique, value)
	}
	return unique
}

func secureRandomInt(n int) int {
	if n <= 1 {
		return 0
	}

	var buf [8]byte
	if _, err := rand.Read(buf[:]); err == nil {
		return int(binary.BigEndian.Uint64(buf[:]) % uint64(n))
	}

	return int(time.Now().UnixNano() % int64(n))
}
