package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

const pipelinePublicationID = "pipeline-publication"

func seedPipelinePublication(t *testing.T, db *bun.DB, status string) {
	t.Helper()
	_, err := db.NewCreateTable().Model((*models.ProviderDelivery)(nil)).IfNotExists().Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID: pipelinePublicationID, WorkspaceID: "ws-1", CreatedByID: "user-1", Title: "Pipeline",
		SourceText: "Pipeline body", SourceContent: "Pipeline body", ContentProfile: models.ContentProfileShortText,
		Status: status, Revision: 1, MetadataJSON: "{}", ReleasePlanJSON: "{}",
	}).Exec(t.Context())
	require.NoError(t, err)
}

func seedPipelineRendition(t *testing.T, db *bun.DB, id, targetKey, status string, position int, scheduleOverride time.Time) {
	t.Helper()
	_, err := db.NewInsert().Model(&models.Rendition{
		ID: id, PublicationID: pipelinePublicationID, SocialAccountID: "account-1", TargetKey: targetKey,
		Platform: "x", Profile: models.ContentProfileShortText, Body: "Destination " + id, SettingsJSON: "{}",
		Status: status, Position: position, ScheduleOverride: scheduleOverride,
	}).Exec(t.Context())
	require.NoError(t, err)
}

func seedPipelineJob(t *testing.T, db *bun.DB, id, renditionID, status string, runAt time.Time) {
	t.Helper()
	payload := map[string]string{"publication_id": pipelinePublicationID}
	if renditionID != "" {
		payload["rendition_id"] = renditionID
	}
	job, err := jobregistry.NewJob(jobTypePublishPublication, mustJSON(payload), runAt)
	require.NoError(t, err)
	job.ID = id
	job.ScopeID = pipelinePublicationID
	job.Status = status
	_, err = db.NewInsert().Model(job).Exec(t.Context())
	require.NoError(t, err)
}

func seedPipelineAttempt(t *testing.T, db *bun.DB, id, jobID, renditionID, status string) {
	t.Helper()
	_, err := db.NewInsert().Model(&models.ProviderWriteAttempt{
		ID: id, OperationID: "authorization:auth-" + id + ":" + renditionID + ":publish", AttemptNumber: 1,
		JobID: jobID, AuthorizationID: "auth-" + id, WorkspaceID: "ws-1", PublicationID: pipelinePublicationID,
		RenditionID: renditionID, SocialAccountID: "account-1", TargetKey: "x", Provider: "x", Operation: "publish",
		PayloadFingerprint: "fingerprint", Status: status, SubmissionState: "submitted", RetrySafety: "never",
	}).Exec(t.Context())
	require.NoError(t, err)
}

func pipelineJobExists(t *testing.T, db *bun.DB, id string) bool {
	t.Helper()
	exists, err := db.NewSelect().Model((*models.Job)(nil)).Where("id = ?", id).Exists(t.Context())
	require.NoError(t, err)
	return exists
}

func TestRetryFailedRenditionsKeepsSiblingDestinationJobs(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	ctx := t.Context()
	seedPipelinePublication(t, srv.db, models.PublicationStatusFailed)
	later := time.Now().UTC().Add(2 * time.Hour)
	seedPipelineRendition(t, srv.db, "rendition-failed", "x:failed", models.RenditionStatusFailed, 0, time.Time{})
	seedPipelineRendition(t, srv.db, "rendition-later", "x:later", models.RenditionStatusScheduled, 1, later)
	_, err := srv.db.NewInsert().Model(&models.ProviderDelivery{
		ID: "delivery-failed", WorkspaceID: "ws-1", PublicationID: pipelinePublicationID, RenditionID: "rendition-failed",
		SocialAccountID: "account-1", TargetKey: "x:failed", Provider: "x", State: providerwrite.DeliveryRejected,
		CurrentAttemptID: "rejected-attempt", CurrentAttemptNumber: 1, CurrentAttemptCreatedAt: time.Now().UTC(),
		RetrySafety: string(platform.PublishRetrySafe),
	}).Exec(ctx)
	require.NoError(t, err)
	seedPipelineJob(t, srv.db, "job-later", "rendition-later", jobStatusPending, later)
	seedPipelineJob(t, srv.db, "job-stale-retry", "rendition-failed", jobStatusPending, time.Now().UTC().Add(time.Hour))

	jobID, err := srv.handler.publicationHandler().publicationApplication().RetryFailedRenditions(ctx, "user-1", pipelinePublicationID)
	require.NoError(t, err)

	require.True(t, pipelineJobExists(t, srv.db, "job-later"), "a sibling destination keeps its own scheduled job")
	require.False(t, pipelineJobExists(t, srv.db, "job-stale-retry"), "the retry replaces the job for the retried destination")
	require.True(t, pipelineJobExists(t, srv.db, jobID))
	var retried models.Rendition
	require.NoError(t, srv.db.NewSelect().Model(&retried).Where("id = ?", "rendition-failed").Scan(ctx))
	require.Equal(t, models.RenditionStatusScheduled, retried.Status)
}

func TestDeletePartiallyPublishedFailedPublication(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name             string
		acceptedSubject  string
		wantDeleted      bool
		wantErrorMessage string
	}{
		{name: "accepted subject already published", acceptedSubject: "rendition-published", wantDeleted: true},
		{name: "accepted subject still unpublished", acceptedSubject: "rendition-failed", wantErrorMessage: errPublicationAlreadyProcessing.Error()},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			srv := newMCPTestServer(t)
			ctx := t.Context()
			seedPipelinePublication(t, srv.db, models.PublicationStatusFailed)
			seedPipelineRendition(t, srv.db, "rendition-published", "x:published", models.RenditionStatusPublished, 0, time.Time{})
			seedPipelineRendition(t, srv.db, "rendition-failed", "x:failed", models.RenditionStatusFailed, 1, time.Time{})
			seedPipelineJob(t, srv.db, "job-failed", "", "failed", time.Now().UTC())
			seedPipelineAttempt(t, srv.db, "accepted", "job-failed", tc.acceptedSubject, providerwrite.StatusAccepted)

			err := srv.handler.publicationHandler().publicationApplication().Delete(ctx, "user-1", pipelinePublicationID, 1)
			exists, existsErr := srv.db.NewSelect().Model((*models.Publication)(nil)).Where("id = ?", pipelinePublicationID).Exists(ctx)
			require.NoError(t, existsErr)
			if tc.wantDeleted {
				require.NoError(t, err)
				require.False(t, exists)
				return
			}
			require.ErrorContains(t, err, tc.wantErrorMessage)
			require.True(t, exists)
		})
	}
}

// installationScopedAuthenticator carries an installation identity past the
// REST scope map, which today refuses these operations to external-app tokens
// outright. The handler guard must still hold if that map later admits them.
type installationScopedAuthenticator struct{}

func (installationScopedAuthenticator) AuthenticateBearer(context.Context, string) (*middleware.Principal, error) {
	return &middleware.Principal{UserID: "user-1", WorkspaceID: "workspace-1", TokenID: "installation-token", InstallationID: "installation-1"}, nil
}

func TestExternalApplicationLifecycleActionsRequireEveryDestinationGrant(t *testing.T) {
	t.Parallel()
	db := createHandlerTestDB(t, (*models.WorkspaceMember)(nil), (*models.Publication)(nil), (*models.ExternalAppAccountGrant)(nil),
		(*models.ExternalAppInstallation)(nil), (*models.ExternalAppWorkspaceGrant)(nil), (*models.Job)(nil))
	ctx := t.Context()
	for _, model := range []any{
		&models.ExternalAppInstallation{ID: "installation-1", SponsorUserID: "user-1"},
		&models.ExternalAppWorkspaceGrant{InstallationID: "installation-1", WorkspaceID: "workspace-1"},
		&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin},
		&models.Publication{
			ID: "publication-1", WorkspaceID: "workspace-1", CreatedByID: "user-1", Title: "Failed", SourceText: "Body",
			SourceContent: "Body", ContentProfile: models.ContentProfileShortText, Status: models.PublicationStatusFailed,
			Revision: 1, MetadataJSON: "{}", ReleasePlanJSON: "{}",
		},
		&models.ExternalAppAccountGrant{InstallationID: "installation-1", WorkspaceID: "workspace-1", SocialAccountID: "account-2"},
	} {
		_, err := db.NewInsert().Model(model).Exec(ctx)
		require.NoError(t, err)
	}
	seedHandlerAccount(t, db, "account-1", "x")
	seedHandlerAccount(t, db, "account-2", "x")
	seedHandlerRendition(t, db, "rendition-1", "publication-1", "account-1", "x", "Ungranted destination", models.RenditionStatusFailed)
	seedHandlerRendition(t, db, "rendition-2", "publication-1", "account-2", "x", "Granted destination", models.RenditionStatusPublished)

	server := echo.New()
	api := humaecho.NewV4WithGroup(server, server.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPublicationHandler(db, installationScopedAuthenticator{}, nil).RegisterRoutes(api)
	invoke := func(method, path, body string) *httptest.ResponseRecorder {
		request := httptest.NewRequestWithContext(ctx, method, "/api/v1"+path, bytes.NewBufferString(body))
		request.Header.Set("Authorization", "Bearer external-token")
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		server.ServeHTTP(response, request)
		return response
	}
	for _, action := range []struct{ name, method, path, body string }{
		{"retry destination", http.MethodPost, "/publications/publication-1/renditions/account-1/retry", ""},
		{"retry failed destinations", http.MethodPost, "/publications/publication-1/retry-failed", ""},
		{"reply through granted destination", http.MethodPost, "/renditions/rendition-2/reply", `{"body":"Thanks","parent_id":"external-1"}`},
		{"delete publication", http.MethodDelete, "/publications/publication-1?confirm=true&expected_revision=1", ""},
		{"delete destination", http.MethodDelete, "/publications/publication-1/renditions/account-2?confirm=true&expected_revision=1", ""},
		{"dismiss failure", http.MethodPost, "/publications/publication-1/failure-dismissal", ""},
		{"restore failure", http.MethodDelete, "/publications/publication-1/failure-dismissal", ""},
	} {
		response := invoke(action.method, action.path, action.body)
		require.Equal(t, http.StatusForbidden, response.Code, "%s: %s", action.name, response.Body.String())
		require.Contains(t, response.Body.String(), "not granted every publication account", action.name)
	}
	count, err := db.NewSelect().Model((*models.Job)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, count, "denied actions must not queue work")
	var unchanged models.Publication
	require.NoError(t, db.NewSelect().Model(&unchanged).Where("id = ?", "publication-1").Scan(ctx))
	require.True(t, unchanged.FailureDismissedAt.IsZero())

	_, err = db.NewInsert().Model(&models.ExternalAppAccountGrant{InstallationID: "installation-1", WorkspaceID: "workspace-1", SocialAccountID: "account-1"}).Exec(ctx)
	require.NoError(t, err)
	response := invoke(http.MethodPost, "/publications/publication-1/failure-dismissal", "")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
}

type statusFlipHook struct {
	db    *bun.DB
	fired atomic.Bool
}

func (hook *statusFlipHook) BeforeQuery(ctx context.Context, event *bun.QueryEvent) context.Context {
	if strings.HasPrefix(event.Query, "UPDATE") && strings.Contains(event.Query, "failure_dismissed_at") &&
		hook.fired.CompareAndSwap(false, true) {
		// A retry commits between the dismissal read and its write.
		_, _ = hook.db.NewUpdate().Model((*models.Publication)(nil)).
			Set("status = ?", models.PublicationStatusScheduled).
			Where("id = ?", pipelinePublicationID).Exec(ctx)
	}
	return ctx
}

func (*statusFlipHook) AfterQuery(context.Context, *bun.QueryEvent) {}

func TestFailureDismissalDoesNotOverwriteConcurrentRetry(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	seedPipelinePublication(t, srv.db, models.PublicationStatusFailed)
	srv.db.AddQueryHook(&statusFlipHook{db: srv.db})
	handler := srv.handler.publicationHandler()
	handler.auth = testAuthenticator{}
	server := echo.New()
	handler.RegisterRoutes(humaecho.NewV4WithGroup(server, server.Group("/api/v1"), huma.DefaultConfig("Test", "1")))

	response := publicationApplicationRequest(t.Context(), t, server, http.MethodPost, "/api/v1/publications/"+pipelinePublicationID+"/failure-dismissal", map[string]any{})
	require.Equal(t, http.StatusConflict, response.Code, response.Body.String())
	var stored models.Publication
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", pipelinePublicationID).Scan(t.Context()))
	require.Equal(t, models.PublicationStatusScheduled, stored.Status)
	require.True(t, stored.FailureDismissedAt.IsZero(), "a retried Publication must not become a dismissed failure")
}

func TestReschedulingQueuedPublicationChargesMonthlyUsageOnceAndCancelReportsRevision(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	ctx := t.Context()
	handler := srv.handler.publicationHandler()
	handler.entitlement = entitlements.NewStaticService(entitlements.PlanSnapshot{Limits: map[entitlements.LimitKey]int64{entitlements.LimitScheduledPostsMonthly: 1}})
	scheduledAt := time.Now().UTC().Add(time.Hour)
	publication, err := handler.publicationApplication().Create(ctx, "user-1", CreatePublicationBody{
		WorkspaceID: "ws-1", ContentProfile: models.ContentProfileShortText, SourceText: "Only scheduled post this month",
		ScheduledAt: &scheduledAt, SocialAccountIDs: []string{"account-1"},
	})
	require.NoError(t, err)
	for range 2 {
		current, err := handler.publicationApplication().Get(ctx, "user-1", publication.ID)
		require.NoError(t, err)
		_, err = handler.publicationApplication().Schedule(ctx, "user-1", publication.ID, current.Revision, providerreadiness.ExecutionIntentProduction)
		require.NoError(t, err, "re-queuing an already scheduled post uses its existing reservation")
	}
	usage, err := handler.usage.CurrentMonthly(ctx, "ws-1", entitlements.LimitScheduledPostsMonthly, scheduledAt)
	require.NoError(t, err)
	require.Equal(t, int64(1), usage)

	handler.auth = testAuthenticator{}
	server := echo.New()
	handler.RegisterRoutes(humaecho.NewV4WithGroup(server, server.Group("/api/v1"), huma.DefaultConfig("Test", "1")))
	current, err := handler.publicationApplication().Get(ctx, "user-1", publication.ID)
	require.NoError(t, err)
	response := publicationApplicationRequest(ctx, t, server, http.MethodPost, "/api/v1/publications/"+publication.ID+"/cancel", map[string]any{"expected_revision": current.Revision})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var output struct {
		Revision int `json:"revision"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &output))
	var stored models.Publication
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", publication.ID).Scan(ctx))
	require.Equal(t, stored.Revision, output.Revision)
	require.Equal(t, models.PublicationStatusDraft, stored.Status)
}

func TestScheduleWithoutTimeFailsBeforeQuotaRead(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	handler := srv.handler.publicationHandler()
	handler.usage = nil // Any usage read would report temporary unavailability.
	publication, err := handler.publicationApplication().Create(t.Context(), "user-1", CreatePublicationBody{
		WorkspaceID: "ws-1", ContentProfile: models.ContentProfileShortText, SourceText: "Unscheduled draft",
		SocialAccountIDs: []string{"account-1"},
	})
	require.NoError(t, err)
	_, err = handler.publicationApplication().Schedule(t.Context(), "user-1", publication.ID, publication.Revision, providerreadiness.ExecutionIntentProduction)
	require.ErrorIs(t, err, errPublicationScheduleRequired)
}

func TestReplyRejectsDroppedMediaAndMissingParent(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	seedPipelinePublication(t, srv.db, models.PublicationStatusPublished)
	seedPipelineRendition(t, srv.db, "rendition-unpublished", "x", models.RenditionStatusDraft, 0, time.Time{})
	handler := srv.handler.publicationHandler()
	handler.auth = testAuthenticator{}
	server := echo.New()
	handler.RegisterRoutes(humaecho.NewV4WithGroup(server, server.Group("/api/v1"), huma.DefaultConfig("Test", "1")))

	response := publicationApplicationRequest(t.Context(), t, server, http.MethodPost, "/api/v1/renditions/rendition-unpublished/reply",
		map[string]any{"body": "With media", "parent_id": "external-1", "media": []map[string]any{{"media_id": "media-1"}}})
	require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
	require.Contains(t, response.Body.String(), "reply media is not supported")

	response = publicationApplicationRequest(t.Context(), t, server, http.MethodPost, "/api/v1/renditions/rendition-unpublished/reply",
		map[string]any{"body": "No parent"})
	require.Equal(t, http.StatusConflict, response.Code, response.Body.String())
	count, err := srv.db.NewSelect().Model((*models.Job)(nil)).Where("scope_id = ?", pipelinePublicationID).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}
