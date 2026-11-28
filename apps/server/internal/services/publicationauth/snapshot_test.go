package publicationauth_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"sync/atomic"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/publicationauth"
	"github.com/openpost/backend/internal/testdb"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func seedSnapshotFixture(t *testing.T) *bun.DB {
	t.Helper()
	db := testdb.NewSQLiteBase(t,
		(*models.Publication)(nil), (*models.Rendition)(nil), (*models.RenditionSegment)(nil),
		(*models.SocialAccount)(nil), (*models.MediaAttachment)(nil), (*models.RenditionMedia)(nil),
		(*models.RenditionSegmentMedia)(nil), (*models.PublicationAuthorization)(nil),
		(*models.Workspace)(nil), (*models.PublicationLifecycleEvent)(nil),
	)
	ctx := t.Context()
	created := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	insert := func(model any) {
		t.Helper()
		_, err := db.NewInsert().Model(model).Exec(ctx)
		require.NoError(t, err)
	}
	insert(&models.Publication{
		ID: "publication-1", WorkspaceID: "workspace-1", CreatedByID: "user-1", Title: "Launch notes",
		Revision: 3, Status: models.PublicationStatusDraft, MetadataJSON: "{}", ReleasePlanJSON: "{}",
	})
	insert(&[]models.SocialAccount{
		{ID: "account-x", WorkspaceID: "workspace-1", Slug: "x", Platform: "x", AccountID: "x-1", AccessTokenEnc: []byte("c"), IsActive: true},
		{ID: "account-m", WorkspaceID: "workspace-1", Slug: "m", Platform: "mastodon", AccountID: "m-1", InstanceURL: "https://social.example", AccessTokenEnc: []byte("c"), IsActive: true},
	})
	media := func(id, hash, mime, name, alt string, size int64) models.MediaAttachment {
		return models.MediaAttachment{ID: id, WorkspaceID: "workspace-1", FilePath: id, FileHash: hash, MimeType: mime, Size: size, OriginalFilename: name, AltText: alt}
	}
	insert(&[]models.MediaAttachment{
		media("media-a", "hash-a", "image/png", "a.png", "Default A", 10),
		media("media-b", "hash-b", "image/jpeg", "b.jpg", "", 20),
		media("media-c", "hash-c", "video/mp4", "c.mp4", "Default C", 30),
		media("media-cover", "hash-cover", "image/png", "cover.png", "Cover", 40),
	})
	insert(&[]models.Rendition{
		{
			ID: "rendition-thread", PublicationID: "publication-1", SocialAccountID: "account-x", Platform: "x",
			Profile: models.ContentProfileShortText, OutputProfile: "x.thread", Position: 1, Body: "ignored for segments",
			SettingsJSON: `{"reply_settings":"everyone","cover_media_id":"media-cover","thumbnail_media_id":"media-a","caption_media_id":"https://cdn.example/c.vtt"}`,
			Status:       models.RenditionStatusDraft, CreatedAt: created.Add(2 * time.Minute),
		},
		{
			ID: "rendition-legacy", PublicationID: "publication-1", SocialAccountID: "account-m", Platform: "mastodon",
			Profile: models.ContentProfileShortText, Position: 0, Title: "Legacy title", Description: "Legacy description",
			Body: "Legacy body", SettingsJSON: `{"visibility":"public","cover_media_id":"media-cover"}`,
			Status: models.RenditionStatusDraft, CreatedAt: created.Add(time.Minute),
		},
		{
			ID: "rendition-plain", PublicationID: "publication-1", SocialAccountID: "account-x", TargetKey: "x:plain", Platform: "x",
			Profile: models.ContentProfileShortText, Position: 2, SettingsJSON: `{}`,
			Status: models.RenditionStatusDraft, CreatedAt: created,
		},
	})
	insert(&[]models.RenditionSegment{
		{ID: "segment-2", RenditionID: "rendition-thread", Position: 1, Body: "Second post", Description: "Second description", URL: "https://example.com/2", SettingsJSON: `{"b":2,"a":1}`},
		{ID: "segment-1", RenditionID: "rendition-thread", Position: 0, Body: "First post", Title: "First title", SettingsJSON: `{}`},
		{ID: "segment-plain", RenditionID: "rendition-plain", Position: 0, Body: "Plain body", SettingsJSON: `{}`},
	})
	insert(&[]models.RenditionSegmentMedia{
		{RenditionSegmentID: "segment-1", MediaID: "media-b", Role: "attachment", DisplayOrder: 1, SettingsJSON: `{"z":true,"a":[1,2]}`},
		{RenditionSegmentID: "segment-1", MediaID: "media-a", Role: "attachment", DisplayOrder: 0, AltText: "Override A", ThumbnailTimestampMS: 1500, SettingsJSON: `{}`},
		{RenditionSegmentID: "segment-2", MediaID: "media-c", Role: "attachment", DisplayOrder: 0, SettingsJSON: `{}`},
	})
	insert(&[]models.RenditionMedia{
		{RenditionID: "rendition-legacy", MediaID: "media-c", Role: "attachment", DisplayOrder: 1},
		{RenditionID: "rendition-legacy", MediaID: "media-a", Role: "attachment", DisplayOrder: 0, AltText: "Legacy alt"},
	})
	return db
}

// The expected values were recorded from the per-segment loader before media
// and segment reads were batched. Authorization receipts and review approvals
// stored by earlier releases must keep validating against the batched loader.
var recordedSnapshots = map[string]publicationauth.Snapshot{
	"rendition-thread": {WorkspaceID: "workspace-1", PublicationRevision: 3, SocialAccountID: "account-x", TargetKey: "x", ContentHash: "sha256:183d98d8d2f4b3cb8556fc2496f800630177ef7ad0aa7e1e9e54113d4263734f", MediaHash: "sha256:9e5516d734dd80d1fab42aadb2119c477a8d6c290820f0fd020dbfd4c3eb0387", SettingsHash: "sha256:3719dac8c2b437427761ec33103d5af889c4d94987bb2bae1e315e05b4e349c4", ProviderPolicyMode: "x.standard"},
	"rendition-legacy": {WorkspaceID: "workspace-1", PublicationRevision: 3, SocialAccountID: "account-m", TargetKey: "mastodon:https://social.example", ContentHash: "sha256:7550730cb23731873d176a37821c38b44ab6432368395bb3a1ed96a5313c9b02", MediaHash: "sha256:c849b47d327689ba6013ca3ddb763125bffb11f184f33c6a138ab52059c82711", SettingsHash: "sha256:9f9aa40e81aaff5decb570fc000e562d180491bbacebcb7448ef5d9f843b0fa3", ProviderPolicyMode: "mastodon.standard"},
	"rendition-plain":  {WorkspaceID: "workspace-1", PublicationRevision: 3, SocialAccountID: "account-x", TargetKey: "x:plain", ContentHash: "sha256:cbcf0ef311d9044435a4e2c8041f7bf92c8ffe9ee09a2ffcd94a02180983132e", MediaHash: "sha256:d0b60c5171592f2268c05457046d85c988ec35c51d51a2aedc72897e66e182fe", SettingsHash: "sha256:63e47b896322ec24fdc642caf8cd317d2a59591151881824731bcb39363483d0", ProviderPolicyMode: "x.standard"},
}

type queryCounter struct{ count atomic.Int64 }

func (counter *queryCounter) BeforeQuery(ctx context.Context, _ *bun.QueryEvent) context.Context {
	counter.count.Add(1)
	return ctx
}

func (*queryCounter) AfterQuery(context.Context, *bun.QueryEvent) {}

func TestBatchedSnapshotsKeepRecordedHashesWithBoundedQueries(t *testing.T) {
	db := seedSnapshotFixture(t)
	ctx := t.Context()
	counter := &queryCounter{}
	db.AddQueryHook(counter)

	for renditionID, want := range recordedSnapshots {
		snapshot, err := publicationauth.SnapshotForRendition(ctx, db, "publication-1", renditionID)
		require.NoError(t, err)
		require.Equal(t, want, snapshot, renditionID)
	}

	counter.count.Store(0)
	fingerprints, err := publicationauth.ReviewFingerprints(ctx, db, "publication-1")
	require.NoError(t, err)
	var reviewed []publicationauth.Snapshot
	require.NoError(t, json.Unmarshal([]byte(fingerprints), &reviewed))
	require.Len(t, reviewed, 3)
	for index, renditionID := range []string{"rendition-legacy", "rendition-thread", "rendition-plain"} {
		want := recordedSnapshots[renditionID]
		want.PublicationRevision = 0
		require.Equal(t, want, reviewed[index], renditionID)
	}
	// Rendition list, publication, renditions, accounts, segments, legacy
	// media, segment media and setting media: independent of segment count.
	require.LessOrEqual(t, counter.count.Load(), int64(8))

	counter.count.Store(0)
	_, receipts, err := publicationauth.CreateBatch(ctx, db, publicationauth.BatchInput{
		BatchID: "batch-1", PublicationID: "publication-1",
		Actor:  publicationauth.Actor{Origin: publicationauth.OriginAPI, UserID: "user-1", TokenID: "token-1"},
		Action: publicationauth.ActionPublish, PolicyMode: publicationauth.PolicyScheduled,
		ConfirmedAt: time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC),
		Targets:     []publicationauth.JobTarget{{JobID: "job-1", RunAt: time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)}},
	})
	require.NoError(t, err)
	require.Len(t, receipts, 3)
	for _, receipt := range receipts {
		want := recordedSnapshots[receipt.RenditionID]
		require.Equal(t, want.ContentHash, receipt.ContentHash, receipt.RenditionID)
		require.Equal(t, want.MediaHash, receipt.MediaHash, receipt.RenditionID)
		require.Equal(t, want.SettingsHash, receipt.SettingsHash, receipt.RenditionID)
		require.Equal(t, want.TargetKey, receipt.TargetKey, receipt.RenditionID)
	}

	validated, err := publicationauth.ValidateBatch(ctx, db, publicationauth.ValidateInput{
		BatchID: "batch-1", PublicationID: "publication-1", JobID: "job-1", Action: publicationauth.ActionPublish,
	})
	require.NoError(t, err)
	require.Len(t, validated, 3)
}

func TestSnapshotRejectsSettingMediaOutsideWorkspace(t *testing.T) {
	db := seedSnapshotFixture(t)
	ctx := t.Context()
	_, err := db.NewUpdate().Model((*models.MediaAttachment)(nil)).Set("workspace_id = ?", "workspace-2").
		Where("id = ?", "media-cover").Exec(ctx)
	require.NoError(t, err)
	_, err = publicationauth.SnapshotForRendition(ctx, db, "publication-1", "rendition-legacy")
	require.ErrorIs(t, err, sql.ErrNoRows)
	require.ErrorContains(t, err, "cover_media_id")
	// A destination that does not reference the setting is unaffected.
	_, err = publicationauth.SnapshotForRendition(ctx, db, "publication-1", "rendition-plain")
	require.NoError(t, err)
}
