package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/workspaceteam"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type workspaceTestServer struct {
	echo     *echo.Echo
	db       *bun.DB
	api      huma.API
	handler  *WorkspaceHandler
	recorder *telemetry.MemoryRecorder
}

func TestWorkspaceSettingsRejectInvertedComposerRangeWithoutSaving(t *testing.T) {
	for _, body := range []map[string]any{
		{"slot_start_hour": 23, "slot_end_hour": 22},
		{"slot_start_hour": 23},
		{"slot_end_hour": 4},
	} {
		t.Run(fmt.Sprint(body), func(t *testing.T) {
			srv := newWorkspaceTestServer(t, entitlements.NewSelfHostedService())
			srv.handler.UpdateWorkspaceSettings(srv.api)
			seedWorkspaceUserAndMember(t, srv.db, "user-1", "user@example.com", models.WorkspaceRoleAdmin)
			_, err := srv.db.NewUpdate().Model((*models.Workspace)(nil)).Set("slot_start_hour = 5").Set("slot_end_hour = 22").Where("id = ?", "ws-1").Exec(context.Background())
			require.NoError(t, err)
			response := srv.patchJSON(t, "/api/v1/workspaces/ws-1/settings", body, "web-token")
			require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
			var saved models.Workspace
			require.NoError(t, srv.db.NewSelect().Model(&saved).Where("id = ?", "ws-1").Scan(context.Background()))
			require.Equal(t, 5, saved.SlotStartHour)
			require.Equal(t, 22, saved.SlotEndHour)
			valid := srv.patchJSON(t, "/api/v1/workspaces/ws-1/settings", map[string]any{"slot_start_hour": 23, "slot_end_hour": 23}, "web-token")
			require.Equal(t, http.StatusOK, valid.Code, valid.Body.String())
		})
	}
}

func newWorkspaceTestServer(t *testing.T, entitlement entitlements.Service) *workspaceTestServer {
	return newWorkspaceTestServerWithAuthenticator(t, entitlement, testAuthenticator{})
}

func newWorkspaceTestServerWithAuthenticator(t *testing.T, entitlement entitlements.Service, authenticator middleware.Authenticator) *workspaceTestServer {
	t.Helper()

	db := createHandlerTestDB(
		t,
		(*models.User)(nil),
		(*models.Organization)(nil),
		(*models.OrganizationMember)(nil),
		(*models.BillingSubscription)(nil),
		(*models.BillingCheckoutAttempt)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil),
		(*models.WorkspaceFirstComposition)(nil),
		(*models.Publication)(nil),
		(*models.WorkspaceInvitation)(nil),
		(*models.WorkspaceInvitationResend)(nil),
		(*models.WorkspaceAccessAuditEvent)(nil),
		(*models.WorkspaceLifecycleAuditEvent)(nil),
		(*models.OrganizationLifecycleAuditEvent)(nil),
		(*models.IdentityAuditEvent)(nil),
		(*models.OrganizationOwnershipAuditEvent)(nil),
		(*models.IdentityProvider)(nil),
		(*models.UserImpersonationGrant)(nil),
		(*models.UserImpersonationGrantOrganization)(nil),
		(*models.MCPToolCall)(nil),
		(*models.PublicationLifecycleEvent)(nil),
		(*models.PublicationAuthorization)(nil),
		(*models.ProviderWriteAttempt)(nil),
		(*models.Job)(nil),
		(*models.OrganizationSSOPolicy)(nil),
		(*models.SessionIdentityAssurance)(nil),
		(*models.APIToken)(nil),
	)
	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewWorkspaceHandler(db, authenticator, entitlement)
	handler.SetFrontendURL("https://app.openpost.test")
	recorder := &telemetry.MemoryRecorder{}
	handler.SetTelemetry(recorder)
	handler.CreateWorkspace(api)
	handler.ListWorkspaceTeam(api)
	handler.CreateWorkspaceInvitation(api)
	handler.ResendWorkspaceInvitation(api)
	handler.RevokeWorkspaceInvitation(api)
	handler.UpdateWorkspaceMember(api)
	handler.RemoveWorkspaceMember(api)
	handler.ListWorkspaceAccessAudit(api)
	handler.ListOrganizationAudit(api)
	handler.ExportOrganizationAudit(api)
	handler.ListInstanceAudit(api)
	handler.ExportInstanceAudit(api)
	handler.AcceptWorkspaceInvitation(api)
	handler.GetWorkspaceSetup(api)
	handler.StartWorkspaceComposition(api)

	return &workspaceTestServer{echo: e, db: db, api: api, handler: handler, recorder: recorder}
}

func TestWorkspaceCompositionTelemetryStaysWorkspaceScoped(t *testing.T) {
	t.Parallel()

	srv := newWorkspaceTestServer(t, entitlements.NewSelfHostedService())
	seedWorkspaceUserAndMember(t, srv.db, "user-1", "user@example.com", models.WorkspaceRoleAdmin)
	ctx := context.Background()
	_, err := srv.db.NewInsert().Model(&models.Workspace{ID: "ws-2", OrganizationID: "org-1", Name: "Second"}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-2", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(ctx)
	require.NoError(t, err)

	first := srv.postJSON(t, "/api/v1/workspaces/ws-1/setup/composition", map[string]any{"signal": "text", "origin_key": "origin-signal-0001"}, "web-token")
	require.Equal(t, http.StatusOK, first.Code, first.Body.String())
	second := srv.postJSON(t, "/api/v1/workspaces/ws-2/setup/composition", map[string]any{"signal": "media", "origin_key": "origin-signal-0002"}, "web-token")
	require.Equal(t, http.StatusOK, second.Code, second.Body.String())
	require.Len(t, srv.recorder.Events, 2)
	require.Equal(t, "ws-1", srv.recorder.Events[0].WorkspaceID)
	require.Equal(t, "composition:ws-1", srv.recorder.Events[0].UUID)
	require.Equal(t, "ws-2", srv.recorder.Events[1].WorkspaceID)
	require.Equal(t, "composition:ws-2", srv.recorder.Events[1].UUID)

	denied := srv.postJSON(t, "/api/v1/workspaces/ws-1/setup/composition", map[string]any{"signal": "text", "origin_key": "origin-signal-0001"}, "other-workspace-token")
	require.Equal(t, http.StatusForbidden, denied.Code, denied.Body.String())
	require.Len(t, srv.recorder.Events, 2)
}

func TestWorkspaceSetupKeepsPublicationActionAfterFailedDelivery(t *testing.T) {
	t.Parallel()

	srv := newWorkspaceTestServer(t, entitlements.NewSelfHostedService())
	seedWorkspaceUserAndMember(t, srv.db, "user-1", "user@example.com", models.WorkspaceRoleAdmin)
	_, err := srv.db.NewInsert().Model(&models.SocialAccount{
		ID: "account-1", WorkspaceID: "ws-1", Slug: "main", Platform: "x", AccountID: "1",
		AccessTokenEnc: []byte("token"), IsActive: true,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.WorkspaceFirstComposition{
		WorkspaceID: "ws-1", Signal: "text",
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.Publication{
		ID: "publication-1", WorkspaceID: "ws-1", CreatedByID: "user-1", Status: models.PublicationStatusFailed,
		SourceContent: "Launch", MetadataJSON: "{}", ReleasePlanJSON: "{}", RepostOverride: "{}",
	}).Exec(t.Context())
	require.NoError(t, err)
	response := srv.getJSON(t, "/api/v1/workspaces/ws-1/setup", "web-token")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var setup WorkspaceSetupResponse
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &setup))
	require.False(t, setup.Activated)
	require.True(t, setup.Visible)
	require.Equal(t, "publication", setup.NextStep)
	require.Equal(t, "create_publication", setup.NextAction)
}

func (s *workspaceTestServer) createWorkspace(t *testing.T, name string) *httptest.ResponseRecorder {
	t.Helper()
	// The authenticated principal must have a stored User for creation locking.
	_, err := s.db.NewInsert().Model(&models.User{ID: "user-1", Email: "user@example.com", PasswordHash: "hash", CreatedAt: time.Now().UTC()}).On("CONFLICT DO NOTHING").Exec(t.Context())
	require.NoError(t, err)

	var payload bytes.Buffer
	require.NoError(t, json.NewEncoder(&payload).Encode(map[string]string{"name": name}))
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/workspaces", &payload)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func (s *workspaceTestServer) postJSON(t *testing.T, path string, body any, token string) *httptest.ResponseRecorder {
	t.Helper()

	var payload bytes.Buffer
	require.NoError(t, json.NewEncoder(&payload).Encode(body))
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, &payload)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func (s *workspaceTestServer) patchJSON(t *testing.T, path string, body any, token string) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	require.NoError(t, json.NewEncoder(&payload).Encode(body))
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPatch, path, &payload)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func (s *workspaceTestServer) deleteJSON(t *testing.T, path string, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodDelete, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func (s *workspaceTestServer) getJSON(t *testing.T, path string, token string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

type workspaceTestAuthenticator map[string]middleware.Principal

func (a workspaceTestAuthenticator) AuthenticateBearer(_ context.Context, token string) (*middleware.Principal, error) {
	principal, ok := a[token]
	if !ok {
		return nil, apitokens.ErrInvalidToken
	}
	return &principal, nil
}

func seedWorkspaceUserAndMember(t *testing.T, db *bun.DB, userID, email, role string) {
	t.Helper()
	ctx := context.Background()
	workspaceID := "ws-1"
	_, err := db.NewInsert().Model(&models.User{
		ID:           userID,
		Email:        email,
		PasswordHash: "hash",
		CreatedAt:    time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Organization{
		ID: "org-1", Name: "Launch", CreatedByID: userID, CreatedAt: time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.OrganizationMember{
		OrganizationID: "org-1", UserID: userID, Role: models.OrganizationRoleOwner, CreatedAt: time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{
		ID: workspaceID, OrganizationID: "org-1", Name: "Launch",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: workspaceID,
		UserID:      userID,
		Role:        role,
	}).Exec(ctx)
	require.NoError(t, err)
}

func TestWorkspaceMemberLifecycleEndpointsEnforceRolesAndLastAdmin(t *testing.T) {
	t.Parallel()
	authenticator := workspaceTestAuthenticator{
		"admin-token":        {UserID: "admin-1", Email: "admin@example.com"},
		"editor-token":       {UserID: "editor-1", Email: "editor@example.com"},
		"scoped-admin-token": {UserID: "admin-1", Email: "admin@example.com", WorkspaceID: "ws-2"},
	}
	srv := newWorkspaceTestServerWithAuthenticator(t, nil, authenticator)
	seedWorkspaceUserAndMember(t, srv.db, "admin-1", "admin@example.com", models.WorkspaceRoleAdmin)
	_, err := srv.db.NewInsert().Model(&models.User{ID: "editor-1", Email: "editor@example.com"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1", UserID: "editor-1", Role: models.WorkspaceRoleEditor,
		Status: models.WorkspaceMemberStatusActive,
	}).Exec(t.Context())
	require.NoError(t, err)

	scopeChecks := []*httptest.ResponseRecorder{
		srv.getJSON(t, "/api/v1/workspaces/ws-1/team", "scoped-admin-token"),
		srv.postJSON(t, "/api/v1/workspaces/ws-1/invitations", map[string]string{
			"email": "other@example.com", "role": "viewer",
		}, "scoped-admin-token"),
		srv.postJSON(t, "/api/v1/workspaces/ws-1/invitations/invite-1/resend", map[string]string{}, "scoped-admin-token"),
		srv.deleteJSON(t, "/api/v1/workspaces/ws-1/invitations/invite-1", "scoped-admin-token"),
		srv.patchJSON(t, "/api/v1/workspaces/ws-1/members/editor-1", map[string]string{"role": "viewer"}, "scoped-admin-token"),
		srv.deleteJSON(t, "/api/v1/workspaces/ws-1/members/editor-1", "scoped-admin-token"),
		srv.getJSON(t, "/api/v1/workspaces/ws-1/access-audit", "scoped-admin-token"),
	}
	for _, response := range scopeChecks {
		require.Equal(t, http.StatusForbidden, response.Code, response.Body.String())
	}

	teamResponse := srv.getJSON(t, "/api/v1/workspaces/ws-1/team", "editor-token")
	require.Equal(t, http.StatusOK, teamResponse.Code, teamResponse.Body.String())
	var team WorkspaceTeamOutput
	require.NoError(t, json.Unmarshal(teamResponse.Body.Bytes(), &team.Body))
	require.False(t, team.Body.CanManage)

	unauthorized := srv.patchJSON(t, "/api/v1/workspaces/ws-1/members/admin-1", map[string]string{"role": "viewer"}, "editor-token")
	require.Equal(t, http.StatusForbidden, unauthorized.Code)

	roleChanged := srv.patchJSON(t, "/api/v1/workspaces/ws-1/members/editor-1", map[string]string{"role": "viewer"}, "admin-token")
	require.Equal(t, http.StatusOK, roleChanged.Code, roleChanged.Body.String())
	deactivated := srv.patchJSON(t, "/api/v1/workspaces/ws-1/members/editor-1", map[string]string{"status": "inactive"}, "admin-token")
	require.Equal(t, http.StatusOK, deactivated.Code, deactivated.Body.String())

	filtered := srv.getJSON(t, "/api/v1/workspaces/ws-1/team?status=inactive&q=EDITOR", "admin-token")
	require.Equal(t, http.StatusOK, filtered.Code, filtered.Body.String())
	var filteredTeam WorkspaceTeamOutput
	require.NoError(t, json.Unmarshal(filtered.Body.Bytes(), &filteredTeam.Body))
	require.Len(t, filteredTeam.Body.Members, 1)
	require.Equal(t, models.WorkspaceMemberStatusInactive, filteredTeam.Body.Members[0].Status)
	require.Equal(t, int64(1), filteredTeam.Body.CurrentSeats)

	audit := srv.getJSON(t, "/api/v1/workspaces/ws-1/access-audit?limit=10", "admin-token")
	require.Equal(t, http.StatusOK, audit.Code, audit.Body.String())
	var auditEvents []WorkspaceAccessAuditResponse
	require.NoError(t, json.Unmarshal(audit.Body.Bytes(), &auditEvents))
	require.Len(t, auditEvents, 2)

	lastAdminRemoval := srv.deleteJSON(t, "/api/v1/workspaces/ws-1/members/admin-1", "admin-token")
	require.Equal(t, http.StatusConflict, lastAdminRemoval.Code)
	require.Contains(t, lastAdminRemoval.Body.String(), "at least one active administrator")
}

func TestResendInvitationRotatesLinkAndRevokedInviteCannotBeAccepted(t *testing.T) {
	t.Parallel()
	authenticator := workspaceTestAuthenticator{
		"admin-token":   {UserID: "admin-1", Email: "admin@example.com"},
		"invitee-token": {UserID: "invitee-1", Email: "invitee@example.com"},
	}
	srv := newWorkspaceTestServerWithAuthenticator(t, nil, authenticator)
	seedWorkspaceUserAndMember(t, srv.db, "admin-1", "admin@example.com", models.WorkspaceRoleAdmin)
	_, err := srv.db.NewInsert().Model(&models.User{ID: "invitee-1", Email: "invitee@example.com"}).Exec(t.Context())
	require.NoError(t, err)

	created := srv.postJSON(t, "/api/v1/workspaces/ws-1/invitations", map[string]string{
		"email": "invitee@example.com", "role": "viewer",
	}, "admin-token")
	require.Equal(t, http.StatusOK, created.Code, created.Body.String())
	var first WorkspaceInvitationResponse
	require.NoError(t, json.Unmarshal(created.Body.Bytes(), &first))
	_, err = srv.db.NewUpdate().Model((*models.WorkspaceInvitation)(nil)).
		Set("last_sent_at = ?", time.Now().UTC().Add(-workspaceteam.InvitationResendDelay)).
		Where("id = ?", first.ID).Exec(t.Context())
	require.NoError(t, err)

	resent := srv.postJSON(t, "/api/v1/workspaces/ws-1/invitations/"+first.ID+"/resend", map[string]string{}, "admin-token")
	require.Equal(t, http.StatusOK, resent.Code, resent.Body.String())
	var second WorkspaceInvitationResponse
	require.NoError(t, json.Unmarshal(resent.Body.Bytes(), &second))
	require.NotEqual(t, first.AcceptURL, second.AcceptURL)
	secondAcceptURL, err := url.Parse(second.AcceptURL)
	require.NoError(t, err)
	secondToken := secondAcceptURL.Query().Get("token")
	require.NotEmpty(t, secondToken)

	revoked := srv.deleteJSON(t, "/api/v1/workspaces/ws-1/invitations/"+first.ID, "admin-token")
	require.Equal(t, http.StatusOK, revoked.Code, revoked.Body.String())
	accepted := srv.postJSON(t, "/api/v1/workspace-invitations/accept", map[string]string{"token": secondToken}, "invitee-token")
	require.Equal(t, http.StatusConflict, accepted.Code)
	require.Contains(t, accepted.Body.String(), "cannot be accepted")
}

func TestResendInvitationAppliesPerInvitationAbuseControl(t *testing.T) {
	t.Parallel()
	srv := newWorkspaceTestServer(t, nil)
	seedWorkspaceUserAndMember(t, srv.db, "user-1", "admin@example.com", models.WorkspaceRoleAdmin)

	created := srv.postJSON(t, "/api/v1/workspaces/ws-1/invitations", map[string]string{
		"email": "invitee@example.com", "role": "viewer",
	}, "web-token")
	require.Equal(t, http.StatusOK, created.Code, created.Body.String())
	var invitation WorkspaceInvitationResponse
	require.NoError(t, json.Unmarshal(created.Body.Bytes(), &invitation))

	for attempt := 0; attempt < 5; attempt++ {
		_, err := srv.db.NewUpdate().Model((*models.WorkspaceInvitation)(nil)).
			Set("last_sent_at = ?", time.Now().UTC().Add(-workspaceteam.InvitationResendDelay)).
			Where("id = ?", invitation.ID).Exec(t.Context())
		require.NoError(t, err)
		response := srv.postJSON(t, "/api/v1/workspaces/ws-1/invitations/"+invitation.ID+"/resend", map[string]string{}, "web-token")
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	}
	_, err := srv.db.NewUpdate().Model((*models.WorkspaceInvitation)(nil)).
		Set("last_sent_at = ?", time.Now().UTC().Add(-workspaceteam.InvitationResendDelay)).
		Where("id = ?", invitation.ID).Exec(t.Context())
	require.NoError(t, err)
	limited := srv.postJSON(t, "/api/v1/workspaces/ws-1/invitations/"+invitation.ID+"/resend", map[string]string{}, "web-token")
	require.Equal(t, http.StatusTooManyRequests, limited.Code, limited.Body.String())
	require.Contains(t, limited.Body.String(), "resend limit reached")
	require.Contains(t, limited.Body.String(), "try again after")
}

type workspaceInterleavedEntitlement struct {
	entitlements.Service
	beforeCheck func()
}

func (s *workspaceInterleavedEntitlement) Check(ctx context.Context, req entitlements.Request) (entitlements.Decision, error) {
	if s.beforeCheck != nil {
		fn := s.beforeCheck
		s.beforeCheck = nil
		fn()
	}
	return s.Service.Check(ctx, req)
}
func TestCreateWorkspaceRechecksLimitAfterCompetingCreation(t *testing.T) {
	policy := &workspaceInterleavedEntitlement{Service: entitlements.NewStaticService(entitlements.PlanSnapshot{PlanID: "limited", Limits: map[entitlements.LimitKey]int64{entitlements.LimitWorkspaces: 1}})}
	srv := newWorkspaceTestServer(t, policy)
	policy.beforeCheck = func() {
		resp := srv.createWorkspace(t, "Competing")
		require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	}
	resp := srv.createWorkspace(t, "Late")
	require.Equal(t, http.StatusPaymentRequired, resp.Code, resp.Body.String())
	count, err := srv.db.NewSelect().Model((*models.Workspace)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.EqualValues(t, 1, count)
}
