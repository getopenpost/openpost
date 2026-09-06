package handlers

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/auth"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/workspaceteam"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func newDeleteOrganizationTestServer(t *testing.T) *workspaceTestServer {
	t.Helper()
	db := newHandlerSchemaTestDB(t)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewWorkspaceHandler(db, workspaceTestAuthenticator{
		"web-token":       {UserID: "user-1", Email: "owner@example.com"},
		"workspace-token": {UserID: "user-1", Email: "owner@example.com", TokenID: "scoped", WorkspaceID: "workspace-1", Scope: "cli:full"},
	}, entitlements.NewSelfHostedService())
	handler.SetSensitiveActionServices(auth.NewService("organization-delete-test"), nil, organizationDeletionTestEncryptor())
	handler.GetOrganizationDeletionPreview(api)
	handler.CancelOrganizationCheckoutAttempts(api)
	handler.DeleteOrganization(api)
	return &workspaceTestServer{echo: e, db: db}
}

func organizationDeletionTestEncryptor() *servicecrypto.TokenEncryptor {
	return servicecrypto.NewTokenEncryptor("organization-delete-invitation-test")
}

func insertOrganizationDeletionFixture(t *testing.T, db *bun.DB) {
	t.Helper()
	now := time.Now().UTC()
	hash, err := auth.NewService("organization-delete-test").HashPassword("current-password-123")
	require.NoError(t, err)
	modelsToInsert := []any{
		&models.User{ID: "user-1", Email: "owner@example.com", PasswordHash: hash, CreatedAt: now},
		&models.User{ID: "user-2", Email: "member@example.com", CreatedAt: now},
		&models.Organization{ID: "org-1", Name: "OpenPost Studio", CreatedByID: "user-1", CreatedAt: now, UpdatedAt: now},
		&models.OrganizationMember{OrganizationID: "org-1", UserID: "user-1", Role: models.OrganizationRoleOwner, CreatedAt: now},
		&models.OrganizationMember{OrganizationID: "org-1", UserID: "user-2", Role: models.OrganizationRoleMember, CreatedAt: now},
		&models.Workspace{ID: "workspace-1", OrganizationID: "org-1", Name: "Editorial", Timezone: "UTC", CreatedAt: now},
		&models.Workspace{ID: "workspace-2", OrganizationID: "org-1", Name: "Launches", Timezone: "UTC", CreatedAt: now},
		&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin},
		&models.WorkspaceMember{WorkspaceID: "workspace-2", UserID: "user-2", Role: models.WorkspaceRoleEditor},
	}
	for _, model := range modelsToInsert {
		_, err := db.NewInsert().Model(model).Exec(t.Context())
		require.NoError(t, err)
	}
}

func TestOrganizationDeletionPreviewEnumeratesImpactAndAllBlockers(t *testing.T) {
	server := newDeleteOrganizationTestServer(t)
	insertOrganizationDeletionFixture(t, server.db)
	now := time.Now().UTC()
	_, err := server.db.NewInsert().Model(&models.BillingSubscription{OrganizationID: "org-1", WorkspaceID: "workspace-1", Provider: models.BillingProviderPaddle, ProviderCustomerID: "customer", ProviderSubscriptionID: "subscription", Status: "active"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = server.db.NewInsert().Model(&models.BillingCheckoutAttempt{CheckoutAttemptID: "checkout", OrganizationID: "org-1", WorkspaceID: "workspace-1", UserID: "user-1", Provider: models.BillingProviderPaddle, ProviderPriceID: "price", PlanID: "starter", BillingPeriod: "monthly", Status: "created", CreatedAt: now, UpdatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = server.db.NewInsert().Model(&models.OrganizationOwnershipTransfer{ID: "transfer", OrganizationID: "org-1", PriorOwnerUserID: "user-1", NomineeUserID: "user-2", Status: "pending", ExpiresAt: now.Add(time.Hour), CreatedAt: now, UpdatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = server.db.NewInsert().Model(&models.SocialAccount{ID: "account", WorkspaceID: "workspace-1", Slug: "x-owner", Platform: "x", AccountID: "remote", AccountUsername: "owner", AccessTokenEnc: []byte("encrypted"), CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = server.db.NewInsert().Model(&models.ProviderWriteAttempt{ID: "write", OperationID: "operation", AttemptNumber: 1, WorkspaceID: "workspace-1", SocialAccountID: "account", TargetKey: "x", Provider: "x", Operation: "publish", PayloadFingerprint: "sha256:test", Status: "accepted", ProviderState: "scheduled", SubmissionState: "accepted", RetrySafety: "never"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = server.db.NewInsert().Model(&models.Job{ID: "billing-webhook", Type: "billing_webhook", Payload: `{"event_type":"subscription.updated","data":{"id":"subscription"}}`, Status: "pending", RunAt: now, MaxAttempts: 5}).Exec(t.Context())
	require.NoError(t, err)

	rec := jsonRequest(t, server.echo, http.MethodGet, "/api/v1/organizations/org-1/deletion-preview", nil, "web-token")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.Contains(t, rec.Body.String(), `"organization_name":"OpenPost Studio"`)
	require.Contains(t, rec.Body.String(), `"workspace_name":"Editorial"`)
	require.Contains(t, rec.Body.String(), `"workspace_name":"Launches"`)
	require.Contains(t, rec.Body.String(), `"billing_state":"active"`)
	require.Contains(t, rec.Body.String(), `"pending_provider_writes":1`)
	require.Contains(t, rec.Body.String(), `"pending_jobs":1`)
	for _, code := range []string{"active_billing", "pending_billing_checkout", "pending_ownership_transfer", "pending_external_writes"} {
		require.Contains(t, rec.Body.String(), `"code":"`+code+`"`)
	}
	require.Contains(t, rec.Body.String(), `"access_effects":[`)
	require.Contains(t, rec.Body.String(), `"retained":[`)
	require.Contains(t, rec.Body.String(), `"irreversible_loss":[`)

	blocked := jsonRequest(t, server.echo, http.MethodDelete, "/api/v1/organizations/org-1", map[string]any{"confirm_name": "OpenPost Studio", "current_password": "current-password-123"}, "web-token")
	require.Equal(t, http.StatusConflict, blocked.Code, blocked.Body.String())
	require.Equal(t, 1, countRows[models.Organization](t, server.db, "id = ?", "org-1"))
	canceled := jsonRequest(t, server.echo, http.MethodDelete, "/api/v1/organizations/org-1/billing-checkout-attempts/pending", nil, "web-token")
	require.Equal(t, http.StatusOK, canceled.Code, canceled.Body.String())
	require.Contains(t, canceled.Body.String(), `"canceled":1`)
	require.Equal(t, 1, countRows[models.BillingCheckoutAttempt](t, server.db, "checkout_attempt_id = ? AND status = ?", "checkout", "canceled"))
	require.Equal(t, 1, countRows[models.BillingCheckoutCancellation](t, server.db, "checkout_attempt_id = ? AND organization_id = ?", "checkout", "org-1"))
}

func TestOrganizationDeletionFailsClosedForEveryUnconfirmedBillingState(t *testing.T) {
	for _, status := range []string{"paused", "unknown", ""} {
		t.Run(status, func(t *testing.T) {
			server := newDeleteOrganizationTestServer(t)
			insertOrganizationDeletionFixture(t, server.db)
			_, err := server.db.NewInsert().Model(&models.BillingSubscription{OrganizationID: "org-1", WorkspaceID: "workspace-1", Provider: models.BillingProviderPaddle, ProviderCustomerID: "customer", ProviderSubscriptionID: "subscription", Status: status}).Exec(t.Context())
			require.NoError(t, err)
			preview := jsonRequest(t, server.echo, http.MethodGet, "/api/v1/organizations/org-1/deletion-preview", nil, "web-token")
			require.Equal(t, http.StatusOK, preview.Code, preview.Body.String())
			require.Contains(t, preview.Body.String(), `"code":"active_billing"`)
		})
	}
}

func TestOrganizationDeletionRequiresCurrentOwnerExactNameAndRecentAuthentication(t *testing.T) {
	server := newDeleteOrganizationTestServer(t)
	insertOrganizationDeletionFixture(t, server.db)
	_, err := server.db.NewUpdate().Model((*models.OrganizationMember)(nil)).Set("role = ?", models.OrganizationRoleAdmin).Where("organization_id = ? AND user_id = ?", "org-1", "user-1").Exec(t.Context())
	require.NoError(t, err)
	preview := jsonRequest(t, server.echo, http.MethodGet, "/api/v1/organizations/org-1/deletion-preview", nil, "web-token")
	require.Equal(t, http.StatusForbidden, preview.Code, preview.Body.String())
	_, err = server.db.NewUpdate().Model((*models.OrganizationMember)(nil)).Set("role = ?", models.OrganizationRoleOwner).Where("organization_id = ? AND user_id = ?", "org-1", "user-1").Exec(t.Context())
	require.NoError(t, err)
	for _, test := range []struct {
		body map[string]any
		want int
	}{
		{map[string]any{"confirm_name": "openpost studio", "current_password": "current-password-123"}, http.StatusBadRequest},
		{map[string]any{"confirm_name": "OpenPost Studio", "current_password": "wrong"}, http.StatusUnauthorized},
	} {
		rec := jsonRequest(t, server.echo, http.MethodDelete, "/api/v1/organizations/org-1", test.body, "web-token")
		require.Equal(t, test.want, rec.Code, rec.Body.String())
		require.Equal(t, 1, countRows[models.Organization](t, server.db, "id = ?", "org-1"))
	}
	scoped := jsonRequest(t, server.echo, http.MethodGet, "/api/v1/organizations/org-1/deletion-preview", nil, "workspace-token")
	require.Equal(t, http.StatusForbidden, scoped.Code, scoped.Body.String())
}

func TestOrganizationDeletionRemovesWholeBoundaryAndRetainsSafeAudit(t *testing.T) {
	server := newDeleteOrganizationTestServer(t)
	insertOrganizationDeletionFixture(t, server.db)
	_, err := server.db.NewInsert().Model(&models.MediaAttachment{ID: "media", WorkspaceID: "workspace-1", FilePath: "/uploads/media.jpg", MimeType: "image/jpeg", CreatedAt: time.Now().UTC()}).Exec(t.Context())
	require.NoError(t, err)
	_, err = server.db.ExecContext(t.Context(), `INSERT INTO organization_theme_assets
		(id, organization_id, kind, name, media_type, object_key, size_bytes, checksum_sha256, native_object_key, native_media_type, native_size_bytes, native_checksum_sha256, font_family, font_style, font_weight, license_acknowledged, created_by)
		VALUES ('theme-font', 'org-1', 'font', 'Theme font', 'font/woff2', 'theme-assets/org-1/theme-font.woff2', 20, 'source-hash', 'theme-assets/org-1/theme-font.ttf', 'font/ttf', 40, 'native-hash', 'Theme Font', 'normal', 400, TRUE, 'user-1')`)
	require.NoError(t, err)
	_, err = server.db.ExecContext(t.Context(), `INSERT INTO organization_theme_assets
		(id, organization_id, kind, name, media_type, object_key, size_bytes, width, height, checksum_sha256, created_by)
		VALUES ('corrupt-theme-art', 'org-1', 'illustration', 'Corrupt art', 'image/png', 'theme-assets/org-collision/private.png', 20, 10, 10, 'source-hash', 'user-1')`)
	require.NoError(t, err)
	_, err = server.db.ExecContext(t.Context(), `INSERT INTO organization_themes
		(id, organization_id, name, normalized_name, latest_published_revision, created_by)
		VALUES ('linked-theme', 'org-1', 'Linked theme', 'linked theme', 1, 'user-1')`)
	require.NoError(t, err)
	_, err = server.db.ExecContext(t.Context(), `INSERT INTO organization_theme_drafts
		(theme_id, organization_id, revision, name, manifest_json, updated_by)
		VALUES ('linked-theme', 'org-1', 1, 'Linked theme', '{}', 'user-1')`)
	require.NoError(t, err)
	_, err = server.db.ExecContext(t.Context(), `INSERT INTO organization_theme_revisions
		(theme_id, organization_id, revision, name, manifest_json, published_by)
		VALUES ('linked-theme', 'org-1', 1, 'Linked theme', '{}', 'user-1')`)
	require.NoError(t, err)
	_, err = server.db.ExecContext(t.Context(), `INSERT INTO organization_theme_draft_assets (theme_id, asset_id) VALUES ('linked-theme', 'theme-font')`)
	require.NoError(t, err)
	_, err = server.db.ExecContext(t.Context(), `INSERT INTO organization_theme_revision_assets (theme_id, revision, asset_id) VALUES ('linked-theme', 1, 'theme-font')`)
	require.NoError(t, err)
	_, err = server.db.ExecContext(t.Context(), `INSERT INTO organization_theme_settings
		(organization_id, default_reference_kind, default_reference_id, default_reference_version, updated_by)
		VALUES ('org-1', 'custom', 'linked-theme', 1, 'user-1')`)
	require.NoError(t, err)
	_, err = server.db.ExecContext(t.Context(), `INSERT INTO workspace_theme_assignments
		(workspace_id, organization_id, reference_kind, reference_id, reference_version, updated_by)
		VALUES ('workspace-1', 'org-1', 'custom', 'linked-theme', 1, 'user-1')`)
	require.NoError(t, err)
	_, err = server.db.NewInsert().Model(&models.SocialAccount{ID: "account", WorkspaceID: "workspace-1", Slug: "x-owner", Platform: "x", AccountID: "remote", AccountUsername: "owner", AccessTokenEnc: []byte("encrypted"), CreatedAt: time.Now().UTC()}).Exec(t.Context())
	require.NoError(t, err)
	_, err = server.db.NewInsert().Model(&models.ProviderWriteAttempt{ID: "write", OperationID: "operation", AttemptNumber: 1, WorkspaceID: "workspace-1", SocialAccountID: "account", TargetKey: "x", Provider: "x", Operation: "publish", PayloadFingerprint: "sha256:test", Status: "accepted", SubmissionState: "accepted", RetrySafety: "never"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = server.db.NewInsert().Model(&models.APIToken{ID: "token", UserID: "user-1", Name: "Automation", TokenHash: "hash", TokenPrefix: "prefix", Scope: "cli:full", OrganizationID: "org-1", CreatedAt: time.Now().UTC()}).Exec(t.Context())
	require.NoError(t, err)
	const legacyToken = "op_inv_legacy-token"
	_, err = server.db.NewInsert().Model(&models.WorkspaceInvitation{ID: "invitation", WorkspaceID: "workspace-1", Email: "invitee@example.com", Role: "editor", InvitedByUserID: "user-1", TokenHash: workspaceteam.HashInvitationToken(legacyToken), ExpiresAt: time.Now().Add(time.Hour), EmailDeliveryJobID: "invitation-email-job", CreatedAt: time.Now().UTC()}).Exec(t.Context())
	require.NoError(t, err)
	_, err = server.db.NewInsert().Model(&models.Job{ID: "invitation-email-job", Type: "notification_email", Payload: `{"recipient":"invitee@example.com","workspace_name":"Editorial"}`, Status: "failed", RunAt: time.Now().UTC(), MaxAttempts: 5}).Exec(t.Context())
	require.NoError(t, err)
	_, err = server.db.NewInsert().Model(&models.Job{ID: "historical-invitation-email-job", Type: "notification_email", Payload: `{"recipient":"invitee@example.com"}`, Status: "failed", RunAt: time.Now().UTC(), MaxAttempts: 5}).Exec(t.Context())
	require.NoError(t, err)
	legacyJobID := uuid.NewSHA1(uuid.NameSpaceOID, []byte("workspace-invitation\x00invitation:"+workspaceteam.HashInvitationToken(legacyToken))).String()
	legacyAcceptURL, err := organizationDeletionTestEncryptor().Encrypt("https://openpost.test/invite?token=" + legacyToken)
	require.NoError(t, err)
	legacyPayload, err := json.Marshal(map[string]any{"delivery_id": legacyJobID, "recipient": "invitee@example.com", "workspace_name": "Editorial", "accept_url_encrypted": legacyAcceptURL})
	require.NoError(t, err)
	_, err = server.db.NewInsert().Model(&models.Job{ID: legacyJobID, Type: "notification_email", Payload: string(legacyPayload), Status: "failed", RunAt: time.Now().UTC(), MaxAttempts: 5}).Exec(t.Context())
	require.NoError(t, err)
	_, err = server.db.NewInsert().Model(&models.Organization{ID: "org-collision", Name: "Other Studio", CreatedByID: "user-2", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}).Exec(t.Context())
	require.NoError(t, err)
	_, err = server.db.NewInsert().Model(&models.Workspace{ID: "workspace-collision", OrganizationID: "org-collision", Name: "Editorial", Timezone: "UTC", CreatedAt: time.Now().UTC()}).Exec(t.Context())
	require.NoError(t, err)
	const collisionToken = "op_inv_other-organization"
	_, err = server.db.NewInsert().Model(&models.WorkspaceInvitation{ID: "invitation-collision", WorkspaceID: "workspace-collision", Email: "invitee@example.com", Role: "editor", InvitedByUserID: "user-2", TokenHash: workspaceteam.HashInvitationToken(collisionToken), ExpiresAt: time.Now().Add(time.Hour), CreatedAt: time.Now().UTC()}).Exec(t.Context())
	require.NoError(t, err)
	collisionJobID := uuid.NewSHA1(uuid.NameSpaceOID, []byte("workspace-invitation\x00invitation-collision:"+workspaceteam.HashInvitationToken(collisionToken))).String()
	collisionAcceptURL, err := organizationDeletionTestEncryptor().Encrypt("https://openpost.test/invite?token=" + collisionToken)
	require.NoError(t, err)
	collisionPayload, err := json.Marshal(map[string]any{"delivery_id": collisionJobID, "recipient": "invitee@example.com", "workspace_name": "Editorial", "accept_url_encrypted": collisionAcceptURL})
	require.NoError(t, err)
	_, err = server.db.NewInsert().Model(&models.Job{ID: collisionJobID, Type: "notification_email", Payload: string(collisionPayload), Status: "failed", RunAt: time.Now().UTC(), MaxAttempts: 5}).Exec(t.Context())
	require.NoError(t, err)
	_, err = server.db.NewUpdate().Model((*models.Workspace)(nil)).Set("name = ?", "Renamed after invitation").Where("id = ?", "workspace-1").Exec(t.Context())
	require.NoError(t, err)
	_, err = server.db.NewInsert().Model(&models.WorkspaceInvitationDeliveryEvent{EventID: "historical-delivery-event", InvitationID: "invitation", DeliveryID: "historical-invitation-email-job", Outcome: "delivered", OccurredAt: time.Now().UTC(), CreatedAt: time.Now().UTC()}).Exec(t.Context())
	require.NoError(t, err)
	rec := jsonRequest(t, server.echo, http.MethodDelete, "/api/v1/organizations/org-1", map[string]any{"confirm_name": "OpenPost Studio", "current_password": "current-password-123"}, "web-token")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.Zero(t, countRows[models.Organization](t, server.db, "id = ?", "org-1"))
	require.Zero(t, countRows[models.Workspace](t, server.db, "organization_id = ?", "org-1"))
	require.Zero(t, countRows[models.OrganizationMember](t, server.db, "organization_id = ?", "org-1"))
	require.Zero(t, countRows[models.MediaAttachment](t, server.db, "id = ?", "media"))
	require.Zero(t, countRows[models.ProviderWriteAttempt](t, server.db, "id = ?", "write"))
	require.Zero(t, countRows[models.APIToken](t, server.db, "id = ?", "token"))
	for _, table := range []string{
		"organization_theme_draft_assets", "organization_theme_revision_assets", "organization_theme_drafts",
		"organization_theme_revisions", "organization_theme_assets", "workspace_theme_assignments",
		"organization_theme_settings", "organization_themes",
	} {
		var count int
		require.NoError(t, server.db.NewRaw("SELECT COUNT(*) FROM "+table).Scan(t.Context(), &count))
		require.Zero(t, count, table)
	}
	require.Zero(t, countRows[models.Job](t, server.db, "id = ?", "invitation-email-job"))
	require.Zero(t, countRows[models.Job](t, server.db, "id = ?", "historical-invitation-email-job"))
	require.Zero(t, countRows[models.Job](t, server.db, "id = ?", legacyJobID))
	require.Equal(t, 1, countRows[models.Job](t, server.db, "id = ?", collisionJobID))
	require.Zero(t, countRows[models.WorkspaceInvitationDeliveryEvent](t, server.db, "event_id = ?", "historical-delivery-event"))
	var storageJobs []models.Job
	require.NoError(t, server.db.NewSelect().Model(&storageJobs).Where("type = ?", "storage_delete").Scan(t.Context()))
	var cleanupPayloads string
	for _, job := range storageJobs {
		cleanupPayloads += job.Payload
	}
	require.Contains(t, cleanupPayloads, "theme-assets/org-1/theme-font.woff2")
	require.Contains(t, cleanupPayloads, "theme-assets/org-1/theme-font.ttf")
	require.NotContains(t, cleanupPayloads, "theme-assets/org-collision/private.png", "corrupt metadata must not delete another Organization's blob")
	var event models.OrganizationLifecycleAuditEvent
	require.NoError(t, server.db.NewSelect().Model(&event).Where("organization_id = ?", "org-1").Scan(t.Context()))
	require.Equal(t, "organization.deleted", event.Action)
	require.Equal(t, "OpenPost Studio", event.OrganizationName)
	require.Equal(t, 2, event.WorkspaceCount)
}

func TestOrganizationDeletionFailureIsAtomic(t *testing.T) {
	server := newDeleteOrganizationTestServer(t)
	insertOrganizationDeletionFixture(t, server.db)
	_, err := server.db.Exec("DROP TABLE organization_lifecycle_audit_events")
	require.NoError(t, err)
	rec := jsonRequest(t, server.echo, http.MethodDelete, "/api/v1/organizations/org-1", map[string]any{"confirm_name": "OpenPost Studio", "current_password": "current-password-123"}, "web-token")
	require.Equal(t, http.StatusInternalServerError, rec.Code, rec.Body.String())
	require.Equal(t, 1, countRows[models.Organization](t, server.db, "id = ?", "org-1"))
	require.Equal(t, 2, countRows[models.Workspace](t, server.db, "organization_id = ?", "org-1"))
}
