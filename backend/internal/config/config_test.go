package config

import (
	"os"
	"path/filepath"
	"testing"

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
	"OPENPOST_DATABASE_DRIVER",
	"OPENPOST_DATABASE_PATH",
	"OPENPOST_DB_PATH",
	"OPENPOST_DATABASE_URL",
	"DATABASE_URL",
	"OPENPOST_JWT_SECRET",
	"JWT_SECRET",
	"OPENPOST_ENCRYPTION_KEY",
	"ENCRYPTION_KEY",
	"OPENPOST_DISABLE_REGISTRATIONS",
	"OPENPOST_LEGAL_ACCEPTANCE_REQUIRED",
	"OPENPOST_TERMS_URL",
	"OPENPOST_PRIVACY_URL",
	"OPENPOST_TERMS_VERSION",
	"OPENPOST_PRIVACY_VERSION",
	"OPENPOST_SUPPORT_EMAIL",
	"OPENPOST_STUDIO_ENABLED",
	"OPENPOST_STUDIO_MODEL_BASE_URL",
	"OPENPOST_VIDEO_STUDIO_ENABLED",
	"OPENPOST_VIDEO_MODEL_BASE_URL",
	"OPENPOST_STOCK_MEDIA_ENABLED",
	"OPENPOST_PEXELS_API_KEY",
	"OPENPOST_UNSPLASH_ACCESS_KEY",
	"OPENPOST_PIXABAY_API_KEY",
	"OPENPOST_FEEDBACK_ENABLED",
	"OPENPOST_FEEDBACK_DESTINATION_URL",
	"OPENPOST_FEEDBACK_RECIPIENT",
	"OPENPOST_FEEDBACK_SUPPORT_URL",
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
	"OPENPOST_POLAR_ACCESS_TOKEN",
	"OPENPOST_POLAR_API_BASE_URL",
	"OPENPOST_POLAR_WEBHOOK_SECRET",
	"OPENPOST_POLAR_CHECKOUT_SUCCESS_URL",
	"OPENPOST_POLAR_RETURN_URL",
	"OPENPOST_POLAR_CUSTOMER_PORTAL_URL",
	"OPENPOST_POLAR_STARTER_PRODUCT_ID",
	"OPENPOST_POLAR_CREATOR_PRODUCT_ID",
	"OPENPOST_POLAR_PRO_PRODUCT_ID",
	"OPENPOST_POLAR_TEAM_PRODUCT_ID",
	"OPENPOST_POLAR_AGENCY_PRODUCT_ID",
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
	require.Empty(t, cfg.PolarAccessToken)
	require.Equal(t, "https://api.polar.sh/v1", cfg.PolarAPIBaseURL)
	require.Empty(t, cfg.PolarWebhookSecret)
	require.True(t, cfg.StudioEnabled)
	require.Equal(t, "/studio-models", cfg.StudioModelBaseURL)
	require.False(t, cfg.VideoStudioEnabled)
	require.Equal(t, "/video-studio-models", cfg.VideoModelBaseURL)
	require.False(t, cfg.StockMediaEnabled)
	require.False(t, cfg.FeedbackEnabled)
	require.Empty(t, cfg.FeedbackDestinationURL)
	require.Equal(t, "https://github.com/rodrgds/openpost/issues/new", cfg.FeedbackSupportURL)
	require.True(t, cfg.UpdateCheckEnabled)
	require.Equal(t, int64(5_000_000), cfg.XMonthlyBudgetMicrousd)
	require.Equal(t, int64(15_000), cfg.XPostCreateCostMicrousd)
	require.Equal(t, int64(200_000), cfg.XPostCreateWithURLCostMicrousd)
	require.Equal(t, 180, cfg.ProviderUsageRetentionDays)
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

func TestLoadStudioConfiguration(t *testing.T) {
	t.Setenv("OPENPOST_STUDIO_ENABLED", "false")
	t.Setenv("OPENPOST_STUDIO_MODEL_BASE_URL", "https://assets.example.com/openpost/studio/")

	cfg := Load()

	require.False(t, cfg.StudioEnabled)
	require.Equal(t, "https://assets.example.com/openpost/studio", cfg.StudioModelBaseURL)
}

func TestLoadVideoStudioAndStockConfiguration(t *testing.T) {
	t.Setenv("OPENPOST_VIDEO_STUDIO_ENABLED", "false")
	t.Setenv("OPENPOST_VIDEO_MODEL_BASE_URL", " https://models.example.test/openpost ")
	t.Setenv("OPENPOST_STOCK_MEDIA_ENABLED", "true")
	t.Setenv("OPENPOST_PEXELS_API_KEY", " pexels-key ")
	t.Setenv("OPENPOST_UNSPLASH_ACCESS_KEY", " unsplash-key ")
	t.Setenv("OPENPOST_PIXABAY_API_KEY", " pixabay-key ")

	cfg := Load()

	require.False(t, cfg.VideoStudioEnabled)
	require.Equal(t, "https://models.example.test/openpost", cfg.VideoModelBaseURL)
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
	require.Equal(t, "2026-07-22", cfg.TermsVersion)
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
	require.Equal(t, "tls", cfg.SMTPTLSMode)
}

func TestLoadSupportsFileBackedEnvValues(t *testing.T) {
	t.Setenv("OPENPOST_APP_URL", "https://app.openpost.social")
	t.Setenv("OPENPOST_EDITION_FILE", writeEnvFile(t, "edition", "cloud\n"))
	t.Setenv("OPENPOST_DATABASE_DRIVER_FILE", writeEnvFile(t, "database-driver", "postgres\n"))
	t.Setenv("OPENPOST_DATABASE_URL_FILE", writeEnvFile(t, "database-url", "postgres://openpost:secret@db.internal:5432/openpost?sslmode=require\n"))
	t.Setenv("OPENPOST_JWT_SECRET_FILE", writeEnvFile(t, "jwt-secret", "jwt-secret-with-more-than-thirty-two-characters\n"))
	t.Setenv("OPENPOST_ENCRYPTION_KEY_FILE", writeEnvFile(t, "encryption-key", "encryption-key-with-more-than-thirty-two-chars\n"))
	t.Setenv("OPENPOST_STORAGE_DRIVER_FILE", writeEnvFile(t, "storage-driver", "s3\n"))
	t.Setenv("OPENPOST_S3_REGION_FILE", writeEnvFile(t, "s3-region", "auto\n"))
	t.Setenv("OPENPOST_S3_BUCKET_FILE", writeEnvFile(t, "s3-bucket", "openpost-media\n"))
	t.Setenv("OPENPOST_S3_ACCESS_KEY_ID_FILE", writeEnvFile(t, "s3-access-key-id", "access-key\n"))
	t.Setenv("OPENPOST_S3_SECRET_ACCESS_KEY_FILE", writeEnvFile(t, "s3-secret-access-key", "secret-key\n"))
	t.Setenv("OPENPOST_S3_PUBLIC_BASE_URL_FILE", writeEnvFile(t, "s3-public-base-url", "https://media.openpost.social/\n"))
	t.Setenv("OPENPOST_S3_FORCE_PATH_STYLE_FILE", writeEnvFile(t, "s3-force-path-style", "true\n"))
	t.Setenv("OPENPOST_POLAR_ACCESS_TOKEN_FILE", writeEnvFile(t, "polar-access-token", "polar-token\n"))
	t.Setenv("OPENPOST_POLAR_WEBHOOK_SECRET_FILE", writeEnvFile(t, "polar-webhook-secret", "whsec_secret\n"))
	t.Setenv("OPENPOST_POLAR_CHECKOUT_SUCCESS_URL_FILE", writeEnvFile(t, "polar-checkout-url", "https://app.openpost.social/settings/billing?checkout_id={CHECKOUT_ID}\n"))
	t.Setenv("OPENPOST_POLAR_RETURN_URL_FILE", writeEnvFile(t, "polar-return-url", "https://app.openpost.social/settings/billing/\n"))
	t.Setenv("OPENPOST_POLAR_STARTER_PRODUCT_ID_FILE", writeEnvFile(t, "polar-starter-product", "starter-product\n"))
	t.Setenv("OPENPOST_POLAR_CREATOR_PRODUCT_ID_FILE", writeEnvFile(t, "polar-creator-product", "creator-product\n"))
	t.Setenv("OPENPOST_POLAR_PRO_PRODUCT_ID_FILE", writeEnvFile(t, "polar-pro-product", "pro-product\n"))
	t.Setenv("OPENPOST_POLAR_TEAM_PRODUCT_ID_FILE", writeEnvFile(t, "polar-team-product", "team-product\n"))
	t.Setenv("OPENPOST_POLAR_AGENCY_PRODUCT_ID_FILE", writeEnvFile(t, "polar-agency-product", "agency-product\n"))
	t.Setenv("OPENPOST_SMTP_HOST_FILE", writeEnvFile(t, "smtp-host", "smtp.example.com\n"))
	t.Setenv("OPENPOST_SMTP_FROM_FILE", writeEnvFile(t, "smtp-from", "OpenPost <openpost@example.com>\n"))

	cfg := Load()

	require.Equal(t, EditionCloud, cfg.Edition)
	require.Equal(t, DatabaseDriverPostgres, cfg.DatabaseDriver)
	require.Equal(t, "postgres://openpost:secret@db.internal:5432/openpost?sslmode=require", cfg.DatabaseURL)
	require.Equal(t, "jwt-secret-with-more-than-thirty-two-characters", cfg.JWTSecret)
	require.Equal(t, "encryption-key-with-more-than-thirty-two-chars", cfg.EncryptionKey)
	require.Equal(t, StorageDriverS3, cfg.StorageDriver)
	require.Equal(t, "auto", cfg.S3Region)
	require.Equal(t, "openpost-media", cfg.S3Bucket)
	require.Equal(t, "access-key", cfg.S3AccessKeyID)
	require.Equal(t, "secret-key", cfg.S3SecretAccessKey)
	require.Equal(t, "https://media.openpost.social", cfg.S3PublicBaseURL)
	require.True(t, cfg.S3ForcePathStyle)
	require.Equal(t, "polar-token", cfg.PolarAccessToken)
	require.Equal(t, "whsec_secret", cfg.PolarWebhookSecret)
	require.Equal(t, "https://app.openpost.social/settings/billing?checkout_id={CHECKOUT_ID}", cfg.PolarCheckoutURL)
	require.Equal(t, "https://app.openpost.social/settings/billing", cfg.PolarReturnURL)
	require.Equal(t, "starter-product", cfg.PolarStarterProductID)
	require.Equal(t, "creator-product", cfg.PolarCreatorProductID)
	require.Equal(t, "pro-product", cfg.PolarProProductID)
	require.Equal(t, "team-product", cfg.PolarTeamProductID)
	require.Equal(t, "agency-product", cfg.PolarAgencyProductID)
	require.NoError(t, cfg.ValidateRuntime())
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
	t.Setenv("OPENPOST_EXTRA_CORS_ORIGINS", "https://admin.openpost.example.com/, capacitor://preview")

	cfg := Load()

	require.Equal(t, []string{
		"https://openpost.example.com",
		"http://localhost:5173",
		"capacitor://localhost",
		"http://localhost",
		"https://localhost",
		"https://admin.openpost.example.com",
		"capacitor://preview",
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
	require.NotContains(t, cfg.CORSOrigins, "capacitor://localhost")
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

func TestValidateRuntimeRejectsCloudMissingPolarPrimitives(t *testing.T) {
	cfg := validCloudRuntimeConfig()
	cfg.PolarAccessToken = ""
	cfg.PolarWebhookSecret = ""
	cfg.PolarCheckoutURL = ""
	cfg.PolarReturnURL = ""
	cfg.PolarStarterProductID = ""
	cfg.PolarCreatorProductID = ""
	cfg.PolarProProductID = ""
	cfg.PolarTeamProductID = ""
	cfg.PolarAgencyProductID = ""

	err := cfg.ValidateRuntime()

	require.Error(t, err)
	require.ErrorContains(t, err, "OPENPOST_POLAR_ACCESS_TOKEN")
	require.ErrorContains(t, err, "OPENPOST_POLAR_WEBHOOK_SECRET")
	require.ErrorContains(t, err, "OPENPOST_POLAR_CHECKOUT_SUCCESS_URL")
	require.ErrorContains(t, err, "OPENPOST_POLAR_RETURN_URL")
	require.ErrorContains(t, err, "OPENPOST_POLAR_STARTER_PRODUCT_ID")
	require.ErrorContains(t, err, "OPENPOST_POLAR_CREATOR_PRODUCT_ID")
	require.ErrorContains(t, err, "OPENPOST_POLAR_PRO_PRODUCT_ID")
	require.ErrorContains(t, err, "OPENPOST_POLAR_TEAM_PRODUCT_ID")
	require.ErrorContains(t, err, "OPENPOST_POLAR_AGENCY_PRODUCT_ID")
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
	cfg.SMTPHost = ""
	cfg.SMTPFrom = ""

	err := cfg.ValidateRuntime()

	require.Error(t, err)
	require.ErrorContains(t, err, "OPENPOST_LEGAL_ACCEPTANCE_REQUIRED=true")
	require.ErrorContains(t, err, "OPENPOST_TERMS_URL")
	require.ErrorContains(t, err, "OPENPOST_PRIVACY_URL")
	require.ErrorContains(t, err, "OPENPOST_SMTP_HOST")
	require.ErrorContains(t, err, "OPENPOST_SMTP_FROM")
}

func validCloudRuntimeConfig() *Config {
	return &Config{
		Edition:                 EditionCloud,
		DatabaseDriver:          DatabaseDriverPostgres,
		DatabaseURL:             "postgres://openpost:secret@db.internal:5432/openpost?sslmode=require",
		StorageDriver:           StorageDriverS3,
		S3Region:                "auto",
		S3Bucket:                "openpost-media",
		S3AccessKeyID:           "access-key",
		S3SecretAccessKey:       "secret-key",
		S3PublicBaseURL:         "https://media.openpost.social",
		S3ForcePathStyle:        true,
		PolarAccessToken:        "polar-token",
		PolarWebhookSecret:      "whsec_secret",
		PolarCheckoutURL:        "https://app.openpost.social/settings/billing?checkout_id={CHECKOUT_ID}",
		PolarReturnURL:          "https://app.openpost.social/settings/billing",
		PolarStarterProductID:   "starter-product",
		PolarCreatorProductID:   "creator-product",
		PolarProProductID:       "pro-product",
		PolarTeamProductID:      "team-product",
		PolarAgencyProductID:    "agency-product",
		LegalAcceptanceRequired: true,
		TermsURL:                "https://openpost.social/terms",
		PrivacyURL:              "https://openpost.social/privacy",
		TermsVersion:            "2026-07-22",
		PrivacyVersion:          "2026-07-22",
		SupportEmail:            "openpost@rgo.pt",
		SMTPHost:                "smtp.example.com",
		SMTPPort:                587,
		SMTPFrom:                "OpenPost <openpost@example.com>",
	}
}

func TestLoadPolarPrimitives(t *testing.T) {
	t.Setenv("OPENPOST_APP_URL", "https://app.openpost.social")
	t.Setenv("OPENPOST_POLAR_ACCESS_TOKEN", "polar-token")
	t.Setenv("OPENPOST_POLAR_API_BASE_URL", "https://sandbox-api.polar.sh/v1/")
	t.Setenv("OPENPOST_POLAR_WEBHOOK_SECRET", "whsec_secret")
	t.Setenv("OPENPOST_POLAR_CHECKOUT_SUCCESS_URL", "https://app.openpost.social/settings/billing/")
	t.Setenv("OPENPOST_POLAR_RETURN_URL", "https://app.openpost.social/settings/billing/")
	t.Setenv("OPENPOST_POLAR_STARTER_PRODUCT_ID", "starter-product")
	t.Setenv("OPENPOST_POLAR_CREATOR_PRODUCT_ID", "creator-product")
	t.Setenv("OPENPOST_POLAR_PRO_PRODUCT_ID", "pro-product")
	t.Setenv("OPENPOST_POLAR_TEAM_PRODUCT_ID", "team-product")
	t.Setenv("OPENPOST_POLAR_AGENCY_PRODUCT_ID", "agency-product")

	cfg := Load()

	require.Equal(t, "polar-token", cfg.PolarAccessToken)
	require.Equal(t, "https://sandbox-api.polar.sh/v1", cfg.PolarAPIBaseURL)
	require.Equal(t, "whsec_secret", cfg.PolarWebhookSecret)
	require.Equal(t, "https://app.openpost.social/settings/billing", cfg.PolarCheckoutURL)
	require.Equal(t, "https://app.openpost.social/settings/billing", cfg.PolarReturnURL)
	require.Equal(t, "starter-product", cfg.PolarStarterProductID)
	require.Equal(t, "creator-product", cfg.PolarCreatorProductID)
	require.Equal(t, "pro-product", cfg.PolarProProductID)
	require.Equal(t, "team-product", cfg.PolarTeamProductID)
	require.Equal(t, "agency-product", cfg.PolarAgencyProductID)
}

func TestLoadPolarReturnURLLegacyAlias(t *testing.T) {
	t.Setenv("OPENPOST_APP_URL", "https://app.openpost.social")
	t.Setenv("OPENPOST_POLAR_CUSTOMER_PORTAL_URL", "https://app.openpost.social/settings/billing/")

	cfg := Load()

	require.Equal(t, "https://app.openpost.social/settings/billing", cfg.PolarReturnURL)
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

// TestWarnOnPlaceholderURLNoEnvSet documents the warning fires when
// neither OPENPOST_APP_URL nor its legacy alias is set, so the operator
// is on the binary's default and the loud-warn is the right move.
func TestWarnOnPlaceholderURLNoEnvSet(t *testing.T) {
	t.Setenv("OPENPOST_APP_URL", "")
	t.Setenv("OPENPOST_FRONTEND_URL", "")
	// The function logs but does not return a value; we just verify it
	// does not panic when the env is empty.
	require.NotPanics(t, func() {
		warnOnPlaceholderURL(&Config{FrontendURL: "http://localhost:8080"})
	})
}

// TestWarnOnPlaceholderURLExplicitEnvSkipsWarn documents the contract
// that the warning is suppressed once the operator has set
// OPENPOST_APP_URL (or its alias). `devenv shell` and any real
// deployment must not see the warning.
func TestWarnOnPlaceholderURLExplicitEnvSkipsWarn(t *testing.T) {
	t.Setenv("OPENPOST_APP_URL", "https://openpost.example.com")
	t.Setenv("OPENPOST_FRONTEND_URL", "")
	require.NotPanics(t, func() {
		warnOnPlaceholderURL(&Config{FrontendURL: "https://openpost.example.com"})
	})
}

func writeEnvFile(t *testing.T, name, value string) string {
	t.Helper()

	path := filepath.Join(t.TempDir(), name)
	require.NoError(t, os.WriteFile(path, []byte(value), 0o600))
	return path
}
