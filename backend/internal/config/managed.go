package config

import (
	"fmt"
	"net/mail"
	"net/url"
	"strconv"
	"strings"
)

type ManagedSettingKind string

const (
	ManagedSettingBoolean ManagedSettingKind = "boolean"
	ManagedSettingInteger ManagedSettingKind = "integer"
	ManagedSettingString  ManagedSettingKind = "string"
	ManagedSettingSecret  ManagedSettingKind = "secret"
	ManagedSettingURL     ManagedSettingKind = "url"
	ManagedSettingEmail   ManagedSettingKind = "email"
	ManagedSettingEnum    ManagedSettingKind = "enum"
	ManagedSettingList    ManagedSettingKind = "list"
)

type ManagedSettingOption struct {
	Value string
	Label string
}

// ManagedSettingDefinition is the allowlist used by the admin configuration
// API. Bootstrap, database, encryption, network, and storage settings remain
// deployment-owned because OpenPost needs them before it can read this
// database-backed layer. Billing is safe here because runtime validation and
// billing service construction happen after stored instance settings load.
type ManagedSettingDefinition struct {
	Key         string
	Group       string
	Label       string
	Description string
	Kind        ManagedSettingKind
	Secret      bool
	Optional    bool
	EnvVars     []string
	Options     []ManagedSettingOption
}

var managedSettingDefinitions = []ManagedSettingDefinition{
	{Key: "OPENPOST_DISABLE_REGISTRATIONS", Group: "accounts", Label: "Disable new registrations", Description: "Stop new password and identity-provider registrations without affecting existing users.", Kind: ManagedSettingBoolean, EnvVars: []string{"OPENPOST_DISABLE_REGISTRATIONS"}},
	{Key: "OPENPOST_LEGAL_ACCEPTANCE_REQUIRED", Group: "accounts", Label: "Require legal acceptance", Description: "Require users to accept the configured terms and privacy policy versions.", Kind: ManagedSettingBoolean, EnvVars: []string{"OPENPOST_LEGAL_ACCEPTANCE_REQUIRED"}},
	{Key: "OPENPOST_TERMS_URL", Group: "accounts", Label: "Terms URL", Description: "Public URL for the terms of service.", Kind: ManagedSettingURL, Optional: true, EnvVars: []string{"OPENPOST_TERMS_URL"}},
	{Key: "OPENPOST_PRIVACY_URL", Group: "accounts", Label: "Privacy URL", Description: "Public URL for the privacy policy.", Kind: ManagedSettingURL, Optional: true, EnvVars: []string{"OPENPOST_PRIVACY_URL"}},
	{Key: "OPENPOST_TERMS_VERSION", Group: "accounts", Label: "Terms version", Description: "Version recorded when a user accepts the terms.", Kind: ManagedSettingString, Optional: true, EnvVars: []string{"OPENPOST_TERMS_VERSION"}},
	{Key: "OPENPOST_PRIVACY_VERSION", Group: "accounts", Label: "Privacy version", Description: "Version recorded when a user accepts the privacy policy.", Kind: ManagedSettingString, Optional: true, EnvVars: []string{"OPENPOST_PRIVACY_VERSION"}},
	{Key: "OPENPOST_SUPPORT_EMAIL", Group: "accounts", Label: "Support email", Description: "Contact address shown in account and policy flows.", Kind: ManagedSettingEmail, Optional: true, EnvVars: []string{"OPENPOST_SUPPORT_EMAIL"}},
	{Key: "OPENPOST_UPDATE_CHECK_ENABLED", Group: "accounts", Label: "Release checks", Description: "Check for new stable OpenPost releases in Instance settings.", Kind: ManagedSettingBoolean, EnvVars: []string{"OPENPOST_UPDATE_CHECK_ENABLED"}},

	{Key: "OPENPOST_WHOP_API_KEY", Group: "billing", Label: "Whop API key", Description: "Write-only API key used to create checkout sessions and reconcile memberships.", Kind: ManagedSettingSecret, Secret: true, Optional: true, EnvVars: []string{"OPENPOST_WHOP_API_KEY"}},
	{Key: "OPENPOST_WHOP_API_BASE_URL", Group: "billing", Label: "Whop API URL", Description: "Whop API endpoint. Keep the default unless Whop provides another environment.", Kind: ManagedSettingURL, EnvVars: []string{"OPENPOST_WHOP_API_BASE_URL"}},
	{Key: "OPENPOST_WHOP_WEBHOOK_SECRET", Group: "billing", Label: "Whop webhook secret", Description: "Write-only signing secret used to verify billing webhook requests.", Kind: ManagedSettingSecret, Secret: true, Optional: true, EnvVars: []string{"OPENPOST_WHOP_WEBHOOK_SECRET"}},
	{Key: "OPENPOST_WHOP_ACCOUNT_ID", Group: "billing", Label: "Whop account ID", Description: "Business account that owns the OpenPost product and receives payments.", Kind: ManagedSettingString, Optional: true, EnvVars: []string{"OPENPOST_WHOP_ACCOUNT_ID"}},
	{Key: "OPENPOST_WHOP_PRODUCT_ID", Group: "billing", Label: "Whop product ID", Description: "Product that contains the OpenPost subscription plans.", Kind: ManagedSettingString, Optional: true, EnvVars: []string{"OPENPOST_WHOP_PRODUCT_ID"}},
	{Key: "OPENPOST_WHOP_CHECKOUT_RETURN_URL", Group: "billing", Label: "Checkout return URL", Description: "OpenPost checkout URL Whop returns customers to after payment.", Kind: ManagedSettingURL, Optional: true, EnvVars: []string{"OPENPOST_WHOP_CHECKOUT_RETURN_URL"}},
	{Key: "OPENPOST_WHOP_STARTER_MONTHLY_PLAN_ID", Group: "billing", Label: "Starter monthly plan ID", Description: "Whop plan used for monthly Starter subscriptions.", Kind: ManagedSettingString, Optional: true, EnvVars: []string{"OPENPOST_WHOP_STARTER_MONTHLY_PLAN_ID"}},
	{Key: "OPENPOST_WHOP_STARTER_ANNUAL_PLAN_ID", Group: "billing", Label: "Starter annual plan ID", Description: "Whop plan used for annual Starter subscriptions.", Kind: ManagedSettingString, Optional: true, EnvVars: []string{"OPENPOST_WHOP_STARTER_ANNUAL_PLAN_ID"}},
	{Key: "OPENPOST_WHOP_CREATOR_MONTHLY_PLAN_ID", Group: "billing", Label: "Creator monthly plan ID", Description: "Whop plan used for monthly Creator subscriptions.", Kind: ManagedSettingString, Optional: true, EnvVars: []string{"OPENPOST_WHOP_CREATOR_MONTHLY_PLAN_ID"}},
	{Key: "OPENPOST_WHOP_CREATOR_ANNUAL_PLAN_ID", Group: "billing", Label: "Creator annual plan ID", Description: "Whop plan used for annual Creator subscriptions.", Kind: ManagedSettingString, Optional: true, EnvVars: []string{"OPENPOST_WHOP_CREATOR_ANNUAL_PLAN_ID"}},
	{Key: "OPENPOST_WHOP_PRO_MONTHLY_PLAN_ID", Group: "billing", Label: "Pro monthly plan ID", Description: "Whop plan used for monthly Pro subscriptions.", Kind: ManagedSettingString, Optional: true, EnvVars: []string{"OPENPOST_WHOP_PRO_MONTHLY_PLAN_ID"}},
	{Key: "OPENPOST_WHOP_PRO_ANNUAL_PLAN_ID", Group: "billing", Label: "Pro annual plan ID", Description: "Whop plan used for annual Pro subscriptions.", Kind: ManagedSettingString, Optional: true, EnvVars: []string{"OPENPOST_WHOP_PRO_ANNUAL_PLAN_ID"}},
	{Key: "OPENPOST_WHOP_TEAM_MONTHLY_PLAN_ID", Group: "billing", Label: "Team monthly plan ID", Description: "Whop plan used for monthly Team subscriptions.", Kind: ManagedSettingString, Optional: true, EnvVars: []string{"OPENPOST_WHOP_TEAM_MONTHLY_PLAN_ID"}},
	{Key: "OPENPOST_WHOP_TEAM_ANNUAL_PLAN_ID", Group: "billing", Label: "Team annual plan ID", Description: "Whop plan used for annual Team subscriptions.", Kind: ManagedSettingString, Optional: true, EnvVars: []string{"OPENPOST_WHOP_TEAM_ANNUAL_PLAN_ID"}},
	{Key: "OPENPOST_WHOP_AGENCY_MONTHLY_PLAN_ID", Group: "billing", Label: "Agency monthly plan ID", Description: "Whop plan used for monthly Agency subscriptions.", Kind: ManagedSettingString, Optional: true, EnvVars: []string{"OPENPOST_WHOP_AGENCY_MONTHLY_PLAN_ID"}},
	{Key: "OPENPOST_WHOP_AGENCY_ANNUAL_PLAN_ID", Group: "billing", Label: "Agency annual plan ID", Description: "Whop plan used for annual Agency subscriptions.", Kind: ManagedSettingString, Optional: true, EnvVars: []string{"OPENPOST_WHOP_AGENCY_ANNUAL_PLAN_ID"}},

	{Key: "OPENPOST_EMAIL_VERIFICATION_REQUIRED", Group: "email", Label: "Require email verification", Description: "Require a six-digit email code before a password account can sign in.", Kind: ManagedSettingBoolean, EnvVars: []string{"OPENPOST_EMAIL_VERIFICATION_REQUIRED"}},
	{Key: "OPENPOST_EMAIL_PROVIDER", Group: "email", Label: "Email provider", Description: "Delivery service for verification and password recovery messages.", Kind: ManagedSettingEnum, Optional: true, EnvVars: []string{"OPENPOST_EMAIL_PROVIDER"}, Options: []ManagedSettingOption{{Value: "", Label: "Not configured"}, {Value: "smtp", Label: "SMTP"}, {Value: "resend", Label: "Resend"}, {Value: "cloudflare", Label: "Cloudflare Email"}}},
	{Key: "OPENPOST_EMAIL_FROM", Group: "email", Label: "From address", Description: "Sender address used for authentication messages.", Kind: ManagedSettingString, Optional: true, EnvVars: []string{"OPENPOST_EMAIL_FROM", "OPENPOST_SMTP_FROM"}},
	{Key: "OPENPOST_RESEND_API_KEY", Group: "email", Label: "Resend API key", Description: "API key used only when Resend is selected.", Kind: ManagedSettingSecret, Secret: true, Optional: true, EnvVars: []string{"OPENPOST_RESEND_API_KEY"}},
	{Key: "OPENPOST_CLOUDFLARE_EMAIL_ACCOUNT_ID", Group: "email", Label: "Cloudflare account ID", Description: "Cloudflare account that owns the email sending service.", Kind: ManagedSettingString, Optional: true, EnvVars: []string{"OPENPOST_CLOUDFLARE_EMAIL_ACCOUNT_ID"}},
	{Key: "OPENPOST_CLOUDFLARE_EMAIL_API_TOKEN", Group: "email", Label: "Cloudflare API token", Description: "Scoped token used only for authentication email delivery.", Kind: ManagedSettingSecret, Secret: true, Optional: true, EnvVars: []string{"OPENPOST_CLOUDFLARE_EMAIL_API_TOKEN"}},
	{Key: "OPENPOST_SMTP_HOST", Group: "email", Label: "SMTP host", Description: "Hostname of the SMTP server.", Kind: ManagedSettingString, Optional: true, EnvVars: []string{"OPENPOST_SMTP_HOST"}},
	{Key: "OPENPOST_SMTP_PORT", Group: "email", Label: "SMTP port", Description: "Port used to connect to the SMTP server.", Kind: ManagedSettingInteger, EnvVars: []string{"OPENPOST_SMTP_PORT"}},
	{Key: "OPENPOST_SMTP_USERNAME", Group: "email", Label: "SMTP username", Description: "Optional SMTP authentication username.", Kind: ManagedSettingString, Optional: true, EnvVars: []string{"OPENPOST_SMTP_USERNAME"}},
	{Key: "OPENPOST_SMTP_PASSWORD", Group: "email", Label: "SMTP password", Description: "Password used when the SMTP server requires authentication.", Kind: ManagedSettingSecret, Secret: true, Optional: true, EnvVars: []string{"OPENPOST_SMTP_PASSWORD"}},
	{Key: "OPENPOST_SMTP_TLS_MODE", Group: "email", Label: "SMTP TLS mode", Description: "Transport security used for the SMTP connection.", Kind: ManagedSettingEnum, EnvVars: []string{"OPENPOST_SMTP_TLS_MODE"}, Options: []ManagedSettingOption{{Value: "starttls", Label: "STARTTLS"}, {Value: "tls", Label: "TLS"}, {Value: "none", Label: "None"}}},
	{Key: "OPENPOST_SMTP_SERVER_NAME", Group: "email", Label: "SMTP TLS server name", Description: "Optional TLS server name override used for certificate verification.", Kind: ManagedSettingString, Optional: true, EnvVars: []string{"OPENPOST_SMTP_SERVER_NAME"}},

	{Key: "OPENPOST_AUTH_GOOGLE_CLIENT_ID", Group: "authentication", Label: "Google client ID", Description: "OAuth client ID for first-party Google sign-in and account linking.", Kind: ManagedSettingString, Optional: true, EnvVars: []string{"OPENPOST_AUTH_GOOGLE_CLIENT_ID"}},
	{Key: "OPENPOST_AUTH_GOOGLE_CLIENT_SECRET", Group: "authentication", Label: "Google client secret", Description: "OAuth client secret for first-party Google sign-in and account linking.", Kind: ManagedSettingSecret, Secret: true, Optional: true, EnvVars: []string{"OPENPOST_AUTH_GOOGLE_CLIENT_SECRET"}},
	{Key: "OPENPOST_OIDC_ISSUER", Group: "authentication", Label: "OIDC issuer", Description: "Issuer URL for the operator-managed OpenID Connect provider.", Kind: ManagedSettingURL, Optional: true, EnvVars: []string{"OPENPOST_OIDC_ISSUER"}},
	{Key: "OPENPOST_OIDC_CLIENT_ID", Group: "authentication", Label: "OIDC client ID", Description: "Client ID for the operator-managed OpenID Connect provider.", Kind: ManagedSettingString, Optional: true, EnvVars: []string{"OPENPOST_OIDC_CLIENT_ID"}},
	{Key: "OPENPOST_OIDC_CLIENT_SECRET", Group: "authentication", Label: "OIDC client secret", Description: "Client secret for the operator-managed OpenID Connect provider.", Kind: ManagedSettingSecret, Secret: true, Optional: true, EnvVars: []string{"OPENPOST_OIDC_CLIENT_SECRET"}},
	{Key: "OPENPOST_OIDC_NAME", Group: "authentication", Label: "OIDC display name", Description: "Name shown to users for the operator-managed identity provider.", Kind: ManagedSettingString, EnvVars: []string{"OPENPOST_OIDC_NAME"}},
	{Key: "OPENPOST_OIDC_SCOPES", Group: "authentication", Label: "OIDC scopes", Description: "Space- or comma-separated OpenID Connect scopes.", Kind: ManagedSettingList, EnvVars: []string{"OPENPOST_OIDC_SCOPES"}},
	{Key: "OPENPOST_OIDC_JIT_ENABLED", Group: "authentication", Label: "OIDC just-in-time users", Description: "Allow the OIDC provider to create a user on first sign-in.", Kind: ManagedSettingBoolean, EnvVars: []string{"OPENPOST_OIDC_JIT_ENABLED"}},
	{Key: "OPENPOST_OIDC_BOOTSTRAP_ALLOWLIST", Group: "authentication", Label: "OIDC bootstrap subjects", Description: "Subject identifiers allowed to bootstrap organization SSO administration.", Kind: ManagedSettingList, Optional: true, EnvVars: []string{"OPENPOST_OIDC_BOOTSTRAP_ALLOWLIST"}},
	{Key: "OPENPOST_SSO_BREAK_GLASS_EMAILS", Group: "authentication", Label: "SSO break-glass emails", Description: "Accounts that retain direct access if organization SSO is unavailable.", Kind: ManagedSettingList, Optional: true, EnvVars: []string{"OPENPOST_SSO_BREAK_GLASS_EMAILS"}},
	{Key: "OPENPOST_OIDC_NATIVE_CALLBACK_URL", Group: "authentication", Label: "Native OIDC callback", Description: "Callback URI used by native OpenPost clients.", Kind: ManagedSettingString, EnvVars: []string{"OPENPOST_OIDC_NATIVE_CALLBACK_URL"}},

	{Key: "OPENPOST_STUDIO_ENABLED", Group: "features", Label: "Design Studio", Description: "Enable the design workspace and its model assets.", Kind: ManagedSettingBoolean, EnvVars: []string{"OPENPOST_STUDIO_ENABLED"}},
	{Key: "OPENPOST_STUDIO_MODEL_BASE_URL", Group: "features", Label: "Design Studio model path", Description: "URL or application path used to load Design Studio models.", Kind: ManagedSettingString, EnvVars: []string{"OPENPOST_STUDIO_MODEL_BASE_URL"}},
	{Key: "OPENPOST_VIDEO_STUDIO_ENABLED", Group: "features", Label: "Video Studio", Description: "Enable the browser-based video editing workspace.", Kind: ManagedSettingBoolean, EnvVars: []string{"OPENPOST_VIDEO_STUDIO_ENABLED"}},
	{Key: "OPENPOST_VIDEO_MODEL_BASE_URL", Group: "features", Label: "Video Studio model path", Description: "URL or application path used to load Video Studio models.", Kind: ManagedSettingString, EnvVars: []string{"OPENPOST_VIDEO_MODEL_BASE_URL"}},
	{Key: "OPENPOST_STOCK_MEDIA_ENABLED", Group: "features", Label: "Stock media search", Description: "Enable stock search when at least one provider key is configured.", Kind: ManagedSettingBoolean, EnvVars: []string{"OPENPOST_STOCK_MEDIA_ENABLED"}},
	{Key: "OPENPOST_PEXELS_API_KEY", Group: "features", Label: "Pexels API key", Description: "Optional API key for Pexels stock search.", Kind: ManagedSettingSecret, Secret: true, Optional: true, EnvVars: []string{"OPENPOST_PEXELS_API_KEY"}},
	{Key: "OPENPOST_UNSPLASH_ACCESS_KEY", Group: "features", Label: "Unsplash access key", Description: "Optional access key for Unsplash stock search.", Kind: ManagedSettingSecret, Secret: true, Optional: true, EnvVars: []string{"OPENPOST_UNSPLASH_ACCESS_KEY"}},
	{Key: "OPENPOST_PIXABAY_API_KEY", Group: "features", Label: "Pixabay API key", Description: "Optional API key for Pixabay stock search.", Kind: ManagedSettingSecret, Secret: true, Optional: true, EnvVars: []string{"OPENPOST_PIXABAY_API_KEY"}},
	{Key: "OPENPOST_FEEDBACK_ENABLED", Group: "features", Label: "In-app feedback", Description: "Show the feedback action and send submissions to the configured destination.", Kind: ManagedSettingBoolean, EnvVars: []string{"OPENPOST_FEEDBACK_ENABLED"}},
	{Key: "OPENPOST_FEEDBACK_DESTINATION_URL", Group: "features", Label: "Feedback destination", Description: "Webhook or form endpoint that receives feedback submissions.", Kind: ManagedSettingURL, Optional: true, EnvVars: []string{"OPENPOST_FEEDBACK_DESTINATION_URL"}},
	{Key: "OPENPOST_FEEDBACK_RECIPIENT", Group: "features", Label: "Feedback recipient", Description: "Optional recipient identifier sent with feedback submissions.", Kind: ManagedSettingString, Optional: true, EnvVars: []string{"OPENPOST_FEEDBACK_RECIPIENT"}},
	{Key: "OPENPOST_FEEDBACK_SUPPORT_URL", Group: "features", Label: "Support link", Description: "Fallback URL shown when direct feedback delivery is unavailable.", Kind: ManagedSettingURL, Optional: true, EnvVars: []string{"OPENPOST_FEEDBACK_SUPPORT_URL"}},

	{Key: "OPENPOST_DISABLE_LINKEDIN_THREAD_REPLIES", Group: "providers", Label: "Disable LinkedIn thread replies", Description: "Publish only the first segment of LinkedIn threads.", Kind: ManagedSettingBoolean, EnvVars: []string{"OPENPOST_DISABLE_LINKEDIN_THREAD_REPLIES", "LINKEDIN_DISABLE_THREAD_REPLIES"}},
	{Key: "OPENPOST_LINKEDIN_ORGANIZATIONS_ENABLED", Group: "providers", Label: "LinkedIn organizations", Description: "Allow publishing through LinkedIn organization pages when the app has permission.", Kind: ManagedSettingBoolean, EnvVars: []string{"OPENPOST_LINKEDIN_ORGANIZATIONS_ENABLED"}},
	{Key: "OPENPOST_X_MONTHLY_BUDGET_MICROUSD", Group: "providers", Label: "X monthly API budget", Description: "Hosted X API budget in millionths of a US dollar.", Kind: ManagedSettingInteger, EnvVars: []string{"OPENPOST_X_MONTHLY_BUDGET_MICROUSD"}},
	{Key: "OPENPOST_X_POST_CREATE_COST_MICROUSD", Group: "providers", Label: "X post API cost", Description: "Estimated cost of an X post request in millionths of a US dollar.", Kind: ManagedSettingInteger, EnvVars: []string{"OPENPOST_X_POST_CREATE_COST_MICROUSD"}},
	{Key: "OPENPOST_X_POST_CREATE_WITH_URL_COST_MICROUSD", Group: "providers", Label: "X post-with-URL API cost", Description: "Estimated cost of an X post request containing a URL.", Kind: ManagedSettingInteger, EnvVars: []string{"OPENPOST_X_POST_CREATE_WITH_URL_COST_MICROUSD"}},
	{Key: "OPENPOST_PROVIDER_USAGE_RETENTION_DAYS", Group: "providers", Label: "Provider usage retention", Description: "Days to keep provider usage and reservation records. Use zero to keep them.", Kind: ManagedSettingInteger, EnvVars: []string{"OPENPOST_PROVIDER_USAGE_RETENTION_DAYS"}},
}

func ManagedSettingDefinitions() []ManagedSettingDefinition {
	definitions := make([]ManagedSettingDefinition, len(managedSettingDefinitions))
	copy(definitions, managedSettingDefinitions)
	return definitions
}

func ManagedSettingDefinitionFor(key string) (ManagedSettingDefinition, bool) {
	for _, definition := range managedSettingDefinitions {
		if definition.Key == key {
			return definition, true
		}
	}
	return ManagedSettingDefinition{}, false
}

func ManagedEnvironmentSource(key string) (string, bool) {
	definition, ok := ManagedSettingDefinitionFor(key)
	if !ok {
		return "", false
	}
	for _, envKey := range definition.EnvVars {
		if _, source, set := getEnvValue(envKey); set {
			return source, true
		}
	}
	return "", false
}

type managedSettingBinding struct {
	get func(*Config) string
	set func(*Config, string)
}

func stringBinding(field func(*Config) *string) managedSettingBinding {
	return managedSettingBinding{
		get: func(c *Config) string { return *field(c) },
		set: func(c *Config, value string) { *field(c) = value },
	}
}

func trimmedStringBinding(field func(*Config) *string) managedSettingBinding {
	binding := stringBinding(field)
	binding.set = func(c *Config, value string) { *field(c) = strings.TrimRight(value, "/") }
	return binding
}

func boolBinding(field func(*Config) *bool) managedSettingBinding {
	return managedSettingBinding{
		get: func(c *Config) string { return strconv.FormatBool(*field(c)) },
		set: func(c *Config, value string) { *field(c), _ = strconv.ParseBool(value) },
	}
}

func intBinding(field func(*Config) *int) managedSettingBinding {
	return managedSettingBinding{
		get: func(c *Config) string { return strconv.Itoa(*field(c)) },
		set: func(c *Config, value string) { *field(c), _ = strconv.Atoi(value) },
	}
}

func int64Binding(field func(*Config) *int64) managedSettingBinding {
	return managedSettingBinding{
		get: func(c *Config) string { return strconv.FormatInt(*field(c), 10) },
		set: func(c *Config, value string) { *field(c), _ = strconv.ParseInt(value, 10, 64) },
	}
}

func listBinding(field func(*Config) *[]string) managedSettingBinding {
	return managedSettingBinding{
		get: func(c *Config) string { return strings.Join(*field(c), ", ") },
		set: func(c *Config, value string) { *field(c) = parseStringList(value) },
	}
}

var managedSettingBindings = map[string]managedSettingBinding{
	"OPENPOST_DISABLE_REGISTRATIONS":                boolBinding(func(c *Config) *bool { return &c.DisableRegistrations }),
	"OPENPOST_LEGAL_ACCEPTANCE_REQUIRED":            boolBinding(func(c *Config) *bool { return &c.LegalAcceptanceRequired }),
	"OPENPOST_TERMS_URL":                            stringBinding(func(c *Config) *string { return &c.TermsURL }),
	"OPENPOST_PRIVACY_URL":                          stringBinding(func(c *Config) *string { return &c.PrivacyURL }),
	"OPENPOST_TERMS_VERSION":                        stringBinding(func(c *Config) *string { return &c.TermsVersion }),
	"OPENPOST_PRIVACY_VERSION":                      stringBinding(func(c *Config) *string { return &c.PrivacyVersion }),
	"OPENPOST_SUPPORT_EMAIL":                        stringBinding(func(c *Config) *string { return &c.SupportEmail }),
	"OPENPOST_UPDATE_CHECK_ENABLED":                 boolBinding(func(c *Config) *bool { return &c.UpdateCheckEnabled }),
	"OPENPOST_WHOP_API_KEY":                         stringBinding(func(c *Config) *string { return &c.WhopAPIKey }),
	"OPENPOST_WHOP_API_BASE_URL":                    trimmedStringBinding(func(c *Config) *string { return &c.WhopAPIBaseURL }),
	"OPENPOST_WHOP_WEBHOOK_SECRET":                  stringBinding(func(c *Config) *string { return &c.WhopWebhookSecret }),
	"OPENPOST_WHOP_ACCOUNT_ID":                      stringBinding(func(c *Config) *string { return &c.WhopAccountID }),
	"OPENPOST_WHOP_PRODUCT_ID":                      stringBinding(func(c *Config) *string { return &c.WhopProductID }),
	"OPENPOST_WHOP_CHECKOUT_RETURN_URL":             stringBinding(func(c *Config) *string { return &c.WhopCheckoutReturnURL }),
	"OPENPOST_WHOP_STARTER_MONTHLY_PLAN_ID":         stringBinding(func(c *Config) *string { return &c.WhopStarterMonthlyPlanID }),
	"OPENPOST_WHOP_STARTER_ANNUAL_PLAN_ID":          stringBinding(func(c *Config) *string { return &c.WhopStarterAnnualPlanID }),
	"OPENPOST_WHOP_CREATOR_MONTHLY_PLAN_ID":         stringBinding(func(c *Config) *string { return &c.WhopCreatorMonthlyPlanID }),
	"OPENPOST_WHOP_CREATOR_ANNUAL_PLAN_ID":          stringBinding(func(c *Config) *string { return &c.WhopCreatorAnnualPlanID }),
	"OPENPOST_WHOP_PRO_MONTHLY_PLAN_ID":             stringBinding(func(c *Config) *string { return &c.WhopProMonthlyPlanID }),
	"OPENPOST_WHOP_PRO_ANNUAL_PLAN_ID":              stringBinding(func(c *Config) *string { return &c.WhopProAnnualPlanID }),
	"OPENPOST_WHOP_TEAM_MONTHLY_PLAN_ID":            stringBinding(func(c *Config) *string { return &c.WhopTeamMonthlyPlanID }),
	"OPENPOST_WHOP_TEAM_ANNUAL_PLAN_ID":             stringBinding(func(c *Config) *string { return &c.WhopTeamAnnualPlanID }),
	"OPENPOST_WHOP_AGENCY_MONTHLY_PLAN_ID":          stringBinding(func(c *Config) *string { return &c.WhopAgencyMonthlyPlanID }),
	"OPENPOST_WHOP_AGENCY_ANNUAL_PLAN_ID":           stringBinding(func(c *Config) *string { return &c.WhopAgencyAnnualPlanID }),
	"OPENPOST_EMAIL_VERIFICATION_REQUIRED":          boolBinding(func(c *Config) *bool { return &c.EmailVerificationRequired }),
	"OPENPOST_EMAIL_PROVIDER":                       stringBinding(func(c *Config) *string { return &c.EmailProvider }),
	"OPENPOST_EMAIL_FROM":                           stringBinding(func(c *Config) *string { return &c.EmailFrom }),
	"OPENPOST_RESEND_API_KEY":                       stringBinding(func(c *Config) *string { return &c.ResendAPIKey }),
	"OPENPOST_CLOUDFLARE_EMAIL_ACCOUNT_ID":          stringBinding(func(c *Config) *string { return &c.CloudflareEmailAccountID }),
	"OPENPOST_CLOUDFLARE_EMAIL_API_TOKEN":           stringBinding(func(c *Config) *string { return &c.CloudflareEmailAPIToken }),
	"OPENPOST_SMTP_HOST":                            stringBinding(func(c *Config) *string { return &c.SMTPHost }),
	"OPENPOST_SMTP_PORT":                            intBinding(func(c *Config) *int { return &c.SMTPPort }),
	"OPENPOST_SMTP_USERNAME":                        stringBinding(func(c *Config) *string { return &c.SMTPUsername }),
	"OPENPOST_SMTP_PASSWORD":                        stringBinding(func(c *Config) *string { return &c.SMTPPassword }),
	"OPENPOST_SMTP_TLS_MODE":                        stringBinding(func(c *Config) *string { return &c.SMTPTLSMode }),
	"OPENPOST_SMTP_SERVER_NAME":                     stringBinding(func(c *Config) *string { return &c.SMTPServerName }),
	"OPENPOST_AUTH_GOOGLE_CLIENT_ID":                stringBinding(func(c *Config) *string { return &c.GoogleAuthClientID }),
	"OPENPOST_AUTH_GOOGLE_CLIENT_SECRET":            stringBinding(func(c *Config) *string { return &c.GoogleAuthClientSecret }),
	"OPENPOST_OIDC_ISSUER":                          stringBinding(func(c *Config) *string { return &c.OIDCIssuer }),
	"OPENPOST_OIDC_CLIENT_ID":                       stringBinding(func(c *Config) *string { return &c.OIDCClientID }),
	"OPENPOST_OIDC_CLIENT_SECRET":                   stringBinding(func(c *Config) *string { return &c.OIDCClientSecret }),
	"OPENPOST_OIDC_NAME":                            stringBinding(func(c *Config) *string { return &c.OIDCName }),
	"OPENPOST_OIDC_SCOPES":                          listBinding(func(c *Config) *[]string { return &c.OIDCScopes }),
	"OPENPOST_OIDC_JIT_ENABLED":                     boolBinding(func(c *Config) *bool { return &c.OIDCJITEnabled }),
	"OPENPOST_OIDC_BOOTSTRAP_ALLOWLIST":             listBinding(func(c *Config) *[]string { return &c.OIDCBootstrapAllowlist }),
	"OPENPOST_SSO_BREAK_GLASS_EMAILS":               listBinding(func(c *Config) *[]string { return &c.OIDCBreakGlassEmails }),
	"OPENPOST_OIDC_NATIVE_CALLBACK_URL":             stringBinding(func(c *Config) *string { return &c.OIDCNativeCallbackURL }),
	"OPENPOST_STUDIO_ENABLED":                       boolBinding(func(c *Config) *bool { return &c.StudioEnabled }),
	"OPENPOST_STUDIO_MODEL_BASE_URL":                trimmedStringBinding(func(c *Config) *string { return &c.StudioModelBaseURL }),
	"OPENPOST_VIDEO_STUDIO_ENABLED":                 boolBinding(func(c *Config) *bool { return &c.VideoStudioEnabled }),
	"OPENPOST_VIDEO_MODEL_BASE_URL":                 trimmedStringBinding(func(c *Config) *string { return &c.VideoModelBaseURL }),
	"OPENPOST_STOCK_MEDIA_ENABLED":                  boolBinding(func(c *Config) *bool { return &c.StockMediaEnabled }),
	"OPENPOST_PEXELS_API_KEY":                       stringBinding(func(c *Config) *string { return &c.PexelsAPIKey }),
	"OPENPOST_UNSPLASH_ACCESS_KEY":                  stringBinding(func(c *Config) *string { return &c.UnsplashAccessKey }),
	"OPENPOST_PIXABAY_API_KEY":                      stringBinding(func(c *Config) *string { return &c.PixabayAPIKey }),
	"OPENPOST_FEEDBACK_ENABLED":                     boolBinding(func(c *Config) *bool { return &c.FeedbackEnabled }),
	"OPENPOST_FEEDBACK_DESTINATION_URL":             stringBinding(func(c *Config) *string { return &c.FeedbackDestinationURL }),
	"OPENPOST_FEEDBACK_RECIPIENT":                   stringBinding(func(c *Config) *string { return &c.FeedbackRecipient }),
	"OPENPOST_FEEDBACK_SUPPORT_URL":                 stringBinding(func(c *Config) *string { return &c.FeedbackSupportURL }),
	"OPENPOST_DISABLE_LINKEDIN_THREAD_REPLIES":      boolBinding(func(c *Config) *bool { return &c.DisableLinkedInThreadReplies }),
	"OPENPOST_LINKEDIN_ORGANIZATIONS_ENABLED":       boolBinding(func(c *Config) *bool { return &c.EnableLinkedInOrganizations }),
	"OPENPOST_X_MONTHLY_BUDGET_MICROUSD":            int64Binding(func(c *Config) *int64 { return &c.XMonthlyBudgetMicrousd }),
	"OPENPOST_X_POST_CREATE_COST_MICROUSD":          int64Binding(func(c *Config) *int64 { return &c.XPostCreateCostMicrousd }),
	"OPENPOST_X_POST_CREATE_WITH_URL_COST_MICROUSD": int64Binding(func(c *Config) *int64 { return &c.XPostCreateWithURLCostMicrousd }),
	"OPENPOST_PROVIDER_USAGE_RETENTION_DAYS":        intBinding(func(c *Config) *int { return &c.ProviderUsageRetentionDays }),
}

func (c *Config) ManagedValue(key string) (string, error) {
	binding, ok := managedSettingBindings[key]
	if !ok {
		return "", fmt.Errorf("unsupported managed setting %q", key)
	}
	return binding.get(c), nil
}

type managedSettingValidator func(ManagedSettingDefinition, string) (string, error)

var managedSettingValidators = map[ManagedSettingKind]managedSettingValidator{
	ManagedSettingBoolean: func(_ ManagedSettingDefinition, value string) (string, error) {
		parsed, err := strconv.ParseBool(value)
		if err != nil {
			return "", fmt.Errorf("must be true or false")
		}
		return strconv.FormatBool(parsed), nil
	},
	ManagedSettingInteger: func(definition ManagedSettingDefinition, value string) (string, error) {
		parsed, err := strconv.ParseInt(value, 10, 64)
		if err != nil {
			return "", fmt.Errorf("must be an integer")
		}
		if parsed < 0 {
			return "", fmt.Errorf("must be zero or greater")
		}
		if definition.Key == "OPENPOST_SMTP_PORT" && (parsed < 1 || parsed > 65535) {
			return "", fmt.Errorf("must be between 1 and 65535")
		}
		return strconv.FormatInt(parsed, 10), nil
	},
	ManagedSettingEnum: func(definition ManagedSettingDefinition, value string) (string, error) {
		value = strings.ToLower(value)
		for _, option := range definition.Options {
			if option.Value == value {
				return value, nil
			}
		}
		return "", fmt.Errorf("must be one of the supported values")
	},
	ManagedSettingURL: func(_ ManagedSettingDefinition, value string) (string, error) {
		parsed, err := url.Parse(value)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return "", fmt.Errorf("must be an absolute HTTP or HTTPS URL")
		}
		return strings.TrimRight(value, "/"), nil
	},
	ManagedSettingEmail: func(_ ManagedSettingDefinition, value string) (string, error) {
		address, err := mail.ParseAddress(value)
		if err != nil || !strings.Contains(address.Address, "@") {
			return "", fmt.Errorf("must be a valid email address")
		}
		return address.Address, nil
	},
	ManagedSettingList: func(_ ManagedSettingDefinition, value string) (string, error) {
		return strings.Join(parseStringList(value), ", "), nil
	},
}

func ValidateManagedValue(definition ManagedSettingDefinition, raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" && definition.Optional {
		return "", nil
	}
	validator, ok := managedSettingValidators[definition.Kind]
	if !ok {
		return value, nil
	}
	return validator(definition, value)
}

func (c *Config) ApplyManagedValue(key, raw string) error {
	definition, ok := ManagedSettingDefinitionFor(key)
	if !ok {
		return fmt.Errorf("unsupported managed setting %q", key)
	}
	value, err := ValidateManagedValue(definition, raw)
	if err != nil {
		return fmt.Errorf("%s %w", key, err)
	}
	binding, ok := managedSettingBindings[key]
	if !ok {
		return fmt.Errorf("unsupported managed setting %q", key)
	}
	binding.set(c, value)
	return nil
}
