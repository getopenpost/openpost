package migrations

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/publicationauth"
	"github.com/stretchr/testify/require"
)

func TestPublicationJobRestartPreservesAuthorizedTime(t *testing.T) {
	for _, tc := range []struct {
		name                                            string
		retry, protected, stale, invalid                bool
		payloadTime                                     string
		missingReceipt, malformed, unbound, readFailure bool
	}{
		{name: "publish_now"},
		{name: "retry", retry: true},
		{name: "protected_retry", retry: true, protected: true},
		{name: "stale_retry", retry: true, stale: true},
		{name: "stale_protected_retry", retry: true, stale: true, protected: true},
		{name: "invalid_time", invalid: true},
		{name: "invalid_stale_time", invalid: true, stale: true},
		{name: "invalid_protected_time", invalid: true, protected: true},
		{name: "equivalent_offset", payloadTime: "2026-10-18T02:16:50.71906688+01:00"},
		{name: "unparseable_time", payloadTime: "invalid", invalid: true},
		{name: "missing_receipt", missingReceipt: true, invalid: true},
		{name: "malformed_payload", malformed: true, invalid: true},
		{name: "unbound_legacy", unbound: true},
		{name: "receipt_read_failure", readFailure: true, protected: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := newMigrationsTestDB(t)
			ctx := t.Context()
			seedMigrationUser(ctx, t, db)
			require.NoError(t, runTestMigrations(t, db))
			now := time.Date(2026, 10, 18, 1, 16, 50, 719066880, time.UTC)
			if tc.retry {
				now = now.Truncate(time.Second) // Isolate retry dispatch changes from precision loss.
			}
			_, err := db.NewInsert().Model(&models.Workspace{ID: "workspace-restart", Name: "Restart"}).Exec(ctx)
			require.NoError(t, err)
			_, err = db.NewInsert().Model(&models.SocialAccount{
				ID: "account-restart", WorkspaceID: "workspace-restart", Platform: "x", AccountID: "x-restart",
				AccessTokenEnc: []byte("ciphertext"), IsActive: true,
			}).Exec(ctx)
			require.NoError(t, err)
			_, err = db.NewInsert().Model(&models.Publication{
				ID: "publication-restart", WorkspaceID: "workspace-restart", CreatedByID: "user-1",
				SourceText: "Restart safely", SourceContent: "Restart safely", Status: models.PublicationStatusScheduled,
				ScheduledAt: now, CreatedAt: now, UpdatedAt: now,
			}).Exec(ctx)
			require.NoError(t, err)
			_, err = db.NewInsert().Model(&models.Rendition{
				ID: "rendition-restart", PublicationID: "publication-restart", SocialAccountID: "account-restart",
				Platform: "x", Profile: models.ContentProfileShortText, Body: "Restart safely",
				Status: models.RenditionStatusScheduled, CreatedAt: now, UpdatedAt: now,
			}).Exec(ctx)
			require.NoError(t, err)
			batchID, receipts, err := publicationauth.CreateBatch(ctx, db, publicationauth.BatchInput{
				PublicationID: "publication-restart", Actor: publicationauth.Actor{Origin: publicationauth.OriginLegacy, UserID: "user-1"},
				Action: publicationauth.ActionPublish, PolicyMode: publicationauth.PolicyImmediate, ConfirmedAt: now,
				Targets: []publicationauth.JobTarget{{JobID: "job-restart", RunAt: now}},
			})
			require.NoError(t, err)
			if tc.invalid {
				_, err = db.NewInsert().Model(&models.Rendition{
					ID: "rendition-published", PublicationID: "publication-restart", SocialAccountID: "account-restart",
					TargetKey: "published-target", Platform: "x", Profile: models.ContentProfileShortText,
					Body: "Already published", Status: models.RenditionStatusPublished, CreatedAt: now, UpdatedAt: now,
				}).Exec(ctx)
				require.NoError(t, err)
			}
			authorizedTime := now
			if tc.invalid {
				authorizedTime = now.Add(time.Second)
			}
			payloadTime := authorizedTime.Format(time.RFC3339Nano)
			if tc.payloadTime != "" {
				payloadTime = tc.payloadTime
			}
			payloadBatchID := batchID
			if tc.missingReceipt {
				payloadBatchID = "missing-batch"
			}
			payload, err := json.Marshal(map[string]any{
				"publication_id": "publication-restart", "authorization_batch_id": payloadBatchID,
				"authorization_scheduled_at": payloadTime,
			})
			require.NoError(t, err)
			if tc.malformed {
				payload = []byte(`{"publication_id":`)
			}
			if tc.unbound {
				payload = []byte(`{"publication_id":"publication-restart"}`)
			}
			job := &models.Job{
				ID: "job-restart", Type: "publish_publication", ScopeID: "publication-restart",
				Payload: string(payload), Status: "pending", RunAt: now, MaxAttempts: 3,
			}
			if tc.retry {
				job.RunAt = now.Add(time.Minute)
				job.Attempts = 1
			}
			if tc.stale {
				job.Status = "processing"
				job.LockedAt = time.Now().UTC().Add(-time.Hour)
				job.LockedBy = "dead-worker"
			}
			_, err = db.NewInsert().Model(job).Exec(ctx)
			require.NoError(t, err)
			dispatchTime := job.RunAt.Truncate(time.Microsecond)
			if tc.protected {
				_, err = db.NewInsert().Model(&models.ProviderWriteAttempt{
					ID: "attempt-restart", OperationID: "authorization:" + receipts[0].ID + ":publish", AttemptNumber: 1,
					JobID: job.ID, AuthorizationID: receipts[0].ID, WorkspaceID: "workspace-restart",
					PublicationID: "publication-restart", RenditionID: "rendition-restart", SocialAccountID: "account-restart",
					TargetKey: receipts[0].TargetKey, Provider: "x", Operation: "publish", PayloadFingerprint: "sha256:test",
					Status: "ambiguous", SubmissionState: "unknown", RetrySafety: "reconcile_only",
				}).Exec(ctx)
				require.NoError(t, err)
			}
			if tc.readFailure {
				_, err = db.ExecContext(ctx, "ALTER TABLE publication_authorizations RENAME COLUMN scheduled_at TO unavailable_scheduled_at")
				require.NoError(t, err)
				err = resumeLegacyPublicationAuthoringBackfill(ctx, db)
				require.ErrorContains(t, err, "scheduled_at")
				require.NoError(t, db.NewSelect().Model(job).Where("id = ?", job.ID).Scan(ctx))
				require.Equal(t, "pending", job.Status, "a receipt read failure must not quarantine valid work")
				return
			}

			// Repeat the complete migration entry point, as each self-hosted start does.
			require.NoError(t, runTestMigrations(t, db))
			require.NoError(t, db.NewSelect().Model(job).Where("id = ?", job.ID).Scan(ctx))
			require.True(t, dispatchTime.Equal(job.RunAt), "recovery must retain the queue's dispatch time")
			if tc.malformed {
				require.Equal(t, string(payload), job.Payload)
			} else if !tc.unbound {
				require.JSONEq(t, string(payload), job.Payload)
			}
			if tc.unbound {
				var bound map[string]any
				require.NoError(t, json.Unmarshal([]byte(job.Payload), &bound))
				batchID = bound["authorization_batch_id"].(string)
			}
			if tc.invalid {
				require.Equal(t, "failed", job.Status)
				require.Contains(t, job.LastError, "authorization")
				var publication models.Publication
				require.NoError(t, db.NewSelect().Model(&publication).Where("id = ?", job.ScopeID).Scan(ctx))
				require.Equal(t, models.PublicationStatusFailed, publication.Status, "the failed job must remain inspectable on its post")
				var rendition models.Rendition
				require.NoError(t, db.NewSelect().Model(&rendition).Where("id = ?", "rendition-restart").Scan(ctx))
				require.Equal(t, models.RenditionStatusFailed, rendition.Status)
				require.Equal(t, job.LastError, rendition.ErrorMessage)
				require.False(t, rendition.ErrorRetryable)
				require.NoError(t, db.NewSelect().Model(&rendition).Where("id = ?", "rendition-published").Scan(ctx))
				require.Equal(t, models.RenditionStatusPublished, rendition.Status, "successful destinations must be preserved")
				count, err := db.NewSelect().Model((*models.PublicationAuthorization)(nil)).Where("job_id = ?", job.ID).Count(ctx)
				require.NoError(t, err)
				require.EqualValues(t, 1, count, "invalid work must never receive replacement authorization")
				require.NoError(t, runTestMigrations(t, db))
				return
			}
			require.Equal(t, "pending", job.Status)
			require.Empty(t, job.LockedBy)
			if tc.protected {
				var attempt models.ProviderWriteAttempt
				require.NoError(t, db.NewSelect().Model(&attempt).Where("id = ?", "attempt-restart").Scan(ctx))
				require.Equal(t, "ambiguous", attempt.Status)
				require.Equal(t, receipts[0].ID, attempt.AuthorizationID)
			}
			validated, err := publicationauth.ValidateBatch(ctx, db, publicationauth.ValidateInput{
				PublicationID: "publication-restart", BatchID: batchID, JobID: job.ID,
				Action: publicationauth.ActionPublish, ScheduledAt: now,
			})
			require.NoError(t, err)
			if !tc.unbound {
				require.Equal(t, receipts[0].ID, validated[0].ID, "restart must preserve the original authorization")
			}
			require.NoError(t, runTestMigrations(t, db), "recovery must remain idempotent")
		})
	}
}
