package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type providerReadinessAdminTestServer struct {
	echo           *echo.Echo
	db             *bun.DB
	appFingerprint string
	now            time.Time
}

func newProviderReadinessAdminTestServer(
	t *testing.T,
	isAdmin bool,
	authenticator middleware.Authenticator,
) *providerReadinessAdminTestServer {
	t.Helper()
	db := createHandlerTestDB(
		t,
		(*models.User)(nil),
		(*models.Workspace)(nil),
		(*models.SocialAccount)(nil),
		(*models.OAuthGrant)(nil),
		(*models.ProviderApprovalReview)(nil),
		(*models.ProviderCertificationRun)(nil),
		(*models.ProviderCertificationCheck)(nil),
		(*models.ProviderRuntimeControlEvent)(nil),
	)
	_, err := db.NewInsert().Model(&models.User{
		ID: "user-1", Email: "user@example.com", PasswordHash: "hash",
		IsAdmin: isAdmin, CreatedAt: time.Now().UTC(),
	}).Exec(t.Context())
	require.NoError(t, err)
	now := time.Now().UTC()
	_, err = db.NewInsert().Model(&[]models.Workspace{
		{ID: "workspace-a", Name: "Workspace A"},
		{ID: "workspace-b", Name: "Workspace B"},
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.OAuthGrant{
		ID: "grant-x", WorkspaceID: "workspace-a", Provider: capabilities.ProviderX,
		AccessTokenEnc: []byte("encrypted"), ValidationStatus: "valid", ValidatedAt: now.Add(-time.Minute),
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "account-x", WorkspaceID: "workspace-a", Slug: "x-account",
		Platform: capabilities.ProviderX, AccountID: "provider-account-x",
		OAuthGrantID: "grant-x", AccessTokenEnc: []byte("legacy-encrypted"),
		IsActive: true, CreatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)

	app := platform.AppConfig{
		Provider: capabilities.ProviderX, ClientID: "provider-app-1",
		RedirectURI: "https://app.openpost.test/api/v1/accounts/x/callback",
	}
	catalog, err := providerreadiness.NewConfigurationCatalog(providerreadiness.RuntimeApps(
		[]platform.AppConfig{app},
		providerreadiness.ConfigurationSourceEnvironment,
		providerreadiness.ProviderEnvironmentProduction,
	))
	require.NoError(t, err)
	fingerprint, err := providerreadiness.AppFingerprint(app)
	require.NoError(t, err)
	service := providerreadiness.NewService(
		providerreadiness.NewRepository(db),
		providerreadiness.ServiceOptions{
			Configurations: catalog, ManagedProduction: true, EnforceCertification: true,
			CurrentRevision: strings.Repeat("a", 40),
		},
	)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewProviderReadinessAdminHandler(db, authenticator, service).RegisterRoutes(api)
	return &providerReadinessAdminTestServer{
		echo: e, db: db, appFingerprint: fingerprint, now: time.Now().UTC().Truncate(time.Second),
	}
}

func (s *providerReadinessAdminTestServer) postJSON(
	t *testing.T,
	path string,
	body any,
	token string,
) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	require.NoError(t, json.NewEncoder(&payload).Encode(body))
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, &payload)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func TestProviderReadinessAdminAppendsSanitizedEvidenceForCurrentContract(t *testing.T) {
	t.Parallel()
	srv := newProviderReadinessAdminTestServer(t, true, browserSessionTestAuthenticator())
	review := providerApprovalReviewRequest(srv)
	reviewResponse := srv.postJSON(
		t,
		"/api/v1/admin/provider-readiness/approval-reviews",
		review,
		"web-token",
	)
	require.Equal(t, http.StatusOK, reviewResponse.Code, reviewResponse.Body.String())
	var reviewResult ProviderReadinessLedgerAppendOutput
	require.NoError(t, json.Unmarshal(reviewResponse.Body.Bytes(), &reviewResult.Body))
	require.NotEmpty(t, reviewResult.Body.ID)

	certification := providerCertificationRequest(t, srv, reviewResult.Body.ID)
	certificationResponse := srv.postJSON(
		t,
		"/api/v1/admin/provider-readiness/certifications",
		certification,
		"web-token",
	)
	require.Equal(t, http.StatusOK, certificationResponse.Code, certificationResponse.Body.String())
	require.NotContains(t, certificationResponse.Body.String(), "user-1")
	require.NotContains(t, certificationResponse.Body.String(), "operator")

	var stored models.ProviderCertificationRun
	require.NoError(t, srv.db.NewSelect().Model(&stored).Limit(1).Scan(t.Context()))
	require.NotEqual(t, "user-1", stored.OperatorRef)
	require.Equal(t, operatorReference("user-1"), stored.OperatorRef)
	require.Equal(t, srv.appFingerprint, stored.AppFingerprint)

	stale := providerCertificationRequest(t, srv, reviewResult.Body.ID)
	stale["policy_mode"] = "x.other"
	staleResponse := srv.postJSON(
		t,
		"/api/v1/admin/provider-readiness/certifications",
		stale,
		"web-token",
	)
	require.Equal(t, http.StatusBadRequest, staleResponse.Code, staleResponse.Body.String())
	require.Contains(t, staleResponse.Body.String(), "account context was rejected")
}

func TestProviderReadinessAdminDerivesCertificationFromExactAccountContext(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name   string
		mutate func(*providerReadinessAdminTestServer, map[string]any)
	}{
		{name: "cross-workspace", mutate: func(_ *providerReadinessAdminTestServer, request map[string]any) {
			request["workspace_id"] = "workspace-b"
		}},
		{name: "nonexistent-account", mutate: func(_ *providerReadinessAdminTestServer, request map[string]any) {
			request["social_account_id"] = "account-missing"
		}},
		{name: "inactive-account", mutate: func(srv *providerReadinessAdminTestServer, _ map[string]any) {
			_, err := srv.db.NewUpdate().Model((*models.SocialAccount)(nil)).
				Set("is_active = ?", false).Where("id = ?", "account-x").Exec(t.Context())
			require.NoError(t, err)
		}},
		{name: "wrong-output-profile", mutate: func(_ *providerReadinessAdminTestServer, request map[string]any) {
			request["output_profile"] = "youtube.video"
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			srv := newProviderReadinessAdminTestServer(t, true, browserSessionTestAuthenticator())
			reviewResponse := srv.postJSON(
				t, "/api/v1/admin/provider-readiness/approval-reviews",
				providerApprovalReviewRequest(srv), "web-token",
			)
			require.Equal(t, http.StatusOK, reviewResponse.Code, reviewResponse.Body.String())
			var review ProviderReadinessLedgerAppendOutput
			require.NoError(t, json.Unmarshal(reviewResponse.Body.Bytes(), &review.Body))
			request := providerCertificationRequest(t, srv, review.Body.ID)
			test.mutate(srv, request)

			response := srv.postJSON(
				t, "/api/v1/admin/provider-readiness/certifications", request, "web-token",
			)
			require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
			var count int
			count, err := srv.db.NewSelect().Model((*models.ProviderCertificationRun)(nil)).Count(t.Context())
			require.NoError(t, err)
			require.Zero(t, count)
		})
	}
}

func TestProviderReadinessAdminAppendsRuntimeControlWithHashedOperator(t *testing.T) {
	t.Parallel()
	srv := newProviderReadinessAdminTestServer(t, true, browserSessionTestAuthenticator())
	response := srv.postJSON(t, "/api/v1/admin/provider-readiness/runtime-controls", map[string]any{
		"selector": map[string]any{"provider": capabilities.ProviderX},
		"state":    "disabled", "reason_code": "provider_incident",
		"starts_at": srv.now, "expires_at": srv.now.Add(time.Hour),
	}, "web-token")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.NotContains(t, response.Body.String(), "user-1")

	var stored models.ProviderRuntimeControlEvent
	require.NoError(t, srv.db.NewSelect().Model(&stored).Limit(1).Scan(t.Context()))
	require.Equal(t, "disabled", stored.State)
	require.Equal(t, operatorReference("user-1"), stored.OperatorRef)
}

func TestProviderReadinessAdminRejectsNonAdminAndWorkspaceScopedCredentials(t *testing.T) {
	t.Parallel()
	t.Run("non-admin", func(t *testing.T) {
		nonAdmin := newProviderReadinessAdminTestServer(t, false, browserSessionTestAuthenticator())
		response := nonAdmin.postJSON(t, "/api/v1/admin/provider-readiness/runtime-controls", map[string]any{
			"selector": map[string]any{"provider": capabilities.ProviderX},
			"state":    "disabled", "reason_code": "provider_incident",
			"starts_at": nonAdmin.now,
		}, "web-token")
		require.Equal(t, http.StatusForbidden, response.Code, response.Body.String())
		require.Contains(t, response.Body.String(), "instance admin role required")
	})

	t.Run("workspace-scoped", func(t *testing.T) {
		scoped := newProviderReadinessAdminTestServer(t, true, workspaceTestAuthenticator{
			"scoped-token": {
				UserID: "user-1", Email: "user@example.com", WorkspaceID: "workspace-1", SessionID: "browser-session",
			},
		})
		response := scoped.postJSON(t, "/api/v1/admin/provider-readiness/runtime-controls", map[string]any{
			"selector": map[string]any{"provider": capabilities.ProviderX},
			"state":    "disabled", "reason_code": "provider_incident",
			"starts_at": scoped.now,
		}, "scoped-token")
		require.Equal(t, http.StatusForbidden, response.Code, response.Body.String())
		require.Contains(t, response.Body.String(), "unscoped credentials")
	})
}

func TestProviderReadinessAdminRejectsBearerAdminToken(t *testing.T) {
	t.Parallel()

	srv := newProviderReadinessAdminTestServer(t, true, unboundCLIFullTestAuthenticator())
	requests := []struct {
		path string
		body any
	}{
		{
			path: "/api/v1/admin/provider-readiness/approval-reviews",
			body: providerApprovalReviewRequest(srv),
		},
		{
			path: "/api/v1/admin/provider-readiness/runtime-controls",
			body: map[string]any{
				"selector": map[string]any{"provider": capabilities.ProviderX},
				"state":    "disabled", "reason_code": "provider_incident", "starts_at": srv.now,
			},
		},
		{
			path: "/api/v1/admin/provider-readiness/certifications",
			body: providerCertificationRequest(t, srv, "review-id"),
		},
	}
	for _, request := range requests {
		response := srv.postJSON(t, request.path, request.body, "web-token")
		require.Equal(t, http.StatusForbidden, response.Code, response.Body.String())
		require.Contains(t, response.Body.String(), "browser session")
	}
}

func providerApprovalReviewRequest(srv *providerReadinessAdminTestServer) map[string]any {
	return map[string]any{
		"provider": capabilities.ProviderX, "app_fingerprint": srv.appFingerprint,
		"provider_environment": "production", "state": "approved", "tier": "standard",
		"source_url":  "https://docs.x.com/x-api/overview",
		"reviewed_at": srv.now.Add(-time.Hour), "expires_at": srv.now.Add(30 * 24 * time.Hour),
	}
}

func providerCertificationRequest(
	t *testing.T,
	srv *providerReadinessAdminTestServer,
	reviewID string,
) map[string]any {
	t.Helper()
	capability, ok := capabilities.FindOutput(capabilities.ProviderX, "x.post")
	require.True(t, ok)
	contract, err := providerreadiness.PublicationContract(
		capability,
		providerreadiness.OperationPublishImmediate,
		true,
		"standard",
		"x.standard",
	)
	require.NoError(t, err)
	checks := make([]providerreadiness.CheckResult, 0, len(contract.Requirements.RequiredLiveChecks))
	for _, required := range contract.Requirements.RequiredLiveChecks {
		externalRef := ""
		if required.Kind == providerreadiness.CheckPublishImmediate ||
			required.Kind == providerreadiness.CheckPublishScheduled ||
			required.Kind == providerreadiness.CheckFinalResult {
			externalRef = "sha256:" + strings.Repeat("e", 64)
		}
		checks = append(checks, providerreadiness.CheckResult{
			Kind: required.Kind, Outcome: providerreadiness.CheckOutcomePassed,
			ExternalRefHash: externalRef, CompletedAt: srv.now,
		})
	}
	return map[string]any{
		"approval_review_id": reviewID,
		"workspace_id":       "workspace-a",
		"social_account_id":  "account-x",
		"output_profile":     capability.OutputProfile,
		"operation":          "publish_immediate",
		"policy_mode":        "x.standard",
		"kind":               "live",
		"tested_at":          srv.now.Add(-time.Minute),
		"expires_at":         srv.now.Add(7 * 24 * time.Hour),
		"checks":             checks,
	}
}
