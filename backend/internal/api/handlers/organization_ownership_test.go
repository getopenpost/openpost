package handlers

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/organizationownership"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type ownershipAuthenticator map[string]*middleware.Principal

func (a ownershipAuthenticator) AuthenticateBearer(_ context.Context, token string) (*middleware.Principal, error) {
	principal := a[token]
	if principal == nil {
		return nil, errors.New("invalid token")
	}
	return principal, nil
}

type ownershipReauth struct{ calls int }

func (r *ownershipReauth) ConsumeReauthGrant(_ context.Context, raw, userID, sessionID, action string) error {
	if raw != "recent" || userID != "owner" || sessionID != "owner-session" || action != organizationownership.ReauthAction {
		return errors.New("invalid grant")
	}
	if r.calls != 0 {
		return errors.New("grant already used")
	}
	r.calls++
	return nil
}

func newOwnershipHandlerTest(t *testing.T) (*echo.Echo, *organizationownership.Service, *ownershipReauth, *bun.DB) {
	return newOwnershipHandlerTestWithReauth(t, true)
}

func newOwnershipHandlerTestWithReauth(t *testing.T, reauthAvailable bool) (*echo.Echo, *organizationownership.Service, *ownershipReauth, *bun.DB) {
	t.Helper()
	db := createHandlerTestDB(t, (*models.User)(nil), (*models.Organization)(nil), (*models.OrganizationMember)(nil), (*models.OrganizationSSOPolicy)(nil), (*models.OrganizationOwnershipTransfer)(nil), (*models.OrganizationOwnershipAuditEvent)(nil), (*models.Job)(nil))
	now := time.Now().UTC()
	users := []models.User{{ID: "owner", Email: "owner@example.com"}, {ID: "nominee", Email: "nominee@example.com"}, {ID: "member", Email: "member@example.com"}}
	_, err := db.NewInsert().Model(&users).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Organization{ID: "org", Name: "Acme", CreatedByID: "owner", CreatedAt: now, UpdatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	members := []models.OrganizationMember{{OrganizationID: "org", UserID: "owner", Role: models.OrganizationRoleOwner, CreatedAt: now}, {OrganizationID: "org", UserID: "nominee", Role: models.OrganizationRoleMember, CreatedAt: now}, {OrganizationID: "org", UserID: "member", Role: models.OrganizationRoleAdmin, CreatedAt: now}}
	_, err = db.NewInsert().Model(&members).Exec(t.Context())
	require.NoError(t, err)
	auth := ownershipAuthenticator{
		"owner":       {UserID: "owner", Email: "owner@example.com", SessionID: "owner-session"},
		"nominee":     {UserID: "nominee", Email: "nominee@example.com", SessionID: "nominee-session"},
		"member":      {UserID: "member", Email: "member@example.com", SessionID: "member-session"},
		"scoped":      {UserID: "owner", Email: "owner@example.com", TokenID: "token", WorkspaceID: "workspace"},
		"sessionless": {UserID: "owner", Email: "owner@example.com"},
	}
	reauth := &ownershipReauth{}
	var reauthService organizationownership.ReauthGrantConsumer
	if reauthAvailable {
		reauthService = reauth
	}
	service := organizationownership.NewService(db, nil, reauthService)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1"))
	NewOrganizationOwnershipHandler(service, auth).RegisterRoutes(api)
	return e, service, reauth, db
}

func TestOwnershipInitiationRequiresOwnerRecentAuthAndExactConfirmation(t *testing.T) {
	e, _, reauth, db := newOwnershipHandlerTest(t)
	body := map[string]any{"nominee_user_id": "nominee", "confirm_organization_name": "Acme", "reauth_grant": "recent"}
	member := jsonRequest(t, e, http.MethodPost, "/api/v1/organizations/org/ownership-transfer", body, "member")
	require.Equal(t, http.StatusForbidden, member.Code, member.Body.String())
	wrongConfirmation := jsonRequest(t, e, http.MethodPost, "/api/v1/organizations/org/ownership-transfer", map[string]any{"nominee_user_id": "nominee", "confirm_organization_name": "acme", "reauth_grant": "recent"}, "owner")
	require.Equal(t, http.StatusBadRequest, wrongConfirmation.Code, wrongConfirmation.Body.String())
	badReauth := jsonRequest(t, e, http.MethodPost, "/api/v1/organizations/org/ownership-transfer", map[string]any{"nominee_user_id": "nominee", "confirm_organization_name": "Acme", "reauth_grant": "old"}, "owner")
	require.Equal(t, http.StatusUnauthorized, badReauth.Code, badReauth.Body.String())
	scoped := jsonRequest(t, e, http.MethodPost, "/api/v1/organizations/org/ownership-transfer", body, "scoped")
	require.Equal(t, http.StatusForbidden, scoped.Code, scoped.Body.String())
	sessionless := jsonRequest(t, e, http.MethodPost, "/api/v1/organizations/org/ownership-transfer", body, "sessionless")
	require.Equal(t, http.StatusForbidden, sessionless.Code, sessionless.Body.String())
	missingGrant := jsonRequest(t, e, http.MethodPost, "/api/v1/organizations/org/ownership-transfer", map[string]any{"nominee_user_id": "nominee", "confirm_organization_name": "Acme", "reauth_grant": " "}, "owner")
	require.Equal(t, http.StatusUnauthorized, missingGrant.Code, missingGrant.Body.String())
	unknownNominee := jsonRequest(t, e, http.MethodPost, "/api/v1/organizations/org/ownership-transfer", map[string]any{"nominee_user_id": "missing-user", "confirm_organization_name": "Acme", "reauth_grant": "recent"}, "owner")
	require.Equal(t, http.StatusBadRequest, unknownNominee.Code, unknownNominee.Body.String())
	failedCount, err := db.NewSelect().Model((*models.OrganizationOwnershipAuditEvent)(nil)).Where("action = ?", organizationownership.ActionInitiationFailed).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 7, failedCount)
	nullNomineeCount, err := db.NewSelect().Model((*models.OrganizationOwnershipAuditEvent)(nil)).Where("action = ? AND nominee_user_id IS NULL", organizationownership.ActionInitiationFailed).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, nullNomineeCount, "an unvalidated nominee must remain a nullable audit subject")
	created := jsonRequest(t, e, http.MethodPost, "/api/v1/organizations/org/ownership-transfer", body, "owner")
	require.Equal(t, http.StatusOK, created.Code, created.Body.String())
	require.Contains(t, created.Body.String(), `"status":"pending"`)
	reused := jsonRequest(t, e, http.MethodPost, "/api/v1/organizations/org/ownership-transfer", body, "owner")
	require.Equal(t, http.StatusUnauthorized, reused.Code, reused.Body.String())
	require.Equal(t, 1, reauth.calls)
}

func TestOwnershipInitiationAuditsUnavailableReauthentication(t *testing.T) {
	e, _, _, db := newOwnershipHandlerTestWithReauth(t, false)
	body := map[string]any{"nominee_user_id": "nominee", "confirm_organization_name": "Acme", "reauth_grant": "recent"}
	response := jsonRequest(t, e, http.MethodPost, "/api/v1/organizations/org/ownership-transfer", body, "owner")
	require.Equal(t, http.StatusServiceUnavailable, response.Code, response.Body.String())
	count, err := db.NewSelect().Model((*models.OrganizationOwnershipAuditEvent)(nil)).Where("action = ? AND result = ?", organizationownership.ActionInitiationFailed, "failed").Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count)
}

func TestOwnershipEndpointsRejectMissingOrganizationIdentityAssurance(t *testing.T) {
	e, service, _, db := newOwnershipHandlerTest(t)
	transfer, err := service.Initiate(t.Context(), organizationownership.InitiateInput{
		OrganizationID: "org", ActorUserID: "owner", ActorSessionID: "owner-session",
		ReauthGrant: "recent", NomineeUserID: "nominee", ConfirmOrganizationName: "Acme",
	})
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.OrganizationSSOPolicy{
		OrganizationID: "org", Mode: models.OrganizationSSOModeRequired, ProviderIDs: "[]",
		AssuranceMaxAgeSeconds: 3600, APITokenMode: models.OrganizationSSOTokensScoped,
		MaxTokenLifetimeSeconds: 3600, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}).Exec(t.Context())
	require.NoError(t, err)

	requests := map[string]*httptest.ResponseRecorder{
		"get":      jsonRequest(t, e, http.MethodGet, "/api/v1/organizations/org/ownership-transfer", nil, "owner"),
		"initiate": jsonRequest(t, e, http.MethodPost, "/api/v1/organizations/org/ownership-transfer", map[string]any{"nominee_user_id": "nominee", "confirm_organization_name": "Acme", "reauth_grant": "recent"}, "owner"),
		"revoke":   jsonRequest(t, e, http.MethodDelete, "/api/v1/organizations/org/ownership-transfer", nil, "owner"),
		"resolve":  jsonRequest(t, e, http.MethodGet, "/api/v1/organization-ownership-transfers/resolve?id="+transfer.ID, nil, "nominee"),
		"accept":   jsonRequest(t, e, http.MethodPost, "/api/v1/organization-ownership-transfers/accept", map[string]any{"id": transfer.ID}, "nominee"),
		"decline":  jsonRequest(t, e, http.MethodPost, "/api/v1/organization-ownership-transfers/decline", map[string]any{"id": transfer.ID}, "nominee"),
	}
	for name, response := range requests {
		t.Run(name, func(t *testing.T) {
			require.Equal(t, http.StatusForbidden, response.Code, response.Body.String())
			require.Contains(t, response.Body.String(), "organization SSO authentication is required")
		})
	}
}

func TestOwnershipAcceptanceIsNomineeOnlyAndChangesAuthorityOnAcceptance(t *testing.T) {
	e, service, _, _ := newOwnershipHandlerTest(t)
	transfer, err := service.Initiate(t.Context(), organizationownership.InitiateInput{OrganizationID: "org", ActorUserID: "owner", ActorSessionID: "owner-session", ReauthGrant: "recent", NomineeUserID: "nominee", ConfirmOrganizationName: "Acme"})
	require.NoError(t, err)
	ownerAttempt := jsonRequest(t, e, http.MethodPost, "/api/v1/organization-ownership-transfers/accept", map[string]any{"id": transfer.ID}, "owner")
	require.Equal(t, http.StatusForbidden, ownerAttempt.Code, ownerAttempt.Body.String())
	accepted := jsonRequest(t, e, http.MethodPost, "/api/v1/organization-ownership-transfers/accept", map[string]any{"id": transfer.ID}, "nominee")
	require.Equal(t, http.StatusOK, accepted.Code, accepted.Body.String())
	require.Contains(t, accepted.Body.String(), `"status":"accepted"`)
	replayed := jsonRequest(t, e, http.MethodPost, "/api/v1/organization-ownership-transfers/accept", map[string]any{"id": transfer.ID}, "nominee")
	require.Equal(t, http.StatusConflict, replayed.Code, replayed.Body.String())
}
