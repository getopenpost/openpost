package publisher

import (
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

const publisherReadinessTestScopes = "instagram_basic instagram_content_publish pages_manage_posts pages_read_engagement threads_basic threads_content_publish user.info.basic video.publish video.upload w_member_social w_organization_social https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.upload"

// enableSelfHostedPublisherReadiness makes the safety dependency explicit in
// legacy publisher fixtures. Production code never gets a nil/permissive
// fallback; tests opt into the same self-hosted decision service used by main.
func enableSelfHostedPublisherReadiness(
	t *testing.T,
	db *bun.DB,
	service *Service,
	provider string,
	accountIDs ...string,
) {
	t.Helper()
	for _, model := range []any{
		(*models.OAuthGrant)(nil),
		(*models.PublicationAuthorization)(nil),
		(*models.ProviderApprovalReview)(nil),
		(*models.ProviderCertificationRun)(nil),
		(*models.ProviderCertificationCheck)(nil),
		(*models.ProviderRuntimeControlEvent)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
		require.NoError(t, err)
	}

	now := time.Now().UTC()
	apps := make([]providerreadiness.RuntimeApp, 0, len(accountIDs))
	for _, accountID := range accountIDs {
		var account models.SocialAccount
		require.NoError(t, db.NewSelect().Model(&account).Where("id = ?", accountID).Scan(t.Context()))
		grantID := "readiness-grant-" + accountID
		_, err := db.NewInsert().Model(&models.OAuthGrant{
			ID: grantID, WorkspaceID: account.WorkspaceID, Provider: provider,
			InstanceURL: account.InstanceURL, AccessTokenEnc: account.AccessTokenEnc,
			GrantedScopes:    publisherReadinessTestScopes,
			ValidationStatus: "valid", ValidatedAt: now.Add(-time.Minute),
		}).On("CONFLICT (id) DO UPDATE").Set("validated_at = EXCLUDED.validated_at").Exec(t.Context())
		require.NoError(t, err)
		_, err = db.NewUpdate().Model((*models.SocialAccount)(nil)).
			Set("oauth_grant_id = ?", grantID).
			Set("granted_scopes = ?", publisherReadinessTestScopes).
			Where("id = ?", accountID).
			Exec(t.Context())
		require.NoError(t, err)
		apps = append(apps, providerreadiness.RuntimeApp{
			Config: platform.AppConfig{
				Provider: provider, ClientID: provider + "-test-client",
				InstanceURL: strings.TrimSpace(account.InstanceURL),
			},
			Source:              providerreadiness.ConfigurationSourceEnvironment,
			ProviderEnvironment: providerreadiness.ProviderEnvironmentDevelopment,
		})
	}
	catalog, err := providerreadiness.NewConfigurationCatalog(apps)
	require.NoError(t, err)
	readiness := providerreadiness.NewService(
		providerreadiness.NewRepository(db),
		providerreadiness.ServiceOptions{
			Configurations: catalog, DefaultControl: providerreadiness.RuntimeControlStateEnabled,
		},
	)
	service.SetProviderReadiness(readiness)
	for _, accountID := range accountIDs {
		var account models.SocialAccount
		require.NoError(t, db.NewSelect().Model(&account).Where("id = ?", accountID).Scan(t.Context()))
		for _, capability := range capabilities.All() {
			if capability.Provider != provider {
				continue
			}
			decision := readiness.DecideAccountPublication(
				t.Context(), account, capability,
				providerreadiness.OperationPublishImmediate,
				providerreadiness.ExecutionIntentProduction,
				providerreadiness.PublicationPolicyMode(account, capability, nil),
			)
			require.True(t, decision.Publishable, "invalid self-hosted publisher readiness fixture: %#v", decision)
			break
		}
	}
}

func TestPublisherWriteFailsClosedWithoutReadinessService(t *testing.T) {
	t.Parallel()
	adapter := &fakePublisherAdapter{externalID: "must-not-publish"}
	srv := newPublisherUsageTestServer(t, adapter)
	srv.service.SetProviderReadiness(nil)
	scope := legacyWriteScope(t.Context(), "ws-1", "account-1", "x", "readiness-missing")
	_, err := srv.service.publishProviderWithUsage(
		t.Context(), "ws-1", capabilities.ProviderX, "readiness-missing", "publish",
		scope, adapter, "access-token", "x-account",
		&platform.PublishRequest{Content: "Readiness", Profile: models.ContentProfileShortText, OutputProfile: "x.post"},
		nil,
	)
	require.Error(t, err)
	require.Zero(t, adapter.publishCalls)
}

func TestPublisherWriteFailsClosedWhenReadinessRepositoryFails(t *testing.T) {
	t.Parallel()
	adapter := &fakePublisherAdapter{externalID: "must-not-publish"}
	srv := newPublisherUsageTestServer(t, adapter)
	_, err := srv.db.ExecContext(t.Context(), "DROP TABLE provider_runtime_control_events")
	require.NoError(t, err)
	scope := legacyWriteScope(t.Context(), "ws-1", "account-1", "x", "readiness-broken")
	_, err = srv.service.publishProviderWithUsage(
		t.Context(), "ws-1", capabilities.ProviderX, "readiness-broken", "publish",
		scope, adapter, "access-token", "x-account",
		&platform.PublishRequest{Content: "Readiness", Profile: models.ContentProfileShortText, OutputProfile: "x.post"},
		nil,
	)
	require.Error(t, err)
	require.Zero(t, adapter.publishCalls)
}
