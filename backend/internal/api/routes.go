package api

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/handlers"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/memes"
	"github.com/openpost/backend/internal/platform"
	analyticsservice "github.com/openpost/backend/internal/services/analytics"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/billing"
	cliauth "github.com/openpost/backend/internal/services/cli_auth"
	communicationsservice "github.com/openpost/backend/internal/services/communications"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/emailchange"
	"github.com/openpost/backend/internal/services/emailverification"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/feedback"
	"github.com/openpost/backend/internal/services/identity"
	"github.com/openpost/backend/internal/services/imagecaption"
	"github.com/openpost/backend/internal/services/instancesettings"
	"github.com/openpost/backend/internal/services/mastodonapps"
	"github.com/openpost/backend/internal/services/mcpoauth"
	"github.com/openpost/backend/internal/services/mediasigner"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/memegeneration"
	"github.com/openpost/backend/internal/services/mfa"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/openpost/backend/internal/services/passwordmail"
	"github.com/openpost/backend/internal/services/providerapps"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/publicurl"
	repostservice "github.com/openpost/backend/internal/services/reposts"
	"github.com/openpost/backend/internal/services/sessions"
	"github.com/openpost/backend/internal/services/updatestatus"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/uptrace/bun"
)

type RouteDeps struct {
	DB                           *bun.DB
	AuthService                  *auth.Service
	Authenticator                middleware.Authenticator
	SessionService               *sessions.Service
	APITokenService              *apitokens.Service
	CLIAuthService               *cliauth.Service
	MCPOAuthService              *mcpoauth.Service
	BillingService               *billing.Service
	MediaStorage                 mediastore.BlobStorage
	MediaSigner                  *mediasigner.Signer
	ImageCaptioner               imagecaption.Captioner
	MemeProvider                 memes.Provider
	MemeSuggester                memegeneration.Suggester
	PublicMediaVerifier          *publicurl.MediaVerifier
	Entitlement                  entitlements.Service
	TokenEncryptor               *servicecrypto.TokenEncryptor
	TokenSource                  handlers.AccessTokenSource
	MFAService                   *mfa.Service
	PasswordResetSender          passwordmail.Sender
	EmailVerificationService     *emailverification.Service
	EmailChangeService           *emailchange.Service
	EmailVerificationRequired    bool
	PublicProfilesEnabled        bool
	AccountPolicy                handlers.AccountPolicy
	Providers                    map[string]platform.Adapter
	ProviderApps                 []platform.AppConfig
	ProviderRegistrars           []func(string, platform.Adapter)
	MastodonAppService           *mastodonapps.Service
	FrontendURL                  string
	PublicURL                    string
	DisableRegistrations         bool
	DisableLinkedInThreadReplies bool
	ImageEditorEnabled           bool
	ImageEditorModelBaseURL      string
	VideoModelBaseURL            string
	StockMediaEnabled            bool
	PexelsAPIKey                 string
	UnsplashAccessKey            string
	PixabayAPIKey                string
	FeedbackService              *feedback.Service
	IdentityService              *identity.Service
	InstanceSettingsService      *instancesettings.Service
	AnalyticsService             *analyticsservice.Service
	CommunicationsService        *communicationsservice.Service
	RepostService                *repostservice.Service
	NotificationService          *notifications.Service
	UpdateStatusService          *updatestatus.Service
	ProviderReadinessService     *providerreadiness.Service
	AppVersion                   string
	AppRevision                  string
	Edition                      string
	Telemetry                    telemetry.Recorder

	MediaHandler    *handlers.MediaHandler
	BillingHandler  *handlers.BillingHandler
	MCPOAuthHandler *handlers.MCPOAuthHandler
	ProfileHandler  *handlers.ProfileHandler
}

func RegisterHumaRoutes(api huma.API, deps RouteDeps) {
	profileHandler := deps.ProfileHandler
	if profileHandler == nil {
		profileHandler = handlers.NewProfileHandler(deps.DB, deps.Authenticator, deps.MediaStorage)
	}
	profileHandler.RegisterRoutes(api)

	mediaHandler := deps.MediaHandler
	if mediaHandler == nil {
		mediaHandler = handlers.NewMediaHandler(deps.DB, deps.MediaStorage, deps.AuthService, deps.Authenticator, deps.MediaSigner)
		mediaHandler.SetEntitlement(deps.Entitlement)
	}
	mediaHandler.SetPublicMediaVerifier(deps.PublicMediaVerifier)
	mediaHandler.RegisterRoutes(api)
	mediaHandler.RegisterImageCaptionRoutes(api, deps.ImageCaptioner)
	handlers.NewMemeHandler(
		deps.DB,
		deps.Authenticator,
		mediaHandler,
		deps.PublicMediaVerifier,
		deps.MemeProvider,
		deps.MemeSuggester,
	).RegisterRoutes(api)
	handlers.NewImageEditorHandler(
		deps.DB,
		deps.Authenticator,
		deps.ImageEditorEnabled,
		deps.ImageEditorModelBaseURL,
	).RegisterRoutes(api)
	stockMediaHandler := handlers.NewStockMediaHandler(
		deps.DB,
		deps.StockMediaEnabled,
		deps.PexelsAPIKey,
		deps.UnsplashAccessKey,
		deps.PixabayAPIKey,
	)
	stockMediaHandler.RegisterRoutes(api)
	videoEditorHandler := handlers.NewVideoEditorHandler(
		deps.DB,
		deps.Authenticator,
		deps.VideoModelBaseURL,
	)
	videoEditorHandler.SetEntitlement(deps.Entitlement)
	videoEditorHandler.SetStockProviders(stockMediaHandler.ProviderKeys())
	videoEditorHandler.RegisterRoutes(api)

	billingHandler := deps.BillingHandler
	if billingHandler == nil {
		billingHandler = handlers.NewBillingHandler(deps.BillingService, deps.DB, deps.Authenticator)
	}
	billingHandler.RegisterAPIRoutes(api)

	authHandler := handlers.NewAuthHandler(
		deps.DB,
		deps.AuthService,
		deps.Authenticator,
		deps.TokenEncryptor,
		deps.MFAService,
		deps.DisableRegistrations,
	)
	authHandler.SetSessionService(deps.SessionService)
	authHandler.SetPasswordResetSender(deps.PasswordResetSender, deps.PublicURL)
	authHandler.SetEmailVerification(deps.EmailVerificationService, deps.PasswordResetSender, deps.EmailVerificationRequired)
	authHandler.SetPublicProfilesEnabled(deps.PublicProfilesEnabled)
	authHandler.SetAccountPolicy(deps.AccountPolicy)
	authHandler.SetIdentityService(deps.IdentityService)
	authHandler.Configuration(api)
	authHandler.AcceptAccountPolicy(api)
	authHandler.Register(api)
	authHandler.ConfirmEmailVerification(api)
	authHandler.ResendEmailVerification(api)
	authHandler.Login(api)
	authHandler.Logout(api)
	authHandler.RequestPasswordReset(api)
	authHandler.ResetPassword(api)
	authHandler.ChangePassword(api)
	authHandler.VerifyTOTPLogin(api)
	authHandler.VerifyRecoveryCodeLogin(api)
	authHandler.BeginPasskeyLogin(api)
	authHandler.FinishPasskeyLogin(api)
	authHandler.BeginPasskeyReauthentication(api)
	authHandler.FinishPasskeyReauthentication(api)
	authHandler.SessionState(api)
	authHandler.Me(api)
	authHandler.UpdateProfile(api)
	authHandler.SecurityStatus(api)
	authHandler.ListSessions(api)
	authHandler.RevokeSession(api)
	authHandler.BeginTOTPSetup(api)
	authHandler.ConfirmTOTPSetup(api)
	authHandler.AcknowledgeTOTPSetup(api)
	authHandler.RecoveryCodeStatus(api)
	authHandler.BeginRecoveryCodeRegeneration(api)
	authHandler.AcknowledgeRecoveryCodeRegeneration(api)
	authHandler.DisableTOTP(api)
	authHandler.BeginPasskeyRegistration(api)
	authHandler.FinishPasskeyRegistration(api)
	authHandler.RemovePasskey(api)
	handlers.NewEmailChangeHandler(
		deps.EmailChangeService,
		deps.IdentityService,
		deps.PasswordResetSender,
		deps.Authenticator,
		deps.PublicURL,
	).RegisterRoutes(api)
	handlers.NewOIDCHandler(deps.IdentityService, authHandler, deps.Authenticator).RegisterRoutes(api)
	handlers.NewPublicProfileHandler(deps.DB, deps.PublicProfilesEnabled).RegisterRoutes(api)

	accountLifecycleHandler := handlers.NewAccountLifecycleHandler(
		deps.DB,
		deps.AuthService,
		deps.Authenticator,
		deps.MediaStorage,
	)
	accountLifecycleHandler.SetIdentityService(deps.IdentityService)
	accountLifecycleHandler.RegisterRoutes(api)

	handlers.NewAPITokenHandler(deps.APITokenService, deps.Authenticator, deps.DB).RegisterRoutes(api)
	cliAuthHandler := handlers.NewCLIAuthHandler(deps.CLIAuthService, deps.Authenticator, deps.PublicURL)
	cliAuthHandler.SetIdentityService(deps.IdentityService)
	cliAuthHandler.RegisterRoutes(api)
	handlers.NewMCPActivityHandler(deps.DB, deps.Authenticator).RegisterRoutes(api)
	handlers.NewProviderAppHandler(
		providerapps.NewService(deps.DB, deps.TokenEncryptor),
		deps.DB,
		deps.Authenticator,
		handlers.WithEnvironmentProviderApps(deps.ProviderApps),
		handlers.WithProviderAppFrontendURL(deps.FrontendURL),
	).RegisterRoutes(api)
	handlers.NewCapabilityHandler().RegisterRoutes(api)
	capabilityResolverHandler := handlers.NewCapabilityResolverHandler(deps.DB, deps.Authenticator, deps.Providers, deps.TokenSource)
	capabilityResolverHandler.SetPublicMediaVerifier(deps.PublicMediaVerifier)
	capabilityResolverHandler.SetProviderReadiness(deps.ProviderReadinessService)
	capabilityResolverHandler.RegisterRoutes(api)
	handlers.NewProviderReadinessHandler(deps.DB, deps.Authenticator, deps.ProviderReadinessService, deps.Providers).RegisterRoutes(api)
	handlers.NewProviderReadinessAdminHandler(deps.DB, deps.Authenticator, deps.ProviderReadinessService).RegisterRoutes(api)
	handlers.NewDestinationOptionsHandler(deps.DB, deps.Authenticator, deps.Providers, deps.TokenSource).RegisterRoutes(api)
	publicationHandler := handlers.NewPublicationHandler(deps.DB, deps.Authenticator, deps.Entitlement)
	publicationHandler.SetCapabilityDependencies(deps.Providers, deps.TokenSource)
	publicationHandler.SetPublicMediaVerifier(deps.PublicMediaVerifier)
	publicationHandler.SetRepostService(deps.RepostService)
	publicationHandler.SetProviderReadiness(deps.ProviderReadinessService)
	publicationHandler.SetTelemetry(deps.Telemetry)
	publicationHandler.RegisterRoutes(api)
	handlers.NewSocialSetHandler(deps.DB, deps.Authenticator).RegisterRoutes(api)
	handlers.NewRepostHandler(deps.DB, deps.RepostService, deps.Authenticator).RegisterRoutes(api)
	commentHandler := handlers.NewCommentHandler(deps.DB, deps.Authenticator, deps.Providers, deps.TokenEncryptor)
	commentHandler.SetTokenSource(deps.TokenSource)
	commentHandler.RegisterRoutes(api)
	handlers.NewAnalyticsHandler(deps.DB, deps.Authenticator, deps.AnalyticsService).RegisterRoutes(api)
	handlers.NewCommunicationsHandler(deps.DB, deps.Authenticator, deps.CommunicationsService).RegisterRoutes(api)
	handlers.NewNotificationHandler(deps.DB, deps.Authenticator, deps.NotificationService).RegisterRoutes(api)
	handlers.NewInstanceAdminHandler(
		deps.DB,
		deps.Authenticator,
		deps.AuthService,
		deps.SessionService,
		deps.FrontendURL,
	).RegisterRoutes(api)
	handlers.NewInstanceSettingsHandler(deps.InstanceSettingsService, deps.DB, deps.Authenticator).RegisterRoutes(api)
	handlers.NewUpdateStatusHandler(deps.DB, deps.Authenticator, deps.UpdateStatusService, deps.InstanceSettingsService).RegisterRoutes(api)

	mcpOAuthHandler := deps.MCPOAuthHandler
	if mcpOAuthHandler == nil {
		mcpOAuthHandler = handlers.NewMCPOAuthHandler(deps.MCPOAuthService, deps.Authenticator, deps.PublicURL)
	}
	mcpOAuthHandler.SetIdentityService(deps.IdentityService)
	mcpOAuthHandler.RegisterAPIRoutes(api)

	workspaceHandler := handlers.NewWorkspaceHandler(deps.DB, deps.Authenticator, deps.Entitlement)
	workspaceHandler.SetFrontendURL(deps.FrontendURL)
	workspaceHandler.SetNotificationService(deps.NotificationService)
	workspaceHandler.CreateWorkspace(api)
	workspaceHandler.ListWorkspaces(api)
	workspaceHandler.DeleteWorkspace(api)
	workspaceHandler.ListOrganizations(api)
	workspaceHandler.ListOrganizationTeam(api)
	workspaceHandler.ListWorkspaceTeam(api)
	workspaceHandler.CreateWorkspaceInvitation(api)
	workspaceHandler.ResendWorkspaceInvitation(api)
	workspaceHandler.RevokeWorkspaceInvitation(api)
	workspaceHandler.UpdateWorkspaceMember(api)
	workspaceHandler.RemoveWorkspaceMember(api)
	workspaceHandler.ListWorkspaceAccessAudit(api)
	workspaceHandler.AcceptWorkspaceInvitation(api)
	workspaceHandler.GetWorkspaceSettings(api)
	workspaceHandler.UpdateWorkspaceSettings(api)

	postHandler := handlers.NewPostHandler(deps.DB, deps.Authenticator, deps.Entitlement)
	postHandler.SetRepostService(deps.RepostService)
	postHandler.SetCapabilityDependencies(deps.Providers, deps.TokenSource)
	postHandler.CreatePost(api)
	postHandler.CreateTextPostDraft(api)
	postHandler.CreateThread(api)
	postHandler.ListPosts(api)
	postHandler.GetPost(api)
	postHandler.SaveTextPostDraft(api)
	postHandler.UpdatePost(api)
	postHandler.DeletePost(api)
	postHandler.GetScheduleOverview(api)
	postHandler.UpsertVariants(api)
	postHandler.GetVariants(api)
	postHandler.DeleteVariants(api)

	postingScheduleHandler := handlers.NewPostingScheduleHandler(deps.DB, deps.Authenticator)
	postingScheduleHandler.ListSchedules(api)
	postingScheduleHandler.CreateSchedule(api)
	postingScheduleHandler.UpdateSchedule(api)
	postingScheduleHandler.DeleteSchedule(api)
	postingScheduleHandler.SuggestSchedule(api)
	postingScheduleHandler.GetNextAvailableSlot(api)

	promptHandler := handlers.NewPromptHandler(deps.DB, deps.Authenticator)
	promptHandler.ListPrompts(api)
	promptHandler.CreatePrompt(api)
	promptHandler.DeletePrompt(api)
	promptHandler.GetRandomPrompt(api)
	promptHandler.GetCategories(api)

	handlers.NewJobHandler(deps.DB, deps.Authenticator).RegisterRoutes(api)
	handlers.NewFeedbackHandler(deps.FeedbackService, deps.Authenticator).RegisterRoutes(api)

	oauthHandler := handlers.NewOAuthHandler(
		deps.DB,
		deps.TokenEncryptor,
		deps.Providers,
		deps.Authenticator,
		deps.DisableLinkedInThreadReplies,
		deps.FrontendURL,
	)
	oauthHandler.SetEntitlement(deps.Entitlement)
	oauthHandler.SetMastodonAppService(deps.MastodonAppService)
	oauthHandler.SetProviderReadiness(deps.ProviderReadinessService)
	oauthHandler.SetProviderRegistrars(deps.ProviderRegistrars...)
	oauthHandler.ListProviders(api)
	oauthHandler.ListMastodonServers(api)
	oauthHandler.GetAuthURL(api)
	oauthHandler.Callback(api)
	oauthHandler.ExchangeCode(api)
	oauthHandler.BlueskyLogin(api)
	oauthHandler.DiscordWebhookLogin(api)
	oauthHandler.GetAccountSelection(api)
	oauthHandler.CompleteAccountSelection(api)
	oauthHandler.ListAccounts(api)
	oauthHandler.UpdateAccount(api)
	oauthHandler.DisconnectAccount(api)
	oauthHandler.RevokeAccountGrant(api)

	RegisterHealth(api, deps.DB)
	RegisterVersion(api, BuildInfo{
		Version:  deps.AppVersion,
		Revision: deps.AppRevision,
		Edition:  deps.Edition,
	})
	RegisterTelemetryConfig(api, deps.Telemetry)
}

func RegisterTelemetryConfig(api huma.API, recorder telemetry.Recorder) {
	huma.Register(api, huma.Operation{
		OperationID: "get-telemetry-config",
		Method:      http.MethodGet,
		Path:        "/telemetry/config",
		Summary:     "Get browser telemetry configuration",
		Description: "Returns only the browser-safe project token and ingestion hosts. Self-hosted telemetry is disabled unless the operator enables it.",
		Tags:        []string{"System"},
	}, func(_ context.Context, _ *struct{}) (*struct {
		Body telemetry.BrowserConfig
	}, error) {
		config := telemetry.BrowserConfig{}
		if recorder != nil {
			config = recorder.PublicConfig()
		}
		return &struct{ Body telemetry.BrowserConfig }{Body: config}, nil
	})
}

type BuildInfo struct {
	Version  string
	Revision string
	Edition  string
}

func RegisterVersion(api huma.API, info BuildInfo) {
	huma.Register(api, huma.Operation{
		OperationID: "get-running-version",
		Method:      http.MethodGet,
		Path:        "/version",
		Summary:     "Running version",
		Description: "Returns the public release and source revision currently serving requests.",
		Tags:        []string{"System"},
	}, func(_ context.Context, _ *struct{}) (*struct {
		Body struct {
			Version  string `json:"version" doc:"Release version embedded in the server"`
			Revision string `json:"revision" doc:"Full source revision embedded in the server"`
			Edition  string `json:"edition" doc:"Configured OpenPost edition"`
		}
	}, error) {
		resp := &struct {
			Body struct {
				Version  string `json:"version" doc:"Release version embedded in the server"`
				Revision string `json:"revision" doc:"Full source revision embedded in the server"`
				Edition  string `json:"edition" doc:"Configured OpenPost edition"`
			}
		}{}
		resp.Body.Version = info.Version
		resp.Body.Revision = info.Revision
		resp.Body.Edition = info.Edition
		return resp, nil
	})
}

func RegisterHealth(api huma.API, db *bun.DB) {
	huma.Register(api, huma.Operation{
		OperationID: "health-check",
		Method:      http.MethodGet,
		Path:        "/health",
		Summary:     "Health check",
		Tags:        []string{"System"},
	}, func(_ context.Context, _ *struct{}) (*struct {
		Body struct {
			Status string `json:"status" doc:"Health status"`
		}
	}, error) {
		resp := &struct {
			Body struct {
				Status string `json:"status" doc:"Health status"`
			}
		}{}
		resp.Body.Status = "ok"
		return resp, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "readiness-check",
		Method:      http.MethodGet,
		Path:        "/ready",
		Summary:     "Readiness check",
		Tags:        []string{"System"},
		Errors:      []int{503},
	}, func(ctx context.Context, _ *struct{}) (*struct {
		Body struct {
			Status   string `json:"status" doc:"Readiness status"`
			Database string `json:"database" doc:"Database dependency status"`
		}
	}, error) {
		if db == nil {
			return nil, huma.NewError(http.StatusServiceUnavailable, "database is not ready")
		}
		var one int
		if err := db.NewSelect().ColumnExpr("1").Scan(ctx, &one); err != nil {
			return nil, huma.NewError(http.StatusServiceUnavailable, "database is not ready")
		}
		resp := &struct {
			Body struct {
				Status   string `json:"status" doc:"Readiness status"`
				Database string `json:"database" doc:"Database dependency status"`
			}
		}{}
		resp.Body.Status = "ready"
		resp.Body.Database = "ok"
		return resp, nil
	})
}
