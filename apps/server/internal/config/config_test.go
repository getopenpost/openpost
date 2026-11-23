package config

import (
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

func TestValidateRuntimePinsManagedAIToZdrEUProvider(t *testing.T) {
	cfg := validCloudRuntimeConfig()
	cfg.AIAPIKey = "openrouter-key"
	cfg.ContentAIProvider = "openai"
	cfg.ContentAIRequireZDR = false
	cfg.ImageCaptionProvider = "openai"
	cfg.ImageCaptionRequireZDR = false

	err := cfg.ValidateRuntime()

	require.Error(t, err)
	require.ErrorContains(t, err, "OPENPOST_IMAGE_CAPTION_PROVIDER=azure/eu")
	require.ErrorContains(t, err, "OPENPOST_IMAGE_CAPTION_REQUIRE_ZDR=true")
	require.ErrorContains(t, err, "OPENPOST_CONTENT_AI_PROVIDER=azure/eu")
	require.ErrorContains(t, err, "OPENPOST_CONTENT_AI_REQUIRE_ZDR=true")

	cfg.ContentAIProvider = "azure/eu"
	cfg.ContentAIRequireZDR = true
	cfg.ImageCaptionProvider = "azure/eu"
	cfg.ImageCaptionRequireZDR = true
	require.NoError(t, cfg.ValidateRuntime())
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
