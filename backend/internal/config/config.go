package config

import (
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/openpost/backend/internal/platform"
)

type MastodonServerConfig struct {
	Name         string `json:"name"`
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
	InstanceURL  string `json:"instance_url"`
}

type Config struct {
	Edition                 string
	Port                    string
	DatabaseDriver          string
	DatabasePath            string
	DatabaseURL             string
	JWTSecret               string
	EncryptionKey           string
	DisableRegistrations    bool
	FrontendURL             string
	PublicURL               string
	CORSOrigins             []string
	WebAuthnRPID            string
	LegalAcceptanceRequired bool
	TermsURL                string
	PrivacyURL              string
	TermsVersion            string
	PrivacyVersion          string
	SupportEmail            string
	StudioEnabled           bool
	StudioModelBaseURL      string
	VideoStudioEnabled      bool
	VideoModelBaseURL       string
	StockMediaEnabled       bool
	PexelsAPIKey            string
	UnsplashAccessKey       string
	PixabayAPIKey           string
	FeedbackEnabled         bool
	FeedbackDestinationURL  string
	FeedbackRecipient       string
	FeedbackSupportURL      string
	UpdateCheckEnabled      bool
	OIDCIssuer              string
	OIDCClientID            string
	OIDCClientSecret        string
	OIDCName                string
	OIDCScopes              []string
	OIDCJITEnabled          bool
	OIDCBootstrapAllowlist  []string
	OIDCBreakGlassEmails    []string
	OIDCNativeCallbackURL   string
	GoogleAuthClientID      string
	GoogleAuthClientSecret  string

	EmailVerificationRequired bool
	EmailProvider             string
	EmailFrom                 string
	ResendAPIKey              string
	CloudflareEmailAccountID  string
	CloudflareEmailAPIToken   string

	SMTPHost       string
	SMTPPort       int
	SMTPUsername   string
	SMTPPassword   string
	SMTPFrom       string
	SMTPTLSMode    string
	SMTPServerName string

	TwitterClientID                string
	TwitterClientSecret            string
	TwitterRedirectURI             string
	XMonthlyBudgetMicrousd         int64
	XPostCreateCostMicrousd        int64
	XPostCreateWithURLCostMicrousd int64
	ProviderUsageRetentionDays     int

	MastodonRedirectURI string
	MastodonServers     []MastodonServerConfig

	LinkedInClientID             string
	LinkedInClientSecret         string
	LinkedInRedirectURI          string
	DisableLinkedInThreadReplies bool
	EnableLinkedInOrganizations  bool

	ThreadsClientID     string
	ThreadsClientSecret string
	ThreadsRedirectURI  string

	ProviderApps []platform.AppConfig

	StorageDriver     string
	MediaPath         string
	MediaURL          string
	S3Endpoint        string
	S3Region          string
	S3Bucket          string
	S3AccessKeyID     string
	S3SecretAccessKey string
	S3PublicBaseURL   string
	S3ForcePathStyle  bool

	WhopAPIKey               string
	WhopAPIBaseURL           string
	WhopWebhookSecret        string
	WhopAccountID            string
	WhopProductID            string
	WhopCheckoutReturnURL    string
	WhopStarterMonthlyPlanID string
	WhopStarterAnnualPlanID  string
	WhopCreatorMonthlyPlanID string
	WhopCreatorAnnualPlanID  string
	WhopProMonthlyPlanID     string
	WhopProAnnualPlanID      string
	WhopTeamMonthlyPlanID    string
	WhopTeamAnnualPlanID     string
	WhopAgencyMonthlyPlanID  string
	WhopAgencyAnnualPlanID   string
}

const minSecretLength = 32

const (
	EditionSelfHost = "selfhost"
	EditionCloud    = "cloud"

	DatabaseDriverSQLite   = "sqlite"
	DatabaseDriverPostgres = "postgres"

	StorageDriverLocal = "local"
	StorageDriverS3    = "s3"
)

func Load() *Config {
	// FrontendURL is computed up front so the platform-specific OAuth
	// redirect URIs can be derived from it when the operator hasn't set
	// the *_REDIRECT_URI env vars. This avoids the previous footgun
	// where copying `.env.example` to `.env` produced a working-looking
	// setup that emitted OAuth callbacks pointing at localhost:5173
	// (Vite's dev port) regardless of where the binary was actually
	// deployed.
	frontendURL := strings.TrimRight(getEnvWithFallbacks("OPENPOST_APP_URL", "http://localhost:8080", "OPENPOST_FRONTEND_URL"), "/")
	edition := getEnvEnum("OPENPOST_EDITION", EditionSelfHost, EditionSelfHost, EditionCloud)
	legalRequired := edition == EditionCloud
	defaultTermsURL := ""
	defaultPrivacyURL := ""
	defaultPolicyVersion := ""
	defaultSupportEmail := ""
	if legalRequired {
		defaultTermsURL = "https://openpost.social/terms"
		defaultPrivacyURL = "https://openpost.social/privacy"
		defaultPolicyVersion = "2026-07-22"
		defaultSupportEmail = "openpost@rgo.pt"
	}

	cfg := &Config{
		Edition:                 edition,
		Port:                    getEnvWithFallbacks("OPENPOST_PORT", "8080"),
		DatabaseDriver:          getEnvEnum("OPENPOST_DATABASE_DRIVER", DatabaseDriverSQLite, DatabaseDriverSQLite, DatabaseDriverPostgres),
		DatabasePath:            getEnvWithFallbacks("OPENPOST_DATABASE_PATH", "file:openpost.db?cache=shared&mode=rwc", "OPENPOST_DB_PATH"),
		DatabaseURL:             getEnvWithFallbacks("OPENPOST_DATABASE_URL", "", "DATABASE_URL"),
		JWTSecret:               getEnvWithFallbacks("OPENPOST_JWT_SECRET", "", "JWT_SECRET"),
		EncryptionKey:           getEnvWithFallbacks("OPENPOST_ENCRYPTION_KEY", "", "ENCRYPTION_KEY"),
		DisableRegistrations:    getEnvBoolWithAliases(false, "OPENPOST_DISABLE_REGISTRATIONS"),
		FrontendURL:             frontendURL,
		PublicURL:               getEnvWithFallbacks("OPENPOST_PUBLIC_URL", "", "OPENPOST_APP_URL", "OPENPOST_FRONTEND_URL"),
		LegalAcceptanceRequired: getEnvBoolWithAliases(legalRequired, "OPENPOST_LEGAL_ACCEPTANCE_REQUIRED"),
		TermsURL:                strings.TrimRight(getEnvDefault("OPENPOST_TERMS_URL", defaultTermsURL), "/"),
		PrivacyURL:              strings.TrimRight(getEnvDefault("OPENPOST_PRIVACY_URL", defaultPrivacyURL), "/"),
		TermsVersion:            getEnvDefault("OPENPOST_TERMS_VERSION", defaultPolicyVersion),
		PrivacyVersion:          getEnvDefault("OPENPOST_PRIVACY_VERSION", defaultPolicyVersion),
		SupportEmail:            getEnvDefault("OPENPOST_SUPPORT_EMAIL", defaultSupportEmail),
		StudioEnabled:           getEnvBoolWithAliases(true, "OPENPOST_STUDIO_ENABLED"),
		StudioModelBaseURL:      strings.TrimRight(getEnvDefault("OPENPOST_STUDIO_MODEL_BASE_URL", "/studio-models"), "/"),
		VideoStudioEnabled:      getEnvBoolWithAliases(false, "OPENPOST_VIDEO_STUDIO_ENABLED"),
		VideoModelBaseURL:       strings.TrimRight(strings.TrimSpace(getEnvDefault("OPENPOST_VIDEO_MODEL_BASE_URL", "/video-studio-models")), "/"),
		StockMediaEnabled:       getEnvBoolWithAliases(false, "OPENPOST_STOCK_MEDIA_ENABLED"),
		PexelsAPIKey:            strings.TrimSpace(getEnvDefault("OPENPOST_PEXELS_API_KEY", "")),
		UnsplashAccessKey:       strings.TrimSpace(getEnvDefault("OPENPOST_UNSPLASH_ACCESS_KEY", "")),
		PixabayAPIKey:           strings.TrimSpace(getEnvDefault("OPENPOST_PIXABAY_API_KEY", "")),
		FeedbackEnabled:         getEnvBoolWithAliases(false, "OPENPOST_FEEDBACK_ENABLED"),
		FeedbackDestinationURL:  getEnvDefault("OPENPOST_FEEDBACK_DESTINATION_URL", ""),
		FeedbackRecipient:       getEnvDefault("OPENPOST_FEEDBACK_RECIPIENT", ""),
		FeedbackSupportURL:      getEnvDefault("OPENPOST_FEEDBACK_SUPPORT_URL", "https://github.com/rodrgds/openpost/issues/new"),
		UpdateCheckEnabled:      getEnvBoolWithAliases(true, "OPENPOST_UPDATE_CHECK_ENABLED"),
		OIDCIssuer:              strings.TrimSpace(getEnvDefault("OPENPOST_OIDC_ISSUER", "")),
		OIDCClientID:            strings.TrimSpace(getEnvDefault("OPENPOST_OIDC_CLIENT_ID", "")),
		OIDCClientSecret:        getEnvDefault("OPENPOST_OIDC_CLIENT_SECRET", ""),
		OIDCName:                strings.TrimSpace(getEnvDefault("OPENPOST_OIDC_NAME", "Single sign-on")),
		OIDCScopes:              parseStringList(getEnvDefault("OPENPOST_OIDC_SCOPES", "openid profile email")),
		OIDCJITEnabled:          getEnvBoolWithAliases(false, "OPENPOST_OIDC_JIT_ENABLED"),
		OIDCBootstrapAllowlist:  parseStringList(getEnvDefault("OPENPOST_OIDC_BOOTSTRAP_ALLOWLIST", "")),
		OIDCBreakGlassEmails:    parseStringList(getEnvDefault("OPENPOST_SSO_BREAK_GLASS_EMAILS", "")),
		OIDCNativeCallbackURL:   strings.TrimSpace(getEnvDefault("OPENPOST_OIDC_NATIVE_CALLBACK_URL", "openpost://oidc/callback")),
		GoogleAuthClientID:      strings.TrimSpace(getEnvDefault("OPENPOST_AUTH_GOOGLE_CLIENT_ID", "")),
		GoogleAuthClientSecret:  getEnvDefault("OPENPOST_AUTH_GOOGLE_CLIENT_SECRET", ""),

		EmailVerificationRequired: getEnvBoolWithAliases(edition == EditionCloud, "OPENPOST_EMAIL_VERIFICATION_REQUIRED"),
		EmailProvider:             getEnvEnum("OPENPOST_EMAIL_PROVIDER", "", "smtp", "resend", "cloudflare"),
		EmailFrom:                 strings.TrimSpace(getEnvDefault("OPENPOST_EMAIL_FROM", "")),
		ResendAPIKey:              getEnvDefault("OPENPOST_RESEND_API_KEY", ""),
		CloudflareEmailAccountID:  strings.TrimSpace(getEnvDefault("OPENPOST_CLOUDFLARE_EMAIL_ACCOUNT_ID", "")),
		CloudflareEmailAPIToken:   getEnvDefault("OPENPOST_CLOUDFLARE_EMAIL_API_TOKEN", ""),

		SMTPHost:       getEnvDefault("OPENPOST_SMTP_HOST", ""),
		SMTPPort:       getEnvInt("OPENPOST_SMTP_PORT", 587),
		SMTPUsername:   getEnvDefault("OPENPOST_SMTP_USERNAME", ""),
		SMTPPassword:   getEnvDefault("OPENPOST_SMTP_PASSWORD", ""),
		SMTPFrom:       getEnvDefault("OPENPOST_SMTP_FROM", ""),
		SMTPTLSMode:    getEnvEnum("OPENPOST_SMTP_TLS_MODE", "starttls", "starttls", "tls", "none"),
		SMTPServerName: getEnvDefault("OPENPOST_SMTP_SERVER_NAME", ""),

		TwitterClientID:                getEnvWithFallbacks("X_CLIENT_ID", "", "TWITTER_CLIENT_ID"),
		TwitterClientSecret:            getEnvWithFallbacks("X_CLIENT_SECRET", "", "TWITTER_CLIENT_SECRET"),
		TwitterRedirectURI:             oauthRedirectFromFrontend("X_REDIRECT_URI", "TWITTER_REDIRECT_URI", frontendURL, "/api/v1/accounts/x/callback"),
		XMonthlyBudgetMicrousd:         getEnvInt64("OPENPOST_X_MONTHLY_BUDGET_MICROUSD", 5_000_000),
		XPostCreateCostMicrousd:        getEnvInt64("OPENPOST_X_POST_CREATE_COST_MICROUSD", 15_000),
		XPostCreateWithURLCostMicrousd: getEnvInt64("OPENPOST_X_POST_CREATE_WITH_URL_COST_MICROUSD", 200_000),
		ProviderUsageRetentionDays:     getEnvInt("OPENPOST_PROVIDER_USAGE_RETENTION_DAYS", 180),

		// Mastodon's OOB flow uses a special URI scheme rather than a
		// real callback URL, so we don't derive from FrontendURL here.
		// Operators who need a real URL can still override via env.
		MastodonRedirectURI: getEnvDefault("MASTODON_REDIRECT_URI", "urn:ietf:wg:oauth:2.0:oob"),

		LinkedInClientID:             getEnvWithFallbacks("LINKEDIN_CLIENT_ID", ""),
		LinkedInClientSecret:         getEnvWithFallbacks("LINKEDIN_CLIENT_SECRET", ""),
		LinkedInRedirectURI:          oauthRedirectFromFrontend("LINKEDIN_REDIRECT_URI", "", frontendURL, "/api/v1/accounts/linkedin/callback"),
		DisableLinkedInThreadReplies: getEnvBoolWithAliases(false, "OPENPOST_DISABLE_LINKEDIN_THREAD_REPLIES", "LINKEDIN_DISABLE_THREAD_REPLIES"),
		EnableLinkedInOrganizations:  getEnvBoolWithAliases(false, "OPENPOST_LINKEDIN_ORGANIZATIONS_ENABLED"),

		ThreadsClientID:     getEnvWithFallbacks("THREADS_CLIENT_ID", ""),
		ThreadsClientSecret: getEnvWithFallbacks("THREADS_CLIENT_SECRET", ""),
		ThreadsRedirectURI:  oauthRedirectFromFrontend("THREADS_REDIRECT_URI", "", frontendURL, "/api/v1/accounts/threads/callback"),

		StorageDriver:     getEnvEnum("OPENPOST_STORAGE_DRIVER", StorageDriverLocal, StorageDriverLocal, StorageDriverS3),
		MediaPath:         getEnvDefault("OPENPOST_MEDIA_PATH", "./media"),
		MediaURL:          getEnvDefault("OPENPOST_MEDIA_URL", "/media"),
		S3Endpoint:        getEnvDefault("OPENPOST_S3_ENDPOINT", ""),
		S3Region:          getEnvDefault("OPENPOST_S3_REGION", ""),
		S3Bucket:          getEnvDefault("OPENPOST_S3_BUCKET", ""),
		S3AccessKeyID:     getEnvDefault("OPENPOST_S3_ACCESS_KEY_ID", ""),
		S3SecretAccessKey: getEnvDefault("OPENPOST_S3_SECRET_ACCESS_KEY", ""),
		S3PublicBaseURL:   strings.TrimRight(getEnvDefault("OPENPOST_S3_PUBLIC_BASE_URL", ""), "/"),
		S3ForcePathStyle:  getEnvBoolWithAliases(false, "OPENPOST_S3_FORCE_PATH_STYLE"),

		WhopAPIKey:               getEnvDefault("OPENPOST_WHOP_API_KEY", ""),
		WhopAPIBaseURL:           strings.TrimRight(getEnvDefault("OPENPOST_WHOP_API_BASE_URL", "https://api.whop.com/api/v1"), "/"),
		WhopWebhookSecret:        getEnvDefault("OPENPOST_WHOP_WEBHOOK_SECRET", ""),
		WhopAccountID:            getEnvDefault("OPENPOST_WHOP_ACCOUNT_ID", ""),
		WhopProductID:            getEnvDefault("OPENPOST_WHOP_PRODUCT_ID", ""),
		WhopCheckoutReturnURL:    strings.TrimRight(getEnvDefault("OPENPOST_WHOP_CHECKOUT_RETURN_URL", ""), "/"),
		WhopStarterMonthlyPlanID: getEnvDefault("OPENPOST_WHOP_STARTER_MONTHLY_PLAN_ID", ""),
		WhopStarterAnnualPlanID:  getEnvDefault("OPENPOST_WHOP_STARTER_ANNUAL_PLAN_ID", ""),
		WhopCreatorMonthlyPlanID: getEnvDefault("OPENPOST_WHOP_CREATOR_MONTHLY_PLAN_ID", ""),
		WhopCreatorAnnualPlanID:  getEnvDefault("OPENPOST_WHOP_CREATOR_ANNUAL_PLAN_ID", ""),
		WhopProMonthlyPlanID:     getEnvDefault("OPENPOST_WHOP_PRO_MONTHLY_PLAN_ID", ""),
		WhopProAnnualPlanID:      getEnvDefault("OPENPOST_WHOP_PRO_ANNUAL_PLAN_ID", ""),
		WhopTeamMonthlyPlanID:    getEnvDefault("OPENPOST_WHOP_TEAM_MONTHLY_PLAN_ID", ""),
		WhopTeamAnnualPlanID:     getEnvDefault("OPENPOST_WHOP_TEAM_ANNUAL_PLAN_ID", ""),
		WhopAgencyMonthlyPlanID:  getEnvDefault("OPENPOST_WHOP_AGENCY_MONTHLY_PLAN_ID", ""),
		WhopAgencyAnnualPlanID:   getEnvDefault("OPENPOST_WHOP_AGENCY_ANNUAL_PLAN_ID", ""),
	}

	if cfg.PublicURL == "" {
		cfg.PublicURL = cfg.FrontendURL
	}
	if cfg.EmailFrom == "" {
		cfg.EmailFrom = strings.TrimSpace(cfg.SMTPFrom)
	}
	if cfg.EmailProvider == "" {
		switch {
		case strings.TrimSpace(cfg.ResendAPIKey) != "":
			cfg.EmailProvider = "resend"
		case strings.TrimSpace(cfg.CloudflareEmailAccountID) != "" || strings.TrimSpace(cfg.CloudflareEmailAPIToken) != "":
			cfg.EmailProvider = "cloudflare"
		case strings.TrimSpace(cfg.SMTPHost) != "":
			cfg.EmailProvider = "smtp"
		}
	}
	if parsed, err := url.Parse(cfg.PublicURL); err == nil && parsed.Hostname() != "" {
		cfg.WebAuthnRPID = parsed.Hostname()
	} else {
		cfg.WebAuthnRPID = "localhost"
	}

	if raw := getEnvDefault("MASTODON_SERVERS", ""); raw != "" {
		var servers []MastodonServerConfig
		if err := json.Unmarshal([]byte(raw), &servers); err != nil {
			log.Printf("WARNING: failed to parse MASTODON_SERVERS JSON: %v", err)
		} else {
			cfg.MastodonServers = servers
		}
	}
	cfg.ProviderApps = providerAppsFromLegacyConfig(cfg)
	if raw := getEnvDefault("OPENPOST_PROVIDER_APPS", ""); raw != "" {
		var apps []platform.AppConfig
		if err := json.Unmarshal([]byte(raw), &apps); err != nil {
			log.Printf("WARNING: failed to parse OPENPOST_PROVIDER_APPS JSON: %v", err)
		} else {
			cfg.ProviderApps = mergeProviderApps(cfg.ProviderApps, defaultProviderAppConfig(cfg, apps)...)
		}
	}

	cfg.CORSOrigins = buildCORSOrigins(
		cfg.Edition,
		cfg.FrontendURL,
		getEnvWithFallbacks("OPENPOST_EXTRA_CORS_ORIGINS", "", "OPENPOST_CORS_EXTRA_ORIGINS"),
	)

	warnOnPlaceholderURL(cfg)

	return cfg
}

func providerAppsFromLegacyConfig(cfg *Config) []platform.AppConfig {
	apps := []platform.AppConfig{{Provider: "bluesky"}, {Provider: "discord"}}
	if cfg.TwitterClientID != "" {
		apps = append(apps, platform.AppConfig{
			Provider:     "x",
			ClientID:     cfg.TwitterClientID,
			ClientSecret: cfg.TwitterClientSecret,
			RedirectURI:  cfg.TwitterRedirectURI,
		})
	}
	for _, server := range cfg.MastodonServers {
		apps = append(apps, platform.AppConfig{
			Provider:     "mastodon",
			Name:         server.Name,
			ClientID:     server.ClientID,
			ClientSecret: server.ClientSecret,
			RedirectURI:  cfg.MastodonRedirectURI,
			InstanceURL:  server.InstanceURL,
		})
	}
	if cfg.LinkedInClientID != "" {
		apps = append(apps, platform.AppConfig{
			Provider:     "linkedin",
			ClientID:     cfg.LinkedInClientID,
			ClientSecret: cfg.LinkedInClientSecret,
			RedirectURI:  cfg.LinkedInRedirectURI,
		})
	}
	if cfg.ThreadsClientID != "" {
		apps = append(apps, platform.AppConfig{
			Provider:     "threads",
			ClientID:     cfg.ThreadsClientID,
			ClientSecret: cfg.ThreadsClientSecret,
			RedirectURI:  cfg.ThreadsRedirectURI,
		})
	}
	return defaultProviderAppConfig(cfg, apps)
}

func defaultProviderAppConfig(cfg *Config, apps []platform.AppConfig) []platform.AppConfig {
	out := make([]platform.AppConfig, 0, len(apps))
	for _, app := range apps {
		app = platform.NormalizeAppConfig(app)
		if app.RedirectURI == "" {
			app.RedirectURI = providerRedirectURI(cfg, app.Provider)
		}
		out = append(out, app)
	}
	return out
}

func providerRedirectURI(cfg *Config, provider string) string {
	redirects := map[string]string{
		"x":         cfg.TwitterRedirectURI,
		"facebook":  oauthRedirectFromFrontend("", "", cfg.FrontendURL, "/api/v1/accounts/facebook/callback"),
		"instagram": oauthRedirectFromFrontend("", "", cfg.FrontendURL, "/api/v1/accounts/instagram/callback"),
		"mastodon":  cfg.MastodonRedirectURI,
		"linkedin":  cfg.LinkedInRedirectURI,
		"threads":   cfg.ThreadsRedirectURI,
		"tiktok":    oauthRedirectFromFrontend("", "", cfg.FrontendURL, "/api/v1/accounts/tiktok/callback"),
		"youtube":   oauthRedirectFromFrontend("", "", cfg.FrontendURL, "/api/v1/accounts/youtube/callback"),
	}
	return redirects[provider]
}

func mergeProviderApps(base []platform.AppConfig, overrides ...platform.AppConfig) []platform.AppConfig {
	return platform.MergeAppConfigs(base, overrides...)
}

func buildCORSOrigins(edition, frontendURL, extraRaw string) []string {
	origins := make([]string, 0, 6)
	addOrigin := func(origin string) {
		origin = strings.TrimRight(strings.TrimSpace(origin), "/")
		if origin == "" {
			return
		}
		for _, existing := range origins {
			if existing == origin {
				return
			}
		}
		origins = append(origins, origin)
	}

	addOrigin(frontendURL)
	if edition != EditionCloud {
		addOrigin("http://localhost:5173")
		addOrigin("capacitor://localhost")
		addOrigin("http://localhost")
		addOrigin("https://localhost")
	}
	for _, origin := range strings.Split(extraRaw, ",") {
		addOrigin(origin)
	}
	return origins
}

func parseStringList(raw string) []string {
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ';' || r == '\n' || r == '\t' || r == ' '
	})
	values := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if !slices.Contains(values, part) {
			values = append(values, part)
		}
	}
	return values
}

func (c *Config) DatabaseDSN() string {
	if c.DatabaseDriver == DatabaseDriverPostgres && c.DatabaseURL != "" {
		return c.DatabaseURL
	}
	return c.DatabasePath
}

func (c *Config) ValidateRuntime() error {
	if err := c.ValidateManagedSettings(); err != nil {
		return err
	}
	if c.Edition != EditionCloud {
		return nil
	}

	missing := append(c.missingCloudDataPlaneConfig(), c.missingCloudBillingConfig()...)
	missing = append(missing, c.missingCloudAccountConfig()...)
	missing = append(missing, c.invalidCloudCORSConfig()...)
	if c.XMonthlyBudgetMicrousd < 0 {
		missing = append(missing, "OPENPOST_X_MONTHLY_BUDGET_MICROUSD >= 0")
	}
	if c.XPostCreateCostMicrousd < 0 {
		missing = append(missing, "OPENPOST_X_POST_CREATE_COST_MICROUSD >= 0")
	}
	if c.XPostCreateWithURLCostMicrousd < 0 {
		missing = append(missing, "OPENPOST_X_POST_CREATE_WITH_URL_COST_MICROUSD >= 0")
	}
	if c.ProviderUsageRetentionDays < 0 {
		missing = append(missing, "OPENPOST_PROVIDER_USAGE_RETENTION_DAYS >= 0")
	}
	if len(missing) > 0 {
		return fmt.Errorf("OPENPOST_EDITION=cloud requires: %s", strings.Join(missing, ", "))
	}
	return nil
}

func (c *Config) ValidateManagedSettings() error {
	if invalid := c.invalidAuthenticationConfig(); len(invalid) > 0 {
		return fmt.Errorf("invalid authentication configuration: %s", strings.Join(invalid, ", "))
	}
	return nil
}

func (c *Config) missingCloudAccountConfig() []string {
	missing := make([]string, 0, 12)
	if !c.LegalAcceptanceRequired {
		missing = append(missing, "OPENPOST_LEGAL_ACCEPTANCE_REQUIRED=true")
	}
	if !c.EmailVerificationRequired {
		missing = append(missing, "OPENPOST_EMAIL_VERIFICATION_REQUIRED=true")
	}
	for key, value := range map[string]string{
		"OPENPOST_TERMS_URL":       c.TermsURL,
		"OPENPOST_PRIVACY_URL":     c.PrivacyURL,
		"OPENPOST_TERMS_VERSION":   c.TermsVersion,
		"OPENPOST_PRIVACY_VERSION": c.PrivacyVersion,
		"OPENPOST_SUPPORT_EMAIL":   c.SupportEmail,
	} {
		if strings.TrimSpace(value) == "" {
			missing = append(missing, key)
		}
	}
	sort.Strings(missing)
	return missing
}

func (c *Config) invalidAuthenticationConfig() []string {
	invalid := make([]string, 0, 8)
	invalid = append(invalid, c.invalidGoogleAuthenticationConfig()...)
	invalid = append(invalid, c.invalidEmailProviderConfig()...)
	sort.Strings(invalid)
	return invalid
}

func (c *Config) invalidGoogleAuthenticationConfig() []string {
	googleID := strings.TrimSpace(c.GoogleAuthClientID)
	googleSecret := strings.TrimSpace(c.GoogleAuthClientSecret)
	if (googleID == "") != (googleSecret == "") {
		return []string{"OPENPOST_AUTH_GOOGLE_CLIENT_ID and OPENPOST_AUTH_GOOGLE_CLIENT_SECRET must be configured together"}
	}
	return nil
}

func (c *Config) invalidEmailProviderConfig() []string {
	invalid := make([]string, 0, 6)
	if c.EmailProvider != "" && strings.TrimSpace(c.EmailFrom) == "" {
		invalid = append(invalid, "OPENPOST_EMAIL_FROM is required when an email provider is configured")
	}
	switch c.EmailProvider {
	case "":
	case "smtp":
		if strings.TrimSpace(c.SMTPHost) == "" {
			invalid = append(invalid, "OPENPOST_SMTP_HOST is required for the SMTP email provider")
		}
		if strings.TrimSpace(c.SMTPUsername) != "" && strings.TrimSpace(c.SMTPPassword) == "" {
			invalid = append(invalid, "OPENPOST_SMTP_PASSWORD is required when an SMTP username is configured")
		}
	case "resend":
		if strings.TrimSpace(c.ResendAPIKey) == "" {
			invalid = append(invalid, "OPENPOST_RESEND_API_KEY is required for the Resend email provider")
		}
	case "cloudflare":
		if strings.TrimSpace(c.CloudflareEmailAccountID) == "" {
			invalid = append(invalid, "OPENPOST_CLOUDFLARE_EMAIL_ACCOUNT_ID is required for the Cloudflare email provider")
		}
		if strings.TrimSpace(c.CloudflareEmailAPIToken) == "" {
			invalid = append(invalid, "OPENPOST_CLOUDFLARE_EMAIL_API_TOKEN is required for the Cloudflare email provider")
		}
	default:
		invalid = append(invalid, "OPENPOST_EMAIL_PROVIDER must be smtp, resend, or cloudflare")
	}
	return invalid
}

func (c *Config) missingCloudDataPlaneConfig() []string {
	missing := make([]string, 0, 8)
	if c.DatabaseDriver != DatabaseDriverPostgres {
		missing = append(missing, "OPENPOST_DATABASE_DRIVER=postgres")
	}
	if strings.TrimSpace(c.DatabaseURL) == "" {
		missing = append(missing, "OPENPOST_DATABASE_URL")
	}
	if c.StorageDriver != StorageDriverS3 {
		missing = append(missing, "OPENPOST_STORAGE_DRIVER=s3")
	}
	if strings.TrimSpace(c.S3Region) == "" {
		missing = append(missing, "OPENPOST_S3_REGION")
	}
	if strings.TrimSpace(c.S3Bucket) == "" {
		missing = append(missing, "OPENPOST_S3_BUCKET")
	}
	if strings.TrimSpace(c.S3AccessKeyID) == "" {
		missing = append(missing, "OPENPOST_S3_ACCESS_KEY_ID")
	}
	if strings.TrimSpace(c.S3SecretAccessKey) == "" {
		missing = append(missing, "OPENPOST_S3_SECRET_ACCESS_KEY")
	}
	if strings.TrimSpace(c.S3PublicBaseURL) == "" {
		missing = append(missing, "OPENPOST_S3_PUBLIC_BASE_URL")
	}
	return missing
}

func (c *Config) missingCloudBillingConfig() []string {
	missing := make([]string, 0, 14)
	for _, required := range []struct {
		value string
		name  string
	}{
		{c.WhopAPIKey, "OPENPOST_WHOP_API_KEY"},
		{c.WhopWebhookSecret, "OPENPOST_WHOP_WEBHOOK_SECRET"},
		{c.WhopAccountID, "OPENPOST_WHOP_ACCOUNT_ID"},
		{c.WhopProductID, "OPENPOST_WHOP_PRODUCT_ID"},
		{c.WhopStarterMonthlyPlanID, "OPENPOST_WHOP_STARTER_MONTHLY_PLAN_ID"},
		{c.WhopStarterAnnualPlanID, "OPENPOST_WHOP_STARTER_ANNUAL_PLAN_ID"},
		{c.WhopCreatorMonthlyPlanID, "OPENPOST_WHOP_CREATOR_MONTHLY_PLAN_ID"},
		{c.WhopCreatorAnnualPlanID, "OPENPOST_WHOP_CREATOR_ANNUAL_PLAN_ID"},
		{c.WhopProMonthlyPlanID, "OPENPOST_WHOP_PRO_MONTHLY_PLAN_ID"},
		{c.WhopProAnnualPlanID, "OPENPOST_WHOP_PRO_ANNUAL_PLAN_ID"},
		{c.WhopTeamMonthlyPlanID, "OPENPOST_WHOP_TEAM_MONTHLY_PLAN_ID"},
		{c.WhopTeamAnnualPlanID, "OPENPOST_WHOP_TEAM_ANNUAL_PLAN_ID"},
		{c.WhopAgencyMonthlyPlanID, "OPENPOST_WHOP_AGENCY_MONTHLY_PLAN_ID"},
		{c.WhopAgencyAnnualPlanID, "OPENPOST_WHOP_AGENCY_ANNUAL_PLAN_ID"},
	} {
		if strings.TrimSpace(required.value) == "" {
			missing = append(missing, required.name)
		}
	}
	return missing
}

func (c *Config) invalidCloudCORSConfig() []string {
	for _, origin := range c.CORSOrigins {
		if strings.TrimSpace(origin) == "*" {
			return []string{"OPENPOST_EXTRA_CORS_ORIGINS without wildcard origins"}
		}
	}
	return nil
}

// warnOnPlaceholderURL emits a loud startup warning when the operator is
// running with the binary's default `http://localhost:8080` for
// OPENPOST_APP_URL/OPENPOST_PUBLIC_URL, which is almost always wrong in
// production. The check only fires when neither env var was set
// explicitly, so `devenv shell` and any operator who has set a real URL
// are not affected.
func warnOnPlaceholderURL(cfg *Config) {
	if envValueSet("OPENPOST_APP_URL") {
		return
	}
	if envValueSet("OPENPOST_FRONTEND_URL") {
		return
	}
	log.Printf("============================================================")
	log.Printf("WARNING: OPENPOST_APP_URL is not set; falling back to")
	log.Printf("         %s. OAuth callbacks, WebAuthn origins, and the", cfg.FrontendURL)
	log.Printf("         public media URL will all advertise this address.")
	log.Printf("         Set OPENPOST_APP_URL=https://your-public-host in")
	log.Printf("         production. See .env.example for details.")
	log.Printf("============================================================")
}

func getEnvDefault(key, fallback string) string {
	if value, _, ok := getEnvValue(key); ok {
		return value
	}
	return fallback
}

func getEnvWithFallbacks(primary, fallback string, aliases ...string) string {
	keys := append([]string{primary}, aliases...)
	for _, alias := range keys {
		if value, _, ok := getEnvValue(alias); ok {
			return value
		}
	}
	return fallback
}

func getEnvBoolWithAliases(fallback bool, keys ...string) bool {
	for _, key := range keys {
		value, source, ok := getEnvValue(key)
		if !ok {
			continue
		}

		parsed, err := strconv.ParseBool(strings.TrimSpace(value))
		if err != nil {
			log.Printf("WARNING: invalid boolean for %s=%q, using default %t", source, value, fallback)
			return fallback
		}
		return parsed
	}

	return fallback
}

func getEnvInt(key string, fallback int) int {
	value, source, ok := getEnvValue(key)
	if !ok {
		return fallback
	}
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		log.Printf("WARNING: invalid integer for %s=%q, using default %d", source, value, fallback)
		return fallback
	}
	return parsed
}

func getEnvInt64(key string, fallback int64) int64 {
	value, source, ok := getEnvValue(key)
	if !ok {
		return fallback
	}
	parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil {
		log.Printf("WARNING: invalid integer for %s=%q, using default %d", source, value, fallback)
		return fallback
	}
	return parsed
}

func getEnvEnum(key, fallback string, allowed ...string) string {
	value := strings.ToLower(strings.TrimSpace(getEnvDefault(key, "")))
	if value == "" {
		return fallback
	}

	for _, candidate := range allowed {
		if value == candidate {
			return value
		}
	}

	log.Printf("WARNING: invalid value for %s=%q, using default %q", key, value, fallback)
	return fallback
}

func envValueSet(key string) bool {
	_, _, ok := getEnvValue(key)
	return ok
}

func getEnvValue(key string) (string, string, bool) {
	if key == "" {
		return "", "", false
	}
	if value := os.Getenv(key); value != "" {
		return value, key, true
	}

	fileKey := key + "_FILE"
	path := strings.TrimSpace(os.Getenv(fileKey))
	if path == "" {
		return "", "", false
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		log.Printf("WARNING: failed to read %s=%q: %v", fileKey, path, err)
		return "", fileKey, false
	}

	value := strings.TrimSpace(string(raw))
	if value == "" {
		log.Printf("WARNING: %s=%q resolved to an empty value", fileKey, path)
		return "", fileKey, false
	}
	return value, fileKey, true
}

// oauthRedirectFromFrontend returns the OAuth redirect URI to register
// with an external provider, preferring the explicit env var (and any
// aliases) when set. If nothing is set, it derives a sensible default
// from the FrontendURL — this prevents the footgun where copying
// `.env.example` produced OAuth callbacks pointing at localhost:5173
// (Vite's dev port) regardless of where the binary was deployed.
func oauthRedirectFromFrontend(primary, alias, frontend, path string) string {
	keys := []string{primary}
	if alias != "" {
		keys = append(keys, alias)
	}
	if v := getEnvWithFallbacks(keys[0], "", keys[1:]...); v != "" {
		return v
	}
	return strings.TrimRight(frontend, "/") + path
}

func Init() {
	jwtSecret := getEnvWithFallbacks("OPENPOST_JWT_SECRET", "", "JWT_SECRET")
	encryptionKey := getEnvWithFallbacks("OPENPOST_ENCRYPTION_KEY", "", "ENCRYPTION_KEY")

	if jwtSecret == "" {
		log.Fatal("FATAL: OPENPOST_JWT_SECRET is required")
	}
	if len(jwtSecret) < minSecretLength {
		log.Fatalf("FATAL: OPENPOST_JWT_SECRET must be at least %d characters (got %d)", minSecretLength, len(jwtSecret))
	}
	if encryptionKey == "" {
		log.Fatal("FATAL: OPENPOST_ENCRYPTION_KEY is required")
	}
	if len(encryptionKey) < minSecretLength {
		log.Fatalf("FATAL: OPENPOST_ENCRYPTION_KEY must be at least %d characters (got %d)", minSecretLength, len(encryptionKey))
	}
}
