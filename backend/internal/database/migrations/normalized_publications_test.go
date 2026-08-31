package migrations

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/publicationauth"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestNormalizedPublicationMigrationBackfillsOneSegmentAndCascades(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	runMigrationsThrough(t, db, 33)

	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws-normalized", Name: "Normalized"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID:             "account-normalized",
		WorkspaceID:    "ws-normalized",
		Platform:       "linkedin",
		AccountID:      "person-1",
		AccessTokenEnc: []byte("token"),
		IsActive:       true,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.MediaAttachment{
		ID:               "media-normalized",
		WorkspaceID:      "ws-normalized",
		FilePath:         "document.pdf",
		MimeType:         "application/pdf",
		ProcessingStatus: "ready",
		FileHash:         "normalized-document",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO publications (
			id, workspace_id, created_by, title, source_content, source_text,
			content_profile, status, release_plan_json, metadata_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', '{}')`,
		"publication-normalized", "ws-normalized", "user-1", "Document title",
		"Document body", "Document body", models.ContentProfileCarousel, models.PublicationStatusDraft,
	)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO renditions (
			id, publication_id, social_account_id, platform, profile, body, title,
			settings_json, status
		) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?)`,
		"rendition-normalized", "publication-normalized", "account-normalized",
		"linkedin", models.ContentProfileCarousel, "Destination body", "Document title",
		models.RenditionStatusDraft,
	)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO rendition_media (
			rendition_id, media_id, role, display_order, alt_text
		) VALUES (?, ?, 'attachment', 0, 'Document preview')`,
		"rendition-normalized", "media-normalized",
	)
	require.NoError(t, err)

	require.NoError(t, runTestMigrations(t, db))
	require.NoError(t, runTestMigrations(t, db))

	var intent, outputProfile string
	require.NoError(t, db.QueryRowContext(ctx, "SELECT intent FROM publications WHERE id = ?", "publication-normalized").Scan(&intent))
	require.Equal(t, models.PublishingIntentPost, intent)
	require.NoError(t, db.QueryRowContext(ctx, "SELECT output_profile FROM renditions WHERE id = ?", "rendition-normalized").Scan(&outputProfile))
	require.Equal(t, "linkedin.document", outputProfile)

	var segmentCount, renditionSegmentCount, renditionMediaCount int
	require.NoError(t, db.QueryRowContext(ctx, "SELECT COUNT(*) FROM publication_segments WHERE publication_id = ?", "publication-normalized").Scan(&segmentCount))
	require.NoError(t, db.QueryRowContext(ctx, "SELECT COUNT(*) FROM rendition_segments WHERE rendition_id = ?", "rendition-normalized").Scan(&renditionSegmentCount))
	require.NoError(t, db.QueryRowContext(ctx, "SELECT COUNT(*) FROM rendition_segment_media WHERE rendition_segment_id = ?", "legacy:rendition-normalized").Scan(&renditionMediaCount))
	require.Equal(t, 1, segmentCount)
	require.Equal(t, 1, renditionSegmentCount)
	require.Equal(t, 1, renditionMediaCount)

	_, err = db.ExecContext(ctx, "DELETE FROM publications WHERE id = ?", "publication-normalized")
	require.NoError(t, err)
	for _, table := range []string{"publication_segments", "renditions", "rendition_segments", "rendition_segment_media"} {
		var count int
		require.NoError(t, db.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table).Scan(&count))
		require.Zero(t, count, table)
	}
}

func TestLegacyAuthoringMigrationPreservesThreadVariantsScheduleAndJobs(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	for _, model := range []interface{}{
		(*models.PostDestination)(nil),
		(*models.PostMedia)(nil),
		(*models.Job)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))
	recreateLegacyPostSchema(t, db)

	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws-legacy-authoring", Name: "Legacy"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID:             "account-legacy",
		WorkspaceID:    "ws-legacy-authoring",
		Platform:       "x",
		AccountID:      "x-1",
		AccessTokenEnc: []byte("token"),
		IsActive:       true,
	}).Exec(ctx)
	require.NoError(t, err)
	for _, media := range []models.MediaAttachment{
		{ID: "media-root", WorkspaceID: "ws-legacy-authoring", FilePath: "root.jpg", MimeType: "image/jpeg", ProcessingStatus: "ready", FileHash: "legacy-root"},
		{ID: "media-reply", WorkspaceID: "ws-legacy-authoring", FilePath: "reply.jpg", MimeType: "image/jpeg", ProcessingStatus: "ready", FileHash: "legacy-reply"},
	} {
		item := media
		_, err = db.NewInsert().Model(&item).Exec(ctx)
		require.NoError(t, err)
	}
	scheduledAt := time.Now().UTC().Add(6 * time.Hour).Truncate(time.Second)
	createdAt := time.Now().UTC().Add(-time.Hour).Truncate(time.Second)
	posts := []models.Post{
		{ID: "legacy-root", WorkspaceID: "ws-legacy-authoring", CreatedByID: "user-1", Content: "Root", Status: models.PostStatusScheduled, ScheduledAt: scheduledAt, CreatedAt: createdAt},
		{ID: "legacy-published", WorkspaceID: "ws-legacy-authoring", CreatedByID: "user-1", Content: "Published history", Status: models.PostStatusPublished, CreatedAt: createdAt},
		{ID: "legacy-failed", WorkspaceID: "ws-legacy-authoring", CreatedByID: "user-1", Content: "Failed history", Status: models.PostStatusFailed, CreatedAt: createdAt},
	}
	_, err = db.NewInsert().Model(&posts).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.PostDestination{
		ID: "destination-legacy", PostID: "legacy-root", SocialAccountID: "account-legacy", Status: "pending",
	}).Exec(ctx)
	require.NoError(t, err)
	draft := legacyThreadDraftPrefix + `{"p":[{"k":"root","c":"Root body","m":["media-root"]},{"k":"reply","c":"Reply body","m":["media-reply"]}],"v":{"account-legacy":{"root":{"content":"Custom root","mediaIds":["media-root"]},"reply":{"content":"Custom reply","mediaIds":[]}}}}`
	_, err = db.NewInsert().Model(&models.ThreadDraft{
		PostID: "legacy-root", DraftJSON: draft, CreatedAt: createdAt, UpdatedAt: createdAt,
	}).Exec(ctx)
	require.NoError(t, err)
	jobs := []models.Job{
		{ID: "job-pending", Type: "publish_post", Payload: `{"post_id":"legacy-root"}`, Status: "pending", RunAt: scheduledAt, MaxAttempts: 3},
		{ID: "job-history", Type: "publish_post", Payload: `{"post_id":"legacy-published"}`, Status: "completed", RunAt: createdAt, MaxAttempts: 3},
	}
	_, err = db.NewInsert().Model(&jobs).Exec(ctx)
	require.NoError(t, err)

	require.NoError(t, runTestMigrations(t, db))
	require.NoError(t, runTestMigrations(t, db))

	publicationID := "legacy-publication:legacy-root"
	var publication models.Publication
	require.NoError(t, db.NewSelect().Model(&publication).Where("id = ?", publicationID).Scan(ctx))
	require.Equal(t, models.PublishingIntentThread, publication.Intent)
	require.Equal(t, models.PublicationStatusScheduled, publication.Status)
	require.WithinDuration(t, scheduledAt, publication.ScheduledAt, time.Second)

	var segments []models.PublicationSegment
	require.NoError(t, db.NewSelect().Model(&segments).Where("publication_id = ?", publicationID).Order("position ASC").Scan(ctx))
	require.Len(t, segments, 2)
	require.Equal(t, []string{"Root body", "Reply body"}, []string{segments[0].Body, segments[1].Body})

	var rendition models.Rendition
	require.NoError(t, db.NewSelect().Model(&rendition).Where("publication_id = ?", publicationID).Scan(ctx))
	var renditionSegments []models.RenditionSegment
	require.NoError(t, db.NewSelect().Model(&renditionSegments).Where("rendition_id = ?", rendition.ID).Order("position ASC").Scan(ctx))
	require.Equal(t, []string{"Custom root", "Custom reply"}, []string{renditionSegments[0].Body, renditionSegments[1].Body})
	var replyMediaCount int
	require.NoError(t, db.QueryRowContext(ctx, "SELECT COUNT(*) FROM rendition_segment_media WHERE rendition_segment_id = ?", renditionSegments[1].ID).Scan(&replyMediaCount))
	require.Zero(t, replyMediaCount)

	var migratedPost models.Post
	_ = migratedPost
	var pendingJob models.Job
	require.NoError(t, db.NewSelect().Model(&pendingJob).Where("id = ?", "job-pending").Scan(ctx))
	require.Equal(t, "publish_publication", pendingJob.Type)
	var payload map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(pendingJob.Payload), &payload))
	require.Equal(t, publicationID, payload["publication_id"])
	authorizationBatchID, ok := payload["authorization_batch_id"].(string)
	require.True(t, ok)
	require.NotEmpty(t, authorizationBatchID)
	require.Equal(t, scheduledAt.Format(time.RFC3339Nano), payload["authorization_scheduled_at"])
	require.WithinDuration(t, scheduledAt, pendingJob.RunAt, time.Second)
	var authorization models.PublicationAuthorization
	require.NoError(t, db.NewSelect().Model(&authorization).
		Where("batch_id = ? AND job_id = ?", authorizationBatchID, pendingJob.ID).
		Scan(ctx))
	require.Equal(t, publicationauth.OriginLegacy, authorization.ActorOrigin)
	require.Equal(t, "user-1", authorization.ActorUserID)
	require.Equal(t, publicationauth.PolicyLegacyScheduled, authorization.PolicyMode)
	require.Equal(t, rendition.ID, authorization.RenditionID)

	var historyJob models.Job
	require.NoError(t, db.NewSelect().Model(&historyJob).Where("id = ?", "job-history").Scan(ctx))
	require.Equal(t, "publish_post", historyJob.Type)
	require.Equal(t, "completed", historyJob.Status)

	_, err = db.NewDelete().Model((*models.Rendition)(nil)).Where("id = ?", rendition.ID).Exec(ctx)
	require.NoError(t, err)
	rendition = models.Rendition{
		ID:              "canonical-rendition-random",
		PublicationID:   publicationID,
		SocialAccountID: "account-legacy",
		Platform:        "x",
		Profile:         models.ContentProfileThread,
		OutputProfile:   "x.thread",
		Body:            "Custom root",
		SettingsJSON:    `{"reply_audience":"followers"}`,
		Status:          models.RenditionStatusScheduled,
		CreatedAt:       createdAt,
		UpdatedAt:       createdAt,
	}
	_, err = db.NewInsert().Model(&rendition).Exec(ctx)
	require.NoError(t, err)
	renditionSegments = []models.RenditionSegment{
		{
			ID:                   "canonical-rendition-segment-random-1",
			RenditionID:          rendition.ID,
			PublicationSegmentID: segments[0].ID,
			Position:             0,
			Body:                 "Custom root",
			SettingsJSON:         `{"poll_options":"Yes\nNo"}`,
			Status:               models.RenditionStatusScheduled,
			CreatedAt:            createdAt,
			UpdatedAt:            createdAt,
		},
		{
			ID:                   "canonical-rendition-segment-random-2",
			RenditionID:          rendition.ID,
			PublicationSegmentID: segments[1].ID,
			Position:             1,
			Body:                 "Custom reply",
			SettingsJSON:         "{}",
			Status:               models.RenditionStatusScheduled,
			CreatedAt:            createdAt,
			UpdatedAt:            createdAt,
		},
	}
	for index := range renditionSegments {
		_, err = db.NewInsert().Model(&renditionSegments[index]).Exec(ctx)
		require.NoError(t, err)
	}
	_, err = db.NewInsert().Model(&models.RenditionSegmentMedia{
		RenditionSegmentID: renditionSegments[0].ID,
		MediaID:            "media-root",
		Role:               "attachment",
		AltText:            "Launch artwork",
		SettingsJSON:       `{"tagged_users":"openpost"}`,
	}).Exec(ctx)
	require.NoError(t, err)

	require.NoError(t, RefreshLegacyPublicationAuthoring(ctx, db, "legacy-root"))
	require.NoError(t, db.NewSelect().Model(&pendingJob).Where("id = ?", "job-pending").Scan(ctx))
	var replacementPayload map[string]any
	require.NoError(t, json.Unmarshal([]byte(pendingJob.Payload), &replacementPayload))
	replacementBatchID, ok := replacementPayload["authorization_batch_id"].(string)
	require.True(t, ok)
	require.NotEqual(t, authorizationBatchID, replacementBatchID)
	var originalReceiptCount int
	require.NoError(t, db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM publication_authorizations WHERE batch_id = ?",
		authorizationBatchID,
	).Scan(&originalReceiptCount))
	require.Equal(t, 1, originalReceiptCount, "refresh must append rather than mutate the prior receipt")

	require.NoError(t, db.NewSelect().Model(&rendition).Where("publication_id = ?", publicationID).Scan(ctx))
	require.NotEqual(t, "canonical-rendition-random", rendition.ID)
	require.JSONEq(t, `{"reply_audience":"followers"}`, rendition.SettingsJSON)
	require.Equal(t, "x.thread", rendition.OutputProfile)
	require.NoError(t, db.NewSelect().Model(&renditionSegments).
		Where("rendition_id = ?", rendition.ID).
		Order("position ASC").
		Scan(ctx))
	require.JSONEq(t, `{"poll_options":"Yes\nNo"}`, renditionSegments[0].SettingsJSON)
	var preservedMedia models.RenditionSegmentMedia
	require.NoError(t, db.NewSelect().Model(&preservedMedia).
		Where("rendition_segment_id = ?", renditionSegments[0].ID).
		Scan(ctx))
	require.Equal(t, "Launch artwork", preservedMedia.AltText)
	require.JSONEq(t, `{"tagged_users":"openpost"}`, preservedMedia.SettingsJSON)

	var publicationCount int
	require.NoError(t, db.QueryRowContext(ctx, "SELECT COUNT(*) FROM publications WHERE id = ?", publicationID).Scan(&publicationCount))
	require.Equal(t, 1, publicationCount)
}

func TestLegacyAuthoringMigrationFollowsSequentialReplyChains(t *testing.T) {
	db := newMigrationsTestDB(t)
	ctx := context.Background()
	for _, model := range []interface{}{
		(*models.PostDestination)(nil),
		(*models.PostMedia)(nil),
		(*models.Job)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))
	recreateLegacyPostSchema(t, db)
	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws-chain", Name: "Chain"}).Exec(ctx)
	require.NoError(t, err)
	createdAt := time.Now().UTC().Add(-time.Hour)
	posts := []models.Post{
		{ID: "chain-1", WorkspaceID: "ws-chain", CreatedByID: "user-1", Content: "One", Status: models.PostStatusDraft, ThreadSequence: 0, CreatedAt: createdAt},
		{ID: "chain-2", WorkspaceID: "ws-chain", CreatedByID: "user-1", Content: "Two", Status: models.PostStatusDraft, ParentPostID: "chain-1", ThreadSequence: 1, CreatedAt: createdAt.Add(time.Second)},
		{ID: "chain-3", WorkspaceID: "ws-chain", CreatedByID: "user-1", Content: "Three", Status: models.PostStatusDraft, ParentPostID: "chain-2", ThreadSequence: 2, CreatedAt: createdAt.Add(2 * time.Second)},
	}
	_, err = db.NewInsert().Model(&posts).Exec(ctx)
	require.NoError(t, err)

	require.NoError(t, MigrateLegacyPublicationAuthoring(ctx, db))

	publicationID := "legacy-publication:chain-1"
	var segments []models.PublicationSegment
	require.NoError(t, db.NewSelect().Model(&segments).Where("publication_id = ?", publicationID).Order("position ASC").Scan(ctx))
	require.Equal(t, []string{"One", "Two", "Three"}, []string{segments[0].Body, segments[1].Body, segments[2].Body})
	var migrated []models.Post
	require.NoError(t, db.NewSelect().Model(&migrated).Where("id IN (?)", bun.List([]string{"chain-1", "chain-2", "chain-3"})).Scan(ctx))
	require.Len(t, migrated, 3)
	for _, post := range migrated {
		require.Equal(t, publicationID, post.PublicationID)
	}
}

func runMigrationsThrough(t *testing.T, db *bun.DB, maximum int64) {
	t.Helper()
	ctx := context.Background()
	_, err := db.NewCreateTable().Model((*SchemaMigration)(nil)).IfNotExists().Exec(ctx)
	require.NoError(t, err)
	var applied []SchemaMigration
	require.NoError(t, db.NewSelect().Model(&applied).Order("version ASC").Scan(ctx))
	appliedSet := make(map[int64]bool, len(applied))
	for _, item := range applied {
		appliedSet[item.Version] = true
	}
	entries, err := migrationFiles.ReadDir(".")
	require.NoError(t, err)
	migrations := []migration{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		version, parseErr := parseVersion(entry.Name())
		require.NoError(t, parseErr)
		if version > maximum {
			continue
		}
		content, readErr := migrationFiles.ReadFile(entry.Name())
		require.NoError(t, readErr)
		migrations = append(migrations, migration{
			version: version,
			name:    entry.Name(),
			sql:     normalizeMigrationSQL(db.Dialect().Name(), string(content)),
		})
	}
	sort.Slice(migrations, func(i, j int) bool { return migrations[i].version < migrations[j].version })
	for _, item := range migrations {
		if appliedSet[item.version] {
			continue
		}
		require.NoError(t, prepareMigration(ctx, db, item), item.name)
		require.NoError(t, runMigration(ctx, db, item), item.name)
		appliedSet[item.version] = true
	}
}
