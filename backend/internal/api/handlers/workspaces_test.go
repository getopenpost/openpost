package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type workspaceTestServer struct {
	echo *echo.Echo
	db   *bun.DB
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
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.WorkspaceInvitation)(nil),
		(*models.WorkspaceAccessAuditEvent)(nil),
		(*models.IdentityProvider)(nil),
		(*models.OrganizationSSOPolicy)(nil),
		(*models.SessionIdentityAssurance)(nil),
		(*models.APIToken)(nil),
	)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewWorkspaceHandler(db, authenticator, entitlement)
	handler.SetFrontendURL("https://app.openpost.test")
	handler.CreateWorkspace(api)
	handler.ListWorkspaceTeam(api)
	handler.CreateWorkspaceInvitation(api)
	handler.ResendWorkspaceInvitation(api)
	handler.RevokeWorkspaceInvitation(api)
	handler.UpdateWorkspaceMember(api)
	handler.RemoveWorkspaceMember(api)
	handler.ListWorkspaceAccessAudit(api)
	handler.AcceptWorkspaceInvitation(api)

	return &workspaceTestServer{echo: e, db: db}
}

func (s *workspaceTestServer) createWorkspace(t *testing.T, name string) *httptest.ResponseRecorder {
	t.Helper()

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

func TestCreateWorkspaceAllowsSelfHostedDefault(t *testing.T) {
	t.Parallel()

	srv := newWorkspaceTestServer(t, nil)
	resp := srv.createWorkspace(t, "Launch")

	require.Equal(t, http.StatusOK, resp.Code)
	var count int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("workspaces").Scan(context.Background(), &count))
	require.Equal(t, 1, count)
	var workspace models.Workspace
	require.NoError(t, srv.db.NewSelect().Model(&workspace).Limit(1).Scan(context.Background()))
	require.Equal(t, 1, workspace.WeekStart)
}

func TestCreateWorkspaceCloudBootstrapAllowsFirstWorkspaceOnly(t *testing.T) {
	t.Parallel()

	srv := newWorkspaceTestServer(t, entitlements.NewCloudBootstrapService())

	first := srv.createWorkspace(t, "Launch")
	require.Equal(t, http.StatusOK, first.Code)

	second := srv.createWorkspace(t, "Second")
	require.Equal(t, http.StatusPaymentRequired, second.Code)
	require.Contains(t, second.Body.String(), "workspaces limit exceeded")

	var count int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("workspaces").Scan(context.Background(), &count))
	require.Equal(t, 1, count)
}

func TestCreateWorkspaceReusesOwnersActiveSubscribedOrganization(t *testing.T) {
	t.Parallel()

	srv := newWorkspaceTestServer(t, entitlements.NewSelfHostedService())
	ctx := t.Context()
	_, err := srv.db.NewInsert().Model(&models.Organization{
		ID: "org-agency", Name: "Agency", CreatedByID: "user-1", CreatedAt: time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.OrganizationMember{
		OrganizationID: "org-agency", UserID: "user-1", Role: models.OrganizationRoleOwner,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID:         "org-agency",
		ProviderCustomerID:     "customer-1",
		ProviderSubscriptionID: "subscription-1",
		Status:                 "active",
		PlanID:                 "agency",
		EntitlementSnapshot:    `{}`,
		UpdatedAt:              time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)

	resp := srv.createWorkspace(t, "Client workspace")
	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())

	var workspace models.Workspace
	require.NoError(t, srv.db.NewSelect().Model(&workspace).Where("name = ?", "Client workspace").Scan(ctx))
	require.Equal(t, "org-agency", workspace.OrganizationID)
}

func TestCreateWorkspaceRejectsWhenEntitlementLimitExceeded(t *testing.T) {
	t.Parallel()

	entitlement := entitlements.NewStaticService(entitlements.PlanSnapshot{
		PlanID: "starter",
		Limits: map[entitlements.LimitKey]int64{
			entitlements.LimitWorkspaces: 1,
		},
	})
	srv := newWorkspaceTestServer(t, entitlement)
	ctx := context.Background()
	_, err := srv.db.NewInsert().Model(&models.Workspace{
		ID:        "existing-ws",
		Name:      "Existing",
		CreatedAt: time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "existing-ws",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)

	resp := srv.createWorkspace(t, "Blocked")

	require.Equal(t, http.StatusPaymentRequired, resp.Code)
	require.Contains(t, resp.Body.String(), "workspaces limit exceeded")
	var count int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("workspaces").Scan(ctx, &count))
	require.Equal(t, 1, count)
}

func TestCreateWorkspaceInvitationEnforcesTeamMemberQuota(t *testing.T) {
	t.Parallel()

	entitlement := entitlements.NewStaticService(entitlements.PlanSnapshot{
		PlanID: "starter",
		Limits: map[entitlements.LimitKey]int64{
			entitlements.LimitTeamMembers: 2,
		},
	})
	srv := newWorkspaceTestServer(t, entitlement)
	seedWorkspaceUserAndMember(t, srv.db, "user-1", "user@example.com", models.WorkspaceRoleAdmin)

	first := srv.postJSON(t, "/api/v1/workspaces/ws-1/invitations", map[string]string{
		"email": "Teammate@example.com",
		"role":  models.WorkspaceRoleEditor,
	}, "web-token")
	require.Equal(t, http.StatusOK, first.Code, first.Body.String())
	var firstOut map[string]any
	require.NoError(t, json.Unmarshal(first.Body.Bytes(), &firstOut))
	require.Equal(t, "teammate@example.com", firstOut["email"])
	require.Regexp(t, `^op_inv_`, firstOut["token"])
	require.Equal(t, "https://app.openpost.test/invite?token="+firstOut["token"].(string), firstOut["accept_url"])

	second := srv.postJSON(t, "/api/v1/workspaces/ws-1/invitations", map[string]string{
		"email": "second@example.com",
		"role":  models.WorkspaceRoleViewer,
	}, "web-token")
	require.Equal(t, http.StatusPaymentRequired, second.Code)
	require.Contains(t, second.Body.String(), "team_members limit exceeded")

	var count int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("workspace_invitations").Scan(context.Background(), &count))
	require.Equal(t, 1, count)
}

func TestCreateWorkspaceInvitationRequiresAdmin(t *testing.T) {
	t.Parallel()

	srv := newWorkspaceTestServer(t, entitlements.NewSelfHostedService())
	seedWorkspaceUserAndMember(t, srv.db, "user-1", "user@example.com", models.WorkspaceRoleEditor)

	resp := srv.postJSON(t, "/api/v1/workspaces/ws-1/invitations", map[string]string{
		"email": "teammate@example.com",
		"role":  models.WorkspaceRoleEditor,
	}, "web-token")

	require.Equal(t, http.StatusForbidden, resp.Code)
	require.Contains(t, resp.Body.String(), "workspace admin role required")
}

func TestListWorkspaceTeamReturnsMembersAndPendingInvites(t *testing.T) {
	t.Parallel()

	srv := newWorkspaceTestServer(t, entitlements.NewSelfHostedService())
	seedWorkspaceUserAndMember(t, srv.db, "user-1", "user@example.com", models.WorkspaceRoleAdmin)
	_, err := srv.db.NewInsert().Model(&models.WorkspaceInvitation{
		ID:              "invite-1",
		WorkspaceID:     "ws-1",
		Email:           "teammate@example.com",
		Role:            models.WorkspaceRoleEditor,
		InvitedByUserID: "user-1",
		TokenHash:       "hash-1",
		ExpiresAt:       time.Now().UTC().Add(24 * time.Hour),
		CreatedAt:       time.Now().UTC(),
	}).Exec(context.Background())
	require.NoError(t, err)

	resp := srv.getJSON(t, "/api/v1/workspaces/ws-1/team", "web-token")

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out struct {
		Members []struct {
			Email string `json:"email"`
			Role  string `json:"role"`
		} `json:"members"`
		Invitations []struct {
			Email string `json:"email"`
			Token string `json:"token"`
		} `json:"invitations"`
		CurrentSeats int64 `json:"current_seats"`
	}
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Len(t, out.Members, 1)
	require.Equal(t, "user@example.com", out.Members[0].Email)
	require.Len(t, out.Invitations, 1)
	require.Equal(t, "teammate@example.com", out.Invitations[0].Email)
	require.Empty(t, out.Invitations[0].Token)
	require.Equal(t, int64(2), out.CurrentSeats)
}

func TestAcceptWorkspaceInvitationAddsWorkspaceMember(t *testing.T) {
	t.Parallel()

	authenticator := workspaceTestAuthenticator{
		"admin-token":  {UserID: "admin-1", Email: "admin@example.com"},
		"invite-token": {UserID: "user-1", Email: "former-address@example.com"},
		"scoped-token": {
			UserID: "user-1", Email: "former-address@example.com", WorkspaceID: "ws-2",
		},
	}
	srv := newWorkspaceTestServerWithAuthenticator(t, entitlements.NewSelfHostedService(), authenticator)
	ctx := context.Background()
	seedWorkspaceUserAndMember(t, srv.db, "admin-1", "admin@example.com", models.WorkspaceRoleAdmin)
	_, err := srv.db.NewInsert().Model(&models.User{
		ID:           "user-1",
		Email:        "teammate@example.com",
		PasswordHash: "hash",
		CreatedAt:    time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)
	rawInviteToken := "op_inv_accept_me"
	_, err = srv.db.NewInsert().Model(&models.WorkspaceInvitation{
		ID:              "invite-1",
		WorkspaceID:     "ws-1",
		Email:           "teammate@example.com",
		Role:            models.WorkspaceRoleViewer,
		InvitedByUserID: "admin-1",
		TokenHash:       hashWorkspaceInvitationToken(rawInviteToken),
		ExpiresAt:       time.Now().UTC().Add(24 * time.Hour),
		CreatedAt:       time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)
	oldAddressInviteToken := "op_inv_old_address"
	_, err = srv.db.NewInsert().Model(&models.WorkspaceInvitation{
		ID:              "invite-old-address",
		WorkspaceID:     "ws-1",
		Email:           "former-address@example.com",
		Role:            models.WorkspaceRoleViewer,
		InvitedByUserID: "admin-1",
		TokenHash:       hashWorkspaceInvitationToken(oldAddressInviteToken),
		ExpiresAt:       time.Now().UTC().Add(24 * time.Hour),
		CreatedAt:       time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)

	oldAddressResp := srv.postJSON(t, "/api/v1/workspace-invitations/accept", map[string]string{
		"token": oldAddressInviteToken,
	}, "invite-token")
	require.Equal(t, http.StatusForbidden, oldAddressResp.Code, oldAddressResp.Body.String())

	scopedResp := srv.postJSON(t, "/api/v1/workspace-invitations/accept", map[string]string{
		"token": rawInviteToken,
	}, "scoped-token")
	require.Equal(t, http.StatusForbidden, scopedResp.Code, scopedResp.Body.String())

	resp := srv.postJSON(t, "/api/v1/workspace-invitations/accept", map[string]string{
		"token": rawInviteToken,
	}, "invite-token")

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var member models.WorkspaceMember
	require.NoError(t, srv.db.NewSelect().Model(&member).Where("workspace_id = ? AND user_id = ?", "ws-1", "user-1").Scan(ctx))
	require.Equal(t, models.WorkspaceRoleViewer, member.Role)
	var organizationMember models.OrganizationMember
	require.NoError(t, srv.db.NewSelect().Model(&organizationMember).
		Where("organization_id = ? AND user_id = ?", "org-1", "user-1").
		Scan(ctx))
	require.Equal(t, models.OrganizationRoleMember, organizationMember.Role)
	var invitation models.WorkspaceInvitation
	require.NoError(t, srv.db.NewSelect().Model(&invitation).Where("id = ?", "invite-1").Scan(ctx))
	require.Equal(t, "user-1", invitation.AcceptedByUserID)
	require.False(t, invitation.AcceptedAt.IsZero())
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

	resent := srv.postJSON(t, "/api/v1/workspaces/ws-1/invitations/"+first.ID+"/resend", map[string]string{}, "admin-token")
	require.Equal(t, http.StatusOK, resent.Code, resent.Body.String())
	var second WorkspaceInvitationResponse
	require.NoError(t, json.Unmarshal(resent.Body.Bytes(), &second))
	require.NotEqual(t, first.Token, second.Token)
	require.NotEqual(t, first.AcceptURL, second.AcceptURL)

	revoked := srv.deleteJSON(t, "/api/v1/workspaces/ws-1/invitations/"+first.ID, "admin-token")
	require.Equal(t, http.StatusOK, revoked.Code, revoked.Body.String())
	accepted := srv.postJSON(t, "/api/v1/workspace-invitations/accept", map[string]string{"token": second.Token}, "invitee-token")
	require.Equal(t, http.StatusConflict, accepted.Code)
	require.Contains(t, accepted.Body.String(), "revoked")
}
