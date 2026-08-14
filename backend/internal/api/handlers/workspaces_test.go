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
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type workspaceTestServer struct {
	echo *echo.Echo
	db   *bun.DB
	api  huma.API
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
	handler.ListOrganizationAudit(api)
	handler.ExportOrganizationAudit(api)
	handler.ListInstanceAudit(api)
	handler.ExportInstanceAudit(api)
	handler.AcceptWorkspaceInvitation(api)
	handler.GetWorkspaceSetup(api)
	handler.StartWorkspaceComposition(api)

	return &workspaceTestServer{echo: e, db: db, api: api}
}

func TestWorkspaceSetupProjectsOwnerProgressFromProductState(t *testing.T) {
	t.Parallel()

	srv := newWorkspaceTestServer(t, entitlements.NewSelfHostedService())
	ctx := t.Context()
	seedWorkspaceUserAndMember(t, srv.db, "user-1", "user@example.com", models.WorkspaceRoleAdmin)

	initial := srv.getJSON(t, "/api/v1/workspaces/ws-1/setup", "web-token")
	require.Equal(t, http.StatusOK, initial.Code, initial.Body.String())
	var before WorkspaceSetupResponse
	require.NoError(t, json.Unmarshal(initial.Body.Bytes(), &before))
	require.True(t, before.Visible)
	require.Equal(t, 1, before.CompletedSteps)
	require.Equal(t, "destination", before.NextStep)
	require.Equal(t, "connect_destination", before.NextAction)
	require.Equal(t, "/settings?tab=accounts", before.ActionHref)

	_, err := srv.db.NewInsert().Model(&models.SocialAccount{
		ID: "account-1", WorkspaceID: "ws-1", Slug: "main", Platform: "x", AccountID: "1",
		AccessTokenEnc: []byte("token"), IsActive: true,
	}).Exec(ctx)
	require.NoError(t, err)

	withDestination := srv.getJSON(t, "/api/v1/workspaces/ws-1/setup", "web-token")
	require.Equal(t, http.StatusOK, withDestination.Code, withDestination.Body.String())
	var readyToPublish WorkspaceSetupResponse
	require.NoError(t, json.Unmarshal(withDestination.Body.Bytes(), &readyToPublish))
	require.Equal(t, 2, readyToPublish.CompletedSteps)
	require.Equal(t, "composition", readyToPublish.NextStep)
	require.Equal(t, "create_publication", readyToPublish.NextAction)
	require.Equal(t, "/", readyToPublish.ActionHref)

	started := srv.postJSON(t, "/api/v1/workspaces/ws-1/setup/composition", map[string]any{"signal": "text", "origin_key": "origin-text-0001"}, "web-token")
	require.Equal(t, http.StatusOK, started.Code, started.Body.String())
	var claim StartWorkspaceCompositionResponse
	require.NoError(t, json.Unmarshal(started.Body.Bytes(), &claim))
	require.True(t, claim.Claimed)

	refreshed := srv.getJSON(t, "/api/v1/workspaces/ws-1/setup", "web-token")
	var composing WorkspaceSetupResponse
	require.NoError(t, json.Unmarshal(refreshed.Body.Bytes(), &composing))
	require.Equal(t, 3, composing.CompletedSteps)
	require.Equal(t, "publication", composing.NextStep)

	_, err = srv.db.NewInsert().Model(&models.Publication{
		ID: "publication-1", WorkspaceID: "ws-1", CreatedByID: "user-1", Status: models.PublicationStatusScheduled,
		SourceContent: "Launch", MetadataJSON: "{}", ReleasePlanJSON: "{}", RepostOverride: "{}",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.WorkspaceActivation{
		ID: "activation:ws-1", WorkspaceID: "ws-1", PublicationID: "publication-1",
	}).Exec(ctx)
	require.NoError(t, err)

	activated := srv.getJSON(t, "/api/v1/workspaces/ws-1/setup", "web-token")
	require.Equal(t, http.StatusOK, activated.Code, activated.Body.String())
	var complete WorkspaceSetupResponse
	require.NoError(t, json.Unmarshal(activated.Body.Bytes(), &complete))
	require.False(t, complete.Visible)
	require.True(t, complete.Activated)
	require.Equal(t, 4, complete.CompletedSteps)
}

func TestWorkspaceCompositionStartsOnceForMeaningfulSignals(t *testing.T) {
	t.Parallel()

	for _, signal := range []string{"text", "media", "content_mode"} {
		t.Run(signal, func(t *testing.T) {
			srv := newWorkspaceTestServer(t, entitlements.NewSelfHostedService())
			seedWorkspaceUserAndMember(t, srv.db, "user-1", "user@example.com", models.WorkspaceRoleAdmin)

			first := srv.postJSON(t, "/api/v1/workspaces/ws-1/setup/composition", map[string]any{"signal": signal, "origin_key": "origin-signal-0001"}, "web-token")
			require.Equal(t, http.StatusOK, first.Code, first.Body.String())
			var firstClaim StartWorkspaceCompositionResponse
			require.NoError(t, json.Unmarshal(first.Body.Bytes(), &firstClaim))
			require.True(t, firstClaim.Claimed)

			reconciled := srv.postJSON(t, "/api/v1/workspaces/ws-1/setup/composition", map[string]any{"signal": signal, "origin_key": "origin-signal-0001"}, "web-token")
			require.Equal(t, http.StatusOK, reconciled.Code, reconciled.Body.String())
			var reconciledClaim StartWorkspaceCompositionResponse
			require.NoError(t, json.Unmarshal(reconciled.Body.Bytes(), &reconciledClaim))
			require.True(t, reconciledClaim.Claimed)

			repeat := srv.postJSON(t, "/api/v1/workspaces/ws-1/setup/composition", map[string]any{"signal": signal, "origin_key": "origin-repeat-0001"}, "web-token")
			require.Equal(t, http.StatusOK, repeat.Code, repeat.Body.String())
			var repeatClaim StartWorkspaceCompositionResponse
			require.NoError(t, json.Unmarshal(repeat.Body.Bytes(), &repeatClaim))
			require.False(t, repeatClaim.Claimed)
		})
	}
}

func TestWorkspaceCompositionRejectsEmptyAndUnknownSignals(t *testing.T) {
	t.Parallel()

	srv := newWorkspaceTestServer(t, entitlements.NewSelfHostedService())
	seedWorkspaceUserAndMember(t, srv.db, "user-1", "user@example.com", models.WorkspaceRoleAdmin)
	for _, signal := range []string{"", "focus", "destination", "draft"} {
		response := srv.postJSON(t, "/api/v1/workspaces/ws-1/setup/composition", map[string]any{"signal": signal, "origin_key": "origin-invalid-001"}, "web-token")
		require.Equal(t, http.StatusUnprocessableEntity, response.Code, response.Body.String())
	}
}

func TestWorkspaceSetupHidesActionsFromViewersAndRejectsScopedTokens(t *testing.T) {
	t.Parallel()

	authenticator := workspaceTestAuthenticator{
		"viewer-token": {UserID: "viewer-1", Email: "viewer@example.com"},
		"scoped-token": {UserID: "viewer-1", Email: "viewer@example.com", WorkspaceID: "other-workspace"},
	}
	srv := newWorkspaceTestServerWithAuthenticator(t, entitlements.NewSelfHostedService(), authenticator)
	seedWorkspaceUserAndMember(t, srv.db, "viewer-1", "viewer@example.com", models.WorkspaceRoleViewer)

	viewer := srv.getJSON(t, "/api/v1/workspaces/ws-1/setup", "viewer-token")
	require.Equal(t, http.StatusOK, viewer.Code, viewer.Body.String())
	var projection WorkspaceSetupResponse
	require.NoError(t, json.Unmarshal(viewer.Body.Bytes(), &projection))
	require.False(t, projection.Visible)
	require.Empty(t, projection.NextAction)

	scoped := srv.getJSON(t, "/api/v1/workspaces/ws-1/setup", "scoped-token")
	require.Equal(t, http.StatusForbidden, scoped.Code, scoped.Body.String())
}

func TestWorkspaceSetupDirectsAnOwnerToNameAnUnnamedWorkspace(t *testing.T) {
	t.Parallel()

	srv := newWorkspaceTestServer(t, entitlements.NewSelfHostedService())
	seedWorkspaceUserAndMember(t, srv.db, "user-1", "user@example.com", models.WorkspaceRoleAdmin)
	_, err := srv.db.NewUpdate().Model((*models.Workspace)(nil)).Set("name = ''").Where("id = ?", "ws-1").Exec(t.Context())
	require.NoError(t, err)

	response := srv.getJSON(t, "/api/v1/workspaces/ws-1/setup", "web-token")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var setup WorkspaceSetupResponse
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &setup))
	require.True(t, setup.Visible)
	require.Equal(t, "workspace", setup.NextStep)
	require.Equal(t, "name_workspace", setup.NextAction)
	require.Equal(t, "/settings?tab=general#workspace-name", setup.ActionHref)
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

func TestWorkspaceSetupRetiresAfterActivation(t *testing.T) {
	t.Parallel()

	srv := newWorkspaceTestServer(t, entitlements.NewSelfHostedService())
	seedWorkspaceUserAndMember(t, srv.db, "user-1", "user@example.com", models.WorkspaceRoleAdmin)
	_, err := srv.db.NewUpdate().Model((*models.Workspace)(nil)).Set("name = ''").Where("id = ?", "ws-1").Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.SocialAccount{
		ID: "account-1", WorkspaceID: "ws-1", Slug: "main", Platform: "x", AccountID: "1",
		AccessTokenEnc: []byte("token"), IsActive: true,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.WorkspaceActivation{
		ID: "activation:ws-1", WorkspaceID: "ws-1", PublicationID: "publication-1",
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.Publication{
		ID: "publication-1", WorkspaceID: "ws-1", CreatedByID: "user-1", Status: models.PublicationStatusPublished,
		SourceContent: "Launch", MetadataJSON: "{}", ReleasePlanJSON: "{}", RepostOverride: "{}",
	}).Exec(t.Context())
	require.NoError(t, err)

	response := srv.getJSON(t, "/api/v1/workspaces/ws-1/setup", "web-token")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var setup WorkspaceSetupResponse
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &setup))
	require.True(t, setup.Activated)
	require.False(t, setup.Visible)
	require.Empty(t, setup.NextStep)
	require.Empty(t, setup.NextAction)
}

func TestWorkspaceSetupProjectsHostedSubscriptionAndCheckoutForAnOwner(t *testing.T) {
	t.Parallel()

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
	)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewWorkspaceHandler(
		db,
		testAuthenticator{},
		entitlements.NewSubscriptionService(db, entitlements.NewCloudBootstrapService()),
	)
	handler.GetWorkspaceSetup(api)
	seedWorkspaceUserAndMember(t, db, "user-1", "user@example.com", models.WorkspaceRoleAdmin)

	request := func() *httptest.ResponseRecorder {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/workspaces/ws-1/setup", nil)
		req.Header.Set("Authorization", "Bearer web-token")
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		return rec
	}

	initial := request()
	require.Equal(t, http.StatusOK, initial.Code, initial.Body.String())
	var pending WorkspaceSetupResponse
	require.NoError(t, json.Unmarshal(initial.Body.Bytes(), &pending))
	require.Equal(t, 1, pending.CompletedSteps)
	require.Equal(t, 5, pending.TotalSteps)
	require.Equal(t, "subscription", pending.NextStep)
	require.Equal(t, "resume_checkout", pending.NextAction)
	require.Equal(t, "/settings?tab=billing", pending.ActionHref)

	_, err := db.NewInsert().Model(&models.BillingCheckoutAttempt{
		CheckoutAttemptID: "checkout-1", OrganizationID: "org-1", WorkspaceID: "ws-1", UserID: "user-1",
		ProviderPriceID: "price-1", PlanID: "founder", BillingPeriod: "monthly", Status: "created",
	}).Exec(t.Context())
	require.NoError(t, err)
	resumable := request()
	var checkout WorkspaceSetupResponse
	require.NoError(t, json.Unmarshal(resumable.Body.Bytes(), &checkout))
	require.Equal(t, "/checkout?attempt=checkout-1", checkout.ActionHref)

	_, err = db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID: "org-1", ProviderCustomerID: "customer-1", ProviderSubscriptionID: "subscription-1",
		Status: "trialing", PlanID: "founder", EntitlementSnapshot: "{}",
	}).Exec(t.Context())
	require.NoError(t, err)
	subscribed := request()
	var connected WorkspaceSetupResponse
	require.NoError(t, json.Unmarshal(subscribed.Body.Bytes(), &connected))
	require.Equal(t, 2, connected.CompletedSteps)
	require.Equal(t, "destination", connected.NextStep)
}

func TestWorkspaceSetupProjectsOnlyHostedEditorActions(t *testing.T) {
	t.Parallel()

	authenticator := workspaceTestAuthenticator{
		"editor-token": {UserID: "editor-1", Email: "editor@example.com"},
	}
	db := newWorkspaceSetupPolicyDB(t)
	entitlement := entitlements.NewSubscriptionService(db, entitlements.NewCloudBootstrapService())
	seedWorkspaceUserAndMember(t, db, "editor-1", "editor@example.com", models.WorkspaceRoleEditor)
	_, err := db.NewUpdate().Model((*models.Workspace)(nil)).Set("name = ''").Where("id = ?", "ws-1").Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.OrganizationMember)(nil)).Set("role = ?", models.OrganizationRoleMember).
		Where("organization_id = ? AND user_id = ?", "org-1", "editor-1").Exec(t.Context())
	require.NoError(t, err)

	rec := requestWorkspaceSetup(t, db, authenticator, entitlement, "editor-token")

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var setup WorkspaceSetupResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &setup))
	require.Equal(t, []WorkspaceSetupStepResponse{
		{ID: "destination", Completed: false},
		{ID: "composition", Completed: false},
		{ID: "publication", Completed: false},
	}, setup.Steps)
	require.Equal(t, 0, setup.CompletedSteps)
	require.Equal(t, 3, setup.TotalSteps)
	require.Equal(t, "destination", setup.NextStep)
	require.Equal(t, "connect_destination", setup.NextAction)
	require.Equal(t, "/settings?tab=accounts", setup.ActionHref)
	require.NotContains(t, rec.Body.String(), "subscription")
	require.NotContains(t, rec.Body.String(), "checkout")
}

func TestWorkspaceSetupProjectsOnlyApplicableRoleAndDeploymentSteps(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name             string
		entitlement      entitlements.Service
		workspaceRole    string
		organizationRole string
		wantSteps        []WorkspaceSetupStepResponse
		wantAction       string
		wantHref         string
		forbidBilling    bool
	}{
		{
			name:             "hosted organization owner receives the complete journey",
			workspaceRole:    models.WorkspaceRoleAdmin,
			organizationRole: models.OrganizationRoleOwner,
			wantSteps: []WorkspaceSetupStepResponse{
				{ID: "workspace", Completed: true},
				{ID: "subscription", Completed: false},
				{ID: "destination", Completed: false},
				{ID: "composition", Completed: false},
				{ID: "publication", Completed: false},
			},
			wantAction: "resume_checkout",
			wantHref:   "/settings?tab=billing",
		},
		{
			name:             "hosted organization administrator receives authorized billing action",
			workspaceRole:    models.WorkspaceRoleAdmin,
			organizationRole: models.OrganizationRoleAdmin,
			wantSteps: []WorkspaceSetupStepResponse{
				{ID: "subscription", Completed: false},
				{ID: "destination", Completed: false},
				{ID: "composition", Completed: false},
				{ID: "publication", Completed: false},
			},
			wantAction: "resume_checkout",
			wantHref:   "/settings?tab=billing",
		},
		{
			name:             "hosted workspace administrator receives content actions",
			workspaceRole:    models.WorkspaceRoleAdmin,
			organizationRole: models.OrganizationRoleMember,
			wantSteps: []WorkspaceSetupStepResponse{
				{ID: "destination", Completed: false},
				{ID: "composition", Completed: false},
				{ID: "publication", Completed: false},
			},
			wantAction:    "connect_destination",
			wantHref:      "/settings?tab=accounts",
			forbidBilling: true,
		},
		{
			name:             "hosted viewer receives orientation without setup actions",
			workspaceRole:    models.WorkspaceRoleViewer,
			organizationRole: models.OrganizationRoleMember,
			wantSteps:        []WorkspaceSetupStepResponse{},
			forbidBilling:    true,
		},
		{
			name:             "hosted organization owner with viewer access receives no setup actions",
			workspaceRole:    models.WorkspaceRoleViewer,
			organizationRole: models.OrganizationRoleOwner,
			wantSteps:        []WorkspaceSetupStepResponse{},
			forbidBilling:    true,
		},
		{
			name:             "self-hosted owner omits hosted service billing",
			entitlement:      entitlements.NewSelfHostedService(),
			workspaceRole:    models.WorkspaceRoleAdmin,
			organizationRole: models.OrganizationRoleOwner,
			wantSteps: []WorkspaceSetupStepResponse{
				{ID: "workspace", Completed: true},
				{ID: "destination", Completed: false},
				{ID: "composition", Completed: false},
				{ID: "publication", Completed: false},
			},
			wantAction:    "connect_destination",
			wantHref:      "/settings?tab=accounts",
			forbidBilling: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			authenticator := workspaceTestAuthenticator{
				"role-token": {UserID: "role-user", Email: "role@example.com"},
			}
			entitlement := tt.entitlement
			if entitlement == nil {
				db := newWorkspaceSetupPolicyDB(t)
				entitlement = entitlements.NewSubscriptionService(db, entitlements.NewCloudBootstrapService())
				runWorkspaceSetupPolicyTest(t, db, authenticator, entitlement, tt.workspaceRole, tt.organizationRole, tt.wantSteps, tt.wantAction, tt.wantHref, tt.forbidBilling)
				return
			}
			srv := newWorkspaceTestServerWithAuthenticator(t, entitlement, authenticator)
			runWorkspaceSetupPolicyTest(t, srv.db, authenticator, entitlement, tt.workspaceRole, tt.organizationRole, tt.wantSteps, tt.wantAction, tt.wantHref, tt.forbidBilling)
		})
	}
}

func runWorkspaceSetupPolicyTest(
	t *testing.T,
	db *bun.DB,
	authenticator middleware.Authenticator,
	entitlement entitlements.Service,
	workspaceRole string,
	organizationRole string,
	wantSteps []WorkspaceSetupStepResponse,
	wantAction string,
	wantHref string,
	forbidBilling bool,
) {
	t.Helper()

	seedWorkspaceUserAndMember(t, db, "role-user", "role@example.com", workspaceRole)
	_, err := db.NewUpdate().Model((*models.OrganizationMember)(nil)).Set("role = ?", organizationRole).
		Where("organization_id = ? AND user_id = ?", "org-1", "role-user").Exec(t.Context())
	require.NoError(t, err)

	rec := requestWorkspaceSetup(t, db, authenticator, entitlement, "role-token")

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var setup WorkspaceSetupResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &setup))
	require.Equal(t, wantSteps, setup.Steps)
	require.Equal(t, wantAction != "", setup.Visible)
	require.Equal(t, wantAction, setup.NextAction)
	require.Equal(t, wantHref, setup.ActionHref)
	if forbidBilling {
		require.NotContains(t, rec.Body.String(), "subscription")
		require.NotContains(t, rec.Body.String(), "resume_checkout")
		require.NotContains(t, rec.Body.String(), "checkout")
	}
	if len(wantSteps) == 0 {
		require.Empty(t, setup.NextStep)
		require.NotContains(t, rec.Body.String(), "settings")
	}
}

func newWorkspaceSetupPolicyDB(t *testing.T) *bun.DB {
	t.Helper()
	return createHandlerTestDB(
		t,
		(*models.User)(nil), (*models.Organization)(nil), (*models.OrganizationMember)(nil),
		(*models.BillingSubscription)(nil), (*models.BillingCheckoutAttempt)(nil),
		(*models.Workspace)(nil), (*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil), (*models.WorkspaceFirstComposition)(nil), (*models.Publication)(nil),
	)
}

func requestWorkspaceSetup(t *testing.T, db *bun.DB, authenticator middleware.Authenticator, entitlement entitlements.Service, token string) *httptest.ResponseRecorder {
	t.Helper()
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewWorkspaceHandler(db, authenticator, entitlement).GetWorkspaceSetup(api)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/workspaces/ws-1/setup", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
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
	require.NotContains(t, firstOut, "token")
	acceptURL, err := url.Parse(firstOut["accept_url"].(string))
	require.NoError(t, err)
	require.Regexp(t, `^op_inv_`, acceptURL.Query().Get("token"))

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
			Email               string `json:"email"`
			EmailDeliveryStatus string `json:"email_delivery_status"`
		} `json:"invitations"`
		CurrentSeats int64 `json:"current_seats"`
	}
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Len(t, out.Members, 1)
	require.Equal(t, "user@example.com", out.Members[0].Email)
	require.Len(t, out.Invitations, 1)
	require.Equal(t, "teammate@example.com", out.Invitations[0].Email)
	require.Equal(t, "unavailable", out.Invitations[0].EmailDeliveryStatus)
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
	require.Equal(t, http.StatusConflict, oldAddressResp.Code, oldAddressResp.Body.String())

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

func TestInvalidInvitationAcceptanceUsesOneSafeResponse(t *testing.T) {
	authenticator := workspaceTestAuthenticator{
		"invitee-token": {UserID: "invitee-1", Email: "invitee@example.com"},
	}
	srv := newWorkspaceTestServerWithAuthenticator(t, entitlements.NewSelfHostedService(), authenticator)
	seedWorkspaceUserAndMember(t, srv.db, "admin-1", "admin@example.com", models.WorkspaceRoleAdmin)
	_, err := srv.db.NewInsert().Model(&models.User{ID: "invitee-1", Email: "invitee@example.com"}).Exec(t.Context())
	require.NoError(t, err)
	now := time.Now().UTC()
	rows := []models.WorkspaceInvitation{
		{ID: "wrong-email", WorkspaceID: "ws-1", Email: "other@example.com", Role: "viewer", InvitedByUserID: "admin-1", TokenHash: hashWorkspaceInvitationToken("op_inv_wrong_email"), ExpiresAt: now.Add(time.Hour), CreatedAt: now},
		{ID: "expired", WorkspaceID: "ws-1", Email: "invitee@example.com", Role: "viewer", InvitedByUserID: "admin-1", TokenHash: hashWorkspaceInvitationToken("op_inv_expired_link"), ExpiresAt: now.Add(-time.Hour), CreatedAt: now},
		{ID: "revoked", WorkspaceID: "ws-1", Email: "invitee@example.com", Role: "viewer", InvitedByUserID: "admin-1", TokenHash: hashWorkspaceInvitationToken("op_inv_revoked_link"), ExpiresAt: now.Add(time.Hour), RevokedAt: now, CreatedAt: now},
	}
	_, err = srv.db.NewInsert().Model(&rows).Exec(t.Context())
	require.NoError(t, err)

	var expectedBody string
	for _, token := range []string{"op_inv_unknown_link", "op_inv_wrong_email", "op_inv_expired_link", "op_inv_revoked_link"} {
		response := srv.postJSON(t, "/api/v1/workspace-invitations/accept", map[string]string{"token": token}, "invitee-token")
		require.Equal(t, http.StatusConflict, response.Code, response.Body.String())
		if expectedBody == "" {
			expectedBody = response.Body.String()
		} else {
			require.Equal(t, expectedBody, response.Body.String())
		}
	}
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

func TestCreateInvitationAppliesPerWorkspaceAbuseControl(t *testing.T) {
	t.Parallel()
	srv := newWorkspaceTestServer(t, nil)
	seedWorkspaceUserAndMember(t, srv.db, "user-1", "admin@example.com", models.WorkspaceRoleAdmin)

	for attempt := 0; attempt < workspaceInvitationCreateLimit; attempt++ {
		created := srv.postJSON(t, "/api/v1/workspaces/ws-1/invitations", map[string]string{
			"email": fmt.Sprintf("invitee-%d@example.com", attempt), "role": "viewer",
		}, "web-token")
		require.Equal(t, http.StatusOK, created.Code, created.Body.String())
		var invitation WorkspaceInvitationResponse
		require.NoError(t, json.Unmarshal(created.Body.Bytes(), &invitation))

		revoked := srv.deleteJSON(t, "/api/v1/workspaces/ws-1/invitations/"+invitation.ID, "web-token")
		require.Equal(t, http.StatusOK, revoked.Code, revoked.Body.String())
	}
	limited := srv.postJSON(t, "/api/v1/workspaces/ws-1/invitations", map[string]string{
		"email": "limited@example.com", "role": "viewer",
	}, "web-token")
	require.Equal(t, http.StatusTooManyRequests, limited.Code, limited.Body.String())
	require.Contains(t, limited.Body.String(), "invitation limit reached")
}
