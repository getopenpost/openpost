package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"runtime/debug"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/joho/godotenv"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"

	apiroutes "github.com/openpost/backend/internal/api"
	"github.com/openpost/backend/internal/api/handlers"
	apimiddleware "github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/config"
	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/queue"
	analyticsservice "github.com/openpost/backend/internal/services/analytics"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/billing"
	cliauth "github.com/openpost/backend/internal/services/cli_auth"
	communicationsservice "github.com/openpost/backend/internal/services/communications"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/emailverification"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/feedback"
	"github.com/openpost/backend/internal/services/identity"
	"github.com/openpost/backend/internal/services/instancesettings"
	"github.com/openpost/backend/internal/services/mastodonapps"
	"github.com/openpost/backend/internal/services/mcpoauth"
	"github.com/openpost/backend/internal/services/mediaanalysis"
	"github.com/openpost/backend/internal/services/mediasigner"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/mfa"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/openpost/backend/internal/services/passwordmail"
	"github.com/openpost/backend/internal/services/providerapps"
	"github.com/openpost/backend/internal/services/publicurl"
	"github.com/openpost/backend/internal/services/publisher"
	"github.com/openpost/backend/internal/services/sessions"
	"github.com/openpost/backend/internal/services/tokenmanager"
	"github.com/openpost/backend/internal/services/updatestatus"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/openpost/backend/internal/services/videoprocessing"
)

var version = "dev"
var commit = "unknown"

//nolint:gocyclo
func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}

	cfg := config.Load()
	config.Init()

	db, err := database.InitDBWithDriver(cfg.DatabaseDriver, cfg.DatabaseDSN())
	if err != nil {
		log.Fatal(err)
	}
	if err := database.CreateSchema(db); err != nil {
		log.Fatalf("database schema initialization failed: %v", err)
	}

	tokenEncryptor := crypto.NewTokenEncryptor(cfg.EncryptionKey)
	instanceSettingsService := instancesettings.NewService(db, tokenEncryptor, cfg)
	if err := instanceSettingsService.ApplyStored(context.Background(), cfg); err != nil {
		log.Fatalf("failed to load administrator-managed instance settings: %v", err)
	}
	instanceSettingsService.CaptureRuntime(cfg)
	if err := cfg.ValidateRuntime(); err != nil {
		log.Fatal(err)
	}

	e := echo.New()
	e.Use(middleware.RequestLoggerWithConfig(middleware.RequestLoggerConfig{
		LogLatency:      true,
		LogRemoteIP:     true,
		LogMethod:       true,
		LogURIPath:      true,
		LogRequestID:    true,
		LogStatus:       true,
		LogError:        true,
		LogResponseSize: true,
		HandleError:     true,
		LogValuesFunc: func(_ echo.Context, values middleware.RequestLoggerValues) error {
			log.Printf(
				"request method=%s path=%s status=%d latency=%s bytes_out=%d remote_ip=%s request_id=%s error=%v",
				values.Method,
				values.URIPath,
				values.Status,
				values.Latency,
				values.ResponseSize,
				values.RemoteIP,
				values.RequestID,
				values.Error,
			)
			return nil
		},
	}))
	e.Use(middleware.Recover())
	e.Use(middleware.Secure())
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins:     cfg.CORSOrigins,
		AllowMethods:     []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions},
		AllowHeaders:     []string{echo.HeaderOrigin, echo.HeaderContentType, echo.HeaderAuthorization, "MCP-Protocol-Version", "Mcp-Session-Id", "Last-Event-ID"},
		AllowCredentials: true,
	}))

	authService := auth.NewService(cfg.JWTSecret)
	googleIssuer := ""
	if cfg.GoogleAuthClientID != "" {
		googleIssuer = "https://accounts.google.com"
	}
	firstPartyIdentityProviders := []identity.EnvironmentProviderConfig{{
		ID:           identity.GoogleProviderID,
		Source:       "first_party",
		Issuer:       googleIssuer,
		ClientID:     cfg.GoogleAuthClientID,
		ClientSecret: cfg.GoogleAuthClientSecret,
		Name:         "Google",
		Scopes:       []string{"openid", "profile", "email"},
		JITEnabled:   true,
	}}
	identityService := identity.NewService(db, tokenEncryptor, identity.Config{
		PublicURL:             cfg.PublicURL,
		NativeCallbackURL:     cfg.OIDCNativeCallbackURL,
		RegistrationsDisabled: cfg.DisableRegistrations,
		Environment: identity.EnvironmentProviderConfig{
			Issuer:            cfg.OIDCIssuer,
			ClientID:          cfg.OIDCClientID,
			ClientSecret:      cfg.OIDCClientSecret,
			Name:              cfg.OIDCName,
			Scopes:            cfg.OIDCScopes,
			JITEnabled:        cfg.OIDCJITEnabled,
			BootstrapSubjects: cfg.OIDCBootstrapAllowlist,
		},
		FirstParty: firstPartyIdentityProviders,
	})
	if err := identityService.SyncEnvironmentProvider(context.Background()); err != nil {
		log.Printf("OIDC provider configuration is unavailable: %v", err)
	}
	if _, err := identityService.ApplyBreakGlassEmails(context.Background(), cfg.OIDCBreakGlassEmails); err != nil {
		log.Printf("Failed to apply SSO break-glass account configuration: %v", err)
	}
	apiTokenService := apitokens.NewService(db)
	sessionService := sessions.NewService(db)
	billingService := billing.NewService(db, cfg.WhopWebhookSecret, billing.WhopConfig{
		APIKey:     cfg.WhopAPIKey,
		APIBaseURL: cfg.WhopAPIBaseURL,
		AccountID:  cfg.WhopAccountID,
		ProductID:  cfg.WhopProductID,
		AppURL:     cfg.FrontendURL,
		ReturnURL:  cfg.WhopCheckoutReturnURL,
		Plans: billing.DefaultPlanCatalog(
			billing.ProviderPlanIDs{Monthly: cfg.WhopStarterMonthlyPlanID, Annual: cfg.WhopStarterAnnualPlanID},
			billing.ProviderPlanIDs{Monthly: cfg.WhopCreatorMonthlyPlanID, Annual: cfg.WhopCreatorAnnualPlanID},
			billing.ProviderPlanIDs{Monthly: cfg.WhopProMonthlyPlanID, Annual: cfg.WhopProAnnualPlanID},
			billing.ProviderPlanIDs{Monthly: cfg.WhopTeamMonthlyPlanID, Annual: cfg.WhopTeamAnnualPlanID},
			billing.ProviderPlanIDs{Monthly: cfg.WhopAgencyMonthlyPlanID, Annual: cfg.WhopAgencyAnnualPlanID},
		),
	})
	entitlementService := entitlements.Service(entitlements.NewSelfHostedService())
	if cfg.Edition == config.EditionCloud {
		entitlementService = entitlements.NewSubscriptionService(db, entitlements.NewCloudBootstrapService())
	}
	authenticator := apimiddleware.NewCompositeServiceWithSessions(authService, apiTokenService, sessionService)
	cliAuthService := cliauth.NewService(db, apiTokenService)
	mcpOAuthService := mcpoauth.NewService(db, apiTokenService)
	mediaSigner := mediasigner.New(cfg.EncryptionKey)
	mfaService, err := mfa.NewService("OpenPost", mfa.RelyingPartyConfig{
		Name:    "OpenPost",
		ID:      cfg.WebAuthnRPID,
		Origins: []string{cfg.PublicURL},
	})
	if err != nil {
		log.Fatal(err)
	}
	var authMailSender passwordmail.Sender
	switch cfg.EmailProvider {
	case "smtp":
		authMailSender, err = passwordmail.NewSMTPSender(passwordmail.SMTPConfig{
			Host:       cfg.SMTPHost,
			Port:       cfg.SMTPPort,
			Username:   cfg.SMTPUsername,
			Password:   cfg.SMTPPassword,
			From:       cfg.EmailFrom,
			TLSMode:    cfg.SMTPTLSMode,
			ServerName: cfg.SMTPServerName,
		})
	case "resend":
		authMailSender, err = passwordmail.NewResendSender(passwordmail.ResendConfig{
			APIKey: cfg.ResendAPIKey,
			From:   cfg.EmailFrom,
		})
	case "cloudflare":
		authMailSender, err = passwordmail.NewCloudflareSender(passwordmail.CloudflareConfig{
			AccountID: cfg.CloudflareEmailAccountID,
			APIToken:  cfg.CloudflareEmailAPIToken,
			From:      cfg.EmailFrom,
		})
	}
	if err != nil {
		log.Fatalf("authentication email configuration is invalid: %v", err)
	}
	emailVerificationService := emailverification.NewService(db, emailverification.Config{
		Secret:                cfg.JWTSecret,
		PromoteFirstVerified:  true,
		RegistrationsDisabled: cfg.DisableRegistrations,
	})
	tokenManager := tokenmanager.NewTokenManager(db, tokenEncryptor)
	usageService := usage.NewService(db)
	publishSvc := publisher.NewService(db, tokenManager)
	publishSvc.SetUsage(usageService)
	publishSvc.SetEntitlement(entitlementService)
	publishSvc.SetDisableLinkedInThreadReplies(cfg.DisableLinkedInThreadReplies)
	publishSvc.SetMediaSigner(mediaSigner)
	if cfg.MediaURL != "" && !strings.HasPrefix(cfg.MediaURL, "/") {
		publishSvc.SetPublicMediaURL(cfg.MediaURL)
	}

	mastodonAppService := mastodonapps.NewService(db, tokenEncryptor, mastodonapps.Options{
		RedirectURI: cfg.MastodonRedirectURI,
		Website:     cfg.PublicURL,
	})

	platform.RegisterAllMediaValidators()
	dynamicMastodonApps, err := mastodonAppService.ListActiveAppConfigs(context.Background())
	if err != nil {
		log.Fatalf("failed to load dynamic mastodon app registry from database: %v", err)
	}
	if len(dynamicMastodonApps) > 0 {
		log.Printf("Loaded %d dynamic mastodon app config(s) from database", len(dynamicMastodonApps))
	}
	dbProviderApps, err := providerapps.NewService(db, tokenEncryptor).ListActiveAppConfigs(context.Background())
	if err != nil {
		log.Fatalf("failed to load provider app registry from database: %v", err)
	}
	if len(dbProviderApps) > 0 {
		log.Printf("Loaded %d provider app config(s) from database", len(dbProviderApps))
	}
	providerAppConfigs := platform.MergeAppConfigs(dynamicMastodonApps, dbProviderApps...)
	// Direct and file-backed environment values are the operator-owned layer
	// and remain authoritative over administrator-managed database fallbacks.
	providerAppConfigs = platform.MergeAppConfigs(providerAppConfigs, cfg.ProviderApps...)
	providers, providerEntries, err := platform.BuildAdapterRegistry(providerAppConfigs, platform.RegistryOptions{
		DisableLinkedInThreadReplies: cfg.DisableLinkedInThreadReplies,
		EnableLinkedInOrganizations:  cfg.EnableLinkedInOrganizations,
	})
	if err != nil {
		log.Fatalf("failed to build provider app registry: %v", err)
	}
	if cfg.Edition == config.EditionCloud {
		if _, xEnabled := providers[usage.ProviderX]; xEnabled {
			if err := usageService.SetProviderCostPolicy(usage.NewXProviderCostPolicy(
				cfg.XMonthlyBudgetMicrousd,
				cfg.XPostCreateCostMicrousd,
				cfg.XPostCreateWithURLCostMicrousd,
			)); err != nil {
				log.Fatalf("hosted X provider cost configuration is invalid: %v", err)
			}
			now := time.Now().UTC()
			if err := usageService.ReconcileProviderCosts(context.Background(), now); err != nil {
				log.Fatalf("failed to reconcile current provider cost counters: %v", err)
			}
			if cfg.ProviderUsageRetentionDays > 0 {
				cutoff := now.AddDate(0, 0, -cfg.ProviderUsageRetentionDays)
				if openPeriod := usage.MonthStart(now); cutoff.After(openPeriod) {
					cutoff = openPeriod
				}
				if _, err := usageService.PruneProviderUsageEvents(context.Background(), cutoff, 1000); err != nil {
					log.Printf("Failed to prune provider usage events: %v", err)
				}
				if _, err := usageService.PruneProviderUsageReservations(context.Background(), cutoff, 1000); err != nil {
					log.Printf("Failed to prune provider usage reservations: %v", err)
				}
			}
		}
	}
	for _, entry := range providerEntries {
		log.Printf("Registered provider adapter: %s", entry.Key)
	}

	analyticsService := analyticsservice.NewService(db, tokenManager)
	notificationService := notifications.NewService(db)
	publishSvc.SetNotificationService(notificationService)
	communicationsService := communicationsservice.NewService(db, tokenManager, notificationService)
	for name, adapter := range providers {
		tokenManager.SetProvider(name, adapter)
		publishSvc.SetProvider(name, adapter)
		analyticsService.SetProvider(name, adapter)
		communicationsService.SetProvider(name, adapter)
	}

	storage, err := mediastore.New(context.Background(), mediastore.Config{
		Driver:    cfg.StorageDriver,
		LocalPath: cfg.MediaPath,
		BaseURL:   cfg.MediaURL,
		S3: mediastore.S3Config{
			Endpoint:        cfg.S3Endpoint,
			Region:          cfg.S3Region,
			Bucket:          cfg.S3Bucket,
			AccessKeyID:     cfg.S3AccessKeyID,
			SecretAccessKey: cfg.S3SecretAccessKey,
			PublicBaseURL:   cfg.S3PublicBaseURL,
			ForcePathStyle:  cfg.S3ForcePathStyle,
		},
	})
	if err != nil {
		log.Fatalf("failed to initialize media storage: %v", err)
	}
	publishSvc.SetStorage(storage)
	publicMediaVerifier := publicurl.NewMediaVerifier(cfg.MediaURL, storage, mediaSigner)
	videoProcessingService := videoprocessing.NewService(db, storage, mediaanalysis.FFmpegAnalyzer{})
	mediaHandler := handlers.NewMediaHandler(db, storage, authService, authenticator, mediaSigner)
	mediaHandler.SetEntitlement(entitlementService)
	mediaHandler.SetPublicMediaVerifier(publicMediaVerifier)
	mediaHandler.SetVideoProcessor(videoProcessingService)
	profileHandler := handlers.NewProfileHandler(db, authenticator, storage)

	var feedbackDestination feedback.Destination
	if cfg.FeedbackEnabled {
		if strings.TrimSpace(cfg.FeedbackRecipient) == "" {
			log.Fatal("OPENPOST_FEEDBACK_RECIPIENT is required when feedback is enabled")
		}
		feedbackDestination, err = feedback.NewDiscordDestination(cfg.FeedbackDestinationURL)
		if err != nil {
			log.Fatalf("feedback destination configuration is invalid: %v", err)
		}
	}
	feedbackService := feedback.NewService(db, feedback.Config{
		Enabled:    cfg.FeedbackEnabled,
		Recipient:  cfg.FeedbackRecipient,
		SupportURL: cfg.FeedbackSupportURL,
		AppVersion: version,
	}, feedbackDestination)

	worker := queue.NewWorker(db, "worker-1", 1*time.Second, publishSvc, tokenManager, storage)
	worker.SetFeedbackService(feedbackService)
	worker.SetAnalyticsService(analyticsService)
	worker.SetBillingService(billingService)
	worker.SetCommunicationsService(communicationsService)
	worker.SetVideoProcessingService(videoProcessingService)
	if err := videoProcessingService.EnqueuePendingAnalysis(context.Background()); err != nil {
		log.Fatalf("failed to schedule pending video analysis: %v", err)
	}
	if err := analyticsService.ScheduleSweep(context.Background(), time.Now().UTC()); err != nil {
		log.Fatalf("failed to schedule analytics collection: %v", err)
	}
	if err := communicationsService.ScheduleSweep(context.Background(), time.Now().UTC()); err != nil {
		log.Fatalf("failed to schedule communications collection: %v", err)
	}

	apiGroup := e.Group("/api/v1")
	apiGroup.Use(handlers.FeedbackBodyLimitMiddleware)
	humaConfig := huma.DefaultConfig("OpenPost API", "1.0.0")
	api := humaecho.NewWithGroup(e, apiGroup, humaConfig)

	mediaHandler.RegisterLegacyRoutes(e)
	profileHandler.RegisterLegacyRoutes(e)
	billingHandler := handlers.NewBillingHandler(billingService, db, authenticator)
	billingHandler.SetUsage(usageService)
	billingHandler.RegisterRoutes(e)

	e.GET("/openapi.json", func(c echo.Context) error {
		spec := api.OpenAPI()
		data, err := json.Marshal(spec)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to marshal spec"})
		}
		return c.Blob(http.StatusOK, "application/json", data)
	})

	robotsHandler := func(c echo.Context) error {
		robots := "User-agent: *\nAllow: /\nUser-agent: facebookexternalhit\nAllow: /\nUser-agent: Twitterbot\nAllow: /\nUser-agent: LinkedInBot\nAllow: /"
		return c.String(http.StatusOK, robots)
	}

	e.GET("/robots.txt", robotsHandler)
	e.HEAD("/robots.txt", robotsHandler)

	mcpHandler := handlers.NewMCPHandler(db, authenticator, entitlementService)
	mcpHandler.SetServerVersion(version)
	mcpHandler.SetMediaStorage(storage)
	mcpHandler.SetPublicURL(cfg.PublicURL)
	mcpHandler.SetAllowedOrigins(cfg.CORSOrigins)
	mcpHandler.SetProviderCatalog(providers, mastodonAppService != nil)
	mcpHandler.SetTokenEncryptor(tokenEncryptor)
	mcpHandler.RegisterRoutes(e)
	mcpOAuthHandler := handlers.NewMCPOAuthHandler(mcpOAuthService, authenticator, cfg.PublicURL)
	mcpOAuthHandler.SetIdentityService(identityService)
	mcpOAuthHandler.RegisterEchoRoutes(e)
	updateStatusService := updatestatus.NewService(updatestatus.Options{
		Enabled:        cfg.Edition == config.EditionSelfHost && cfg.UpdateCheckEnabled,
		RunningVersion: version,
		RunningBuild:   runningBuildRevision(),
	})
	apiroutes.RegisterHumaRoutes(api, apiroutes.RouteDeps{
		DB:                        db,
		AuthService:               authService,
		Authenticator:             authenticator,
		SessionService:            sessionService,
		APITokenService:           apiTokenService,
		CLIAuthService:            cliAuthService,
		MCPOAuthService:           mcpOAuthService,
		BillingService:            billingService,
		MediaStorage:              storage,
		MediaSigner:               mediaSigner,
		Entitlement:               entitlementService,
		TokenEncryptor:            tokenEncryptor,
		TokenSource:               tokenManager,
		MFAService:                mfaService,
		PasswordResetSender:       authMailSender,
		EmailVerificationService:  emailVerificationService,
		EmailVerificationRequired: cfg.EmailVerificationRequired,
		AccountPolicy: handlers.AccountPolicy{
			Required:       cfg.LegalAcceptanceRequired,
			TermsURL:       cfg.TermsURL,
			PrivacyURL:     cfg.PrivacyURL,
			TermsVersion:   cfg.TermsVersion,
			PrivacyVersion: cfg.PrivacyVersion,
			SupportEmail:   cfg.SupportEmail,
		},
		Providers:    providers,
		ProviderApps: cfg.ProviderApps,
		ProviderRegistrars: []func(string, platform.Adapter){
			tokenManager.SetProvider,
			publishSvc.SetProvider,
			analyticsService.SetProvider,
			communicationsService.SetProvider,
		},
		MastodonAppService:           mastodonAppService,
		FrontendURL:                  cfg.FrontendURL,
		PublicURL:                    cfg.PublicURL,
		DisableRegistrations:         cfg.DisableRegistrations,
		DisableLinkedInThreadReplies: cfg.DisableLinkedInThreadReplies,
		StudioEnabled:                cfg.StudioEnabled,
		StudioModelBaseURL:           cfg.StudioModelBaseURL,
		VideoStudioEnabled:           cfg.VideoStudioEnabled,
		VideoModelBaseURL:            cfg.VideoModelBaseURL,
		StockMediaEnabled:            cfg.StockMediaEnabled,
		PexelsAPIKey:                 cfg.PexelsAPIKey,
		UnsplashAccessKey:            cfg.UnsplashAccessKey,
		PixabayAPIKey:                cfg.PixabayAPIKey,
		FeedbackService:              feedbackService,
		IdentityService:              identityService,
		InstanceSettingsService:      instanceSettingsService,
		AnalyticsService:             analyticsService,
		CommunicationsService:        communicationsService,
		NotificationService:          notificationService,
		UpdateStatusService:          updateStatusService,
		MediaHandler:                 mediaHandler,
		PublicMediaVerifier:          publicMediaVerifier,
		ProfileHandler:               profileHandler,
		BillingHandler:               billingHandler,
		MCPOAuthHandler:              mcpOAuthHandler,
	})

	RegisterSpaRoutes(e, db, cfg.PublicURL)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		worker.Start(ctx)
	}()

	log.Println("Starting OpenPost on :" + cfg.Port)
	log.Println("OpenAPI spec available at http://localhost:" + cfg.Port + "/openapi.json")

	serverErrCh := make(chan error, 1)
	go func() {
		serverErrCh <- e.Start(":" + cfg.Port)
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(sigCh)

	select {
	case sig := <-sigCh:
		log.Printf("Shutting down after %s...", sig)
	case err := <-serverErrCh:
		if err != nil && err != http.ErrServerClosed {
			cancel()
			signal.Stop(sigCh)
			worker.Stop()
			wg.Wait()
			log.Printf("Server error: %v", err)
			return
		}
		cancel()
		worker.Stop()
		wg.Wait()
		log.Println("Server stopped")
		return
	}

	cancel()
	worker.Stop()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := e.Shutdown(shutdownCtx); err != nil {
		log.Printf("Echo shutdown error: %v", err)
	}

	if err := <-serverErrCh; err != nil && err != http.ErrServerClosed {
		log.Printf("Echo server error: %v", err)
	}

	wg.Wait()
	log.Println("Server stopped")
}

func runningBuildRevision() string {
	if strings.TrimSpace(commit) != "" && commit != "unknown" {
		return commit
	}
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "unknown"
	}
	revision := ""
	dirty := false
	for _, setting := range info.Settings {
		switch setting.Key {
		case "vcs.revision":
			revision = setting.Value
		case "vcs.modified":
			dirty = setting.Value == "true"
		}
	}
	if revision == "" {
		return "unknown"
	}
	if dirty {
		return revision + "-dirty"
	}
	return revision
}
