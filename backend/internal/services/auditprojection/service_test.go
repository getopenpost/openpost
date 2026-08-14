package auditprojection

import (
	"database/sql"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"
)

func newProjectionTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqlDB, err := sql.Open(sqliteshim.ShimName, "file:"+uuid.NewString()+"?mode=memory&cache=shared")
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	for _, model := range []any{
		(*models.Organization)(nil), (*models.OrganizationMember)(nil), (*models.Workspace)(nil),
		(*models.IdentityProvider)(nil),
		(*models.IdentityAuditEvent)(nil), (*models.WorkspaceAccessAuditEvent)(nil),
		(*models.WorkspaceLifecycleAuditEvent)(nil),
		(*models.UserImpersonationGrant)(nil), (*models.BillingCheckoutAttempt)(nil),
		(*models.UserImpersonationGrantOrganization)(nil),
		(*models.MCPToolCall)(nil), (*models.PublicationLifecycleEvent)(nil),
		(*models.PublicationAuthorization)(nil), (*models.ProviderWriteAttempt)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).Exec(t.Context())
		require.NoError(t, err)
	}
	return db
}

func TestListProjectsRetainedWorkspaceDeletionEvidence(t *testing.T) {
	db := newProjectionTestDB(t)
	now := time.Date(2026, time.August, 14, 12, 0, 0, 0, time.UTC)
	_, err := db.NewInsert().Model(&models.Organization{ID: "org-1", Name: "One", CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceLifecycleAuditEvent{
		ID: "deletion-1", OrganizationID: "org-1", WorkspaceID: "deleted-ws", WorkspaceName: "Editorial",
		ActorUserID: "owner-1", Action: "workspace.deleted", CreatedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)

	page, err := NewService(db).List(t.Context(), Query{OrganizationID: "org-1", WorkspaceID: "deleted-ws", ResourceType: ResourceWorkspace, Limit: 10})
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	require.Equal(t, SourceWorkspaceLifecycle, page.Items[0].Source)
	require.Equal(t, "workspace.deleted", page.Items[0].Action)
	require.Equal(t, AuditResource{Type: ResourceWorkspace, ID: "deleted-ws", OrganizationID: "org-1", WorkspaceID: "deleted-ws"}, page.Items[0].Resource)
	require.Equal(t, []AuditChangedField{{Field: "name", Previous: "Editorial"}}, page.Items[0].ChangedFields)
}

func TestListProjectsSafeOrganizationAndWorkspaceEvidence(t *testing.T) {
	db := newProjectionTestDB(t)
	now := time.Date(2026, time.August, 14, 12, 0, 0, 0, time.UTC)
	for _, row := range []any{
		&models.Organization{ID: "org-1", Name: "One", CreatedByID: "owner-1", CreatedAt: now},
		&models.Organization{ID: "org-2", Name: "Two", CreatedByID: "owner-2", CreatedAt: now},
		&models.Workspace{ID: "ws-1", OrganizationID: "org-1", Name: "Private editorial", CreatedAt: now},
		&models.Workspace{ID: "ws-2", OrganizationID: "org-2", Name: "Other", CreatedAt: now},
		&models.IdentityProvider{ID: "provider-1", OrganizationID: "org-1", Issuer: "https://identity.example", Name: "Identity", ClientID: "client"},
		&models.IdentityAuditEvent{ID: "identity-1", OrganizationID: "org-1", ActorUserID: "owner-1", Action: "policy.updated", Detail: "required", CreatedAt: now.Add(-time.Minute)},
		&models.IdentityAuditEvent{ID: "identity-inferred", ProviderID: "provider-1", ActorUserID: "member-1", Action: "identity.unlinked", CreatedAt: now.Add(-90 * time.Second)},
		&models.IdentityAuditEvent{ID: "identity-secret", OrganizationID: "org-1", ActorUserID: "owner-1", Action: "reauth.completed", Detail: "password:delete secret-token", CreatedAt: now.Add(-2 * time.Minute)},
		&models.WorkspaceAccessAuditEvent{ID: "access-1", WorkspaceID: "ws-1", ActorUserID: "admin-1", SubjectUserID: "member-1", SubjectEmail: "private@example.com", Action: "member.role_changed", PreviousRole: "viewer", Role: "editor", CreatedAt: now},
		&models.WorkspaceAccessAuditEvent{ID: "outside", WorkspaceID: "ws-2", Action: "member.removed", SubjectEmail: "outside@example.com", CreatedAt: now.Add(time.Minute)},
	} {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}

	page, err := NewService(db).List(t.Context(), Query{OrganizationID: "org-1", Limit: 10})
	require.NoError(t, err)
	require.Len(t, page.Items, 4)
	require.Equal(t, []string{"access-1", "identity-1", "identity-inferred", "identity-secret"}, []string{page.Items[0].ID, page.Items[1].ID, page.Items[2].ID, page.Items[3].ID})
	require.Equal(t, "admin-1", page.Items[0].ActorUserID)
	require.Empty(t, page.Items[0].EffectiveActorUserID, "domain evidence does not identify a distinct effective actor")
	require.Equal(t, ResourceWorkspaceMember, page.Items[0].Resource.Type)
	require.Equal(t, "member-1", page.Items[0].Resource.ID)
	require.Equal(t, []AuditChangedField{{Field: "role", Previous: "viewer", Current: "editor"}}, page.Items[0].ChangedFields)
	require.Equal(t, []AuditChangedField{{Field: "mode", Current: "required"}}, page.Items[1].ChangedFields)
	require.Empty(t, page.Items[3].ChangedFields, "free-form identity detail must not be projected")
	for _, item := range page.Items {
		require.NotContains(t, item.Resource.ID, "@")
		for _, field := range item.ChangedFields {
			require.NotContains(t, field.Current, "secret-token")
		}
	}
}

func TestListPagesAndFiltersAcrossBothEvidenceSources(t *testing.T) {
	db := newProjectionTestDB(t)
	now := time.Date(2026, time.August, 14, 12, 0, 0, 0, time.UTC)
	for _, row := range []any{
		&models.Organization{ID: "org-1", Name: "One", CreatedByID: "owner-1", CreatedAt: now},
		&models.Workspace{ID: "ws-1", OrganizationID: "org-1", Name: "One", CreatedAt: now},
		&models.IdentityAuditEvent{ID: "b", OrganizationID: "org-1", Action: "provider.saved", CreatedAt: now},
		&models.WorkspaceAccessAuditEvent{ID: "a", WorkspaceID: "ws-1", Action: "invitation.created", InvitationID: "invite-1", SubjectEmail: "hidden@example.com", Role: "viewer", CreatedAt: now},
		&models.IdentityAuditEvent{ID: "old", OrganizationID: "org-1", Action: "policy.updated", Detail: "optional", CreatedAt: now.Add(-time.Hour)},
	} {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}

	service := NewService(db)
	first, err := service.List(t.Context(), Query{OrganizationID: "org-1", Limit: 2})
	require.NoError(t, err)
	require.Len(t, first.Items, 2)
	require.NotNil(t, first.NextCursor)
	second, err := service.List(t.Context(), Query{OrganizationID: "org-1", Limit: 2, Cursor: first.NextCursor})
	require.NoError(t, err)
	require.Equal(t, []string{"old"}, []string{second.Items[0].ID})
	require.Nil(t, second.NextCursor)

	filtered, err := service.List(t.Context(), Query{OrganizationID: "org-1", WorkspaceID: "ws-1", Action: "invitation.created", ResourceType: "workspace_invitation", Limit: 10})
	require.NoError(t, err)
	require.Equal(t, []string{"a"}, []string{filtered.Items[0].ID})
	require.NotContains(t, []string{filtered.Items[0].ID}, "b", "a Workspace filter cannot include Organization-level identity evidence")
}

func TestListProjectsConsequentialDomainEvidenceAndTrueEffectiveActor(t *testing.T) {
	db := newProjectionTestDB(t)
	now := time.Date(2026, time.August, 14, 12, 0, 0, 0, time.UTC)
	for _, row := range []any{
		&models.Organization{ID: "org-1", Name: "One", CreatedByID: "owner-1", CreatedAt: now},
		&models.OrganizationMember{OrganizationID: "org-1", UserID: "target-1", Role: models.OrganizationRoleMember, CreatedAt: now},
		&models.Workspace{ID: "ws-1", OrganizationID: "org-1", Name: "One", CreatedAt: now},
		&models.UserImpersonationGrant{ID: "grant-1", AdminUserID: "admin-1", TargetUserID: "target-1", CreatedAt: now.Add(-10 * time.Minute), UsedAt: now.Add(-time.Minute)},
		&models.UserImpersonationGrantOrganization{GrantID: "grant-1", OrganizationID: "org-1"},
		&models.BillingCheckoutAttempt{CheckoutAttemptID: "checkout-1", OrganizationID: "org-1", WorkspaceID: "ws-1", UserID: "owner-1", Provider: "paddle", PlanID: "pro", BillingPeriod: "monthly", Status: "completed", CreatedAt: now.Add(-2 * time.Minute), UpdatedAt: now.Add(-2 * time.Minute)},
		&models.MCPToolCall{ID: "mcp-1", UserID: "owner-1", WorkspaceID: "ws-1", ToolName: "create_publication", Status: "success", CreatedAt: now.Add(-3 * time.Minute)},
		&models.PublicationLifecycleEvent{ID: "life-1", WorkspaceID: "ws-1", PublicationID: "publication-1", Type: "publication.scheduled", Status: "success", Message: "private post content", MetadataJSON: `{"token":"secret"}`, CreatedAt: now.Add(-4 * time.Minute)},
		&models.PublicationAuthorization{ID: "authz-1", BatchID: "batch-1", WorkspaceID: "ws-1", PublicationID: "publication-1", RenditionID: "rendition-1", Action: "publish", ActorOrigin: "web", ActorUserID: "owner-1", PublicationRevision: 1, SocialAccountID: "account-1", TargetKey: "target", ScheduledAt: now, PolicyMode: "explicit", ConfirmedAt: now.Add(-5 * time.Minute), CreatedAt: now.Add(-5 * time.Minute)},
		&models.ProviderWriteAttempt{ID: "write-1", OperationID: "operation-1", AttemptNumber: 1, WorkspaceID: "ws-1", PublicationID: "publication-1", SocialAccountID: "account-1", TargetKey: "target", Provider: "bluesky", Operation: "publish", Status: "succeeded", SubmissionState: "confirmed", RetrySafety: "safe", PayloadFingerprint: "must-not-project", CreatedAt: now.Add(-6 * time.Minute), UpdatedAt: now.Add(-6 * time.Minute)},
	} {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}

	page, err := NewService(db).List(t.Context(), Query{OrganizationID: "org-1", Limit: 20})
	require.NoError(t, err)
	require.Len(t, page.Items, 7)
	byID := map[string]AuditEvent{}
	for _, item := range page.Items {
		byID[item.ID] = item
	}
	require.Equal(t, "admin-1", byID["grant-1:created"].ActorUserID)
	require.Equal(t, "target-1", byID["grant-1:created"].EffectiveActorUserID)
	require.Equal(t, "target-1", byID["grant-1:consumed"].EffectiveActorUserID)
	require.Equal(t, ResourceImpersonation, byID["grant-1:created"].Resource.Type)
	require.Empty(t, byID["mcp-1"].EffectiveActorUserID)
	require.Equal(t, ResourceBilling, byID["checkout-1"].Resource.Type)
	require.Equal(t, ResourcePublication, byID["life-1"].Resource.Type)
	require.Equal(t, ResourcePublicationAuthorization, byID["authz-1"].Resource.Type)
	require.Equal(t, ResourceProviderWrite, byID["write-1"].Resource.Type)
	encoded, err := json.Marshal(page.Items)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "private post content")
	require.NotContains(t, string(encoded), "must-not-project")
	require.NotContains(t, string(encoded), "secret")

	firstImpersonationPage, err := NewService(db).List(t.Context(), Query{OrganizationID: "org-1", ResourceType: ResourceImpersonation, Limit: 1})
	require.NoError(t, err)
	require.Equal(t, []string{"grant-1:consumed"}, []string{firstImpersonationPage.Items[0].ID})
	require.NotNil(t, firstImpersonationPage.NextCursor)
	secondImpersonationPage, err := NewService(db).List(t.Context(), Query{OrganizationID: "org-1", ResourceType: ResourceImpersonation, Cursor: firstImpersonationPage.NextCursor, Limit: 1})
	require.NoError(t, err)
	require.Equal(t, []string{"grant-1:created"}, []string{secondImpersonationPage.Items[0].ID})

	recent, err := NewService(db).List(t.Context(), Query{OrganizationID: "org-1", Action: "impersonation.session_created", From: now.Add(-2 * time.Minute), Limit: 20})
	require.NoError(t, err)
	require.Equal(t, []string{"grant-1:consumed"}, []string{recent.Items[0].ID}, "session time filtering must use the consumption time, not the grant creation time")
}

func TestListUsesFrozenOrganizationScopeForImpersonationEvidence(t *testing.T) {
	db := newProjectionTestDB(t)
	now := time.Date(2026, time.August, 14, 12, 0, 0, 0, time.UTC)
	for _, row := range []any{
		&models.Organization{ID: "org-1", Name: "One", CreatedAt: now},
		&models.Organization{ID: "org-2", Name: "Two", CreatedAt: now},
		&models.UserImpersonationGrant{ID: "grant-1", AdminUserID: "admin-1", TargetUserID: "target-1", CreatedAt: now},
		&models.UserImpersonationGrantOrganization{GrantID: "grant-1", OrganizationID: "org-1"},
		&models.OrganizationMember{OrganizationID: "org-2", UserID: "target-1", Role: models.OrganizationRoleMember, CreatedAt: now.Add(time.Minute)},
	} {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}

	orgOne, err := NewService(db).List(t.Context(), Query{OrganizationID: "org-1", Limit: 10})
	require.NoError(t, err)
	require.Equal(t, []string{"grant-1:created"}, []string{orgOne.Items[0].ID})
	orgTwo, err := NewService(db).List(t.Context(), Query{OrganizationID: "org-2", Limit: 10})
	require.NoError(t, err)
	require.Empty(t, orgTwo.Items, "current or future membership must not infer grant scope")
}

func TestListInstanceProjectsEveryOrganizationWithoutChangingOrganizationScope(t *testing.T) {
	db := newProjectionTestDB(t)
	now := time.Date(2026, time.August, 14, 12, 0, 0, 0, time.UTC)
	for _, row := range []any{
		&models.Organization{ID: "org-1", Name: "One", CreatedAt: now},
		&models.Organization{ID: "org-2", Name: "Two", CreatedAt: now},
		&models.Workspace{ID: "ws-1", OrganizationID: "org-1", Name: "One", CreatedAt: now},
		&models.Workspace{ID: "ws-2", OrganizationID: "org-2", Name: "Two", CreatedAt: now},
		&models.IdentityProvider{ID: "provider-1", OrganizationID: "org-1", Issuer: "https://identity.example", Name: "Identity", ClientID: "client"},
		&models.IdentityAuditEvent{ID: "identity-1", OrganizationID: "org-1", ActorUserID: "actor-1", Action: "policy.updated", Detail: "required", CreatedAt: now},
		&models.IdentityAuditEvent{ID: "identity-inferred", ProviderID: "provider-1", ActorUserID: "actor-1", Action: "identity.unlinked", CreatedAt: now.Add(-30 * time.Second)},
		&models.IdentityAuditEvent{ID: "identity-2", OrganizationID: "org-2", ActorUserID: "actor-2", Action: "provider.saved", Detail: "secret", CreatedAt: now.Add(-time.Minute)},
		&models.WorkspaceAccessAuditEvent{ID: "access-2", WorkspaceID: "ws-2", ActorUserID: "actor-2", SubjectEmail: "private@example.com", Action: "member.removed", CreatedAt: now.Add(-2 * time.Minute)},
	} {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}

	service := NewService(db)
	instance, err := service.ListInstance(t.Context(), Query{Limit: 10})
	require.NoError(t, err)
	require.Equal(t, []string{"identity-1", "identity-inferred", "identity-2", "access-2"}, []string{instance.Items[0].ID, instance.Items[1].ID, instance.Items[2].ID, instance.Items[3].ID})
	require.Equal(t, "org-1", instance.Items[0].Resource.OrganizationID)
	require.Equal(t, "org-1", instance.Items[1].Resource.OrganizationID)
	require.Equal(t, "org-2", instance.Items[2].Resource.OrganizationID)
	require.Equal(t, "org-2", instance.Items[3].Resource.OrganizationID)

	filtered, err := service.ListInstance(t.Context(), Query{OrganizationID: "org-2", Limit: 10})
	require.NoError(t, err)
	require.Equal(t, []string{"identity-2", "access-2"}, []string{filtered.Items[0].ID, filtered.Items[1].ID})

	owner, err := service.List(t.Context(), Query{OrganizationID: "org-1", Limit: 10})
	require.NoError(t, err)
	require.Equal(t, []string{"identity-1", "identity-inferred"}, []string{owner.Items[0].ID, owner.Items[1].ID})
	require.NotContains(t, owner.Items, "identity-2")
	encoded, err := json.Marshal(instance.Items)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "private@example.com")
	require.NotContains(t, string(encoded), "secret")
}
