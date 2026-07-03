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
	if len(accountIDs) == 0 {
		return nil
	}

	platforms, err := s.platformsForAccounts(ctx, workspaceID, accountIDs)
	if err != nil {
		return err
	}
	if len(platforms) == 0 {
		return nil
	}

	mediaItems, err := s.mediaItemsForIDs(ctx, workspaceID, mediaIDs)
	if err != nil {
		return err
	}

	for _, platformName := range platforms {
		for _, issue := range platform.ValidateMedia(platformName, mediaItems) {
			if issue.Severity != severityError {
				continue
			}
			return UserError{Message: ProviderMediaIssueMessage(issue)}
		}
	}
	return nil
}

func (s *Service) DestinationAccountIDs(ctx context.Context, postID string) ([]string, error) {
	var destinations []models.PostDestination
	if err := s.db.NewSelect().
		Model(&destinations).
		Column("social_account_id").
		Where("post_id = ?", postID).
		Order("id ASC").
		Scan(ctx); err != nil {
		return nil, fmt.Errorf("failed to load post destinations: %w", err)
	}

	accountIDs := make([]string, 0, len(destinations))
	for _, destination := range destinations {
		accountIDs = append(accountIDs, destination.SocialAccountID)
	}
	return accountIDs, nil
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

func (s *Service) platformsForAccounts(ctx context.Context, workspaceID string, accountIDs []string) ([]string, error) {
	uniqueIDs := uniqueNonEmptyStrings(accountIDs)
	if len(uniqueIDs) == 0 {
		return nil, nil
	}

	var accounts []models.SocialAccount
	if err := s.db.NewSelect().
		Model(&accounts).
		Column("id", "platform").
		Where("workspace_id = ?", workspaceID).
		Where("is_active = ?", true).
		Where("id IN (?)", bun.List(uniqueIDs)).
		Scan(ctx); err != nil {
		return nil, fmt.Errorf("failed to load social account platforms: %w", err)
	}

	platformByID := make(map[string]string, len(accounts))
	for _, account := range accounts {
		platformByID[account.ID] = account.Platform
	}

	platforms := make([]string, 0, len(accounts))
	seenPlatforms := make(map[string]struct{}, len(accounts))
	for _, accountID := range uniqueIDs {
		platformName := platformByID[accountID]
		if platformName == "" {
			continue
		}
		if _, seen := seenPlatforms[platformName]; seen {
			continue
		}
		seenPlatforms[platformName] = struct{}{}
		platforms = append(platforms, platformName)
	}
	return platforms, nil
}

func (s *Service) mediaItemsForIDs(ctx context.Context, workspaceID string, mediaIDs []string) ([]platform.MediaItem, error) {
	uniqueIDs := uniqueNonEmptyStrings(mediaIDs)
	if len(uniqueIDs) == 0 {
		return nil, nil
	}

	var media []models.MediaAttachment
	if err := s.db.NewSelect().
		Model(&media).
		Column("id", "mime_type", "size", "original_filename").
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
