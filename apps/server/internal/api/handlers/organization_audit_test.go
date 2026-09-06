package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/stretchr/testify/require"
)

func TestOrganizationOwnerCanPageFilterAndExportSafeAuditEvidence(t *testing.T) {
	srv := newWorkspaceTestServer(t, entitlements.NewSelfHostedService())
	csvContract := srv.api.OpenAPI().Paths["/organizations/{id}/audit-events/export.csv"].Get.Responses["200"]
	require.Contains(t, csvContract.Content, "text/csv")
	require.NotContains(t, csvContract.Content, "application/json")
	seedWorkspaceUserAndMember(t, srv.db, "user-1", "owner@example.com", models.WorkspaceRoleViewer)
	now := time.Date(2026, time.August, 14, 12, 0, 0, 0, time.UTC)
	for _, row := range []any{
		&models.IdentityAuditEvent{ID: "identity-1", OrganizationID: "org-1", ActorUserID: "user-1", Action: "policy.updated", Detail: "required", CreatedAt: now.Add(-time.Minute)},
		&models.IdentityAuditEvent{ID: "identity-secret", OrganizationID: "org-1", ActorUserID: "user-1", SubjectUserID: "user-1", Action: "reauth.completed", Detail: "password:delete secret-token", CreatedAt: now.Add(-2 * time.Minute)},
		&models.WorkspaceAccessAuditEvent{ID: "access-1", WorkspaceID: "ws-1", ActorUserID: "user-1", SubjectUserID: "member-1", SubjectEmail: "private@example.com", Action: "member.role_changed", PreviousRole: "viewer", Role: "editor", CreatedAt: now},
	} {
		_, err := srv.db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}

	first := srv.getJSON(t, "/api/v1/organizations/org-1/audit-events?limit=2", "web-token")
	require.Equal(t, http.StatusOK, first.Code, first.Body.String())
	require.NotContains(t, first.Body.String(), "private@example.com")
	require.NotContains(t, first.Body.String(), "secret-token")
	var firstPage OrganizationAuditPage
	require.NoError(t, json.Unmarshal(first.Body.Bytes(), &firstPage))
	require.Len(t, firstPage.Items, 2)
	require.NotEmpty(t, firstPage.NextCursor)

	second := srv.getJSON(t, "/api/v1/organizations/org-1/audit-events?limit=2&cursor="+firstPage.NextCursor, "web-token")
	require.Equal(t, http.StatusOK, second.Code, second.Body.String())
	var secondPage OrganizationAuditPage
	require.NoError(t, json.Unmarshal(second.Body.Bytes(), &secondPage))
	require.Equal(t, []string{"identity-secret"}, []string{secondPage.Items[0].ID})

	filteredPath := "/api/v1/organizations/org-1/audit-events?workspace_id=ws-1&resource_type=workspace_member&action=member.role_changed"
	filtered := srv.getJSON(t, filteredPath, "web-token")
	require.Equal(t, http.StatusOK, filtered.Code, filtered.Body.String())
	require.Contains(t, filtered.Body.String(), "access-1")
	require.NotContains(t, filtered.Body.String(), "identity-1")

	jsonExport := srv.getJSON(t, "/api/v1/organizations/org-1/audit-events/export.json?action=member.role_changed", "web-token")
	require.Equal(t, http.StatusOK, jsonExport.Code, jsonExport.Body.String())
	require.Contains(t, jsonExport.Header().Get("Content-Disposition"), "attachment")
	require.Contains(t, jsonExport.Body.String(), "access-1")
	require.NotContains(t, jsonExport.Body.String(), "private@example.com")

	csvExport := srv.getJSON(t, "/api/v1/organizations/org-1/audit-events/export.csv?action=member.role_changed", "web-token")
	require.Equal(t, http.StatusOK, csvExport.Code, csvExport.Body.String())
	require.True(t, strings.HasPrefix(csvExport.Header().Get("Content-Type"), "text/csv"))
	require.Contains(t, csvExport.Body.String(), "workspace_member")
	require.NotContains(t, csvExport.Body.String(), "private@example.com")

	_, err := srv.db.NewInsert().Model(&models.OrganizationOwnershipAuditEvent{
		ID: "ownership-1", OrganizationID: "org-1", TransferID: "transfer-1",
		ActorUserID: "user-1", NomineeUserID: "user-1", Action: "ownership_transfer.initiated",
		Result: "succeeded", CreatedAt: now.Add(2 * time.Minute),
	}).Exec(t.Context())
	require.NoError(t, err)
	ownership := srv.getJSON(t, "/api/v1/organizations/org-1/audit-events?resource_type=organization_ownership_transfer", "web-token")
	require.Equal(t, http.StatusOK, ownership.Code, ownership.Body.String())
	require.Contains(t, ownership.Body.String(), "ownership-1")
	require.Contains(t, ownership.Body.String(), `"type":"organization_ownership_transfer"`)
	require.NotContains(t, ownership.Body.String(), "identity-1")

	for _, row := range []models.BillingCheckoutAttempt{
		{CheckoutAttemptID: "billing-new", OrganizationID: "org-1", WorkspaceID: "ws-1", ProviderPriceID: "price", PlanID: "pro", BillingPeriod: "monthly", Status: "completed", CreatedAt: now.Add(time.Minute), UpdatedAt: now.Add(time.Minute)},
		{CheckoutAttemptID: "billing-old", OrganizationID: "org-1", WorkspaceID: "ws-1", ProviderPriceID: "price", PlanID: "pro", BillingPeriod: "monthly", Status: "completed", CreatedAt: now, UpdatedAt: now},
	} {
		_, err := srv.db.NewInsert().Model(&row).Exec(t.Context())
		require.NoError(t, err)
	}
	billingFirst := srv.getJSON(t, "/api/v1/organizations/org-1/audit-events?resource_type=billing&limit=1", "web-token")
	require.Equal(t, http.StatusOK, billingFirst.Code, billingFirst.Body.String())
	var billingFirstPage OrganizationAuditPage
	require.NoError(t, json.Unmarshal(billingFirst.Body.Bytes(), &billingFirstPage))
	require.Equal(t, []string{"billing-new"}, []string{billingFirstPage.Items[0].ID})
	require.NotEmpty(t, billingFirstPage.NextCursor)
	billingSecond := srv.getJSON(t, "/api/v1/organizations/org-1/audit-events?resource_type=billing&limit=1&cursor="+billingFirstPage.NextCursor, "web-token")
	require.Equal(t, http.StatusOK, billingSecond.Code, billingSecond.Body.String())
	var billingSecondPage OrganizationAuditPage
	require.NoError(t, json.Unmarshal(billingSecond.Body.Bytes(), &billingSecondPage))
	require.Equal(t, []string{"billing-old"}, []string{billingSecondPage.Items[0].ID})
}

func TestOrganizationAuditRequiresOwnerAndUnscopedCredential(t *testing.T) {
	authenticator := workspaceTestAuthenticator{
		"member-token": {UserID: "user-1", Email: "member@example.com"},
		"bound-token":  {UserID: "user-1", Email: "member@example.com", WorkspaceID: "ws-1", TokenID: "token-1"},
	}
	srv := newWorkspaceTestServerWithAuthenticator(t, entitlements.NewSelfHostedService(), authenticator)
	seedWorkspaceUserAndMember(t, srv.db, "user-1", "member@example.com", models.WorkspaceRoleAdmin)
	_, err := srv.db.NewUpdate().Model((*models.OrganizationMember)(nil)).
		Set("role = ?", models.OrganizationRoleMember).
		Where("organization_id = ? AND user_id = ?", "org-1", "user-1").Exec(t.Context())
	require.NoError(t, err)

	member := srv.getJSON(t, "/api/v1/organizations/org-1/audit-events", "member-token")
	require.Equal(t, http.StatusForbidden, member.Code, member.Body.String())
	require.Contains(t, member.Body.String(), "organization owner role required")

	bound := srv.getJSON(t, "/api/v1/organizations/org-1/audit-events", "bound-token")
	require.Equal(t, http.StatusForbidden, bound.Code, bound.Body.String())
	require.Contains(t, bound.Body.String(), "workspace-bound tokens")
}

func TestOrganizationAuditRejectsCrossOrganizationWorkspaceFilter(t *testing.T) {
	srv := newWorkspaceTestServer(t, entitlements.NewSelfHostedService())
	seedWorkspaceUserAndMember(t, srv.db, "user-1", "owner@example.com", models.WorkspaceRoleAdmin)
	_, err := srv.db.NewInsert().Model(&models.Workspace{ID: "outside", OrganizationID: "org-2", Name: "Outside"}).Exec(t.Context())
	require.NoError(t, err)

	response := srv.getJSON(t, "/api/v1/organizations/org-1/audit-events?workspace_id=outside", "web-token")
	require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
	require.NotContains(t, response.Body.String(), "Outside")
}

func TestInstanceAdministratorCanFilterAndExportInstanceAuditEvidence(t *testing.T) {
	authenticator := workspaceTestAuthenticator{
		"admin-session": {UserID: "admin-1", Email: "admin@example.com", SessionID: "session-1"},
	}
	srv := newWorkspaceTestServerWithAuthenticator(t, entitlements.NewSelfHostedService(), authenticator)
	now := time.Date(2026, time.August, 14, 12, 0, 0, 0, time.UTC)
	for _, row := range []any{
		&models.User{ID: "admin-1", Email: "admin@example.com", IsAdmin: true, CreatedAt: now},
		&models.Organization{ID: "org-1", Name: "One", CreatedAt: now},
		&models.Organization{ID: "org-2", Name: "Two", CreatedAt: now},
		&models.Workspace{ID: "ws-1", OrganizationID: "org-1", Name: "One", CreatedAt: now},
		&models.Workspace{ID: "ws-2", OrganizationID: "org-2", Name: "Two", CreatedAt: now},
		&models.IdentityProvider{ID: "provider-1", OrganizationID: "org-1", Issuer: "https://identity.example", Name: "Identity", ClientID: "client"},
		&models.IdentityAuditEvent{ID: "identity-1", OrganizationID: "org-1", ActorUserID: "actor-1", Action: "policy.updated", Detail: "required", CreatedAt: now},
		&models.IdentityAuditEvent{ID: "identity-inferred", ProviderID: "provider-1", ActorUserID: "actor-1", Action: "identity.unlinked", Detail: "secret-token", CreatedAt: now.Add(-30 * time.Second)},
		&models.WorkspaceAccessAuditEvent{ID: "access-2", WorkspaceID: "ws-2", ActorUserID: "actor-2", SubjectEmail: "private@example.com", Action: "member.removed", CreatedAt: now.Add(-time.Minute)},
	} {
		_, err := srv.db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}

	all := srv.getJSON(t, "/api/v1/admin/audit-events", "admin-session")
	require.Equal(t, http.StatusOK, all.Code, all.Body.String())
	require.Contains(t, all.Body.String(), `"organization_id":"org-1"`)
	require.Contains(t, all.Body.String(), `"organization_id":"org-2"`)
	require.Contains(t, all.Body.String(), `"id":"identity-inferred"`)
	require.Contains(t, all.Body.String(), `"organization_id":"org-1"`)
	require.NotContains(t, all.Body.String(), "private@example.com")
	require.NotContains(t, all.Body.String(), "secret-token")

	filtered := srv.getJSON(t, "/api/v1/admin/audit-events?organization_id=org-2&workspace_id=ws-2&result=succeeded", "admin-session")
	require.Equal(t, http.StatusOK, filtered.Code, filtered.Body.String())
	require.Contains(t, filtered.Body.String(), "access-2")
	require.NotContains(t, filtered.Body.String(), "identity-1")

	exported := srv.getJSON(t, "/api/v1/admin/audit-events/export.csv?organization_id=org-2", "admin-session")
	require.Equal(t, http.StatusOK, exported.Code, exported.Body.String())
	require.Contains(t, exported.Body.String(), "organization_id")
	require.Contains(t, exported.Body.String(), "org-2")

	jsonExport := srv.getJSON(t, "/api/v1/admin/audit-events/export.json?organization_id=org-1", "admin-session")
	require.Equal(t, http.StatusOK, jsonExport.Code, jsonExport.Body.String())
	require.Contains(t, jsonExport.Body.String(), `"id":"identity-inferred"`)
	require.Contains(t, jsonExport.Body.String(), `"organization_id":"org-1"`)
	require.NotContains(t, jsonExport.Body.String(), "secret-token")
}

func TestInstanceAuditRejectsNonAdminsOwnersAndScopedCredentials(t *testing.T) {
	authenticator := workspaceTestAuthenticator{
		"ordinary-session":       {UserID: "ordinary-1", Email: "ordinary@example.com", SessionID: "session-ordinary"},
		"workspace-role-session": {UserID: "workspace-1", Email: "workspace@example.com", SessionID: "session-workspace"},
		"owner-session":          {UserID: "owner-1", Email: "owner@example.com", SessionID: "session-owner"},
		"admin-token":            {UserID: "admin-1", Email: "admin@example.com"},
		"scoped-admin":           {UserID: "admin-1", Email: "admin@example.com", WorkspaceID: "ws-1", TokenID: "token-1"},
	}
	srv := newWorkspaceTestServerWithAuthenticator(t, entitlements.NewSelfHostedService(), authenticator)
	now := time.Now().UTC()
	for _, row := range []any{
		&models.User{ID: "ordinary-1", Email: "ordinary@example.com", CreatedAt: now},
		&models.User{ID: "workspace-1", Email: "workspace@example.com", CreatedAt: now},
		&models.User{ID: "owner-1", Email: "owner@example.com", CreatedAt: now},
		&models.User{ID: "admin-1", Email: "admin@example.com", IsAdmin: true, CreatedAt: now},
		&models.Organization{ID: "org-1", Name: "One", CreatedAt: now},
		&models.Workspace{ID: "ws-1", OrganizationID: "org-1", Name: "One", CreatedAt: now},
		&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "workspace-1", Role: models.WorkspaceRoleAdmin, Status: "active", CreatedAt: now},
		&models.OrganizationMember{OrganizationID: "org-1", UserID: "owner-1", Role: models.OrganizationRoleOwner, CreatedAt: now},
	} {
		_, err := srv.db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}

	for token, detail := range map[string]string{
		"ordinary-session":       "instance admin role required",
		"workspace-role-session": "instance admin role required",
		"owner-session":          "instance admin role required",
		"admin-token":            "browser session",
		"scoped-admin":           "browser session",
	} {
		for _, path := range []string{"/api/v1/admin/audit-events", "/api/v1/admin/audit-events/export.json"} {
			response := srv.getJSON(t, path, token)
			require.Equal(t, http.StatusForbidden, response.Code, "%s %s: %s", token, path, response.Body.String())
			require.Contains(t, response.Body.String(), detail)
		}
	}
}
