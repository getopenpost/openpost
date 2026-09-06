package handlers

import (
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

func ensurePermissiveProviderReadinessFixture(t *testing.T, db *bun.DB) {
	t.Helper()
	for _, model := range []any{
		(*models.SocialAccount)(nil),
		(*models.OAuthGrant)(nil),
		(*models.ProviderApprovalReview)(nil),
		(*models.ProviderCertificationRun)(nil),
		(*models.ProviderCertificationCheck)(nil),
		(*models.ProviderRuntimeControlEvent)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
		if err != nil {
			t.Fatalf("create readiness fixture table: %v", err)
		}
	}
	var accounts []models.SocialAccount
	if err := db.NewSelect().Model(&accounts).Where("is_active = ?", true).Scan(t.Context()); err != nil {
		t.Fatalf("load readiness fixture accounts: %v", err)
	}
	now := time.Now().UTC()
	scopes := strings.Join([]string{
		"pages_manage_posts", "pages_read_engagement",
		"instagram_basic", "instagram_content_publish",
		"https://www.googleapis.com/auth/youtube",
		"https://www.googleapis.com/auth/youtube.upload",
		"user.info.basic", "video.upload", "video.publish",
		"w_member_social", "w_organization_social",
		"threads_basic", "threads_content_publish",
	}, " ")
	for _, account := range accounts {
		grantID := "test-readiness-" + account.ID
		grant := &models.OAuthGrant{
			ID: grantID, WorkspaceID: account.WorkspaceID, Provider: account.Platform,
			ProviderSubject: account.AccountID, InstanceURL: account.InstanceURL,
			AccessTokenEnc: []byte("test-readiness-token"), GrantedScopes: scopes,
			TokenVersion: 1, ExecutionMode: "user_oauth", AuthorizationEvidence: "{}",
			ValidationStatus: "valid", ValidatedAt: now, CreatedAt: now, UpdatedAt: now,
		}
		if _, err := db.NewInsert().Model(grant).On("CONFLICT (id) DO NOTHING").Exec(t.Context()); err != nil {
			t.Fatalf("create readiness fixture grant: %v", err)
		}
		if _, err := db.NewUpdate().Model((*models.SocialAccount)(nil)).
			Set("oauth_grant_id = ?", grantID).
			Where("id = ?", account.ID).
			Exec(t.Context()); err != nil {
			t.Fatalf("bind readiness fixture grant: %v", err)
		}
	}
}

func newReadyPublicationHandler(
	t *testing.T,
	db *bun.DB,
	authenticator middleware.Authenticator,
) *PublicationHandler {
	t.Helper()
	ensurePermissiveProviderReadinessFixture(t, db)
	handler := NewPublicationHandler(db, authenticator, nil)
	handler.SetProviderReadiness(permissiveProviderReadiness(t))
	return handler
}
