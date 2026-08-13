package publicationauth

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestCreateAndValidateBatchBindsRevisionPayloadDestinationAndSchedule(t *testing.T) {
	db := newPublicationAuthorizationTestDB(t)
	seedPublicationAuthorizationFixture(t, db)
	ctx := t.Context()
	runAt := time.Now().UTC().Add(time.Hour).Truncate(time.Microsecond)
	batchID, receipts, err := CreateBatch(ctx, db, BatchInput{
		PublicationID: "publication-1",
		Actor:         Actor{Origin: OriginBrowser, UserID: "user-1", SessionID: "session-1"},
		Action:        ActionPublish, PolicyMode: PolicyScheduled,
		Targets: []JobTarget{{JobID: "job-1", RenditionID: "rendition-1", RunAt: runAt}},
	})
	require.NoError(t, err)
	require.Len(t, receipts, 1)
	require.Equal(t, "workspace-1", receipts[0].WorkspaceID)
	require.Equal(t, "mastodon:https://social.example", receipts[0].TargetKey)
	require.Equal(t, 4, receipts[0].PublicationRevision)
	for _, fingerprint := range []string{receipts[0].ContentHash, receipts[0].MediaHash, receipts[0].SettingsHash} {
		require.True(t, strings.HasPrefix(fingerprint, hashPrefix))
		require.NotContains(t, fingerprint, "private publication body")
	}

	validated, err := ValidateBatch(ctx, db, ValidateInput{
		BatchID: batchID, PublicationID: "publication-1", RenditionID: "rendition-1",
		JobID: "job-1", Action: ActionPublish, ScheduledAt: runAt,
	})
	require.NoError(t, err)
	require.Len(t, validated, 1)

	_, err = ValidateBatch(ctx, db, ValidateInput{
		BatchID: batchID, PublicationID: "publication-1", RenditionID: "rendition-1",
		JobID: "job-other", Action: ActionPublish, ScheduledAt: runAt,
	})
	require.ErrorIs(t, err, ErrReceiptJobMismatch)
	_, err = ValidateBatch(ctx, db, ValidateInput{
		BatchID: batchID, PublicationID: "publication-1", RenditionID: "rendition-1",
		JobID: "job-1", Action: ActionPublish, ScheduledAt: runAt.Add(time.Minute),
	})
	require.ErrorIs(t, err, ErrReceiptTimeMismatch)

	_, err = db.NewUpdate().Model((*models.Rendition)(nil)).
		Set("settings_json = ?", `{"visibility":"followers"}`).
		Where("id = ?", "rendition-1").Exec(ctx)
	require.NoError(t, err)
	_, err = ValidateBatch(ctx, db, ValidateInput{
		BatchID: batchID, PublicationID: "publication-1", RenditionID: "rendition-1",
		JobID: "job-1", Action: ActionPublish, ScheduledAt: runAt,
	})
	require.ErrorIs(t, err, ErrReceiptMismatch)
}

func TestCreateExplicitCanonicalizesTypesAndRedactsAuditMetadata(t *testing.T) {
	db := newPublicationAuthorizationTestDB(t)
	seedPublicationAuthorizationFixture(t, db)
	ctx := t.Context()
	runAt := time.Now().UTC().Add(10 * time.Minute).Truncate(time.Microsecond)
	media := []struct {
		MediaID string `json:"media_id"`
		AltText string `json:"alt_text,omitempty"`
	}{{MediaID: "media-secret", AltText: "private media description"}}
	batchID, receipt, err := CreateExplicit(ctx, db, ExplicitInput{
		BatchInput: BatchInput{
			PublicationID: "publication-1",
			Actor:         Actor{Origin: OriginMCP, UserID: "user-1", TokenID: "token-secret", ClientID: "client-1", ClientName: "Assistant"},
			Action:        ActionReply, PolicyMode: PolicyReplyScheduled,
		},
		RenditionID: "rendition-1", JobID: "job-reply", RunAt: runAt,
		Content: "private reply body", Media: media,
		Settings: map[string]any{"parent_id": "remote-parent", "settings": map[string]any{"visibility": "public"}},
	})
	require.NoError(t, err)
	require.NotContains(t, receipt.ContentHash, "private reply body")

	_, err = ValidateBatch(ctx, db, ValidateInput{
		BatchID: batchID, PublicationID: "publication-1", RenditionID: "rendition-1",
		JobID: "job-reply", Action: ActionReply, ScheduledAt: runAt, Explicit: true,
		Content:  "private reply body",
		Media:    []map[string]any{{"media_id": "media-secret", "alt_text": "private media description"}},
		Settings: map[string]any{"settings": map[string]any{"visibility": "public"}, "parent_id": "remote-parent"},
	})
	require.NoError(t, err, "equivalent JSON must hash identically across typed REST and decoded job values")

	encodedReceipt, err := json.Marshal(receipt)
	require.NoError(t, err)
	for _, secret := range []string{"token-secret", "private reply body", "private media description"} {
		require.NotContains(t, string(encodedReceipt), secret)
	}
	var event models.PublicationLifecycleEvent
	require.NoError(t, db.NewSelect().Model(&event).Where("idempotency_key = ?", "publication-authorization:"+batchID).Scan(ctx))
	for _, secret := range []string{"token-secret", "private reply body", "private media description", receipt.ContentHash, receipt.MediaHash, receipt.SettingsHash} {
		require.NotContains(t, event.MetadataJSON, secret)
	}
	require.Contains(t, event.MetadataJSON, `"actor_origin":"mcp"`)
	require.Contains(t, event.MetadataJSON, `"fingerprints_recorded":true`)
}

func TestCreateBatchRejectsUntrustedActorPolicyAndCrossPublicationRendition(t *testing.T) {
	db := newPublicationAuthorizationTestDB(t)
	seedPublicationAuthorizationFixture(t, db)
	ctx := t.Context()
	runAt := time.Now().UTC().Add(time.Hour)
	_, _, err := CreateBatch(ctx, db, BatchInput{
		PublicationID: "publication-1", Actor: Actor{Origin: OriginAPI, UserID: "user-1"},
		Action: ActionPublish, PolicyMode: PolicyScheduled,
		Targets: []JobTarget{{JobID: "job-1", RenditionID: "rendition-1", RunAt: runAt}},
	})
	require.ErrorIs(t, err, ErrActorRequired)
	_, _, err = CreateBatch(ctx, db, BatchInput{
		PublicationID: "publication-1", Actor: Actor{Origin: OriginAPI, UserID: "user-1", TokenID: "token-1"},
		Action: ActionPublish, PolicyMode: "trust_me",
		Targets: []JobTarget{{JobID: "job-1", RenditionID: "rendition-1", RunAt: runAt}},
	})
	require.Error(t, err)
	_, _, err = CreateBatch(ctx, db, BatchInput{
		PublicationID: "publication-1", Actor: Actor{Origin: OriginAPI, UserID: "user-1", TokenID: "token-1"},
		Action: ActionPublish, PolicyMode: PolicyScheduled,
		Targets: []JobTarget{{JobID: "job-1", RenditionID: "rendition-other", RunAt: runAt}},
	})
	require.Error(t, err)
}

func TestValidateBatchAcceptsDatabasePrecisionForScheduledTime(t *testing.T) {
	db := newPublicationAuthorizationTestDB(t)
	seedPublicationAuthorizationFixture(t, db)
	ctx := t.Context()
	runAt := time.Date(2026, time.August, 11, 15, 52, 28, 436566847, time.UTC)
	batchID, receipts, err := CreateBatch(ctx, db, BatchInput{
		PublicationID: "publication-1",
		Actor:         Actor{Origin: OriginAPI, UserID: "user-1", TokenID: "token-1"},
		Action:        ActionPublish,
		PolicyMode:    PolicyImmediate,
		Targets:       []JobTarget{{JobID: "job-1", RenditionID: "rendition-1", RunAt: runAt}},
	})
	require.NoError(t, err)
	require.Len(t, receipts, 1)

	// PostgreSQL stores timestamps at microsecond precision. Reproduce the
	// production round-trip before validating the nanosecond-bearing payload.
	_, err = db.NewUpdate().Model((*models.PublicationAuthorization)(nil)).
		Set("scheduled_at = ?", runAt.Truncate(time.Microsecond)).
		Where("id = ?", receipts[0].ID).
		Exec(ctx)
	require.NoError(t, err)

	_, err = ValidateBatch(ctx, db, ValidateInput{
		BatchID: batchID, PublicationID: "publication-1", RenditionID: "rendition-1",
		JobID: "job-1", Action: ActionPublish, ScheduledAt: runAt,
	})
	require.NoError(t, err)
}

func TestAuthorizeLegacyJobsBindsQueueAndAppendsAfterMutation(t *testing.T) {
	db := newPublicationAuthorizationTestDB(t)
	seedPublicationAuthorizationFixture(t, db)
	ctx := t.Context()
	runAt := time.Now().UTC().Add(time.Hour).Truncate(time.Microsecond)
	job := models.Job{
		ID: "legacy-job-1", Type: "publish_publication", ScopeID: "publication-1",
		Payload: `{"publication_id":"publication-1"}`, Status: "pending", RunAt: runAt,
	}
	stalePayloadJob := models.Job{
		ID: "legacy-job-stale-payload", Type: "publish_publication", ScopeID: "publication-other",
		Payload: `{"publication_id":"publication-1"}`, Status: "pending", RunAt: runAt,
	}
	_, err := db.NewInsert().Model(&[]models.Job{job, stalePayloadJob}).Exec(ctx)
	require.NoError(t, err)

	require.NoError(t, AuthorizeLegacyJobs(ctx, db, LegacyJobsInput{
		PublicationID: "publication-1",
		Actor:         Actor{Origin: OriginCLI, UserID: "user-1", TokenID: "token-1", ClientID: "openpost-cli"},
	}))
	require.NoError(t, db.NewSelect().Model(&job).Where("id = ?", job.ID).Scan(ctx))
	var firstPayload map[string]any
	require.NoError(t, json.Unmarshal([]byte(job.Payload), &firstPayload))
	firstBatchID := stringPayloadValue(firstPayload, "authorization_batch_id")
	require.NotEmpty(t, firstBatchID)
	require.Equal(t, runAt.Format(time.RFC3339Nano), stringPayloadValue(firstPayload, "authorization_scheduled_at"))
	firstReceipts, err := ValidateBatch(ctx, db, ValidateInput{
		BatchID: firstBatchID, PublicationID: "publication-1", JobID: job.ID,
		Action: ActionPublish, ScheduledAt: runAt,
	})
	require.NoError(t, err)
	require.Len(t, firstReceipts, 1)
	require.Equal(t, OriginCLI, firstReceipts[0].ActorOrigin)
	require.Equal(t, PolicyLegacyScheduled, firstReceipts[0].PolicyMode)
	require.NoError(t, db.NewSelect().Model(&stalePayloadJob).Where("id = ?", stalePayloadJob.ID).Scan(ctx))
	require.JSONEq(t, `{"publication_id":"publication-1"}`, stalePayloadJob.Payload)

	_, err = db.NewUpdate().Model((*models.Publication)(nil)).
		Set("revision = ?", 5).Where("id = ?", "publication-1").Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.Rendition)(nil)).
		Set("body = ?", "updated private publication body").Where("id = ?", "rendition-1").Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, AuthorizeLegacyJobs(ctx, db, LegacyJobsInput{
		PublicationID: "publication-1",
		Actor:         Actor{Origin: OriginMCP, UserID: "user-2", SessionID: "session-2", ClientID: "mcp-client"},
		Force:         true,
	}))
	require.NoError(t, db.NewSelect().Model(&job).Where("id = ?", job.ID).Scan(ctx))
	var replacementPayload map[string]any
	require.NoError(t, json.Unmarshal([]byte(job.Payload), &replacementPayload))
	replacementBatchID := stringPayloadValue(replacementPayload, "authorization_batch_id")
	require.NotEqual(t, firstBatchID, replacementBatchID)

	var firstReceipt models.PublicationAuthorization
	require.NoError(t, db.NewSelect().Model(&firstReceipt).Where("batch_id = ?", firstBatchID).Scan(ctx))
	require.Equal(t, 4, firstReceipt.PublicationRevision, "the earlier consent must remain immutable")
	replacementReceipts, err := ValidateBatch(ctx, db, ValidateInput{
		BatchID: replacementBatchID, PublicationID: "publication-1", JobID: job.ID,
		Action: ActionPublish, ScheduledAt: runAt,
	})
	require.NoError(t, err)
	require.Equal(t, 5, replacementReceipts[0].PublicationRevision)
	require.Equal(t, OriginMCP, replacementReceipts[0].ActorOrigin)
}

func TestAuthorizeLegacyJobsRequiresExactScope(t *testing.T) {
	db := newPublicationAuthorizationTestDB(t)
	require.ErrorContains(t, AuthorizeLegacyJobs(t.Context(), db, LegacyJobsInput{}), "requires a job or publication scope")
}

func newPublicationAuthorizationTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqlDB, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_foreign_keys=1", uuid.NewString()))
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	for _, model := range []any{
		(*models.Workspace)(nil), (*models.Publication)(nil), (*models.SocialAccount)(nil),
		(*models.Rendition)(nil), (*models.RenditionSegment)(nil),
		(*models.MediaAttachment)(nil), (*models.RenditionMedia)(nil),
		(*models.RenditionSegmentMedia)(nil), (*models.PublicationAuthorization)(nil),
		(*models.PublicationLifecycleEvent)(nil), (*models.Job)(nil),
	} {
		_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
		require.NoError(t, err)
	}
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return db
}

func seedPublicationAuthorizationFixture(t *testing.T, db *bun.DB) {
	t.Helper()
	ctx := context.Background()
	now := time.Now().UTC().Add(-time.Hour)
	_, err := db.NewInsert().Model(&models.Workspace{ID: "workspace-1", Name: "Main", CreatedAt: now}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Platform: "mastodon",
		InstanceURL: "https://social.example", AccountID: "actor@example", Slug: "mastodon-main",
		AccessTokenEnc: []byte("ciphertext"), IsActive: true, CreatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID: "publication-1", WorkspaceID: "workspace-1", CreatedByID: "user-1",
		Title: "Private launch", SourceText: "private publication body", SourceContent: "private publication body",
		Revision: 4, Status: models.PublicationStatusDraft, CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{
		ID: "rendition-1", PublicationID: "publication-1", SocialAccountID: "account-1",
		Platform: "mastodon", Profile: "mastodon_post", Body: "private publication body",
		SettingsJSON: `{"visibility":"public"}`, Status: models.RenditionStatusReady,
		CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{
		ID: "rendition-other", PublicationID: "missing-publication", SocialAccountID: "account-1",
		Platform: "mastodon", Profile: "mastodon_post", Body: "other body",
		SettingsJSON: `{}`, Status: models.RenditionStatusReady, CreatedAt: now, UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
}
