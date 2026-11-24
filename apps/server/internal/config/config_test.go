package config

import (
	"net/netip"
	"os"
	"path/filepath"
	"testing"

	"github.com/openpost/backend/internal/legalpolicy"
	"github.com/stretchr/testify/require"
)

func TestMain(m *testing.M) {
	for _, key := range configTestEnvKeys {
		_ = os.Unsetenv(key)
		_ = os.Unsetenv(key + "_FILE")
	}
	os.Exit(m.Run())
}

var configTestEnvKeys = []string{
	"OPENPOST_APP_URL",
	"OPENPOST_FRONTEND_URL",
	"OPENPOST_PUBLIC_URL",
	"OPENPOST_PROXY_AUTH_SECRET",
	"OPENPOST_PROXY_AUTH_WORKSPACE_NAME",
	"OPENPOST_OAUTH_DYNAMIC_REGISTRATION_ENABLED",
	"OPENPOST_MCP_MODE",
	"OPENPOST_EDITION",
	"OPENPOST_APP_E2E_HOSTED_SIGNUP",
	"OPENPOST_APP_E2E_DELIVERY_PROJECTION",
	"OPENPOST_DATABASE_DRIVER",
	"OPENPOST_DATABASE_PATH",
	"OPENPOST_DB_PATH",
	"OPENPOST_DATABASE_URL",
	"DATABASE_URL",
	"OPENPOST_JWT_SECRET",
	"JWT_SECRET",
	"OPENPOST_ENCRYPTION_KEY",
	"ENCRYPTION_KEY",
	"OPENPOST_ENCRYPTION_KEY_ID",
	"OPENPOST_ENCRYPTION_PREVIOUS_KEYS",
	"OPENPOST_MEDIA_SIGNING_KEY",
	"OPENPOST_DISABLE_REGISTRATIONS",
	"OPENPOST_PUBLIC_PROFILES_ENABLED",
	"OPENPOST_LEGAL_ACCEPTANCE_REQUIRED",
	"OPENPOST_TERMS_URL",
	"OPENPOST_PRIVACY_URL",
	"OPENPOST_TERMS_VERSION",
	"OPENPOST_PRIVACY_VERSION",
	"OPENPOST_SUPPORT_EMAIL",
	"OPENROUTER_API_KEY",
	"OPENPOST_AI_API_KEY",
	"OPENPOST_AI_BASE_URL",
	"OPENPOST_CONTENT_AI_PROVIDER",
	"OPENPOST_CONTENT_AI_REQUIRE_ZDR",
	"OPENPOST_IMAGE_CAPTION_MODEL",
	"OPENPOST_IMAGE_CAPTION_PROVIDER",
	"OPENPOST_IMAGE_CAPTION_REQUIRE_ZDR",
	"OPENPOST_TEXT_GENERATION_MODEL",
	"OPENPOST_EDITOR_AGENT_MODEL",
	"OPENPOST_WORKFLOW_DECISION_MODEL",
	"OPENPOST_MEME_GENERATOR_ENABLED",
	"OPENPOST_MEME_GENERATION_MODEL",
	"OPENPOST_IMAGE_EDITOR_ENABLED",
	"OPENPOST_IMAGE_EDITOR_MODEL_BASE_URL",
	"OPENPOST_STUDIO_ENABLED",
	"OPENPOST_STUDIO_MODEL_BASE_URL",
	"OPENPOST_STOCK_MEDIA_ENABLED",
	"OPENPOST_PEXELS_API_KEY",
	"OPENPOST_UNSPLASH_ACCESS_KEY",
	"OPENPOST_PIXABAY_API_KEY",
	"OPENPOST_FEEDBACK_ENABLED",
	"OPENPOST_FEEDBACK_DESTINATION_URL",
	"OPENPOST_FEEDBACK_RECIPIENT",
	"OPENPOST_FEEDBACK_SUPPORT_URL",
	"OPENPOST_DISCORD_PRESENCE_STREAM_URL",
	"OPENPOST_TELEMETRY_ENABLED",
	"OPENPOST_POSTHOG_PROJECT_TOKEN",
	"OPENPOST_POSTHOG_API_HOST",
	"OPENPOST_POSTHOG_BROWSER_HOST",
	"OPENPOST_POSTHOG_UI_HOST",
	"OPENPOST_TELEMETRY_ENVIRONMENT",
	"OPENPOST_UPDATE_CHECK_ENABLED",
	"OPENPOST_OIDC_ISSUER",
	"OPENPOST_OIDC_CLIENT_ID",
	"OPENPOST_OIDC_CLIENT_SECRET",
	"OPENPOST_OIDC_NAME",
	"OPENPOST_OIDC_SCOPES",
	"OPENPOST_OIDC_JIT_ENABLED",
	"OPENPOST_OIDC_BOOTSTRAP_ALLOWLIST",
	"OPENPOST_SSO_BREAK_GLASS_EMAILS",
	"OPENPOST_OIDC_NATIVE_CALLBACK_URL",
	"OPENPOST_AUTH_GOOGLE_CLIENT_ID",
	"OPENPOST_AUTH_GOOGLE_CLIENT_SECRET",
	"OPENPOST_EMAIL_VERIFICATION_REQUIRED",
	"OPENPOST_EMAIL_PROVIDER",
	"OPENPOST_EMAIL_FROM",
	"OPENPOST_RESEND_API_KEY",
	"OPENPOST_CLOUDFLARE_EMAIL_ACCOUNT_ID",
	"OPENPOST_CLOUDFLARE_EMAIL_API_TOKEN",
	"OPENPOST_SMTP_HOST",
	"OPENPOST_SMTP_PORT",
	"OPENPOST_SMTP_USERNAME",
	"OPENPOST_SMTP_PASSWORD",
	"OPENPOST_SMTP_FROM",
	"OPENPOST_SMTP_TLS_MODE",
	"OPENPOST_SMTP_SERVER_NAME",
	"OPENPOST_EXTRA_CORS_ORIGINS",
	"OPENPOST_CORS_EXTRA_ORIGINS",
	"OPENPOST_TRUSTED_PROXY_CIDRS",
	"OPENPOST_ALLOWED_PRIVATE_CIDRS",
	"OPENPOST_WORKFLOWS_AI_ENABLED",
	"OPENPOST_WORKFLOWS_AI_MONTHLY_CALL_LIMIT",
	"X_CLIENT_ID",
	"TWITTER_CLIENT_ID",
	"X_CLIENT_SECRET",
	"TWITTER_CLIENT_SECRET",
	"X_REDIRECT_URI",
	"TWITTER_REDIRECT_URI",
	"OPENPOST_X_MONTHLY_BUDGET_MICROUSD",
	"OPENPOST_X_POST_CREATE_COST_MICROUSD",
	"OPENPOST_X_POST_CREATE_WITH_URL_COST_MICROUSD",
	"OPENPOST_PROVIDER_USAGE_RETENTION_DAYS",
	"MASTODON_REDIRECT_URI",
	"MASTODON_SERVERS",
	"LINKEDIN_CLIENT_ID",
	"LINKEDIN_CLIENT_SECRET",
	"LINKEDIN_REDIRECT_URI",
	"OPENPOST_LINKEDIN_AUTH_MODE",
	"LINKEDIN_DISABLE_THREAD_REPLIES",
	"OPENPOST_DISABLE_LINKEDIN_THREAD_REPLIES",
	"OPENPOST_LINKEDIN_ORGANIZATIONS_ENABLED",
	"OPENPOST_DISABLE_TIKTOK_DISPLAY_API",
	"THREADS_CLIENT_ID",
	"THREADS_CLIENT_SECRET",
	"THREADS_REDIRECT_URI",
	"OPENPOST_PROVIDER_APPS",
	"OPENPOST_CONNECTORS_FILE",
	"OPENPOST_PROVIDER_CERTIFICATION_ENFORCED",
	"OPENPOST_STORAGE_DRIVER",
	"OPENPOST_MEDIA_PATH",
	"OPENPOST_MEDIA_URL",
	"OPENPOST_S3_ENDPOINT",
	"OPENPOST_S3_REGION",
	"OPENPOST_S3_BUCKET",
	"OPENPOST_S3_ACCESS_KEY_ID",
	"OPENPOST_S3_SECRET_ACCESS_KEY",
	"OPENPOST_S3_PUBLIC_BASE_URL",
	"OPENPOST_S3_FORCE_PATH_STYLE",
	"OPENPOST_PADDLE_API_KEY",
	"OPENPOST_PADDLE_API_BASE_URL",
	"OPENPOST_PADDLE_ENVIRONMENT",
	"OPENPOST_PADDLE_CLIENT_TOKEN",
	"OPENPOST_PADDLE_WEBHOOK_SECRET",
	"OPENPOST_BILLING_DISCORD_WEBHOOK_URL",
	"OPENPOST_PADDLE_CHECKOUT_RETURN_URL",
	"OPENPOST_PADDLE_FOUNDER_MONTHLY_PRICE_ID",
	"OPENPOST_PADDLE_FOUNDER_ANNUAL_PRICE_ID",
	"OPENPOST_PADDLE_TEAM_MONTHLY_PRICE_ID",
	"OPENPOST_PADDLE_TEAM_ANNUAL_PRICE_ID",
	"OPENPOST_PADDLE_AGENCY_MONTHLY_PRICE_ID",
	"OPENPOST_PADDLE_AGENCY_ANNUAL_PRICE_ID",
}

func TestLoadAndValidateAllowedPrivateNetworks(t *testing.T) {
	t.Setenv("OPENPOST_ALLOWED_PRIVATE_CIDRS", " 10.7.7.0/24, ::ffff:192.168.1.9/120 ,")

	cfg := Load()
	require.Equal(t, []string{"10.7.7.0/24", "::ffff:192.168.1.9/120"}, cfg.AllowedPrivateCIDRs)
	prefixes, err := cfg.AllowedPrivateNetworks()
	require.NoError(t, err)
	require.Equal(t, []netip.Prefix{netip.MustParsePrefix("10.7.7.0/24"), netip.MustParsePrefix("192.168.1.0/24")}, prefixes)

	cfg.AllowedPrivateCIDRs = []string{"10.7.7.5"}
	require.EqualError(t, cfg.validateSecurityRuntime(), "OPENPOST_ALLOWED_PRIVATE_CIDRS contains an invalid CIDR")
}

func TestManagedEditionRejectsAllowedPrivateNetworks(t *testing.T) {
	cfg := &Config{Edition: EditionCloud, AllowedPrivateCIDRs: []string{"10.7.7.0/24"}}

	err := cfg.ValidateManagedSettings()
	require.ErrorContains(t, err, "allowed private networks are limited to self-hosted deployments")
}

func TestValidateRuntimeRejectsInvalidEncryptionKeyringWithoutEchoingKeys(t *testing.T) {
	const previousKey = "previous-encryption-key-with-more-than-thirty-two-chars"
	t.Setenv("OPENPOST_ENCRYPTION_KEY", "current-encryption-key-with-more-than-thirty-two-chars")
	t.Setenv("OPENPOST_ENCRYPTION_KEY_ID", "current")
	t.Setenv("OPENPOST_ENCRYPTION_PREVIOUS_KEYS", `{"current":"`+previousKey+`"}`)

	err := Load().ValidateRuntime()

	require.ErrorContains(t, err, "OPENPOST_ENCRYPTION_PREVIOUS_KEYS")
	require.ErrorContains(t, err, "current primary key ID")
	require.NotContains(t, err.Error(), previousKey)

	t.Setenv("OPENPOST_ENCRYPTION_PREVIOUS_KEYS", `{`)
	err = Load().ValidateRuntime()
	require.ErrorContains(t, err, "valid JSON object")

	t.Setenv("OPENPOST_ENCRYPTION_PREVIOUS_KEYS", `null`)
	err = Load().ValidateRuntime()
	require.ErrorContains(t, err, "valid JSON object")
}

func TestEncryptionKeyringFilesFailClosedWhenUnreadableOrEmpty(t *testing.T) {
	tests := []struct {
		name    string
		fileKey string
		prepare func(*testing.T)
	}{
		{
			name:    "primary key ID",
			fileKey: "OPENPOST_ENCRYPTION_KEY_ID_FILE",
		},
		{
			name:    "previous keys",
			fileKey: "OPENPOST_ENCRYPTION_PREVIOUS_KEYS_FILE",
			prepare: func(t *testing.T) { t.Setenv("OPENPOST_ENCRYPTION_KEY_ID", "current") },
		},
		{
			name:    "media signing key",
			fileKey: "OPENPOST_MEDIA_SIGNING_KEY_FILE",
		},
	}

	for _, test := range tests {
		t.Run(test.name+" unreadable", func(t *testing.T) {
			if test.prepare != nil {
				test.prepare(t)
			}
			t.Setenv(test.fileKey, filepath.Join(t.TempDir(), "missing"))

			err := Load().ValidateEncryptionKeyring()

			require.ErrorContains(t, err, test.fileKey)
			require.ErrorContains(t, err, "readable file")
		})

		t.Run(test.name+" empty", func(t *testing.T) {
			if test.prepare != nil {
				test.prepare(t)
			}
			t.Setenv(test.fileKey, writeEnvFile(t, "empty", " \n"))

			err := Load().ValidateEncryptionKeyring()

			require.ErrorContains(t, err, test.fileKey)
			require.ErrorContains(t, err, "nonempty file")
		})
	}
}

func TestLoadSupportsHostedAndSelfHostedProviderBotContracts(t *testing.T) {
	t.Setenv("OPENPOST_APP_URL", "https://app.openpo.st")
	t.Setenv("OPENPOST_PROVIDER_APPS", `[
		{"provider":"pinterest","client_id":"pin-client","client_secret":"pin-secret"},
		{"provider":"telegram","bot_token":"telegram-token","bot_username":"@openpost_bot","webhook_secret":"telegram-webhook-secret"},
		{"provider":"discord","connection_mode":"bot","client_id":"discord-app","client_secret":"discord-secret","bot_token":"discord-token"}
	]`)

	cfg := Load()

	require.Len(t, cfg.ProviderApps, 9)
	require.Equal(t, "devnull", cfg.ProviderApps[1].Provider)
	require.Equal(t, "ssh_signature", cfg.ProviderApps[1].ConnectionMode)
	require.Equal(t, "webhook", cfg.ProviderApps[2].ConnectionMode)
	require.Equal(t, "peertube", cfg.ProviderApps[3].Provider)
	require.Equal(t, "lemmy", cfg.ProviderApps[4].Provider)
	require.Equal(t, "piefed", cfg.ProviderApps[5].Provider)
	require.Equal(t, "pinterest", cfg.ProviderApps[6].Provider)
	require.Equal(t, "https://app.openpo.st/api/v1/accounts/pinterest/callback", cfg.ProviderApps[6].RedirectURI)
	require.Equal(t, "telegram", cfg.ProviderApps[7].Provider)
	require.Equal(t, "openpost_bot", cfg.ProviderApps[7].BotUsername)
	require.Empty(t, cfg.ProviderApps[7].RedirectURI)
	require.Equal(t, "discord", cfg.ProviderApps[8].Provider)
	require.Equal(t, "bot", cfg.ProviderApps[8].ConnectionMode)
	require.Equal(t, "https://app.openpo.st/api/v1/accounts/discord/callback", cfg.ProviderApps[8].RedirectURI)
}

func TestLoadReadsBillingDiscordWebhookFromFile(t *testing.T) {
	t.Setenv("OPENPOST_BILLING_DISCORD_WEBHOOK_URL_FILE", writeEnvFile(t, "billing-discord-webhook", "https://discord.com/api/webhooks/test/token\n"))

	cfg := Load()

	require.Equal(t, "https://discord.com/api/webhooks/test/token", cfg.BillingDiscordWebhookURL)
	require.NoError(t, cfg.ValidateRuntime())
}

func TestValidateRuntimeRejectsCloudLocalDefaults(t *testing.T) {
	cfg := &Config{
		Edition:        EditionCloud,
		DatabaseDriver: DatabaseDriverSQLite,
		DatabasePath:   "file:openpost.db?cache=shared&mode=rwc",
		StorageDriver:  StorageDriverLocal,
	}

	err := cfg.ValidateRuntime()

	require.Error(t, err)
	require.ErrorContains(t, err, "OPENPOST_EDITION=cloud")
	require.ErrorContains(t, err, "OPENPOST_DATABASE_DRIVER=postgres")
	require.ErrorContains(t, err, "OPENPOST_DATABASE_URL")
	require.ErrorContains(t, err, "OPENPOST_STORAGE_DRIVER=s3")
}

func validCloudRuntimeConfig() *Config {
	return &Config{
		Edition:                     EditionCloud,
		DatabaseDriver:              DatabaseDriverPostgres,
		DatabaseURL:                 "postgres://openpost:secret@db.internal:5432/openpost?sslmode=require",
		StorageDriver:               StorageDriverS3,
		S3Region:                    "auto",
		S3Bucket:                    "openpost-media",
		S3AccessKeyID:               "access-key",
		S3SecretAccessKey:           "secret-key",
		S3PublicBaseURL:             "https://media.openpo.st",
		S3ForcePathStyle:            true,
		PaddleAPIKey:                "pdl_sdbx_token",
		PaddleEnvironment:           "sandbox",
		PaddleClientToken:           "test_client_token",
		PaddleWebhookSecret:         "pdl_webhook_secret",
		PaddleFounderMonthlyPriceID: "pri_founder_monthly",
		PaddleFounderAnnualPriceID:  "pri_founder_annual",
		PaddleTeamMonthlyPriceID:    "pri_team_monthly",
		PaddleTeamAnnualPriceID:     "pri_team_annual",
		PaddleAgencyMonthlyPriceID:  "pri_agency_monthly",
		PaddleAgencyAnnualPriceID:   "pri_agency_annual",
		LegalAcceptanceRequired:     true,
		TermsURL:                    "https://openpo.st/terms",
		PrivacyURL:                  "https://openpo.st/privacy",
		TermsVersion:                legalpolicy.TermsVersion,
		PrivacyVersion:              legalpolicy.PrivacyVersion,
		SupportEmail:                "openpost@rgo.pt",
		EmailVerificationRequired:   true,
		EmailProvider:               "smtp",
		EmailFrom:                   "OpenPost <openpost@example.com>",
		SMTPHost:                    "smtp.example.com",
		SMTPPort:                    587,
		SMTPFrom:                    "OpenPost <openpost@example.com>",
		TelemetryEnabled:            true,
		PostHogProjectToken:         "phc_test",
		PostHogAPIHost:              "https://eu.i.posthog.com",
		PostHogBrowserHost:          "https://e.example.com",
		PostHogUIHost:               "https://eu.posthog.com",
		TelemetryEnvironment:        "test",
	}
}

func TestLoadEnablesTelemetryByDefaultForCloudInstances(t *testing.T) {
	t.Setenv("OPENPOST_EDITION", EditionCloud)
	t.Setenv("OPENPOST_POSTHOG_API_HOST", "https://eu.i.posthog.com/")
	cfg := Load()
	require.True(t, cfg.TelemetryEnabled)
	require.Equal(t, "https://eu.i.posthog.com", cfg.PostHogAPIHost)
	require.Equal(t, "https://cool.openpo.st", cfg.PostHogBrowserHost)
	require.Equal(t, "https://eu.posthog.com", cfg.PostHogUIHost)
	require.Equal(t, "production", cfg.TelemetryEnvironment)
}

func TestOauthRedirectFromFrontendPreferesExplicitEnv(t *testing.T) {
	t.Setenv("X_REDIRECT_URI", "https://proxy.example.com/api/v1/accounts/x/callback")
	t.Setenv("TWITTER_REDIRECT_URI", "")
	got := oauthRedirectFromFrontend("X_REDIRECT_URI", "TWITTER_REDIRECT_URI", "https://openpost.example.com", "/api/v1/accounts/x/callback")
	require.Equal(t, "https://proxy.example.com/api/v1/accounts/x/callback", got)
}

// TestOauthRedirectFromFrontendFallsBackToAlias covers the case where
// the primary env var isn't set but the legacy alias is.
func TestOauthRedirectFromFrontendDerivesFromFrontendURL(t *testing.T) {
	t.Setenv("X_REDIRECT_URI", "")
	t.Setenv("TWITTER_REDIRECT_URI", "")
	got := oauthRedirectFromFrontend("X_REDIRECT_URI", "TWITTER_REDIRECT_URI", "https://openpost.example.com", "/api/v1/accounts/x/callback")
	require.Equal(t, "https://openpost.example.com/api/v1/accounts/x/callback", got)
}

// TestOauthRedirectFromFrontendStripsTrailingSlash covers the common
// case where the operator sets OPENPOST_APP_URL with a trailing slash.
func TestOauthRedirectFromFrontendStripsTrailingSlash(t *testing.T) {
	t.Setenv("LINKEDIN_REDIRECT_URI", "")
	got := oauthRedirectFromFrontend("LINKEDIN_REDIRECT_URI", "", "https://openpost.example.com/", "/api/v1/accounts/linkedin/callback")
	require.Equal(t, "https://openpost.example.com/api/v1/accounts/linkedin/callback", got)
}

func TestValidateBootstrapSecretsAcceptsIndependentGeneratedValues(t *testing.T) {
	require.NoError(t, validateBootstrapSecrets(
		"3daf47b368ac4e64b2791a807b32fc05",
		"b8d7b76210b84570bfa504515e240f66",
	))
}

func writeEnvFile(t *testing.T, name, value string) string {
	t.Helper()

	path := filepath.Join(t.TempDir(), name)
	require.NoError(t, os.WriteFile(path, []byte(value), 0o600))
	return path
}

func TestValidateRuntimeRejectsCustomAIEndpointForHosted(t *testing.T) {
	cfg := validCloudRuntimeConfig()
	cfg.AIBaseURL = "https://gateway.example.test/v1"
	require.ErrorContains(t, cfg.ValidateRuntime(), "OPENPOST_AI_BASE_URL must be empty")
}
