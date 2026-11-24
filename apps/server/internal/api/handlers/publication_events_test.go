package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/lifecycle"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestListPublicationEventsPaginatesSafeActorAttributedHistory(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.User)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.Publication)(nil),
		(*models.Rendition)(nil),
		(*models.PublicationLifecycleEvent)(nil),
		(*models.PublicationAuthorization)(nil),
		(*models.DraftRevisionChange)(nil),
	)
	testPublicationEventsPaginatesSafeActorAttributedHistory(t, db)
}

func testPublicationEventsPaginatesSafeActorAttributedHistory(t *testing.T, db *bun.DB) {
	t.Helper()
	ctx := context.Background()
	now := time.Date(2026, time.August, 9, 12, 0, 0, 0, time.UTC)
	_, err := db.NewInsert().Model(&models.User{
		ID: "user-1", Email: "alex@example.com", DisplayName: "Alex", PasswordHash: "hash",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Events"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Publication{
		ID: "publication-1", WorkspaceID: "ws-1", CreatedByID: "user-1", Title: "Launch",
		ContentProfile: models.ContentProfileShortText, SourceText: "Launch", SourceContent: "Launch",
		Status: models.PublicationStatusFailed, Revision: 2, CreatedAt: now.Add(-4 * time.Hour), UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{
		ID: "rendition-1", PublicationID: "publication-1", SocialAccountID: "account-1",
		Platform: "x", Status: models.RenditionStatusFailed, ErrorMessage: "The provider rejected this post.",
		ErrorAction: "edit", SettingsJSON: "{}", CreatedAt: now.Add(-4 * time.Hour), UpdatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.DraftRevisionChange{
		AggregateType: "publication", AggregateID: "publication-1", Revision: 2,
		ChangedDomains: `["content","schedule"]`, ChangedBy: "user-1", CreatedAt: now.Add(-3 * time.Hour),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.PublicationAuthorization{
		ID: "authorization-1", BatchID: "batch-1", WorkspaceID: "ws-1", PublicationID: "publication-1",
		RenditionID: "rendition-1", Action: "publish", ActorOrigin: "browser", ActorUserID: "user-1",
		PublicationRevision: 2, SocialAccountID: "account-1", TargetKey: "x", ScheduledAt: now,
		ContentHash: "secret-content-hash", MediaHash: "secret-media-hash", SettingsHash: "secret-settings-hash",
		PolicyMode: "scheduled", ConfirmedAt: now.Add(-2 * time.Hour), CreatedAt: now.Add(-2 * time.Hour),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = lifecycle.NewService(db).Record(ctx, lifecycle.EventInput{
		WorkspaceID: "ws-1", PublicationID: "publication-1", Type: lifecycle.EventAuthorizationConfirmed,
		Status: lifecycle.StatusSucceeded, Message: "raw message must not leak",
		Metadata: map[string]any{
			"authorization_batch_id": "batch-1", "actor_origin": "browser", "policy_mode": "scheduled",
			"content_hash": "secret-content-hash",
		},
	})
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.PublicationLifecycleEvent)(nil)).
		Set("created_at = ?", now.Add(-2*time.Hour)).
		Where("type = ?", lifecycle.EventAuthorizationConfirmed).
		Exec(ctx)
	require.NoError(t, err)
	_, err = lifecycle.NewService(db).Record(ctx, lifecycle.EventInput{
		WorkspaceID: "ws-1", PublicationID: "publication-1", RenditionID: "rendition-1",
		Type: lifecycle.EventFailed, Status: lifecycle.StatusFailed, Message: "provider response with secret",
		Metadata: map[string]any{
			"platform": "x", "error_kind": "validation", "error_code": "invalid_post",
			"http_status": 400, "retryable": false, "provider_key": "private-provider-key",
		},
	})
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.PublicationLifecycleEvent)(nil)).
		Set("created_at = ?", now.Add(-time.Hour)).
		Where("type = ?", lifecycle.EventFailed).
		Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewPublicationHandler(db, testAuthenticator{}, entitlements.NewSelfHostedService()).RegisterRoutes(api)
	get := func(path string) *httptest.ResponseRecorder {
		req := httptest.NewRequestWithContext(ctx, http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer web-token")
		response := httptest.NewRecorder()
		e.ServeHTTP(response, req)
		return response
	}

	first := get("/api/v1/publications/publication-1/events?limit=2")
	require.Equal(t, http.StatusOK, first.Code, first.Body.String())
	require.Equal(t, "true", first.Header().Get("X-Has-More"))
	var firstPage []PublicationLifecycleEventResponse
	require.NoError(t, json.Unmarshal(first.Body.Bytes(), &firstPage))
	require.Equal(t, []string{lifecycle.EventFailed, lifecycle.EventAuthorizationConfirmed}, []string{firstPage[0].Type, firstPage[1].Type})
	require.Equal(t, "The provider rejected this post.", firstPage[0].Error.Message)
	require.Equal(t, "Alex", firstPage[1].Actor.Name)
	require.Equal(t, "user", firstPage[1].Actor.Kind)
	require.Equal(t, 2, firstPage[1].Revision)
	require.Equal(t, now.Format(time.RFC3339Nano), firstPage[1].ScheduledAt)
	require.NotContains(t, first.Body.String(), "secret")
	require.NotContains(t, first.Body.String(), "private-provider-key")

	cursor := first.Header().Get("X-Next-Cursor")
	require.NotEmpty(t, cursor)
	second := get("/api/v1/publications/publication-1/events?limit=2&cursor=" + url.QueryEscape(cursor))
	require.Equal(t, http.StatusOK, second.Code, second.Body.String())
	require.Equal(t, "false", second.Header().Get("X-Has-More"))
	var secondPage []PublicationLifecycleEventResponse
	require.NoError(t, json.Unmarshal(second.Body.Bytes(), &secondPage))
	require.Equal(t, []string{"edited", "created"}, []string{secondPage[0].Type, secondPage[1].Type})
	require.Equal(t, "Alex", secondPage[0].Actor.Name)
	require.Equal(t, []string{"content", "schedule"}, secondPage[0].ChangedDomains)
}

func TestListPublicationEventsPostgres(t *testing.T) {
	db := createHandlerPostgresTestDB(t,
		(*models.User)(nil), (*models.Workspace)(nil), (*models.WorkspaceMember)(nil),
		(*models.Publication)(nil), (*models.Rendition)(nil),
		(*models.PublicationLifecycleEvent)(nil), (*models.PublicationAuthorization)(nil),
		(*models.DraftRevisionChange)(nil),
		(*models.ExternalWebhookSubscription)(nil), (*models.ProviderDelivery)(nil),
		(*models.SocialAccount)(nil),
	)
	testPublicationEventsPaginatesSafeActorAttributedHistory(t, db)
}
