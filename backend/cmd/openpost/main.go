package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"runtime/debug"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"

	"github.com/openpost/backend/internal/ai"
	apiroutes "github.com/openpost/backend/internal/api"
	"github.com/openpost/backend/internal/api/handlers"
	apimiddleware "github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/config"
	"github.com/openpost/backend/internal/connectors"
	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/memes"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/queue"
	"github.com/openpost/backend/internal/services/aiprompts"
	analyticsservice "github.com/openpost/backend/internal/services/analytics"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/billing"
	cliauth "github.com/openpost/backend/internal/services/cli_auth"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/emailchange"
	"github.com/openpost/backend/internal/services/emailverification"
	engagementservice "github.com/openpost/backend/internal/services/engagement"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/feedback"
	growthservice "github.com/openpost/backend/internal/services/growth"
	"github.com/openpost/backend/internal/services/identity"
	"github.com/openpost/backend/internal/services/imagecaption"
	"github.com/openpost/backend/internal/services/instancesettings"
	"github.com/openpost/backend/internal/services/mastodonapps"
	"github.com/openpost/backend/internal/services/mcpoauth"
	"github.com/openpost/backend/internal/services/mediaanalysis"
	"github.com/openpost/backend/internal/services/mediasigner"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/memegeneration"
	messagingservice "github.com/openpost/backend/internal/services/messaging"
	"github.com/openpost/backend/internal/services/mfa"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/openpost/backend/internal/services/organizationownership"
	"github.com/openpost/backend/internal/services/passwordmail"
	"github.com/openpost/backend/internal/services/postgeneration"
	"github.com/openpost/backend/internal/services/providerapps"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/publicationbuilder"
	"github.com/openpost/backend/internal/services/publicationdiscovery"
	"github.com/openpost/backend/internal/services/publicurl"
	"github.com/openpost/backend/internal/services/publisher"
	repostservice "github.com/openpost/backend/internal/services/reposts"
	"github.com/openpost/backend/internal/services/sessions"
	"github.com/openpost/backend/internal/services/sourcecontext"
	"github.com/openpost/backend/internal/services/tokenmanager"
	"github.com/openpost/backend/internal/services/updatestatus"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/openpost/backend/internal/services/videoprocessing"
	"github.com/openpost/backend/internal/services/workspaceteam"
	"github.com/openpost/backend/internal/telemetry"
)

var version = "dev"
var commit = "unknown"

const (
	processShutdownTimeout    = 10 * time.Second
	workerCancellationReserve = 3 * time.Second
)

func newWorkerID() string {
	return "worker-" + uuid.NewString()
}

//nolint:gocyclo
func main() {
	command, commandErr := parseProcessCommand(os.Args[1:])
	if commandErr != nil {
		log.Fatal(commandErr)
	}
	if command.showHelp {
		fmt.Println(processUsage)
		return
	}
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}

	cfg := config.Load()
	if command.checkConfig {
		if err := cfg.ValidateRuntime(); err != nil {
			log.Fatal(err)
		}
		config.Init()
		if err := json.NewEncoder(os.Stdout).Encode(map[string]string{
			"status":          "ok",
			"edition":         cfg.Edition,
			"database_driver": cfg.DatabaseDriver,
			"storage_driver":  cfg.StorageDriver,
		}); err != nil {
			log.Fatal(err)
		}
		return
	}
	config.Init()
	if command.role == processRoleMigrate {
		if err := cfg.ValidateRuntime(); err != nil {
			log.Fatal(err)
		}
	}

	db, err := database.InitDBWithDriver(cfg.DatabaseDriver, cfg.DatabaseDSN())
	if err != nil {
		log.Fatal(err)
	}
	defer func() {
		if closeErr := db.Close(); closeErr != nil {
			log.Printf("database shutdown failed: %v", closeErr)
		}
	}()
	if command.role.autoMigrates() {
		if err := database.CreateSchemaLocked(context.Background(), db, cfg.DatabaseDriver, cfg.DatabaseDSN()); err != nil {
			log.Fatalf("database schema initialization failed: %v", err)
		}
	} else if err := database.RequireCurrentSchema(context.Background(), db); err != nil {
		log.Fatal(err)
	}
	if command.role == processRoleMigrate {
		if err := json.NewEncoder(os.Stdout).Encode(map[string]string{
			"status":          "migrated",
			"database_driver": cfg.DatabaseDriver,
		}); err != nil {
			log.Fatal(err)
		}
		return
	}

	tokenEncryptor := crypto.NewTokenEncryptor(cfg.EncryptionKey)
	instanceSettingsService := instancesettings.NewService(db, tokenEncryptor, cfg)
	aiPromptService := aiprompts.NewService(db, tokenEncryptor)
	if err := instanceSettingsService.ApplyStored(context.Background(), cfg); err != nil {
		log.Fatalf("failed to load administrator-managed instance settings: %v", err)
	}
	instanceSettingsService.CaptureRuntime(cfg)
	if err := cfg.ValidateRuntime(); err != nil {
		log.Fatal(err)
	}
	telemetryRecorder, err := telemetry.New(telemetry.Config{
		Enabled:         cfg.TelemetryEnabled,
		ProjectToken:    cfg.PostHogProjectToken,
		Endpoint:        cfg.PostHogAPIHost,
		BrowserEndpoint: cfg.PostHogBrowserHost,
		UIHost:          cfg.PostHogUIHost,
		Environment:     cfg.TelemetryEnvironment,
		Edition:         cfg.Edition,
		Version:         version,
		Revision:        runningBuildRevision(),
	})
	if err != nil {
		log.Fatal(err)
	}
	readiness := apiroutes.NewReadiness()
	e := echo.New()
	e.Use(echo.WrapMiddleware(telemetryRecorder.WrapHTTP))
	e.Use(middleware.RequestID())
	e.Use(middleware.RequestLoggerWithConfig(middleware.RequestLoggerConfig{
		LogLatency:      true,
		LogRemoteIP:     true,
		LogMethod:       true,
		LogURIPath:      true,
		LogRoutePath:    true,
		LogRequestID:    true,
		LogUserAgent:    true,
		LogStatus:       true,
		LogError:        true,
		LogResponseSize: true,
		HandleError:     true,
		LogValuesFunc: func(_ echo.Context, values middleware.RequestLoggerValues) error {
			route := normalizedRequestRoute(values.RoutePath)
			log.Printf(
				"request method=%s path=%s route=%s consumer=%s status=%d latency=%s bytes_out=%d remote_ip=%s request_id=%s error=%v",
				values.Method,
				values.URIPath,
				route,
				requestConsumerClass(route, values.UserAgent),
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
	e.Use(capturePanics(telemetryRecorder))
	e.Use(middleware.Secure())
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins:     cfg.CORSOrigins,
		AllowMethods:     []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions},
		AllowHeaders:     []string{echo.HeaderOrigin, echo.HeaderContentType, echo.HeaderAuthorization, "MCP-Protocol-Version", "Mcp-Session-Id", "Last-Event-ID", "X-PostHog-Distinct-ID", "X-PostHog-Session-ID"},
		AllowCredentials: true,
	}))
	installTelemetryErrorHandler(e, telemetryRecorder)

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
		RequireExplicitSignup: cfg.Edition == config.EditionCloud,
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
	billingService := billing.NewService(db, cfg.PaddleWebhookSecret, billing.PaddleConfig{
		APIKey:               cfg.PaddleAPIKey,
		APIBaseURL:           cfg.PaddleAPIBaseURL,
		Environment:          cfg.PaddleEnvironment,
		ClientToken:          cfg.PaddleClientToken,
		AppURL:               cfg.FrontendURL,
		ReturnURL:            cfg.PaddleCheckoutReturnURL,
		PurchaseChoiceSecret: cfg.JWTSecret,
		Plans: billing.DefaultPlanCatalog(
			billing.PaddlePriceIDs{Monthly: cfg.PaddleStarterMonthlyPriceID, Annual: cfg.PaddleStarterAnnualPriceID},
			billing.PaddlePriceIDs{Monthly: cfg.PaddleFounderMonthlyPriceID, Annual: cfg.PaddleFounderAnnualPriceID},
			billing.PaddlePriceIDs{Monthly: cfg.PaddleProMonthlyPriceID, Annual: cfg.PaddleProAnnualPriceID},
			billing.PaddlePriceIDs{Monthly: cfg.PaddleTeamMonthlyPriceID, Annual: cfg.PaddleTeamAnnualPriceID},
			billing.PaddlePriceIDs{Monthly: cfg.PaddleAgencyMonthlyPriceID, Annual: cfg.PaddleAgencyAnnualPriceID},
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
	emailChangeService := emailchange.NewService(db, emailchange.Config{Secret: cfg.JWTSecret})
	tokenManager := tokenmanager.NewTokenManager(db, tokenEncryptor)
	usageService := usage.NewService(db)
	publishSvc := publisher.NewService(db, tokenManager)
	publishSvc.SetMediaStateEncryptor(tokenEncryptor)
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
	providerEnvironment := providerreadiness.ProviderEnvironmentDevelopment
	defaultProviderControl := providerreadiness.RuntimeControlStateEnabled
	managedProviderProduction := cfg.Edition == config.EditionCloud
	enforceProviderCertification := managedProviderProduction && cfg.ProviderCertificationEnforced
	if managedProviderProduction {
		providerEnvironment = providerreadiness.ProviderEnvironmentProduction
	}
	if enforceProviderCertification {
		defaultProviderControl = providerreadiness.RuntimeControlStateUnknown
	}
	providerConfigurationCatalog, err := providerreadiness.NewConfigurationCatalog(
		providerreadiness.RuntimeApps(dynamicMastodonApps, providerreadiness.ConfigurationSourceDynamic, providerEnvironment),
		providerreadiness.RuntimeApps(dbProviderApps, providerreadiness.ConfigurationSourceDatabase, providerEnvironment),
		providerreadiness.OperatorRuntimeApps(cfg.ProviderApps, providerEnvironment),
	)
	if err != nil {
		log.Fatalf("failed to build provider readiness configuration: %v", err)
	}
	providerReadinessService := providerreadiness.NewService(
		providerreadiness.NewRepository(db),
		providerreadiness.ServiceOptions{
			Configurations:               providerConfigurationCatalog,
			ManagedProduction:            managedProviderProduction,
			EnforceCertification:         enforceProviderCertification,
			CurrentRevision:              runningBuildRevision(),
			DisabledProviders:            cfg.DisabledProviders,
			DynamicRegistrationProviders: []string{capabilities.ProviderMastodon},
			DefaultControl:               defaultProviderControl,
		},
	)
	providers, providerEntries, err := platform.BuildAdapterRegistry(providerAppConfigs, platform.RegistryOptions{
		DisableLinkedInThreadReplies: cfg.DisableLinkedInThreadReplies,
		EnableLinkedInOrganizations:  cfg.EnableLinkedInOrganizations,
	})
	if err != nil {
		log.Fatalf("failed to build provider app registry: %v", err)
	}
	connectorConfig, err := connectors.LoadConfig(cfg.ConnectorsFile)
	if err != nil {
		log.Fatalf("failed to load connector configuration: %v", err)
	}
	connectorRegistry, err := connectors.NewRegistry(context.Background(), connectorConfig, connectors.RegistryOptions{})
	if err != nil {
		log.Fatalf("failed to initialize connector registry: %v", err)
	}
	connectorStore := connectors.NewStore(db)
	if err := connectorStore.SyncRegistry(context.Background(), connectorRegistry); err != nil {
		log.Fatalf("failed to synchronize connector registry: %v", err)
	}
	for _, entry := range connectorRegistry.All() {
		log.Printf("Loaded connector installation %s: %s", entry.InstallationID, entry.Status)
	}
	publishSvc.SetConnectorRegistry(connectorRegistry, connectorStore)
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
	publishSvc.SetProviderReadiness(providerReadinessService)
	publishSvc.SetTelemetry(telemetryRecorder)

	analyticsService := analyticsservice.NewService(db, tokenManager)
	repostService := repostservice.NewService(db, tokenManager)
	repostService.SetUsage(usageService)
	repostService.SetEntitlement(entitlementService)
	growthService := growthservice.NewService(db, tokenManager, telemetryRecorder)
	notificationService := notifications.NewService(db, notifications.Options{
		EmailDelivery: authMailSender, Encryptor: tokenEncryptor, PublicURL: cfg.PublicURL,
	})
	publishSvc.SetNotificationService(notificationService)
	publishSvc.SetRepostScheduler(repostService)
	engagementService := engagementservice.NewService(db, tokenManager, notificationService)
	messagingService := messagingservice.NewService(db, tokenManager, notificationService)
	for name, adapter := range providers {
		tokenManager.SetProvider(name, adapter)
		publishSvc.SetProvider(name, adapter)
		analyticsService.SetProvider(name, adapter)
		if engagementAdapter, ok := adapter.(platform.EngagementAdapter); ok {
			engagementService.SetProvider(name, engagementAdapter)
		}
		if messagingAdapter, ok := adapter.(platform.MessagingAdapter); ok {
			messagingService.SetProvider(name, messagingAdapter)
		}
		repostService.SetProvider(name, adapter)
		growthService.SetProvider(name, adapter)
	}
	for _, source := range cfg.AnalyticsSources {
		adapter, err := analyticsservice.NewExternalAnalyticsAdapter(source.Platform, source.BaseURL, source.BearerToken)
		if err != nil {
			log.Fatalf("failed to initialize external analytics source for %s: %v", source.Platform, err)
		}
		analyticsService.SetExternalSource(source.Platform, adapter)
		log.Printf("Registered external analytics source: %s", source.Platform)
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

	var imageGenerator ai.Generator
	var contentGenerator ai.Generator
	if cfg.OpenRouterAPIKey != "" {
		imageConfig, contentConfig := openRouterConfigs(cfg)
		imageGenerator, err = ai.NewOpenRouter(imageConfig)
		if err != nil {
			log.Fatalf("failed to initialize OpenRouter image generator: %v", err)
		}
		contentGenerator, err = ai.NewOpenRouter(contentConfig)
		if err != nil {
			log.Fatalf("failed to initialize OpenRouter text generator: %v", err)
		}
	}

	var imageCaptioner imagecaption.Captioner
	var postBuilder postgeneration.Builder
	if imageGenerator != nil {
		imageCaptioner, err = imagecaption.New(imageGenerator, cfg.ImageCaptionModel)
		if err != nil {
			log.Fatalf("failed to initialize automatic image captioning: %v", err)
		}
		log.Printf(
			"Automatic image captioning enabled with model %s provider %s zero_data_retention=%t",
			cfg.ImageCaptionModel,
			cfg.ImageCaptionProvider,
			cfg.ImageCaptionRequireZDR,
		)
	}
	if contentGenerator != nil {
		postBuilder, err = postgeneration.New(contentGenerator, cfg.TextGenerationModel, aiPromptService)
		if err != nil {
			log.Fatalf("failed to initialize AI post builder: %v", err)
		}
		log.Printf(
			"AI post builder enabled with model %s provider %s zero_data_retention=%t",
			cfg.TextGenerationModel,
			cfg.ContentAIProvider,
			cfg.ContentAIRequireZDR,
		)
	}

	var publicSourceLoader sourcecontext.Loader
	var publicationBuilderApplication *publicationbuilder.Application
	var publicationBuilderService *publicationbuilder.Service
	var publicationDiscoveryService publicationdiscovery.Discoverer
	if contentGenerator != nil {
		publicSourceLoader, err = sourcecontext.New(sourcecontext.Config{})
		if err != nil {
			log.Fatalf("failed to initialize public source loader: %v", err)
		}
		publicationBuilderService, err = publicationbuilder.New(contentGenerator, publicationbuilder.Config{Model: cfg.TextGenerationModel})
		if err != nil {
			log.Fatalf("failed to initialize publication builder: %v", err)
		}
		publicationBuilderApplication, err = publicationbuilder.NewApplication(
			db,
			publicationBuilderService,
			publicationbuilder.ApplicationConfig{
				Model:        cfg.TextGenerationModel,
				SourceLoader: publicSourceLoader,
				AssetLoader:  publicationbuilder.NewMediaAssetLoader(db, storage),
			},
		)
		if err != nil {
			log.Fatalf("failed to initialize durable publication builder: %v", err)
		}
		publicationDiscoveryService, err = publicationdiscovery.New(contentGenerator, publicationdiscovery.Config{
			Model:        cfg.TextGenerationModel,
			SourceLoader: publicSourceLoader,
		})
		if err != nil {
			log.Fatalf("failed to initialize publication discovery: %v", err)
		}
	}

	var memeProvider memes.Provider
	var memeSuggester memegeneration.Suggester
	if cfg.MemeGeneratorEnabled {
		memeProvider, err = memes.NewBuiltinProvider()
		if err != nil {
			log.Fatalf("failed to initialize built-in meme catalog: %v", err)
		}
		if contentGenerator != nil {
			memeSuggester, err = memegeneration.New(contentGenerator, cfg.MemeGenerationModel)
			if err != nil {
				log.Fatalf("failed to initialize AI meme suggestions: %v", err)
			}
			log.Printf("AI meme suggestions enabled with model %s", cfg.MemeGenerationModel)
		}
		log.Printf("Meme generator enabled with renderer %s", memeProvider.Key())
	}

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

	organizationOwnershipService := organizationownership.NewService(db, notificationService, identityService)
	var worker *queue.BackgroundWorker
	if command.role.runsWorker() {
		worker = queue.NewWorker(db, newWorkerID(), 1*time.Second, publishSvc, tokenManager, storage)
		worker.SetFeedbackService(feedbackService)
		worker.SetAnalyticsService(analyticsService)
		worker.SetBillingService(billingService)
		worker.SetEngagementService(engagementService)
		worker.SetMessagingService(messagingService)
		worker.SetNotificationService(notificationService)
		worker.SetOrganizationOwnershipService(organizationOwnershipService)
		worker.SetRepostService(repostService)
		worker.SetVideoProcessingService(videoProcessingService)
		worker.SetGrowthService(growthService)
		worker.SetPublicationBuilderService(publicationBuilderApplication)
		worker.SetTelemetry(telemetryRecorder)
		if err := videoProcessingService.EnqueuePendingAnalysis(context.Background()); err != nil {
			log.Fatalf("failed to schedule pending video analysis: %v", err)
		}
		if err := analyticsService.ScheduleSweep(context.Background(), time.Now().UTC()); err != nil {
			log.Fatalf("failed to schedule analytics collection: %v", err)
		}
		if err := engagementService.ScheduleSweep(context.Background(), time.Now().UTC()); err != nil {
			log.Fatalf("failed to schedule engagement collection: %v", err)
		}
		if err := messagingService.ScheduleSweep(context.Background(), time.Now().UTC()); err != nil {
			log.Fatalf("failed to schedule messaging collection: %v", err)
		}
		if err := repostService.ScheduleSweep(context.Background(), time.Now().UTC()); err != nil {
			log.Fatalf("failed to schedule repost automation: %v", err)
		}
	}

	apiGroup := e.Group("/api/v1")
	apiGroup.Use(handlers.FeedbackBodyLimitMiddleware)
	apiGroup.Use(handlers.MemeBodyLimitMiddleware)
	humaConfig := apiroutes.OpenAPIConfig("1.0.0")
	api := humaecho.NewWithGroup(e, apiGroup, humaConfig)

	mediaHandler.RegisterLegacyRoutes(e)
	profileHandler.RegisterLegacyRoutes(e)
	billingHandler := handlers.NewBillingHandler(billingService, db, authenticator)
	billingHandler.SetUsage(usageService)
	billingHandler.SetTelemetry(telemetryRecorder)
	billingHandler.RegisterRoutes(e)
	invitationDeliveryService := workspaceteam.NewService(db, entitlementService, notificationService)
	handlers.NewEmailDeliveryWebhookHandler(invitationDeliveryService, cfg.EmailDeliveryWebhookSecret).RegisterRoutes(e)
	if err := registerE2EDeliveryProjection(e, db, authenticator, cfg.AppE2EDeliveryProjection); err != nil {
		log.Fatalf("failed to configure E2E delivery projection: %v", err)
	}

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
	mcpHandler.SetProviderReadiness(providerReadinessService)
	mcpHandler.SetTokenEncryptor(tokenEncryptor)
	mcpHandler.SetTokenSource(tokenManager)
	mcpHandler.RegisterRoutes(e)
	mcpOAuthHandler := handlers.NewMCPOAuthHandler(mcpOAuthService, authenticator, cfg.PublicURL)
	mcpOAuthHandler.SetIdentityService(identityService)
	mcpOAuthHandler.RegisterEchoRoutes(e)
	updateChecksEnabled := cfg.Edition == config.EditionSelfHost && cfg.UpdateCheckEnabled
	updateChecksDisabledReason := ""
	if cfg.Edition != config.EditionSelfHost {
		updateChecksDisabledReason = "managed_edition"
	} else if !cfg.UpdateCheckEnabled {
		updateChecksDisabledReason = "configuration"
	}
	updateStatusService := updatestatus.NewService(updatestatus.Options{
		Enabled:        updateChecksEnabled,
		DisabledReason: updateChecksDisabledReason,
		RunningVersion: version,
		RunningBuild:   runningBuildRevision(),
	})
	apiroutes.RegisterHumaRoutes(api, apiroutes.RouteDeps{
		DB:                        db,
		Readiness:                 readiness,
		AuthService:               authService,
		Authenticator:             authenticator,
		SessionService:            sessionService,
		APITokenService:           apiTokenService,
		CLIAuthService:            cliAuthService,
		MCPOAuthService:           mcpOAuthService,
		BillingService:            billingService,
		MediaStorage:              storage,
		MediaSigner:               mediaSigner,
		ImageCaptioner:            imageCaptioner,
		MemeProvider:              memeProvider,
		MemeSuggester:             memeSuggester,
		PostBuilder:               postBuilder,
		ContentBuilderEnabled:     publicationBuilderApplication != nil,
		ContentDiscoveryEnabled:   publicationDiscoveryService != nil,
		PublicationBuilder:        publicationBuilderApplication,
		PublicationPlanner:        publicationBuilderService,
		PublicationDiscovery:      publicationDiscoveryService,
		Entitlement:               entitlementService,
		TokenEncryptor:            tokenEncryptor,
		TokenSource:               tokenManager,
		MFAService:                mfaService,
		PasswordResetSender:       authMailSender,
		EmailVerificationSender:   authMailSender,
		IdentityEmailSender:       authMailSender,
		EmailVerificationService:  emailVerificationService,
		EmailChangeService:        emailChangeService,
		EmailVerificationRequired: cfg.EmailVerificationRequired,
		PurchaseChoiceRequired:    cfg.Edition == config.EditionCloud || cfg.AppE2EHostedSignup,
		PublicProfilesEnabled:     cfg.PublicProfilesEnabled,
		AccountPolicy: handlers.AccountPolicy{
			Required:       cfg.LegalAcceptanceRequired,
			TermsURL:       cfg.TermsURL,
			PrivacyURL:     cfg.PrivacyURL,
			TermsVersion:   cfg.TermsVersion,
			PrivacyVersion: cfg.PrivacyVersion,
			SupportEmail:   cfg.SupportEmail,
		},
		Providers:                providers,
		ProviderApps:             cfg.ProviderApps,
		ProviderReadinessService: providerReadinessService,
		ConnectorRegistry:        connectorRegistry,
		ConnectorStore:           connectorStore,
		ProviderRegistrars: []func(string, platform.Adapter){
			tokenManager.SetProvider,
			func(name string, adapter platform.Adapter) { publishSvc.SetProvider(name, adapter) },
			analyticsService.SetProvider,
			func(name string, adapter platform.Adapter) {
				if engagementAdapter, ok := adapter.(platform.EngagementAdapter); ok {
					engagementService.SetProvider(name, engagementAdapter)
				}
			},
			func(name string, adapter platform.Adapter) {
				if messagingAdapter, ok := adapter.(platform.MessagingAdapter); ok {
					messagingService.SetProvider(name, messagingAdapter)
				}
			},
			repostService.SetProvider,
			growthService.SetProvider,
		},
		MastodonAppService:           mastodonAppService,
		FrontendURL:                  cfg.FrontendURL,
		PublicURL:                    cfg.PublicURL,
		DisableRegistrations:         cfg.DisableRegistrations,
		DisableLinkedInThreadReplies: cfg.DisableLinkedInThreadReplies,
		ImageEditorEnabled:           cfg.ImageEditorEnabled,
		ImageEditorModelBaseURL:      cfg.ImageEditorModelBaseURL,
		StockMediaEnabled:            cfg.StockMediaEnabled,
		PexelsAPIKey:                 cfg.PexelsAPIKey,
		UnsplashAccessKey:            cfg.UnsplashAccessKey,
		PixabayAPIKey:                cfg.PixabayAPIKey,
		FeedbackService:              feedbackService,
		IdentityService:              identityService,
		InstanceSettingsService:      instanceSettingsService,
		AIPromptService:              aiPromptService,
		AnalyticsService:             analyticsService,
		MessagingService:             messagingService,
		EngagementService:            engagementService,
		RepostService:                repostService,
		GrowthService:                growthService,
		NotificationService:          notificationService,
		OrganizationOwnershipService: organizationOwnershipService,
		UpdateStatusService:          updateStatusService,
		AppVersion:                   version,
		AppRevision:                  runningBuildRevision(),
		Edition:                      cfg.Edition,
		Telemetry:                    telemetryRecorder,
		MediaHandler:                 mediaHandler,
		PublicMediaVerifier:          publicMediaVerifier,
		ProfileHandler:               profileHandler,
		BillingHandler:               billingHandler,
		MCPOAuthHandler:              mcpOAuthHandler,
		MCPHandler:                   mcpHandler,
	})
	apiroutes.FinalizeOpenAPIContract(api)

	RegisterSpaRoutes(e, db, cfg.PublicURL, cfg.Edition == config.EditionCloud, cfg.PublicProfilesEnabled)

	workerCtx, cancelWorker := context.WithCancel(context.Background())
	defer cancelWorker()
	if worker != nil {
		go worker.Start(workerCtx)
		log.Printf("Starting OpenPost %s process", command.role)
	}

	var serverErrCh <-chan error
	if command.role.runsWeb() {
		log.Println("Starting OpenPost on :" + cfg.Port)
		log.Println("OpenAPI spec available at http://localhost:" + cfg.Port + "/openapi.json")
		serverErrors := make(chan error, 1)
		serverErrCh = serverErrors
		go func() {
			serverErrors <- e.Start(":" + cfg.Port)
		}()
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(sigCh)

	var runtimeErr error
	select {
	case sig := <-sigCh:
		log.Printf("Shutting down after %s...", sig)
	case err := <-serverErrCh:
		if err != nil && err != http.ErrServerClosed {
			runtimeErr = err
		}
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), processShutdownTimeout)
	defer shutdownCancel()
	var forceWorkerCancellation *time.Timer
	if worker != nil {
		forceWorkerCancellation = time.AfterFunc(processShutdownTimeout-workerCancellationReserve, cancelWorker)
		defer forceWorkerCancellation.Stop()
	}
	var webRuntime webProcess
	if command.role.runsWeb() {
		webRuntime = e
	}
	var workerRuntime workerProcess
	if worker != nil {
		workerRuntime = worker
	}
	for _, err := range drainRuntime(shutdownCtx, readiness, webRuntime, workerRuntime) {
		log.Printf("Process drain error: %v", err)
	}
	cancelWorker()
	closeTelemetry(telemetryRecorder)
	if runtimeErr != nil {
		log.Printf("Server error: %v", runtimeErr)
		return
	}
	log.Printf("OpenPost %s process stopped", command.role)
}

func closeTelemetry(recorder telemetry.Recorder) {
	if closeErr := recorder.Close(); closeErr != nil {
		log.Printf("PostHog shutdown failed: %v", closeErr)
	}
}

const telemetryPanicCapturedKey = "openpost.telemetry.panic-captured"

func capturePanics(recorder telemetry.Recorder) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) (err error) {
			defer func() {
				if recovered := recover(); recovered != nil {
					c.Set(telemetryPanicCapturedKey, true)
					captureErr := recorder.CaptureException(c.Request().Context(), telemetry.Exception{
						Title:       "OpenPost request panic",
						Description: "An HTTP request panicked",
						Properties: map[string]any{
							"method":         c.Request().Method,
							"route":          normalizedRequestRoute(c.Path()),
							"request_id":     c.Response().Header().Get(echo.HeaderXRequestID),
							"panic_type":     fmt.Sprintf("%T", recovered),
							"error_boundary": "http_panic",
						},
					})
					if captureErr != nil {
						log.Printf("Failed to enqueue request panic telemetry: %v", captureErr)
					}
					panic(recovered)
				}
			}()
			return next(c)
		}
	}
}

func installTelemetryErrorHandler(e *echo.Echo, recorder telemetry.Recorder) {
	defaultHandler := e.DefaultHTTPErrorHandler
	e.HTTPErrorHandler = func(err error, c echo.Context) {
		status := http.StatusInternalServerError
		var httpError *echo.HTTPError
		if errors.As(err, &httpError) {
			status = httpError.Code
		}
		panicCaptured, _ := c.Get(telemetryPanicCapturedKey).(bool)
		if status >= http.StatusInternalServerError && !panicCaptured {
			captureErr := recorder.CaptureException(c.Request().Context(), telemetry.Exception{
				Title:       "OpenPost HTTP " + strconv.Itoa(status),
				Description: "An HTTP request failed",
				Properties: map[string]any{
					"method":         c.Request().Method,
					"route":          normalizedRequestRoute(c.Path()),
					"status":         status,
					"request_id":     c.Response().Header().Get(echo.HeaderXRequestID),
					"error_type":     telemetry.ErrorType(err),
					"error_boundary": "http_error",
				},
			})
			if captureErr != nil {
				log.Printf("Failed to enqueue HTTP error telemetry: %v", captureErr)
			}
		}
		defaultHandler(err, c)
	}
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
