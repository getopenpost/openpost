package migrations

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

const legacyThreadDraftPrefix = "__openpost_thread__:"

type legacyThreadDraft struct {
	Posts    []legacyThreadPost                          `json:"p"`
	Variants map[string]map[string]legacyThreadVariation `json:"v"`
}

type legacyThreadPost struct {
	Key      string   `json:"k"`
	Content  string   `json:"c"`
	MediaIDs []string `json:"m"`
}

type legacyThreadVariation struct {
	Content  string   `json:"content"`
	MediaIDs []string `json:"mediaIds"`
}

func migrateLegacyPublicationAuthoring(ctx context.Context, db *bun.DB) error {
	var posts []models.Post
	if err := db.NewSelect().
		Model(&posts).
		Where("status IN (?)", bun.List([]string{models.PostStatusDraft, models.PostStatusScheduled})).
		Where("COALESCE(publication_id, '') = ''").
		Order("created_at ASC", "id ASC").
		Scan(ctx); err != nil {
		if isMissingLegacyAuthoringTable(err) {
			return nil
		}
		return err
	}
	for index := range posts {
		post := posts[index]
		eligible, err := legacyPostHasOwners(ctx, db, post)
		if err != nil {
			return err
		}
		if !eligible {
			continue
		}
		if err := migrateLegacyPost(ctx, db, post); err != nil {
			return fmt.Errorf("post %s: %w", post.ID, err)
		}
	}
	return nil
}

// MigrateLegacyPublicationAuthoring translates draft and scheduled legacy
// posts created through compatibility APIs into canonical publications.
func MigrateLegacyPublicationAuthoring(ctx context.Context, db *bun.DB) error {
	return migrateLegacyPublicationAuthoring(ctx, db)
}

// SyncTextPostAuthoring applies a text-and-thread composer mutation to its
// linked canonical publication.
func SyncTextPostAuthoring(ctx context.Context, db *bun.DB, postID string) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		return SyncTextPostAuthoringTx(txCtx, tx, postID)
	})
}

// RefreshLegacyPublicationAuthoring is retained as a source-compatible alias
// for integrations built before the text composer became a first-class path.
func RefreshLegacyPublicationAuthoring(ctx context.Context, db *bun.DB, postID string) error {
	return SyncTextPostAuthoring(ctx, db, postID)
}

// SyncTextPostAuthoringTx keeps the text composer row, its destinations,
// variants, segments, media, and canonical publication in one transaction.
//
//nolint:gocyclo
func SyncTextPostAuthoringTx(ctx context.Context, tx bun.Tx, postID string) error {
	var changed models.Post
	if err := tx.NewSelect().Model(&changed).Where("id = ?", postID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) || isMissingLegacyAuthoringTable(err) {
			return nil
		}
		return err
	}
	if changed.PublicationID == "" {
		return nil
	}
	var threadPosts []models.Post
	if err := tx.NewSelect().
		Model(&threadPosts).
		Where("publication_id = ?", changed.PublicationID).
		Order("thread_sequence ASC", "created_at ASC", "id ASC").
		Scan(ctx); err != nil {
		return err
	}
	if len(threadPosts) == 0 {
		return nil
	}
	root := threadPosts[0]
	segments, threadDraft, err := legacySegments(ctx, tx, root)
	if err != nil {
		return err
	}
	var publication models.Publication
	if err := tx.NewSelect().Model(&publication).Where("id = ?", changed.PublicationID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	publication.Intent = models.PublishingIntentPost
	publication.ContentProfile = models.ContentProfileShortText
	if len(segments) > 1 || threadDraft != nil {
		publication.Intent = models.PublishingIntentThread
		publication.ContentProfile = models.ContentProfileThread
	}
	publication.Title = legacyPublicationTitle(segments, publication.Intent)
	publication.SourceText = firstLegacySegmentBody(segments)
	publication.SourceContent = publication.SourceText
	publication.Status = legacyPublicationStatus(root.Status)
	publication.ScheduledAt = root.ScheduledAt
	publication.ActualRunAt = root.ActualRunAt
	publication.UpdatedAt = time.Now().UTC()
	if _, err := tx.NewUpdate().
		Model(&publication).
		Column("title", "intent", "content_profile", "source_text", "source_content", "status", "scheduled_at", "actual_run_at", "updated_at").
		Where("id = ?", publication.ID).
		Exec(ctx); err != nil {
		return err
	}

	preservedSettings, err := loadLegacyAuthoringSettings(ctx, tx, publication.ID)
	if err != nil {
		return err
	}
	var renditionIDs []string
	if err := tx.NewSelect().
		Model((*models.Rendition)(nil)).
		Column("id").
		Where("publication_id = ?", publication.ID).
		Scan(ctx, &renditionIDs); err != nil {
		return err
	}
	if len(renditionIDs) > 0 {
		if _, err := tx.NewDelete().
			Model((*models.RenditionMedia)(nil)).
			Where("rendition_id IN (?)", bun.List(renditionIDs)).
			Exec(ctx); err != nil {
			return err
		}
	}
	if _, err := tx.NewDelete().
		Model((*models.Rendition)(nil)).
		Where("publication_id = ?", publication.ID).
		Exec(ctx); err != nil {
		return err
	}
	if _, err := tx.NewDelete().
		Model((*models.PublicationSegment)(nil)).
		Where("publication_id = ?", publication.ID).
		Exec(ctx); err != nil {
		return err
	}
	segmentModels, err := insertLegacyPublicationSegments(ctx, tx, publication, segments)
	if err != nil {
		return err
	}
	if err := insertLegacyRenditions(ctx, tx, publication, root, segmentModels, segments, threadDraft); err != nil {
		return err
	}
	if err := restoreLegacyAuthoringSettings(ctx, tx, preservedSettings); err != nil {
		return err
	}
	if err := rewriteLegacyPublicationJobs(ctx, tx, root.ID, publication.ID); err != nil {
		return err
	}
	return syncLegacyPublicationJobs(ctx, tx, root, publication.ID)
}

type legacyRenditionSettings struct {
	SettingsJSON  string
	Profile       string
	OutputProfile string
}

type legacyAuthoringSettings struct {
	publicationID           string
	publicationSegments     map[int]string
	publicationSegmentMedia map[string]string
	renditions              map[string]legacyRenditionSettings
	renditionSegments       map[string]string
	renditionSegmentMedia   map[string]models.RenditionSegmentMedia
}

func loadLegacyAuthoringSettings(
	ctx context.Context,
	db bun.IDB,
	publicationID string,
) (legacyAuthoringSettings, error) {
	snapshot := legacyAuthoringSettings{
		publicationID:           publicationID,
		publicationSegments:     map[int]string{},
		publicationSegmentMedia: map[string]string{},
		renditions:              map[string]legacyRenditionSettings{},
		renditionSegments:       map[string]string{},
		renditionSegmentMedia:   map[string]models.RenditionSegmentMedia{},
	}
	var publicationSegments []models.PublicationSegment
	if err := db.NewSelect().
		Model(&publicationSegments).
		Where("publication_id = ?", publicationID).
		Scan(ctx); err != nil {
		return snapshot, err
	}
	segmentIDs := make([]string, 0, len(publicationSegments))
	segmentPositions := make(map[string]int, len(publicationSegments))
	for _, segment := range publicationSegments {
		segmentIDs = append(segmentIDs, segment.ID)
		segmentPositions[segment.ID] = segment.Position
		snapshot.publicationSegments[segment.Position] = segment.SettingsJSON
	}
	if len(segmentIDs) > 0 {
		var media []models.PublicationSegmentMedia
		if err := db.NewSelect().
			Model(&media).
			Where("segment_id IN (?)", bun.List(segmentIDs)).
			Scan(ctx); err != nil {
			return snapshot, err
		}
		for _, item := range media {
			snapshot.publicationSegmentMedia[legacySettingsKey(
				strconv.Itoa(segmentPositions[item.SegmentID]),
				item.MediaID,
			)] =
				item.SettingsJSON
		}
	}

	var renditions []models.Rendition
	if err := db.NewSelect().
		Model(&renditions).
		Where("publication_id = ?", publicationID).
		Scan(ctx); err != nil {
		return snapshot, err
	}
	renditionIDs := make([]string, 0, len(renditions))
	renditionAccounts := make(map[string]string, len(renditions))
	for _, rendition := range renditions {
		renditionIDs = append(renditionIDs, rendition.ID)
		renditionAccounts[rendition.ID] = rendition.SocialAccountID
		snapshot.renditions[rendition.SocialAccountID] = legacyRenditionSettings{
			SettingsJSON:  rendition.SettingsJSON,
			Profile:       rendition.Profile,
			OutputProfile: rendition.OutputProfile,
		}
	}
	if len(renditionIDs) == 0 {
		return snapshot, nil
	}
	var renditionSegments []models.RenditionSegment
	if err := db.NewSelect().
		Model(&renditionSegments).
		Where("rendition_id IN (?)", bun.List(renditionIDs)).
		Scan(ctx); err != nil {
		return snapshot, err
	}
	renditionSegmentIDs := make([]string, 0, len(renditionSegments))
	renditionSegmentScopes := make(map[string]string, len(renditionSegments))
	for _, segment := range renditionSegments {
		renditionSegmentIDs = append(renditionSegmentIDs, segment.ID)
		scope := legacySettingsKey(
			renditionAccounts[segment.RenditionID],
			strconv.Itoa(segment.Position),
		)
		renditionSegmentScopes[segment.ID] = scope
		snapshot.renditionSegments[scope] = segment.SettingsJSON
	}
	if len(renditionSegmentIDs) > 0 {
		var media []models.RenditionSegmentMedia
		if err := db.NewSelect().
			Model(&media).
			Where("rendition_segment_id IN (?)", bun.List(renditionSegmentIDs)).
			Scan(ctx); err != nil {
			return snapshot, err
		}
		for _, item := range media {
			scope := renditionSegmentScopes[item.RenditionSegmentID]
			snapshot.renditionSegmentMedia[legacySettingsKey(scope, item.MediaID)] = item
		}
	}
	return snapshot, nil
}

func restoreLegacyAuthoringSettings(
	ctx context.Context,
	db bun.IDB,
	snapshot legacyAuthoringSettings,
) error {
	segmentIDsByPosition, err := restoreLegacyPublicationSegmentSettings(ctx, db, snapshot)
	if err != nil {
		return err
	}
	if err := restoreLegacyPublicationMediaSettings(ctx, db, snapshot, segmentIDsByPosition); err != nil {
		return err
	}
	renditionIDsByAccount, renditionSegmentIDsByScope, err := loadRestoredLegacyRenditionScopes(
		ctx,
		db,
		snapshot.publicationID,
	)
	if err != nil {
		return err
	}
	if err := restoreLegacyRenditionSettings(ctx, db, snapshot, renditionIDsByAccount); err != nil {
		return err
	}
	if err := restoreLegacyRenditionSegmentSettings(ctx, db, snapshot, renditionSegmentIDsByScope); err != nil {
		return err
	}
	return restoreLegacyRenditionMediaSettings(ctx, db, snapshot, renditionSegmentIDsByScope)
}

func restoreLegacyPublicationSegmentSettings(
	ctx context.Context,
	db bun.IDB,
	snapshot legacyAuthoringSettings,
) (map[int]string, error) {
	var publicationSegments []models.PublicationSegment
	if err := db.NewSelect().
		Model(&publicationSegments).
		Where("publication_id = ?", snapshot.publicationID).
		Scan(ctx); err != nil {
		return nil, err
	}
	segmentIDsByPosition := make(map[int]string, len(publicationSegments))
	for _, segment := range publicationSegments {
		segmentIDsByPosition[segment.Position] = segment.ID
	}
	for position, settingsJSON := range snapshot.publicationSegments {
		segmentID := segmentIDsByPosition[position]
		if segmentID == "" {
			continue
		}
		if _, err := db.NewUpdate().
			Model((*models.PublicationSegment)(nil)).
			Set("settings_json = ?", settingsJSON).
			Where("id = ?", segmentID).
			Exec(ctx); err != nil {
			return nil, err
		}
	}
	return segmentIDsByPosition, nil
}

func restoreLegacyPublicationMediaSettings(
	ctx context.Context,
	db bun.IDB,
	snapshot legacyAuthoringSettings,
	segmentIDsByPosition map[int]string,
) error {
	for key, settingsJSON := range snapshot.publicationSegmentMedia {
		parts := strings.SplitN(key, "\x00", 2)
		if len(parts) != 2 {
			continue
		}
		position, err := strconv.Atoi(parts[0])
		if err != nil {
			continue
		}
		segmentID := segmentIDsByPosition[position]
		mediaID := parts[1]
		if segmentID == "" {
			continue
		}
		if _, err := db.NewUpdate().
			Model((*models.PublicationSegmentMedia)(nil)).
			Set("settings_json = ?", settingsJSON).
			Where("segment_id = ? AND media_id = ?", segmentID, mediaID).
			Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func loadRestoredLegacyRenditionScopes(
	ctx context.Context,
	db bun.IDB,
	publicationID string,
) (map[string]string, map[string]string, error) {
	var renditions []models.Rendition
	if err := db.NewSelect().
		Model(&renditions).
		Where("publication_id = ?", publicationID).
		Scan(ctx); err != nil {
		return nil, nil, err
	}
	renditionIDsByAccount := make(map[string]string, len(renditions))
	for _, rendition := range renditions {
		renditionIDsByAccount[rendition.SocialAccountID] = rendition.ID
	}
	renditionIDs := make([]string, 0, len(renditions))
	renditionAccounts := make(map[string]string, len(renditions))
	for _, rendition := range renditions {
		renditionIDs = append(renditionIDs, rendition.ID)
		renditionAccounts[rendition.ID] = rendition.SocialAccountID
	}
	var renditionSegments []models.RenditionSegment
	if len(renditionIDs) > 0 {
		if err := db.NewSelect().
			Model(&renditionSegments).
			Where("rendition_id IN (?)", bun.List(renditionIDs)).
			Scan(ctx); err != nil {
			return nil, nil, err
		}
	}
	renditionSegmentIDsByScope := make(map[string]string, len(renditionSegments))
	for _, segment := range renditionSegments {
		scope := legacySettingsKey(
			renditionAccounts[segment.RenditionID],
			strconv.Itoa(segment.Position),
		)
		renditionSegmentIDsByScope[scope] = segment.ID
	}
	return renditionIDsByAccount, renditionSegmentIDsByScope, nil
}

func restoreLegacyRenditionSettings(
	ctx context.Context,
	db bun.IDB,
	snapshot legacyAuthoringSettings,
	renditionIDsByAccount map[string]string,
) error {
	for accountID, settings := range snapshot.renditions {
		renditionID := renditionIDsByAccount[accountID]
		if renditionID == "" {
			continue
		}
		if _, err := db.NewUpdate().
			Model((*models.Rendition)(nil)).
			Set("settings_json = ?", settings.SettingsJSON).
			Set("profile = ?", settings.Profile).
			Set("output_profile = ?", settings.OutputProfile).
			Where("id = ?", renditionID).
			Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func restoreLegacyRenditionSegmentSettings(
	ctx context.Context,
	db bun.IDB,
	snapshot legacyAuthoringSettings,
	renditionSegmentIDsByScope map[string]string,
) error {
	for scope, settingsJSON := range snapshot.renditionSegments {
		segmentID := renditionSegmentIDsByScope[scope]
		if segmentID == "" {
			continue
		}
		if _, err := db.NewUpdate().
			Model((*models.RenditionSegment)(nil)).
			Set("settings_json = ?", settingsJSON).
			Where("id = ?", segmentID).
			Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func restoreLegacyRenditionMediaSettings(
	ctx context.Context,
	db bun.IDB,
	snapshot legacyAuthoringSettings,
	renditionSegmentIDsByScope map[string]string,
) error {
	for key, media := range snapshot.renditionSegmentMedia {
		parts := strings.SplitN(key, "\x00", 3)
		if len(parts) != 3 {
			continue
		}
		scope := legacySettingsKey(parts[0], parts[1])
		segmentID := renditionSegmentIDsByScope[scope]
		mediaID := parts[2]
		if segmentID == "" {
			continue
		}
		if _, err := db.NewUpdate().
			Model((*models.RenditionSegmentMedia)(nil)).
			Set("alt_text = ?", media.AltText).
			Set("thumbnail_timestamp_ms = ?", media.ThumbnailTimestampMS).
			Set("settings_json = ?", media.SettingsJSON).
			Where("rendition_segment_id = ? AND media_id = ?", segmentID, mediaID).
			Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func legacySettingsKey(parts ...string) string {
	return strings.Join(parts, "\x00")
}

func legacyPostHasOwners(ctx context.Context, db bun.IDB, post models.Post) (bool, error) {
	workspaceCount, err := db.NewSelect().
		Model((*models.Workspace)(nil)).
		Where("id = ?", post.WorkspaceID).
		Count(ctx)
	if err != nil {
		if isMissingLegacyAuthoringTable(err) {
			return false, nil
		}
		return false, err
	}
	userCount, err := db.NewSelect().
		Model((*models.User)(nil)).
		Where("id = ?", post.CreatedByID).
		Count(ctx)
	if err != nil {
		if isMissingLegacyAuthoringTable(err) {
			return false, nil
		}
		return false, err
	}
	return workspaceCount == 1 && userCount == 1, nil
}

func migrateLegacyPost(ctx context.Context, db *bun.DB, post models.Post) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var current models.Post
		if err := tx.NewSelect().Model(&current).Where("id = ?", post.ID).Scan(txCtx); err != nil {
			return err
		}
		if current.PublicationID != "" {
			return nil
		}
		segments, threadDraft, err := legacySegments(txCtx, tx, current)
		if err != nil {
			return err
		}
		publicationID := "legacy-publication:" + current.ID
		intent := models.PublishingIntentPost
		profile := models.ContentProfileShortText
		if len(segments) > 1 || threadDraft != nil {
			intent = models.PublishingIntentThread
			profile = models.ContentProfileThread
		}
		now := time.Now().UTC()
		publication := models.Publication{
			ID:              publicationID,
			WorkspaceID:     current.WorkspaceID,
			CreatedByID:     current.CreatedByID,
			Title:           legacyPublicationTitle(segments, intent),
			Intent:          intent,
			ContentProfile:  profile,
			SourceText:      firstLegacySegmentBody(segments),
			SourceContent:   firstLegacySegmentBody(segments),
			Status:          legacyPublicationStatus(current.Status),
			ScheduledAt:     current.ScheduledAt,
			ActualRunAt:     current.ActualRunAt,
			MetadataJSON:    `{"migrated_from":"posts"}`,
			ReleasePlanJSON: `{"migrated_from":"posts"}`,
			CreatedAt:       current.CreatedAt,
			UpdatedAt:       now,
		}
		if _, err := tx.NewInsert().Model(&publication).Ignore().Exec(txCtx); err != nil {
			return err
		}
		segmentModels, err := insertLegacyPublicationSegments(txCtx, tx, publication, segments)
		if err != nil {
			return err
		}
		if err := insertLegacyRenditions(txCtx, tx, publication, current, segmentModels, segments, threadDraft); err != nil {
			return err
		}
		threadPosts, err := legacyThreadPosts(txCtx, tx, current)
		if err != nil {
			return err
		}
		postIDs := make([]string, 0, len(threadPosts))
		for _, threadPost := range threadPosts {
			postIDs = append(postIDs, threadPost.ID)
		}
		if _, err := tx.NewUpdate().
			Model((*models.Post)(nil)).
			Set("publication_id = ?", publicationID).
			Where("id IN (?)", bun.List(postIDs)).
			Exec(txCtx); err != nil {
			return err
		}
		return rewriteLegacyPublicationJobs(txCtx, tx, current.ID, publicationID)
	})
}

func legacySegments(ctx context.Context, db bun.IDB, post models.Post) ([]legacyThreadPost, *legacyThreadDraft, error) {
	var draft models.ThreadDraft
	err := db.NewSelect().Model(&draft).Where("post_id = ?", post.ID).Scan(ctx)
	if err == nil {
		if decoded := decodeLegacyThreadDraft(draft.DraftJSON); decoded != nil && len(decoded.Posts) > 0 {
			return decoded.Posts, decoded, nil
		}
	} else if !errors.Is(err, sql.ErrNoRows) && !isMissingLegacyAuthoringTable(err) {
		return nil, nil, err
	}

	children, err := legacyThreadPosts(ctx, db, post)
	if err != nil {
		return nil, nil, err
	}
	if len(children) == 0 {
		children = []models.Post{post}
	}
	segments := make([]legacyThreadPost, 0, len(children))
	for index, child := range children {
		mediaIDs, err := legacyPostMediaIDs(ctx, db, child.ID)
		if err != nil {
			return nil, nil, err
		}
		segments = append(segments, legacyThreadPost{
			Key:      fmt.Sprintf("%s-%d", post.ID, index),
			Content:  child.Content,
			MediaIDs: mediaIDs,
		})
	}
	return segments, nil, nil
}

func legacyThreadPosts(ctx context.Context, db bun.IDB, root models.Post) ([]models.Post, error) {
	var candidates []models.Post
	if err := db.NewSelect().
		Model(&candidates).
		Where("workspace_id = ?", root.WorkspaceID).
		Order("thread_sequence ASC", "created_at ASC", "id ASC").
		Scan(ctx); err != nil {
		return nil, err
	}
	byParent := map[string][]models.Post{}
	for _, candidate := range candidates {
		byParent[candidate.ParentPostID] = append(byParent[candidate.ParentPostID], candidate)
	}
	out := []models.Post{root}
	seen := map[string]bool{root.ID: true}
	currentID := root.ID
	for {
		children := byParent[currentID]
		next := models.Post{}
		for _, child := range children {
			if !seen[child.ID] {
				next = child
				break
			}
		}
		if next.ID == "" {
			break
		}
		out = append(out, next)
		seen[next.ID] = true
		currentID = next.ID
	}
	return out, nil
}

func decodeLegacyThreadDraft(raw string) *legacyThreadDraft {
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(raw, legacyThreadDraftPrefix) {
		return nil
	}
	var draft legacyThreadDraft
	if err := json.Unmarshal([]byte(strings.TrimPrefix(raw, legacyThreadDraftPrefix)), &draft); err != nil {
		return nil
	}
	return &draft
}

func legacyPostMediaIDs(ctx context.Context, db bun.IDB, postID string) ([]string, error) {
	var rows []models.PostMedia
	if err := db.NewSelect().
		Model(&rows).
		Where("post_id = ?", postID).
		Order("display_order ASC").
		Scan(ctx); err != nil {
		if isMissingLegacyAuthoringTable(err) {
			return nil, nil
		}
		return nil, err
	}
	out := make([]string, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.MediaID)
	}
	return out, nil
}

func insertLegacyPublicationSegments(
	ctx context.Context,
	tx bun.Tx,
	publication models.Publication,
	segments []legacyThreadPost,
) ([]models.PublicationSegment, error) {
	out := make([]models.PublicationSegment, 0, len(segments))
	for position, input := range segments {
		segment := models.PublicationSegment{
			ID:            fmt.Sprintf("legacy-segment:%s:%d", publication.ID, position),
			PublicationID: publication.ID,
			Position:      position,
			Body:          input.Content,
			SettingsJSON:  "{}",
			CreatedAt:     publication.CreatedAt,
			UpdatedAt:     publication.UpdatedAt,
		}
		if _, err := tx.NewInsert().Model(&segment).Ignore().Exec(ctx); err != nil {
			return nil, err
		}
		validMedia, err := existingLegacyMediaIDs(ctx, tx, input.MediaIDs)
		if err != nil {
			return nil, err
		}
		for displayOrder, mediaID := range validMedia {
			row := models.PublicationSegmentMedia{
				SegmentID:    segment.ID,
				MediaID:      mediaID,
				DisplayOrder: displayOrder,
				SettingsJSON: "{}",
			}
			if _, err := tx.NewInsert().Model(&row).Ignore().Exec(ctx); err != nil {
				return nil, err
			}
		}
		out = append(out, segment)
	}
	return out, nil
}

//nolint:gocyclo
func insertLegacyRenditions(
	ctx context.Context,
	tx bun.Tx,
	publication models.Publication,
	post models.Post,
	segments []models.PublicationSegment,
	segmentInputs []legacyThreadPost,
	threadDraft *legacyThreadDraft,
) error {
	accountIDs, err := legacyDestinationAccountIDs(ctx, tx, post.ID)
	if err != nil {
		return err
	}
	for _, accountID := range accountIDs {
		var account models.SocialAccount
		if err := tx.NewSelect().Model(&account).Where("id = ?", accountID).Scan(ctx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			return err
		}
		renditionID := "legacy-rendition:" + post.ID + ":" + account.ID
		rendition := models.Rendition{
			ID:              renditionID,
			PublicationID:   publication.ID,
			SocialAccountID: account.ID,
			Platform:        account.Platform,
			Profile:         publication.ContentProfile,
			OutputProfile:   legacyOutputProfile(account.Platform, publication.Intent),
			Body:            publication.SourceText,
			Title:           publication.Title,
			SettingsJSON:    "{}",
			Status:          legacyRenditionStatus(post.Status),
			CreatedAt:       publication.CreatedAt,
			UpdatedAt:       publication.UpdatedAt,
		}
		if _, err := tx.NewInsert().Model(&rendition).Ignore().Exec(ctx); err != nil {
			return err
		}
		for position, canonical := range segments {
			body := canonical.Body
			mediaIDs := segmentInputs[position].MediaIDs
			if threadDraft != nil {
				if variation, ok := threadDraft.Variants[account.ID][segmentInputs[position].Key]; ok {
					if strings.TrimSpace(variation.Content) != "" {
						body = variation.Content
					}
					if variation.MediaIDs != nil {
						mediaIDs = variation.MediaIDs
					}
				}
			} else if position == 0 {
				var variant models.PostVariant
				if err := tx.NewSelect().
					Model(&variant).
					Where("post_id = ? AND social_account_id = ?", post.ID, account.ID).
					Scan(ctx); err == nil {
					if strings.TrimSpace(variant.Content) != "" {
						body = variant.Content
					}
					var variantMedia []string
					if json.Unmarshal([]byte(variant.MediaIDs), &variantMedia) == nil && variantMedia != nil {
						mediaIDs = variantMedia
					}
				} else if !errors.Is(err, sql.ErrNoRows) && !isMissingLegacyAuthoringTable(err) {
					return err
				}
			}
			renditionSegment := models.RenditionSegment{
				ID:                   fmt.Sprintf("legacy-rendition-segment:%s:%d", renditionID, position),
				RenditionID:          renditionID,
				PublicationSegmentID: canonical.ID,
				Position:             position,
				Body:                 body,
				SettingsJSON:         "{}",
				Status:               rendition.Status,
				CreatedAt:            publication.CreatedAt,
				UpdatedAt:            publication.UpdatedAt,
			}
			if _, err := tx.NewInsert().Model(&renditionSegment).Ignore().Exec(ctx); err != nil {
				return err
			}
			validMedia, err := existingLegacyMediaIDs(ctx, tx, mediaIDs)
			if err != nil {
				return err
			}
			for displayOrder, mediaID := range validMedia {
				row := models.RenditionSegmentMedia{
					RenditionSegmentID: renditionSegment.ID,
					MediaID:            mediaID,
					Role:               "attachment",
					DisplayOrder:       displayOrder,
					SettingsJSON:       "{}",
				}
				if _, err := tx.NewInsert().Model(&row).Ignore().Exec(ctx); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func existingLegacyMediaIDs(ctx context.Context, db bun.IDB, ids []string) ([]string, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	var rows []string
	if err := db.NewSelect().
		Model((*models.MediaAttachment)(nil)).
		Column("id").
		Where("id IN (?)", bun.List(ids)).
		Scan(ctx, &rows); err != nil {
		return nil, err
	}
	exists := make(map[string]struct{}, len(rows))
	for _, id := range rows {
		exists[id] = struct{}{}
	}
	out := make([]string, 0, len(rows))
	for _, id := range ids {
		if _, ok := exists[id]; ok {
			out = append(out, id)
		}
	}
	return out, nil
}

func legacyDestinationAccountIDs(ctx context.Context, db bun.IDB, postID string) ([]string, error) {
	var rows []models.PostDestination
	if err := db.NewSelect().Model(&rows).Where("post_id = ?", postID).Scan(ctx); err != nil {
		if isMissingLegacyAuthoringTable(err) {
			return nil, nil
		}
		return nil, err
	}
	seen := map[string]struct{}{}
	out := []string{}
	for _, row := range rows {
		if _, ok := seen[row.SocialAccountID]; ok {
			continue
		}
		seen[row.SocialAccountID] = struct{}{}
		out = append(out, row.SocialAccountID)
	}
	return out, nil
}

//nolint:gocyclo
func rewriteLegacyPublicationJobs(ctx context.Context, db bun.IDB, postID, publicationID string) error {
	var root models.Post
	if err := db.NewSelect().Model(&root).Where("id = ?", postID).Scan(ctx); err != nil {
		return err
	}
	posts, err := legacyThreadPosts(ctx, db, root)
	if err != nil {
		return err
	}
	postIDs := map[string]struct{}{postID: {}}
	for _, post := range posts {
		postIDs[post.ID] = struct{}{}
	}
	var jobs []models.Job
	if err := db.NewSelect().
		Model(&jobs).
		Where("type = ? AND status = ?", "publish_post", "pending").
		Scan(ctx); err != nil {
		if isMissingLegacyAuthoringTable(err) {
			return nil
		}
		return err
	}
	candidates := make([]models.Job, 0, len(jobs))
	for _, job := range jobs {
		payload := map[string]interface{}{}
		if json.Unmarshal([]byte(job.Payload), &payload) != nil {
			continue
		}
		if _, ok := postIDs[strings.TrimSpace(fmt.Sprint(payload["post_id"]))]; !ok {
			continue
		}
		candidates = append(candidates, job)
	}
	if len(candidates) == 0 {
		return nil
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].RunAt.Equal(candidates[j].RunAt) {
			return candidates[i].ID < candidates[j].ID
		}
		return candidates[i].RunAt.Before(candidates[j].RunAt)
	})
	for index, job := range candidates {
		if index > 0 {
			if _, err := db.NewDelete().Model(&job).Where("id = ?", job.ID).Exec(ctx); err != nil {
				return err
			}
			continue
		}
		payload := map[string]interface{}{}
		_ = json.Unmarshal([]byte(job.Payload), &payload)
		delete(payload, "post_id")
		payload["publication_id"] = publicationID
		encoded, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		if _, err := db.NewUpdate().
			Model(&job).
			Set("type = ?", "publish_publication").
			Set("payload = ?", string(encoded)).
			Where("id = ?", job.ID).
			Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func syncLegacyPublicationJobs(ctx context.Context, db bun.IDB, root models.Post, publicationID string) error {
	var jobs []models.Job
	if err := db.NewSelect().
		Model(&jobs).
		Where("type = ? AND status = ?", "publish_publication", "pending").
		Scan(ctx); err != nil {
		if isMissingLegacyAuthoringTable(err) {
			return nil
		}
		return err
	}
	matching := make([]models.Job, 0, len(jobs))
	for _, job := range jobs {
		payload := map[string]interface{}{}
		if json.Unmarshal([]byte(job.Payload), &payload) == nil &&
			strings.TrimSpace(fmt.Sprint(payload["publication_id"])) == publicationID {
			matching = append(matching, job)
		}
	}
	if root.Status != models.PostStatusScheduled {
		for _, job := range matching {
			if _, err := db.NewDelete().Model(&job).Where("id = ?", job.ID).Exec(ctx); err != nil {
				return err
			}
		}
		return nil
	}
	runAt := root.ActualRunAt
	if runAt.IsZero() {
		runAt = root.ScheduledAt
	}
	if len(matching) == 0 {
		payload, err := json.Marshal(map[string]string{"publication_id": publicationID})
		if err != nil {
			return err
		}
		job := models.Job{
			ID:          fmt.Sprintf("legacy-publication-job:%s", root.ID),
			Type:        "publish_publication",
			Payload:     string(payload),
			Status:      "pending",
			RunAt:       runAt,
			MaxAttempts: 3,
		}
		_, err = db.NewInsert().Model(&job).Exec(ctx)
		return err
	}
	kept := matching[len(matching)-1]
	if _, err := db.NewUpdate().
		Model(&kept).
		Set("run_at = ?", runAt).
		Where("id = ?", kept.ID).
		Exec(ctx); err != nil {
		return err
	}
	for _, job := range matching[:len(matching)-1] {
		if _, err := db.NewDelete().Model(&job).Where("id = ?", job.ID).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func legacyPublicationTitle(segments []legacyThreadPost, intent string) string {
	title := strings.TrimSpace(firstLegacySegmentBody(segments))
	if newline := strings.IndexByte(title, '\n'); newline >= 0 {
		title = title[:newline]
	}
	runes := []rune(title)
	if len(runes) > 100 {
		title = string(runes[:100])
	}
	if title != "" {
		return title
	}
	if intent == models.PublishingIntentThread {
		return "Untitled thread"
	}
	return "Untitled post"
}

func firstLegacySegmentBody(segments []legacyThreadPost) string {
	if len(segments) == 0 {
		return ""
	}
	return segments[0].Content
}

func legacyPublicationStatus(status string) string {
	if status == models.PostStatusScheduled {
		return models.PublicationStatusScheduled
	}
	return models.PublicationStatusDraft
}

func legacyRenditionStatus(status string) string {
	if status == models.PostStatusScheduled {
		return models.RenditionStatusScheduled
	}
	return models.RenditionStatusDraft
}

func legacyOutputProfile(provider, intent string) string {
	suffix := "post"
	switch intent {
	case models.PublishingIntentThread:
		suffix = "thread"
	case models.PublishingIntentStory:
		suffix = "story"
	case models.PublishingIntentShortVideo:
		if provider == "youtube" {
			suffix = "short"
		} else {
			suffix = "video"
		}
	case models.PublishingIntentVideo:
		suffix = "video"
	}
	return provider + "." + suffix
}

func isMissingLegacyAuthoringTable(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such table") ||
		(strings.Contains(message, "relation") && strings.Contains(message, "does not exist"))
}
