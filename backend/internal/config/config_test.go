package config

import (
	"bytes"
	"log"
	"os"
	"path/filepath"
	"strings"
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
	"OPENPOST_CONTENT_AI_PROVIDER",
	"OPENPOST_CONTENT_AI_REQUIRE_ZDR",
	"OPENPOST_IMAGE_CAPTION_MODEL",
	"OPENPOST_IMAGE_CAPTION_PROVIDER",
	"OPENPOST_IMAGE_CAPTION_REQUIRE_ZDR",
	"OPENPOST_TEXT_GENERATION_MODEL",
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
	"LINKEDIN_DISABLE_THREAD_REPLIES",
	"OPENPOST_DISABLE_LINKEDIN_THREAD_REPLIES",
	"THREADS_CLIENT_ID",
	"THREADS_CLIENT_SECRET",
	"THREADS_REDIRECT_URI",
	"OPENPOST_PROVIDER_APPS",
	"OPENPOST_ANALYTICS_SOURCES",
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
	"OPENPOST_PADDLE_CHECKOUT_RETURN_URL",
	"OPENPOST_PADDLE_STARTER_MONTHLY_PRICE_ID",
	"OPENPOST_PADDLE_STARTER_ANNUAL_PRICE_ID",
	"OPENPOST_PADDLE_FOUNDER_MONTHLY_PRICE_ID",
	"OPENPOST_PADDLE_FOUNDER_ANNUAL_PRICE_ID",
	"OPENPOST_PADDLE_PRO_MONTHLY_PRICE_ID",
	"OPENPOST_PADDLE_PRO_ANNUAL_PRICE_ID",
	"OPENPOST_PADDLE_TEAM_MONTHLY_PRICE_ID",
	"OPENPOST_PADDLE_TEAM_ANNUAL_PRICE_ID",
	"OPENPOST_PADDLE_AGENCY_MONTHLY_PRICE_ID",
	"OPENPOST_PADDLE_AGENCY_ANNUAL_PRICE_ID",
}

func TestLoadKeepsConnectorConfigAsAPath(t *testing.T) {
	t.Setenv("OPENPOST_CONNECTORS_FILE", "/run/openpost/connectors.json")

	cfg := Load()

	require.Equal(t, "/run/openpost/connectors.json", cfg.ConnectorsFile)
}

func TestManagedEditionRejectsOperatorInstalledConnectors(t *testing.T) {
	cfg := &Config{Edition: EditionCloud, ConnectorsFile: "/run/openpost/connectors.json"}

	err := cfg.ValidateManagedSettings()
	require.ErrorContains(t, err, "operator-installed connectors are limited to self-hosted deployments")
}

func TestLoadProductionPrimitiveDefaults(t *testing.T) {
	t.Setenv("OPENPOST_APP_URL", "https://openpost.example.com")

	cfg := Load()

	require.Equal(t, EditionSelfHost, cfg.Edition)
	require.Equal(t, DatabaseDriverSQLite, cfg.DatabaseDriver)
	require.Equal(t, "file:openpost.db?cache=shared&mode=rwc", cfg.DatabaseDSN())
	require.Equal(t, StorageDriverLocal, cfg.StorageDriver)
	require.Empty(t, cfg.DatabaseURL)
	require.Empty(t, cfg.S3Bucket)
	require.Empty(t, cfg.PaddleAPIKey)
	require.Empty(t, cfg.PaddleEnvironment)
	require.Empty(t, cfg.PaddleClientToken)
	require.Empty(t, cfg.PaddleWebhookSecret)
	require.Empty(t, cfg.OpenRouterAPIKey)
	require.Empty(t, cfg.ContentAIProvider)
	require.False(t, cfg.ContentAIRequireZDR)
	require.Equal(t, "openai/gpt-5.6-luna", cfg.ImageCaptionModel)
	require.Empty(t, cfg.ImageCaptionProvider)
	require.False(t, cfg.ImageCaptionRequireZDR)
	require.Equal(t, "openai/gpt-5.6-luna", cfg.TextGenerationModel)
	require.True(t, cfg.MemeGeneratorEnabled)
	require.Equal(t, "openai/gpt-5.6-luna", cfg.MemeGenerationModel)
	require.True(t, cfg.ImageEditorEnabled)
	require.Equal(t, "/image-editor-models", cfg.ImageEditorModelBaseURL)
	require.False(t, cfg.StockMediaEnabled)
	require.False(t, cfg.FeedbackEnabled)
	require.Empty(t, cfg.FeedbackDestinationURL)
	require.Equal(t, "https://github.com/getopenpost/openpost/issues/new", cfg.FeedbackSupportURL)
	require.True(t, cfg.UpdateCheckEnabled)
	require.Equal(t, int64(5_000_000), cfg.XMonthlyBudgetMicrousd)
	require.Equal(t, int64(15_000), cfg.XPostCreateCostMicrousd)
	require.Equal(t, int64(200_000), cfg.XPostCreateWithURLCostMicrousd)
	require.Equal(t, 180, cfg.ProviderUsageRetentionDays)
	require.Equal(t, "https://openpost.example.com/media", cfg.MediaURL)
}

func TestLoadImageCaptionConfigurationSupportsFileBackedSecret(t *testing.T) {
	t.Setenv(
		"OPENROUTER_API_KEY_FILE",
		writeEnvFile(t, "openrouter-api-key", " openrouter-secret\n"),
	)
	t.Setenv("OPENPOST_IMAGE_CAPTION_MODEL", " openai/gpt-5.6-luna-20260709 ")
	t.Setenv("OPENPOST_IMAGE_CAPTION_PROVIDER", " azure/eu ")
	t.Setenv("OPENPOST_IMAGE_CAPTION_REQUIRE_ZDR", "true")

	cfg := Load()

	require.Equal(t, "openrouter-secret", cfg.OpenRouterAPIKey)
	require.Equal(t, "openai/gpt-5.6-luna-20260709", cfg.ImageCaptionModel)
	require.Equal(t, "azure/eu", cfg.ImageCaptionProvider)
	require.True(t, cfg.ImageCaptionRequireZDR)
	require.Equal(t, "azure/eu", cfg.ContentAIProvider)
	require.True(t, cfg.ContentAIRequireZDR)
}

func TestLoadMemeGeneratorConfiguration(t *testing.T) {
	t.Setenv("OPENPOST_MEME_GENERATOR_ENABLED", "false")
	t.Setenv("OPENPOST_MEME_GENERATION_MODEL", " openai/gpt-5.6-luna-20260709 ")

	cfg := Load()

	require.False(t, cfg.MemeGeneratorEnabled)
	require.Equal(t, "openai/gpt-5.6-luna-20260709", cfg.MemeGenerationModel)
}

func TestLoadTextGenerationModel(t *testing.T) {
	t.Setenv("OPENPOST_TEXT_GENERATION_MODEL", " openai/gpt-5.6-luna-20260709 ")
	t.Setenv("OPENPOST_CONTENT_AI_PROVIDER", " azure/eu ")
	t.Setenv("OPENPOST_CONTENT_AI_REQUIRE_ZDR", "true")

	cfg := Load()

	require.Equal(t, "openai/gpt-5.6-luna-20260709", cfg.TextGenerationModel)
	require.Equal(t, "azure/eu", cfg.ContentAIProvider)
	require.True(t, cfg.ContentAIRequireZDR)
}

func TestLoadResolvesRelativeMediaURLAgainstCanonicalPublicURL(t *testing.T) {
	t.Setenv("OPENPOST_APP_URL", "https://app.example.com")
	t.Setenv("OPENPOST_PUBLIC_URL", "https://public.example.com/openpost")
	t.Setenv("OPENPOST_MEDIA_URL", "assets/media/")

	cfg := Load()

	require.Equal(t, "https://public.example.com/openpost/assets/media", cfg.MediaURL)
}

func TestLoadPreservesExplicitAbsoluteMediaURL(t *testing.T) {
	t.Setenv("OPENPOST_APP_URL", "https://app.example.com")
	t.Setenv("OPENPOST_MEDIA_URL", "https://cdn.example.com/openpost-media/")

	cfg := Load()

	require.Equal(t, "https://cdn.example.com/openpost-media", cfg.MediaURL)
}

func TestLoadProviderCostGuardrailConfiguration(t *testing.T) {
	t.Setenv("OPENPOST_UPDATE_CHECK_ENABLED", "false")
	t.Setenv("OPENPOST_X_MONTHLY_BUDGET_MICROUSD", "1230000")
	t.Setenv("OPENPOST_X_POST_CREATE_COST_MICROUSD", "16000")
	t.Setenv("OPENPOST_X_POST_CREATE_WITH_URL_COST_MICROUSD", "210000")
	t.Setenv("OPENPOST_PROVIDER_USAGE_RETENTION_DAYS", "90")

	cfg := Load()

	require.False(t, cfg.UpdateCheckEnabled)
	require.Equal(t, int64(1_230_000), cfg.XMonthlyBudgetMicrousd)
	require.Equal(t, int64(16_000), cfg.XPostCreateCostMicrousd)
	require.Equal(t, int64(210_000), cfg.XPostCreateWithURLCostMicrousd)
	require.Equal(t, 90, cfg.ProviderUsageRetentionDays)
}

func TestLoadImageEditorConfiguration(t *testing.T) {
	t.Setenv("OPENPOST_IMAGE_EDITOR_ENABLED", "false")
	t.Setenv("OPENPOST_IMAGE_EDITOR_MODEL_BASE_URL", "https://assets.example.com/openpost/image-editor/")

	cfg := Load()

	require.False(t, cfg.ImageEditorEnabled)
	require.Equal(t, "https://assets.example.com/openpost/image-editor", cfg.ImageEditorModelBaseURL)
}

func TestLoadImageEditorConfigurationSupportsLegacyEnvironmentAliases(t *testing.T) {
	t.Setenv("OPENPOST_STUDIO_ENABLED", "false")
	t.Setenv("OPENPOST_STUDIO_MODEL_BASE_URL", "https://assets.example.com/legacy-image-editor/")

	cfg := Load()

	require.False(t, cfg.ImageEditorEnabled)
	require.Equal(t, "https://assets.example.com/legacy-image-editor", cfg.ImageEditorModelBaseURL)
}

func TestLoadStockConfiguration(t *testing.T) {
	t.Setenv("OPENPOST_STOCK_MEDIA_ENABLED", "true")
	t.Setenv("OPENPOST_PEXELS_API_KEY", " pexels-key ")
	t.Setenv("OPENPOST_UNSPLASH_ACCESS_KEY", " unsplash-key ")
	t.Setenv("OPENPOST_PIXABAY_API_KEY", " pixabay-key ")

	cfg := Load()

	require.True(t, cfg.StockMediaEnabled)
	require.Equal(t, "pexels-key", cfg.PexelsAPIKey)
	require.Equal(t, "unsplash-key", cfg.UnsplashAccessKey)
	require.Equal(t, "pixabay-key", cfg.PixabayAPIKey)
}

func TestLoadFeedbackConfigurationSupportsFileBackedWebhook(t *testing.T) {
	t.Setenv("OPENPOST_FEEDBACK_ENABLED", "true")
	t.Setenv(
		"OPENPOST_FEEDBACK_DESTINATION_URL_FILE",
		writeEnvFile(t, "feedback-webhook", "https://discord.com/api/webhooks/example/secret\n"),
	)
	t.Setenv("OPENPOST_FEEDBACK_RECIPIENT", "OpenPost team")
	t.Setenv("OPENPOST_FEEDBACK_SUPPORT_URL", "https://github.com/example/openpost/issues/new")

	cfg := Load()

	require.True(t, cfg.FeedbackEnabled)
	require.Equal(
		t,
		"https://discord.com/api/webhooks/example/secret",
		cfg.FeedbackDestinationURL,
	)
	require.Equal(t, "OpenPost team", cfg.FeedbackRecipient)
	require.Equal(t, "https://github.com/example/openpost/issues/new", cfg.FeedbackSupportURL)
}

func TestLoadOIDCConfigurationSupportsFileBackedSecret(t *testing.T) {
	t.Setenv("OPENPOST_OIDC_ISSUER", "https://idp.example.com/tenant")
	t.Setenv("OPENPOST_OIDC_CLIENT_ID", "openpost-client")
	t.Setenv(
		"OPENPOST_OIDC_CLIENT_SECRET_FILE",
		writeEnvFile(t, "oidc-client-secret", "oidc-secret\n"),
	)
	t.Setenv("OPENPOST_OIDC_NAME", "Company login")
	t.Setenv("OPENPOST_OIDC_SCOPES", "openid,profile,email,groups")
	t.Setenv("OPENPOST_OIDC_JIT_ENABLED", "true")
	t.Setenv(
		"OPENPOST_OIDC_BOOTSTRAP_ALLOWLIST",
		"https://idp.example.com/tenant|admin-subject,admin@example.com",
	)
	t.Setenv("OPENPOST_SSO_BREAK_GLASS_EMAILS", "operator@example.com")
	t.Setenv("OPENPOST_OIDC_NATIVE_CALLBACK_URL", "https://app.example.com/native/oidc")

	cfg := Load()

	require.Equal(t, "https://idp.example.com/tenant", cfg.OIDCIssuer)
	require.Equal(t, "openpost-client", cfg.OIDCClientID)
	require.Equal(t, "oidc-secret", cfg.OIDCClientSecret)
	require.Equal(t, "Company login", cfg.OIDCName)
	require.Equal(t, []string{"openid", "profile", "email", "groups"}, cfg.OIDCScopes)
	require.True(t, cfg.OIDCJITEnabled)
	require.Equal(
		t,
		[]string{"https://idp.example.com/tenant|admin-subject", "admin@example.com"},
		cfg.OIDCBootstrapAllowlist,
	)
	require.Equal(t, []string{"operator@example.com"}, cfg.OIDCBreakGlassEmails)
	require.Equal(t, "https://app.example.com/native/oidc", cfg.OIDCNativeCallbackURL)
}

func TestLoadCloudPostgresAndS3Primitives(t *testing.T) {
	t.Setenv("OPENPOST_APP_URL", "https://app.openpost.social")
	t.Setenv("OPENPOST_EDITION", "cloud")
	t.Setenv("OPENPOST_DATABASE_DRIVER", "postgres")
	t.Setenv("OPENPOST_DATABASE_URL", "postgres://openpost:secret@db.internal:5432/openpost?sslmode=require")
	t.Setenv("OPENPOST_STORAGE_DRIVER", "s3")
	t.Setenv("OPENPOST_S3_ENDPOINT", "https://r2.example.com")
	t.Setenv("OPENPOST_S3_REGION", "auto")
	t.Setenv("OPENPOST_S3_BUCKET", "openpost-media")
	t.Setenv("OPENPOST_S3_ACCESS_KEY_ID", "access-key")
	t.Setenv("OPENPOST_S3_SECRET_ACCESS_KEY", "secret-key")
	t.Setenv("OPENPOST_S3_PUBLIC_BASE_URL", "https://media.openpost.social")
	t.Setenv("OPENPOST_S3_FORCE_PATH_STYLE", "true")

	cfg := Load()

	require.Equal(t, EditionCloud, cfg.Edition)
	require.Equal(t, DatabaseDriverPostgres, cfg.DatabaseDriver)
	require.Equal(t, "postgres://openpost:secret@db.internal:5432/openpost?sslmode=require", cfg.DatabaseDSN())
	require.Equal(t, StorageDriverS3, cfg.StorageDriver)
	require.Equal(t, "https://r2.example.com", cfg.S3Endpoint)
	require.Equal(t, "auto", cfg.S3Region)
	require.Equal(t, "openpost-media", cfg.S3Bucket)
	require.Equal(t, "access-key", cfg.S3AccessKeyID)
	require.Equal(t, "secret-key", cfg.S3SecretAccessKey)
	require.Equal(t, "https://media.openpost.social", cfg.S3PublicBaseURL)
	require.True(t, cfg.S3ForcePathStyle)
	require.True(t, cfg.LegalAcceptanceRequired)
	require.Equal(t, "https://openpost.social/terms", cfg.TermsURL)
	require.Equal(t, legalpolicy.TermsVersion, cfg.TermsVersion)
	require.Equal(t, legalpolicy.PrivacyVersion, cfg.PrivacyVersion)
}

func TestLoadPasswordRecoveryConfiguration(t *testing.T) {
	t.Setenv("OPENPOST_APP_URL", "https://app.openpost.social")
	t.Setenv("OPENPOST_SMTP_HOST", "smtp.example.com")
	t.Setenv("OPENPOST_SMTP_PORT", "465")
	t.Setenv("OPENPOST_SMTP_USERNAME", "openpost")
	t.Setenv("OPENPOST_SMTP_PASSWORD_FILE", writeEnvFile(t, "smtp-password", "smtp-secret\n"))
	t.Setenv("OPENPOST_SMTP_FROM", "OpenPost <support@example.com>")
	t.Setenv("OPENPOST_SMTP_TLS_MODE", "tls")

	cfg := Load()

	require.Equal(t, "smtp.example.com", cfg.SMTPHost)
	require.Equal(t, 465, cfg.SMTPPort)
	require.Equal(t, "openpost", cfg.SMTPUsername)
	require.Equal(t, "smtp-secret", cfg.SMTPPassword)
	require.Equal(t, "OpenPost <support@example.com>", cfg.SMTPFrom)
	require.Equal(t, "OpenPost <support@example.com>", cfg.EmailFrom)
	require.Equal(t, "smtp", cfg.EmailProvider)
	require.Equal(t, "tls", cfg.SMTPTLSMode)
}

func TestLoadFirstPartyGoogleAndResendConfiguration(t *testing.T) {
	t.Setenv("OPENPOST_AUTH_GOOGLE_CLIENT_ID", "google-client")
	t.Setenv("OPENPOST_AUTH_GOOGLE_CLIENT_SECRET_FILE", writeEnvFile(t, "google-secret", "google-secret-value\n"))
	t.Setenv("OPENPOST_EMAIL_VERIFICATION_REQUIRED", "true")
	t.Setenv("OPENPOST_EMAIL_PROVIDER", "resend")
	t.Setenv("OPENPOST_EMAIL_FROM", "OpenPost <hello@example.com>")
	t.Setenv("OPENPOST_RESEND_API_KEY_FILE", writeEnvFile(t, "resend-key", "re_secret\n"))

	cfg := Load()

	require.Equal(t, "google-client", cfg.GoogleAuthClientID)
	require.Equal(t, "google-secret-value", cfg.GoogleAuthClientSecret)
	require.True(t, cfg.EmailVerificationRequired)
	require.Equal(t, "resend", cfg.EmailProvider)
	require.Equal(t, "OpenPost <hello@example.com>", cfg.EmailFrom)
	require.Equal(t, "re_secret", cfg.ResendAPIKey)
	require.NoError(t, cfg.ValidateRuntime())
}

func TestValidateRuntimeRejectsIncompleteFirstPartyAuthConfiguration(t *testing.T) {
	t.Setenv("OPENPOST_AUTH_GOOGLE_CLIENT_ID", "google-client")
	t.Setenv("OPENPOST_EMAIL_VERIFICATION_REQUIRED", "true")

	err := Load().ValidateRuntime()

	require.ErrorContains(t, err, "OPENPOST_AUTH_GOOGLE_CLIENT_ID and OPENPOST_AUTH_GOOGLE_CLIENT_SECRET")
}

func TestValidateRuntimeAllowsVerificationToBeEnabledBeforeEmailProviderSetup(t *testing.T) {
	t.Setenv("OPENPOST_EMAIL_VERIFICATION_REQUIRED", "true")

	cfg := Load()

	require.Empty(t, cfg.EmailProvider)
	require.NoError(t, cfg.ValidateRuntime())
}

func TestLoadSupportsFileBackedEnvValues(t *testing.T) {
	t.Setenv("OPENPOST_APP_URL", "https://app.openpost.social")
	t.Setenv("OPENPOST_EDITION_FILE", writeEnvFile(t, "edition", "cloud\n"))
	t.Setenv("OPENPOST_DATABASE_DRIVER_FILE", writeEnvFile(t, "database-driver", "postgres\n"))
	t.Setenv("OPENPOST_DATABASE_URL_FILE", writeEnvFile(t, "database-url", "postgres://openpost:secret@db.internal:5432/openpost?sslmode=require\n"))
	t.Setenv("OPENPOST_JWT_SECRET_FILE", writeEnvFile(t, "jwt-secret", "jwt-secret-with-more-than-thirty-two-characters\n"))
	t.Setenv("OPENPOST_ENCRYPTION_KEY_FILE", writeEnvFile(t, "encryption-key", "encryption-key-with-more-than-thirty-two-chars\n"))
	t.Setenv("OPENPOST_ENCRYPTION_KEY_ID_FILE", writeEnvFile(t, "encryption-key-id", "2026-08\n"))
	t.Setenv("OPENPOST_ENCRYPTION_PREVIOUS_KEYS_FILE", writeEnvFile(t, "previous-encryption-keys", `{"2026-07":"previous-encryption-key-with-more-than-thirty-two-chars"}`))
	t.Setenv("OPENPOST_MEDIA_SIGNING_KEY_FILE", writeEnvFile(t, "media-signing-key", "media-signing-key-with-more-than-thirty-two-chars\n"))
	t.Setenv("OPENPOST_STORAGE_DRIVER_FILE", writeEnvFile(t, "storage-driver", "s3\n"))
	t.Setenv("OPENPOST_S3_REGION_FILE", writeEnvFile(t, "s3-region", "auto\n"))
	t.Setenv("OPENPOST_S3_BUCKET_FILE", writeEnvFile(t, "s3-bucket", "openpost-media\n"))
	t.Setenv("OPENPOST_S3_ACCESS_KEY_ID_FILE", writeEnvFile(t, "s3-access-key-id", "access-key\n"))
	t.Setenv("OPENPOST_S3_SECRET_ACCESS_KEY_FILE", writeEnvFile(t, "s3-secret-access-key", "secret-key\n"))
	t.Setenv("OPENPOST_S3_PUBLIC_BASE_URL_FILE", writeEnvFile(t, "s3-public-base-url", "https://media.openpost.social/\n"))
	t.Setenv("OPENPOST_S3_FORCE_PATH_STYLE_FILE", writeEnvFile(t, "s3-force-path-style", "true\n"))
	t.Setenv("OPENPOST_PADDLE_API_KEY_FILE", writeEnvFile(t, "paddle-api-key", "pdl_sdbx_token\n"))
	t.Setenv("OPENPOST_PADDLE_ENVIRONMENT_FILE", writeEnvFile(t, "paddle-environment", "sandbox\n"))
	t.Setenv("OPENPOST_PADDLE_CLIENT_TOKEN_FILE", writeEnvFile(t, "paddle-client-token", "test_client_token\n"))
	t.Setenv("OPENPOST_PADDLE_WEBHOOK_SECRET_FILE", writeEnvFile(t, "paddle-webhook-secret", "pdl_webhook_secret\n"))
	t.Setenv("OPENPOST_PADDLE_CHECKOUT_RETURN_URL_FILE", writeEnvFile(t, "paddle-return-url", "https://app.openpost.social/checkout?status=success\n"))
	t.Setenv("OPENPOST_POSTHOG_PROJECT_TOKEN_FILE", writeEnvFile(t, "posthog-project-token", "phc_test\n"))
	t.Setenv("OPENPOST_POSTHOG_API_HOST_FILE", writeEnvFile(t, "posthog-api-host", "https://eu.i.posthog.com\n"))
	t.Setenv("OPENPOST_POSTHOG_BROWSER_HOST_FILE", writeEnvFile(t, "posthog-browser-host", "https://e.openpost.social\n"))
	t.Setenv("OPENPOST_POSTHOG_UI_HOST_FILE", writeEnvFile(t, "posthog-ui-host", "https://eu.posthog.com\n"))
	for _, plan := range []string{"STARTER", "FOUNDER", "PRO", "TEAM", "AGENCY"} {
		t.Setenv("OPENPOST_PADDLE_"+plan+"_MONTHLY_PRICE_ID_FILE", writeEnvFile(t, strings.ToLower(plan)+"-monthly", "pri_"+strings.ToLower(plan)+"_monthly\n"))
		t.Setenv("OPENPOST_PADDLE_"+plan+"_ANNUAL_PRICE_ID_FILE", writeEnvFile(t, strings.ToLower(plan)+"-annual", "pri_"+strings.ToLower(plan)+"_annual\n"))
	}
	t.Setenv("OPENPOST_SMTP_HOST_FILE", writeEnvFile(t, "smtp-host", "smtp.example.com\n"))
	t.Setenv("OPENPOST_SMTP_FROM_FILE", writeEnvFile(t, "smtp-from", "OpenPost <openpost@example.com>\n"))

	cfg := Load()

	require.Equal(t, EditionCloud, cfg.Edition)
	require.Equal(t, DatabaseDriverPostgres, cfg.DatabaseDriver)
	require.Equal(t, "postgres://openpost:secret@db.internal:5432/openpost?sslmode=require", cfg.DatabaseURL)
	require.Equal(t, "jwt-secret-with-more-than-thirty-two-characters", cfg.JWTSecret)
	require.Equal(t, "encryption-key-with-more-than-thirty-two-chars", cfg.EncryptionKey)
	require.Equal(t, "2026-08", cfg.EncryptionKeyID)
	require.Equal(t, map[string]string{"2026-07": "previous-encryption-key-with-more-than-thirty-two-chars"}, cfg.EncryptionPreviousKeys)
	require.Equal(t, "media-signing-key-with-more-than-thirty-two-chars", cfg.MediaSigningKey)
	require.Equal(t, StorageDriverS3, cfg.StorageDriver)
	require.Equal(t, "auto", cfg.S3Region)
	require.Equal(t, "openpost-media", cfg.S3Bucket)
	require.Equal(t, "access-key", cfg.S3AccessKeyID)
	require.Equal(t, "secret-key", cfg.S3SecretAccessKey)
	require.Equal(t, "https://media.openpost.social", cfg.S3PublicBaseURL)
	require.True(t, cfg.S3ForcePathStyle)
	require.Equal(t, "pdl_sdbx_token", cfg.PaddleAPIKey)
	require.Equal(t, "sandbox", cfg.PaddleEnvironment)
	require.Equal(t, "test_client_token", cfg.PaddleClientToken)
	require.Equal(t, "pdl_webhook_secret", cfg.PaddleWebhookSecret)
	require.Equal(t, "https://app.openpost.social/checkout?status=success", cfg.PaddleCheckoutReturnURL)
	require.Equal(t, "pri_starter_monthly", cfg.PaddleStarterMonthlyPriceID)
	require.Equal(t, "pri_agency_annual", cfg.PaddleAgencyAnnualPriceID)
	require.NoError(t, cfg.ValidateRuntime())
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

func TestPreviousEncryptionKeysRequireExplicitPrimaryKeyID(t *testing.T) {
	t.Setenv("OPENPOST_ENCRYPTION_PREVIOUS_KEYS", `{"previous":"previous-encryption-key-with-more-than-thirty-two-chars"}`)

	cfg := Load()
	err := cfg.ValidateRuntime()

	require.Empty(t, cfg.EncryptionKeyID)
	require.ErrorContains(t, err, "requires an explicit OPENPOST_ENCRYPTION_KEY_ID")
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

func TestMediaSigningKeyCanRemainStableAcrossEncryptionRotation(t *testing.T) {
	t.Setenv("OPENPOST_ENCRYPTION_KEY", "data-encryption-key-with-more-than-thirty-two-chars")

	cfg := Load()
	require.Equal(t, cfg.EncryptionKey, cfg.MediaSigningKey)

	t.Setenv("OPENPOST_MEDIA_SIGNING_KEY", "stable-media-signing-key-with-more-than-thirty-two-chars")
	cfg = Load()
	require.Equal(t, "stable-media-signing-key-with-more-than-thirty-two-chars", cfg.MediaSigningKey)
	require.NotEqual(t, cfg.EncryptionKey, cfg.MediaSigningKey)
}

func TestLoadFileBackedEnvPrefersInlineValue(t *testing.T) {
	t.Setenv("OPENPOST_APP_URL", "https://app.openpost.social")
	t.Setenv("OPENPOST_DATABASE_URL", "postgres://env.example/openpost")
	t.Setenv("OPENPOST_DATABASE_URL_FILE", writeEnvFile(t, "database-url", "postgres://file.example/openpost\n"))

	cfg := Load()

	require.Equal(t, "postgres://env.example/openpost", cfg.DatabaseURL)
}

func TestLoadFileBackedEnvSupportsLegacyAliases(t *testing.T) {
	t.Setenv("OPENPOST_APP_URL", "https://app.openpost.social")
	t.Setenv("DATABASE_URL_FILE", writeEnvFile(t, "database-url", "postgres://alias.example/openpost\n"))
	t.Setenv("JWT_SECRET_FILE", writeEnvFile(t, "jwt-secret", "legacy-jwt-secret-with-thirty-two-chars\n"))
	t.Setenv("ENCRYPTION_KEY_FILE", writeEnvFile(t, "encryption-key", "legacy-encryption-key-with-thirty-two\n"))

	cfg := Load()

	require.Equal(t, "postgres://alias.example/openpost", cfg.DatabaseURL)
	require.Equal(t, "legacy-jwt-secret-with-thirty-two-chars", cfg.JWTSecret)
	require.Equal(t, "legacy-encryption-key-with-thirty-two", cfg.EncryptionKey)
}

func TestLoadSupportsFileBackedAnalyticsSources(t *testing.T) {
	t.Setenv("OPENPOST_ANALYTICS_SOURCES_FILE", writeEnvFile(t, "analytics-sources", `[
		{"platform":"linkedin","base_url":"https://collector.example/openpost","bearer_token":"secret-token"}
	]`))

	cfg := Load()

	require.Len(t, cfg.AnalyticsSources, 1)
	require.Equal(t, "linkedin", cfg.AnalyticsSources[0].Platform)
	require.Equal(t, "https://collector.example/openpost", cfg.AnalyticsSources[0].BaseURL)
	require.Equal(t, "secret-token", cfg.AnalyticsSources[0].BearerToken)
}

func TestValidateRuntimeRejectsInvalidAnalyticsSourceConfiguration(t *testing.T) {
	cfg := &Config{
		Edition: EditionSelfHost,
		AnalyticsSources: []AnalyticsSourceConfig{
			{Platform: "linkedin", BaseURL: "collector.example", BearerToken: "token-a"},
			{Platform: "linkedin", BaseURL: "https://collector.example", BearerToken: "token-b"},
		},
	}

	err := cfg.ValidateRuntime()

	require.Error(t, err)
	require.ErrorContains(t, err, "OPENPOST_ANALYTICS_SOURCES")
	require.ErrorContains(t, err, "absolute http(s) URL")
	require.ErrorContains(t, err, "duplicate platform \"linkedin\"")
}

func TestValidateRuntimeRejectsMalformedAnalyticsSourcesJSON(t *testing.T) {
	t.Setenv("OPENPOST_ANALYTICS_SOURCES_FILE", writeEnvFile(t, "analytics-sources", `[{`))

	err := Load().ValidateRuntime()

	require.Error(t, err)
	require.ErrorContains(t, err, "OPENPOST_ANALYTICS_SOURCES")
	require.ErrorContains(t, err, "valid JSON")
}

func TestLoadSupportsFileBackedProviderApps(t *testing.T) {
	t.Setenv("OPENPOST_APP_URL", "https://app.openpost.social")
	t.Setenv("OPENPOST_PROVIDER_APPS_FILE", writeEnvFile(t, "provider-apps", `[
		{"provider":"youtube","client_id":"youtube-client","client_secret":"youtube-secret"}
	]`))

	cfg := Load()

	require.Len(t, cfg.ProviderApps, 3)
	require.Equal(t, "bluesky", cfg.ProviderApps[0].Provider)
	require.Equal(t, "discord", cfg.ProviderApps[1].Provider)
	require.Equal(t, "youtube", cfg.ProviderApps[2].Provider)
	require.Equal(t, "youtube-client", cfg.ProviderApps[2].ClientID)
	require.Equal(t, "youtube-secret", cfg.ProviderApps[2].ClientSecret)
	require.Equal(t, "https://app.openpost.social/api/v1/accounts/youtube/callback", cfg.ProviderApps[2].RedirectURI)
}

func TestLoadSelfHostedCORSOriginsIncludeLocalDevelopmentDefaults(t *testing.T) {
	t.Setenv("OPENPOST_APP_URL", "https://openpost.example.com/")
	t.Setenv("OPENPOST_EXTRA_CORS_ORIGINS", "https://admin.openpost.example.com/")

	cfg := Load()

	require.Equal(t, []string{
		"https://openpost.example.com",
		"http://localhost:5173",
		"http://localhost",
		"https://localhost",
		"https://admin.openpost.example.com",
	}, cfg.CORSOrigins)
}

func TestLoadCloudCORSOriginsExcludeLocalDevelopmentDefaults(t *testing.T) {
	t.Setenv("OPENPOST_APP_URL", "https://app.openpost.social")
	t.Setenv("OPENPOST_EDITION", "cloud")
	t.Setenv("OPENPOST_EXTRA_CORS_ORIGINS", "https://admin.openpost.social")

	cfg := Load()

	require.Equal(t, []string{
		"https://app.openpost.social",
		"https://admin.openpost.social",
	}, cfg.CORSOrigins)
	require.NotContains(t, cfg.CORSOrigins, "http://localhost:5173")
}

func TestValidateRuntimeAllowsSelfHostedLocalDefaults(t *testing.T) {
	cfg := &Config{
		Edition:        EditionSelfHost,
		DatabaseDriver: DatabaseDriverSQLite,
		DatabasePath:   "file:openpost.db?cache=shared&mode=rwc",
		StorageDriver:  StorageDriverLocal,
	}

	require.NoError(t, cfg.ValidateRuntime())
}

func TestValidateRuntimeAllowsCloudPostgresAndS3(t *testing.T) {
	cfg := validCloudRuntimeConfig()

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

func TestValidateRuntimeRejectsNegativeProviderCostConfiguration(t *testing.T) {
	cfg := validCloudRuntimeConfig()
	cfg.XMonthlyBudgetMicrousd = -1
	cfg.XPostCreateCostMicrousd = -1
	cfg.XPostCreateWithURLCostMicrousd = -1
	cfg.ProviderUsageRetentionDays = -1

	err := cfg.ValidateRuntime()

	require.Error(t, err)
	require.ErrorContains(t, err, "OPENPOST_X_MONTHLY_BUDGET_MICROUSD >= 0")
	require.ErrorContains(t, err, "OPENPOST_X_POST_CREATE_COST_MICROUSD >= 0")
	require.ErrorContains(t, err, "OPENPOST_X_POST_CREATE_WITH_URL_COST_MICROUSD >= 0")
	require.ErrorContains(t, err, "OPENPOST_PROVIDER_USAGE_RETENTION_DAYS >= 0")
}

func TestValidateRuntimeRejectsCloudMissingS3Primitives(t *testing.T) {
	cfg := validCloudRuntimeConfig()
	cfg.S3Region = ""
	cfg.S3Bucket = ""
	cfg.S3AccessKeyID = ""
	cfg.S3SecretAccessKey = ""
	cfg.S3PublicBaseURL = ""

	err := cfg.ValidateRuntime()

	require.Error(t, err)
	require.ErrorContains(t, err, "OPENPOST_S3_REGION")
	require.ErrorContains(t, err, "OPENPOST_S3_BUCKET")
	require.ErrorContains(t, err, "OPENPOST_S3_ACCESS_KEY_ID")
	require.ErrorContains(t, err, "OPENPOST_S3_SECRET_ACCESS_KEY")
	require.ErrorContains(t, err, "OPENPOST_S3_PUBLIC_BASE_URL")
}

func TestValidateRuntimeRejectsCloudMissingPaddlePrimitives(t *testing.T) {
	cfg := validCloudRuntimeConfig()
	cfg.PaddleAPIKey = ""
	cfg.PaddleEnvironment = ""
	cfg.PaddleClientToken = ""
	cfg.PaddleWebhookSecret = ""
	cfg.PaddleStarterMonthlyPriceID = ""
	cfg.PaddleStarterAnnualPriceID = ""
	cfg.PaddleFounderMonthlyPriceID = ""
	cfg.PaddleFounderAnnualPriceID = ""
	cfg.PaddleProMonthlyPriceID = ""
	cfg.PaddleProAnnualPriceID = ""
	cfg.PaddleTeamMonthlyPriceID = ""
	cfg.PaddleTeamAnnualPriceID = ""
	cfg.PaddleAgencyMonthlyPriceID = ""
	cfg.PaddleAgencyAnnualPriceID = ""

	err := cfg.ValidateRuntime()

	require.Error(t, err)
	require.ErrorContains(t, err, "OPENPOST_PADDLE_API_KEY")
	require.ErrorContains(t, err, "OPENPOST_PADDLE_ENVIRONMENT")
	require.ErrorContains(t, err, "OPENPOST_PADDLE_CLIENT_TOKEN")
	require.ErrorContains(t, err, "OPENPOST_PADDLE_WEBHOOK_SECRET")
	require.ErrorContains(t, err, "OPENPOST_PADDLE_STARTER_MONTHLY_PRICE_ID")
	require.ErrorContains(t, err, "OPENPOST_PADDLE_AGENCY_ANNUAL_PRICE_ID")
}

func TestValidateRuntimeRejectsCloudWildcardCORSOrigins(t *testing.T) {
	cfg := validCloudRuntimeConfig()
	cfg.CORSOrigins = []string{"https://app.openpost.social", "*"}

	err := cfg.ValidateRuntime()

	require.Error(t, err)
	require.ErrorContains(t, err, "OPENPOST_EXTRA_CORS_ORIGINS without wildcard origins")
}

func TestValidateRuntimeRejectsCloudWithoutAccountRecoveryAndLegalConfig(t *testing.T) {
	cfg := validCloudRuntimeConfig()
	cfg.LegalAcceptanceRequired = false
	cfg.TermsURL = ""
	cfg.PrivacyURL = ""
	cfg.TermsVersion = ""
	cfg.PrivacyVersion = ""
	cfg.SupportEmail = ""
	cfg.EmailProvider = ""
	cfg.EmailFrom = ""
	cfg.EmailVerificationRequired = false

	err := cfg.ValidateRuntime()

	require.Error(t, err)
	require.ErrorContains(t, err, "OPENPOST_LEGAL_ACCEPTANCE_REQUIRED=true")
	require.ErrorContains(t, err, "OPENPOST_TERMS_URL")
	require.ErrorContains(t, err, "OPENPOST_PRIVACY_URL")
	require.ErrorContains(t, err, "OPENPOST_EMAIL_VERIFICATION_REQUIRED=true")
}

func TestValidateRuntimeRejectsManagedPolicyVersionDrift(t *testing.T) {
	cfg := validCloudRuntimeConfig()
	cfg.TermsVersion = "2026-08-04"
	cfg.PrivacyVersion = "2026-08-04"

	err := cfg.ValidateRuntime()

	require.Error(t, err)
	require.ErrorContains(t, err, "OPENPOST_TERMS_VERSION="+legalpolicy.TermsVersion)
	require.ErrorContains(t, err, "OPENPOST_PRIVACY_VERSION="+legalpolicy.PrivacyVersion)
}

func TestValidateRuntimePinsManagedAIToZdrEUProvider(t *testing.T) {
	cfg := validCloudRuntimeConfig()
	cfg.OpenRouterAPIKey = "openrouter-key"
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
		S3PublicBaseURL:             "https://media.openpost.social",
		S3ForcePathStyle:            true,
		PaddleAPIKey:                "pdl_sdbx_token",
		PaddleEnvironment:           "sandbox",
		PaddleClientToken:           "test_client_token",
		PaddleWebhookSecret:         "pdl_webhook_secret",
		PaddleStarterMonthlyPriceID: "pri_starter_monthly",
		PaddleStarterAnnualPriceID:  "pri_starter_annual",
		PaddleFounderMonthlyPriceID: "pri_founder_monthly",
		PaddleFounderAnnualPriceID:  "pri_founder_annual",
		PaddleProMonthlyPriceID:     "pri_pro_monthly",
		PaddleProAnnualPriceID:      "pri_pro_annual",
		PaddleTeamMonthlyPriceID:    "pri_team_monthly",
		PaddleTeamAnnualPriceID:     "pri_team_annual",
		PaddleAgencyMonthlyPriceID:  "pri_agency_monthly",
		PaddleAgencyAnnualPriceID:   "pri_agency_annual",
		LegalAcceptanceRequired:     true,
		TermsURL:                    "https://openpost.social/terms",
		PrivacyURL:                  "https://openpost.social/privacy",
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

func TestLoadDisablesTelemetryByDefaultForSelfHostedInstances(t *testing.T) {
	cfg := Load()
	require.Equal(t, EditionSelfHost, cfg.Edition)
	require.False(t, cfg.TelemetryEnabled)
	require.Equal(t, "selfhost", cfg.TelemetryEnvironment)
}

func TestLoadEnablesTelemetryByDefaultForCloudInstances(t *testing.T) {
	t.Setenv("OPENPOST_EDITION", EditionCloud)
	t.Setenv("OPENPOST_POSTHOG_API_HOST", "https://eu.i.posthog.com/")
	cfg := Load()
	require.True(t, cfg.TelemetryEnabled)
	require.Equal(t, "https://eu.i.posthog.com", cfg.PostHogAPIHost)
	require.Equal(t, "https://cool.openpost.social", cfg.PostHogBrowserHost)
	require.Equal(t, "https://eu.posthog.com", cfg.PostHogUIHost)
	require.Equal(t, "production", cfg.TelemetryEnvironment)
}

func TestLoadPaddlePrimitives(t *testing.T) {
	t.Setenv("OPENPOST_APP_URL", "https://app.openpost.social")
	t.Setenv("OPENPOST_APP_E2E_HOSTED_SIGNUP", "true")
	t.Setenv("OPENPOST_APP_E2E_DELIVERY_PROJECTION", "true")
	t.Setenv("OPENPOST_PADDLE_API_KEY", "pdl_sdbx_token")
	t.Setenv("OPENPOST_PADDLE_API_BASE_URL", "http://127.0.0.1:18182/paddle/")
	t.Setenv("OPENPOST_PADDLE_ENVIRONMENT", "sandbox")
	t.Setenv("OPENPOST_PADDLE_CLIENT_TOKEN", "test_client_token")
	t.Setenv("OPENPOST_PADDLE_WEBHOOK_SECRET", "pdl_webhook_secret")
	t.Setenv("OPENPOST_PADDLE_CHECKOUT_RETURN_URL", "https://app.openpost.social/checkout?status=success")
	for _, plan := range []string{"STARTER", "FOUNDER", "PRO", "TEAM", "AGENCY"} {
		t.Setenv("OPENPOST_PADDLE_"+plan+"_MONTHLY_PRICE_ID", "pri_"+strings.ToLower(plan)+"_monthly")
		t.Setenv("OPENPOST_PADDLE_"+plan+"_ANNUAL_PRICE_ID", "pri_"+strings.ToLower(plan)+"_annual")
	}

	cfg := Load()

	require.True(t, cfg.AppE2EHostedSignup)
	require.True(t, cfg.AppE2EDeliveryProjection)
	require.Equal(t, "pdl_sdbx_token", cfg.PaddleAPIKey)
	require.Equal(t, "http://127.0.0.1:18182/paddle", cfg.PaddleAPIBaseURL)
	require.Equal(t, "sandbox", cfg.PaddleEnvironment)
	require.Equal(t, "test_client_token", cfg.PaddleClientToken)
	require.Equal(t, "pdl_webhook_secret", cfg.PaddleWebhookSecret)
	require.Equal(t, "https://app.openpost.social/checkout?status=success", cfg.PaddleCheckoutReturnURL)
	require.Equal(t, "pri_starter_monthly", cfg.PaddleStarterMonthlyPriceID)
	require.Equal(t, "pri_agency_annual", cfg.PaddleAgencyAnnualPriceID)
}

func TestLoadBuildsProviderAppRegistryFromLegacyEnv(t *testing.T) {
	t.Setenv("OPENPOST_APP_URL", "https://app.openpost.social")
	t.Setenv("X_CLIENT_ID", "x-client")
	t.Setenv("X_CLIENT_SECRET", "x-secret")
	t.Setenv("LINKEDIN_CLIENT_ID", "linkedin-client")
	t.Setenv("LINKEDIN_CLIENT_SECRET", "linkedin-secret")
	t.Setenv("THREADS_CLIENT_ID", "threads-client")
	t.Setenv("THREADS_CLIENT_SECRET", "threads-secret")
	t.Setenv("MASTODON_SERVERS", `[{"name":"Personal","client_id":"masto-client","client_secret":"masto-secret","instance_url":"https://masto.pt/"}]`)

	cfg := Load()

	require.Len(t, cfg.ProviderApps, 6)
	require.Equal(t, "bluesky", cfg.ProviderApps[0].Provider)
	require.Equal(t, "discord", cfg.ProviderApps[1].Provider)
	require.Equal(t, "x", cfg.ProviderApps[2].Provider)
	require.Equal(t, "https://app.openpost.social/api/v1/accounts/x/callback", cfg.ProviderApps[2].RedirectURI)
	require.Equal(t, "mastodon", cfg.ProviderApps[3].Provider)
	require.Equal(t, "https://masto.pt", cfg.ProviderApps[3].InstanceURL)
	require.Equal(t, "linkedin", cfg.ProviderApps[4].Provider)
	require.Equal(t, "https://app.openpost.social/api/v1/accounts/linkedin/callback", cfg.ProviderApps[4].RedirectURI)
	require.Equal(t, "threads", cfg.ProviderApps[5].Provider)
	require.Equal(t, "https://app.openpost.social/api/v1/accounts/threads/callback", cfg.ProviderApps[5].RedirectURI)
}

func TestLoadParsesProviderEnvironmentKillSwitches(t *testing.T) {
	t.Setenv("OPENPOST_DISABLED_PROVIDERS", "youtube, tiktok\nthreads")
	t.Setenv("OPENPOST_PROVIDER_CERTIFICATION_ENFORCED", "true")

	cfg := Load()

	require.Equal(t, []string{"youtube", "tiktok", "threads"}, cfg.DisabledProviders)
	require.True(t, cfg.ProviderCertificationEnforced)
}

func TestLoadDoesNotEnforceProviderCertificationByDefault(t *testing.T) {
	require.False(t, Load().ProviderCertificationEnforced)
}

func TestLoadMergesStructuredProviderApps(t *testing.T) {
	t.Setenv("OPENPOST_APP_URL", "https://app.openpost.social")
	t.Setenv("X_CLIENT_ID", "legacy-x-client")
	t.Setenv("X_CLIENT_SECRET", "legacy-x-secret")
	t.Setenv("OPENPOST_PROVIDER_APPS", `[
		{"provider":"x","client_id":"cloud-x-client","client_secret":"cloud-x-secret"},
		{"provider":"mastodon","name":"Community","client_id":"masto-client","client_secret":"masto-secret","instance_url":"https://community.example"},
		{"provider":"facebook","client_id":"facebook-client","client_secret":"facebook-secret"},
		{"provider":"instagram","client_id":"instagram-client","client_secret":"instagram-secret"},
		{"provider":"tiktok","client_id":"tiktok-client","client_secret":"tiktok-secret"},
		{"provider":"youtube","client_id":"youtube-client","client_secret":"youtube-secret"}
	]`)

	cfg := Load()

	require.Len(t, cfg.ProviderApps, 8)
	require.Equal(t, "bluesky", cfg.ProviderApps[0].Provider)
	require.Equal(t, "discord", cfg.ProviderApps[1].Provider)
	require.Equal(t, "cloud-x-client", cfg.ProviderApps[2].ClientID)
	require.Equal(t, "https://app.openpost.social/api/v1/accounts/x/callback", cfg.ProviderApps[2].RedirectURI)
	require.Equal(t, "mastodon", cfg.ProviderApps[3].Provider)
	require.Equal(t, "urn:ietf:wg:oauth:2.0:oob", cfg.ProviderApps[3].RedirectURI)
	require.Equal(t, "facebook", cfg.ProviderApps[4].Provider)
	require.Equal(t, "https://app.openpost.social/api/v1/accounts/facebook/callback", cfg.ProviderApps[4].RedirectURI)
	require.Equal(t, "instagram", cfg.ProviderApps[5].Provider)
	require.Equal(t, "https://app.openpost.social/api/v1/accounts/instagram/callback", cfg.ProviderApps[5].RedirectURI)
	require.Equal(t, "tiktok", cfg.ProviderApps[6].Provider)
	require.Equal(t, "https://app.openpost.social/api/v1/accounts/tiktok/callback", cfg.ProviderApps[6].RedirectURI)
	require.Equal(t, "youtube", cfg.ProviderApps[7].Provider)
	require.Equal(t, "https://app.openpost.social/api/v1/accounts/youtube/callback", cfg.ProviderApps[7].RedirectURI)
}

func TestLoadInvalidProductionPrimitiveEnumsFallback(t *testing.T) {
	t.Setenv("OPENPOST_APP_URL", "https://openpost.example.com")
	t.Setenv("OPENPOST_EDITION", "enterprise")
	t.Setenv("OPENPOST_DATABASE_DRIVER", "mysql")
	t.Setenv("OPENPOST_STORAGE_DRIVER", "gcs")

	cfg := Load()

	require.Equal(t, EditionSelfHost, cfg.Edition)
	require.Equal(t, DatabaseDriverSQLite, cfg.DatabaseDriver)
	require.Equal(t, StorageDriverLocal, cfg.StorageDriver)
}

func TestDatabaseDSNFallsBackToDatabasePathForPostgres(t *testing.T) {
	cfg := &Config{
		DatabaseDriver: DatabaseDriverPostgres,
		DatabasePath:   "postgres://legacy/path",
	}

	require.Equal(t, "postgres://legacy/path", cfg.DatabaseDSN())
}

// TestOauthRedirectFromFrontendPreferesExplicitEnv pins the contract
// that an operator-set env var (or its alias) wins over the derived
// default from FrontendURL. This matters for users who proxy their
// installation under a path or behind a hostname the binary can't see
// from OPENPOST_APP_URL.
func TestOauthRedirectFromFrontendPreferesExplicitEnv(t *testing.T) {
	t.Setenv("X_REDIRECT_URI", "https://proxy.example.com/api/v1/accounts/x/callback")
	t.Setenv("TWITTER_REDIRECT_URI", "")
	got := oauthRedirectFromFrontend("X_REDIRECT_URI", "TWITTER_REDIRECT_URI", "https://openpost.example.com", "/api/v1/accounts/x/callback")
	require.Equal(t, "https://proxy.example.com/api/v1/accounts/x/callback", got)
}

// TestOauthRedirectFromFrontendFallsBackToAlias covers the case where
// the primary env var isn't set but the legacy alias is.
func TestOauthRedirectFromFrontendFallsBackToAlias(t *testing.T) {
	t.Setenv("X_REDIRECT_URI", "")
	t.Setenv("TWITTER_REDIRECT_URI", "https://proxy.example.com/api/v1/accounts/x/callback")
	got := oauthRedirectFromFrontend("X_REDIRECT_URI", "TWITTER_REDIRECT_URI", "https://openpost.example.com", "/api/v1/accounts/x/callback")
	require.Equal(t, "https://proxy.example.com/api/v1/accounts/x/callback", got)
}

// TestOauthRedirectFromFrontendDerivesFromFrontendURL is the regression
// test for the operator footgun (P0.3): when nothing is set, the
// default is derived from FrontendURL rather than hardcoded to
// localhost:8080 (which would 404 in production).
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

// TestOauthRedirectFromFrontendNoAlias covers the LinkedIn / Threads
// case where there is no legacy alias. Passing an empty alias should
// not cause a panic and should derive from FrontendURL.
func TestOauthRedirectFromFrontendNoAlias(t *testing.T) {
	t.Setenv("THREADS_REDIRECT_URI", "")
	got := oauthRedirectFromFrontend("THREADS_REDIRECT_URI", "", "https://openpost.example.com", "/api/v1/accounts/threads/callback")
	require.Equal(t, "https://openpost.example.com/api/v1/accounts/threads/callback", got)
}

// TestOauthRedirectFromFrontendEmptyFrontendDerivesPathOnly documents
// the (unusual) edge case where FrontendURL is empty. The result is
// still well-formed (a path-only URL), but the operator probably wants
// to set OPENPOST_APP_URL.
func TestOauthRedirectFromFrontendEmptyFrontendDerivesPathOnly(t *testing.T) {
	t.Setenv("X_REDIRECT_URI", "")
	t.Setenv("TWITTER_REDIRECT_URI", "")
	got := oauthRedirectFromFrontend("X_REDIRECT_URI", "TWITTER_REDIRECT_URI", "", "/api/v1/accounts/x/callback")
	require.Equal(t, "/api/v1/accounts/x/callback", got)
}

func TestWarnOnPlaceholderURLOnlyWarnsForImplicitDefault(t *testing.T) {
	var output bytes.Buffer
	previousOutput := log.Writer()
	log.SetOutput(&output)
	t.Cleanup(func() { log.SetOutput(previousOutput) })

	t.Setenv("OPENPOST_APP_URL", "")
	t.Setenv("OPENPOST_FRONTEND_URL", "")
	warnOnPlaceholderURL(&Config{FrontendURL: "http://localhost:8080"})
	require.Contains(t, output.String(), "WARNING: OPENPOST_APP_URL is not set")
	require.Contains(t, output.String(), "http://localhost:8080")

	output.Reset()
	t.Setenv("OPENPOST_APP_URL", "https://openpost.example.com")
	warnOnPlaceholderURL(&Config{FrontendURL: "https://openpost.example.com"})
	require.Empty(t, output.String())
}

func TestValidateBootstrapSecretsRejectsTrackedExamplePlaceholdersWithoutEchoingThem(t *testing.T) {
	jwtPlaceholder := "change-this-jwt-secret-min-32-chars"
	encryptionPlaceholder := "change-this-encryption-key-32chars"
	documentedPlaceholder := "replace-with-a-random-secret-at-least-32-characters-long"

	err := validateBootstrapSecrets(jwtPlaceholder, strings.Repeat("e", minSecretLength))
	require.ErrorContains(t, err, "OPENPOST_JWT_SECRET")
	require.ErrorContains(t, err, "public example placeholder")
	require.NotContains(t, err.Error(), jwtPlaceholder)

	err = validateBootstrapSecrets(strings.Repeat("j", minSecretLength), encryptionPlaceholder)
	require.ErrorContains(t, err, "OPENPOST_ENCRYPTION_KEY")
	require.ErrorContains(t, err, "public example placeholder")
	require.NotContains(t, err.Error(), encryptionPlaceholder)

	for _, secrets := range []struct {
		name       string
		jwt        string
		encryption string
	}{
		{name: "JWT", jwt: documentedPlaceholder, encryption: strings.Repeat("e", minSecretLength)},
		{name: "encryption", jwt: strings.Repeat("j", minSecretLength), encryption: documentedPlaceholder},
	} {
		t.Run("documented "+secrets.name+" placeholder", func(t *testing.T) {
			err := validateBootstrapSecrets(secrets.jwt, secrets.encryption)
			require.ErrorContains(t, err, "public example placeholder")
			require.NotContains(t, err.Error(), documentedPlaceholder)
		})
	}
}

func TestValidateBootstrapSecretsAcceptsIndependentGeneratedValues(t *testing.T) {
	require.NoError(t, validateBootstrapSecrets(
		"3daf47b368ac4e64b2791a807b32fc05",
		"b8d7b76210b84570bfa504515e240f66",
	))
}

func TestBootstrapAndDataPlaneSettingsRemainDeploymentOwned(t *testing.T) {
	for _, key := range []string{
		"OPENPOST_JWT_SECRET",
		"OPENPOST_ENCRYPTION_KEY",
		"OPENPOST_DATABASE_DRIVER",
		"OPENPOST_DATABASE_URL",
		"OPENPOST_STORAGE_DRIVER",
		"OPENPOST_S3_ACCESS_KEY_ID",
		"OPENPOST_S3_SECRET_ACCESS_KEY",
	} {
		_, managed := ManagedSettingDefinitionFor(key)
		require.Falsef(t, managed, "%s must not become a database-managed setting", key)
	}
}

func writeEnvFile(t *testing.T, name, value string) string {
	t.Helper()

	path := filepath.Join(t.TempDir(), name)
	require.NoError(t, os.WriteFile(path, []byte(value), 0o600))
	return path
}
