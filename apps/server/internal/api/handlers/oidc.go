package handlers

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/billing"
	"github.com/openpost/backend/internal/services/identity"
	"github.com/openpost/backend/internal/telemetry"
)

const (
	oidcBindingCookieName      = "openpost_oidc_binding"
	reauthActionIdentityLink   = "identity.link"
	reauthActionIdentityUnlink = "identity.unlink"
)

type OIDCHandler struct {
	identity      *identity.Service
	auth          *AuthHandler
	authenticator middleware.Authenticator
}

func NewOIDCHandler(
	identityService *identity.Service,
	authHandler *AuthHandler,
	authenticator middleware.Authenticator,
) *OIDCHandler {
	return &OIDCHandler{
		identity:      identityService,
		auth:          authHandler,
		authenticator: authenticator,
	}
}

type OIDCProviderSummary struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Kind         string `json:"kind" enum:"oauth,sso"`
	Organization string `json:"organization,omitempty"`
	StartURL     string `json:"start_url"`
}

type OIDCProvidersOutput struct {
	Body []OIDCProviderSummary
}

type OIDCStartInput struct {
	ProviderID          string `path:"provider_id"`
	ReturnPath          string `query:"return_path"`
	Native              bool   `query:"native"`
	Signup              bool   `query:"signup" doc:"Whether this login was started from the explicit hosted signup flow"`
	PlanID              string `query:"plan_id" doc:"Canonical hosted plan selected for signup"`
	BillingPeriod       string `query:"billing_period" doc:"Canonical hosted billing period selected for signup"`
	PurchaseChoiceToken string `query:"purchase_choice_token" doc:"Integrity-protected hosted plan choice required for signup"`
	TelemetryID         string `query:"telemetry_id" doc:"Anonymous browser telemetry ID used only to join the signup journey"`
	Cookie              string `header:"Cookie"`
}

type OIDCCallbackInput struct {
	ProviderID       string `path:"provider_id"`
	Code             string `query:"code"`
	State            string `query:"state"`
	Error            string `query:"error"`
	ErrorDescription string `query:"error_description"`
	Cookie           string `header:"Cookie"`
}

type OIDCDiscoverInput struct {
	Email string `query:"email" format:"email"`
}

type OIDCDiscoverOutput struct {
	Body struct {
		Found    bool                 `json:"found"`
		Provider *OIDCProviderSummary `json:"provider,omitempty"`
	}
}

type OIDCAuthenticatedStartInput struct {
	ProviderID string `path:"provider_id"`
	Cookie     string `header:"Cookie"`
	Body       struct {
		ReturnPath  string `json:"return_path,omitempty"`
		ReauthGrant string `json:"reauth_grant,omitempty"`
		Action      string `json:"action,omitempty"`
		Native      bool   `json:"native,omitempty"`
	}
}

type OIDCAuthenticatedStartOutput struct {
	SetCookie string `header:"Set-Cookie"`
	Body      struct {
		AuthorizationURL string `json:"authorization_url"`
	}
}

type PasswordReauthInput struct {
	Body struct {
		Action   string `json:"action" minLength:"1"`
		Password string `json:"password" minLength:"1"`
	}
}

type ReauthGrantOutput struct {
	Body struct {
		Grant     string `json:"grant"`
		ExpiresIn int    `json:"expires_in"`
	}
}

type OIDCNativeHandoffInput struct {
	Body struct {
		Code string `json:"code" minLength:"32"`
	}
}

type OIDCNativeHandoffOutput struct {
	Body struct {
		Purpose     string       `json:"purpose" enum:"login,reauth,link"`
		Action      string       `json:"action,omitempty"`
		Token       string       `json:"token,omitempty"`
		ReauthGrant string       `json:"reauth_grant,omitempty"`
		User        *UserProfile `json:"user,omitempty"`
	}
}

type OIDCIdentitySummary struct {
	ID           string    `json:"id"`
	ProviderID   string    `json:"provider_id"`
	ProviderName string    `json:"provider_name"`
	LinkedEmail  string    `json:"linked_email,omitempty"`
	LinkedName   string    `json:"linked_name,omitempty"`
	Active       bool      `json:"active" doc:"Whether this identity provider can currently be used for sign-in and reauthentication"`
	CreatedAt    time.Time `json:"created_at"`
	LastLoginAt  time.Time `json:"last_login_at,omitempty"`
}

type OIDCIdentitiesOutput struct {
	Body []OIDCIdentitySummary
}

type OIDCUnlinkIdentityInput struct {
	IdentityID string `path:"identity_id"`
	Body       struct {
		ReauthGrant string `json:"reauth_grant"`
	}
}

type OIDCLogoutInput struct {
	ProviderID string `path:"provider_id"`
	Body       struct {
		ReturnPath string `json:"return_path,omitempty"`
	}
}

type OIDCLogoutOutput struct {
	SetCookie string `header:"Set-Cookie"`
	Body      struct {
		LogoutURL string `json:"logout_url,omitempty"`
	}
}

type OIDCBackchannelLogoutInput struct {
	ProviderID string `path:"provider_id"`
	RawBody    []byte `contentType:"application/x-www-form-urlencoded"`
}

type OIDCBackchannelLogoutOutput struct {
	Body struct {
		OK bool `json:"ok"`
	}
}

func (h *OIDCHandler) RegisterRoutes(api huma.API) {
	h.registerPublicRoutes(api)
	h.registerAuthenticatedRoutes(api)
	h.registerAdministrationRoutes(api)
}

func (h *OIDCHandler) registerPublicRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-login-oidc-providers",
		Method:      http.MethodGet,
		Path:        "/auth/oidc/providers",
		Summary:     "List instance identity providers available for login",
		Tags:        []string{tagAuth},
	}, func(ctx context.Context, _ *struct{}) (*OIDCProvidersOutput, error) {
		providers, err := h.identity.ListPublicProviders(ctx)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to list identity providers")
		}
		out := &OIDCProvidersOutput{Body: make([]OIDCProviderSummary, 0, len(providers))}
		for _, provider := range providers {
			out.Body = append(out.Body, h.providerSummary(provider, ""))
		}
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "discover-oidc-provider",
		Method:      http.MethodGet,
		Path:        "/auth/oidc/discover",
		Summary:     "Discover a verified organization identity provider by email",
		Tags:        []string{tagAuth},
		Errors:      []int{400},
	}, func(ctx context.Context, input *OIDCDiscoverInput) (*OIDCDiscoverOutput, error) {
		out := &OIDCDiscoverOutput{}
		provider, err := h.identity.DiscoverProvider(ctx, input.Email)
		if errors.Is(err, identity.ErrProviderNotFound) {
			return out, nil
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to discover identity provider")
		}
		out.Body.Found = true
		summary := h.providerSummary(*provider, "")
		out.Body.Provider = &summary
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "start-oidc-login",
		Method:      http.MethodGet,
		Path:        "/auth/oidc/{provider_id}/start",
		Summary:     "Start an OIDC login",
		Tags:        []string{tagAuth},
		Hidden:      true,
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware()},
	}, h.start)

	huma.Register(api, huma.Operation{
		OperationID: "complete-oidc-login",
		Method:      http.MethodGet,
		Path:        "/auth/oidc/{provider_id}/callback",
		Summary:     "Complete an OIDC authentication request",
		Tags:        []string{tagAuth},
		Hidden:      true,
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware()},
	}, h.callback)

	huma.Register(api, huma.Operation{
		OperationID: "exchange-native-oidc-handoff",
		Method:      http.MethodPost,
		Path:        "/auth/oidc/handoff",
		Summary:     "Exchange a one-time native OIDC handoff code",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware()},
		Errors:      []int{400},
	}, func(ctx context.Context, input *OIDCNativeHandoffInput) (*OIDCNativeHandoffOutput, error) {
		handoff, err := h.identity.ConsumeNativeHandoff(ctx, input.Body.Code)
		if err != nil {
			return nil, huma.Error400BadRequest("OIDC handoff code is invalid or expired")
		}
		out := &OIDCNativeHandoffOutput{}
		out.Body.Purpose = handoff.Purpose
		out.Body.Action = handoff.Action
		switch handoff.Purpose {
		case "login":
			user, err := h.auth.getUserByID(ctx, handoff.UserID)
			if err != nil {
				return nil, huma.Error400BadRequest("OIDC handoff account is unavailable")
			}
			out.Body.Token = handoff.Payload
			out.Body.User = h.auth.profileForUser(ctx, user)
		case "reauth":
			out.Body.ReauthGrant = handoff.Payload
		case "link":
			// The one-time handoff confirms completion. The authenticated
			// native client can refresh its identity list.
		default:
			return nil, huma.Error400BadRequest("OIDC handoff purpose is invalid")
		}
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "oidc-backchannel-logout",
		Method:      http.MethodPost,
		Path:        "/auth/oidc/{provider_id}/backchannel-logout",
		Summary:     "Process an OIDC back-channel logout token",
		Tags:        []string{tagAuth},
		Hidden:      true,
		Errors:      []int{400},
	}, func(ctx context.Context, input *OIDCBackchannelLogoutInput) (*OIDCBackchannelLogoutOutput, error) {
		values, err := url.ParseQuery(string(input.RawBody))
		if err != nil {
			return nil, huma.Error400BadRequest("invalid logout request")
		}
		if _, err := h.identity.ProcessBackchannelLogout(ctx, input.ProviderID, values.Get("logout_token")); err != nil {
			return nil, huma.Error400BadRequest("invalid logout token")
		}
		return &OIDCBackchannelLogoutOutput{Body: struct {
			OK bool `json:"ok"`
		}{OK: true}}, nil
	})
}

func (h *OIDCHandler) start(ctx context.Context, input *OIDCStartInput) (*huma.StreamResponse, error) {
	intent := models.OIDCIntentLogin
	returnPath := input.ReturnPath
	if input.Signup {
		if h.auth.purchaseChoiceRequired &&
			(strings.TrimSpace(input.PlanID) == "" || strings.TrimSpace(input.BillingPeriod) == "") {
			return nil, purchaseChoiceAPIError(billing.ErrPurchaseChoiceMissing)
		}
		choice, err := h.auth.resolvePurchaseChoice(input.PurchaseChoiceToken, input.PlanID, input.BillingPeriod)
		if err != nil {
			return nil, err
		}
		if choice.Token != "" {
			returnPath = purchaseChoiceReturnPath(returnPath, choice)
		}
		returnPath = signupTelemetryReturnPath(returnPath, input.TelemetryID)
		intent = models.OIDCIntentSignup
	}
	result, err := h.identity.Begin(ctx, identity.BeginInput{
		ProviderID:     input.ProviderID,
		Intent:         intent,
		ReturnPath:     returnPath,
		BrowserBinding: oidcBindingCookieValue(input.Cookie),
		Native:         input.Native,
	})
	if err != nil {
		return h.loginErrorRedirect(err)
	}
	return oidcRedirect(result.AuthorizationURL, oidcBindingCookie(result.BrowserBinding, result.ExpiresAt, middleware.IsSecureRequest(ctx))), nil
}

func purchaseChoiceReturnPath(raw string, choice billing.PurchaseChoice) string {
	safe := identity.SafeReturnPath(raw)
	if safe == "/" {
		safe = "/onboarding"
	}
	target, err := url.Parse(safe)
	if err != nil {
		target = &url.URL{Path: "/onboarding"}
	}
	query := target.Query()
	query.Set("plan", choice.PlanID)
	query.Set("billing_period", choice.BillingPeriod)
	query.Set("purchase_choice", choice.Token)
	target.RawQuery = query.Encode()
	return target.String()
}

const signupTelemetryQueryKey = "_signup_telemetry_id"

func signupTelemetryReturnPath(raw, telemetryID string) string {
	safe := identity.SafeReturnPath(raw)
	telemetryID = strings.TrimSpace(telemetryID)
	if !telemetry.IsAnonymousDistinctID(telemetryID) {
		return safe
	}
	parsed, err := url.Parse(safe)
	if err != nil {
		return safe
	}
	query := parsed.Query()
	query.Set(signupTelemetryQueryKey, telemetryID)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func takeSignupTelemetryID(raw string) (string, string) {
	safe := identity.SafeReturnPath(raw)
	parsed, err := url.Parse(safe)
	if err != nil {
		return safe, ""
	}
	query := parsed.Query()
	telemetryID := query.Get(signupTelemetryQueryKey)
	query.Del(signupTelemetryQueryKey)
	parsed.RawQuery = query.Encode()
	return parsed.String(), telemetryID
}

func (h *OIDCHandler) registerAuthenticatedRoutes(api huma.API) {
	h.registerIdentityLinkRoutes(api)
	h.registerReauthenticationRoutes(api)
	h.registerIdentityManagementRoutes(api)
	h.registerOIDCLogoutRoute(api)
}

func (h *OIDCHandler) registerIdentityLinkRoutes(api huma.API) {
	authMiddleware := middleware.AuthMiddleware(api, h.authenticator)

	huma.Register(api, huma.Operation{
		OperationID: "list-linkable-oidc-providers",
		Method:      http.MethodGet,
		Path:        "/auth/oidc/link-providers",
		Summary:     "List identity providers the current account may explicitly link",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{authMiddleware},
	}, func(ctx context.Context, _ *struct{}) (*OIDCProvidersOutput, error) {
		providers, err := h.identity.ListLinkableProviders(ctx, middleware.GetUserID(ctx))
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to list linkable identity providers")
		}
		out := &OIDCProvidersOutput{Body: make([]OIDCProviderSummary, 0, len(providers))}
		for _, provider := range providers {
			out.Body = append(out.Body, h.providerSummary(provider, ""))
		}
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "start-oidc-identity-link",
		Method:      http.MethodPost,
		Path:        "/auth/oidc/{provider_id}/link",
		Summary:     "Start an explicit OIDC identity link",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware(), authMiddleware},
		Errors:      []int{400, 401},
	}, func(ctx context.Context, input *OIDCAuthenticatedStartInput) (*OIDCAuthenticatedStartOutput, error) {
		if err := h.identity.ConsumeReauthGrant(
			ctx,
			input.Body.ReauthGrant,
			middleware.GetUserID(ctx),
			middleware.GetSessionID(ctx),
			reauthActionIdentityLink,
		); err != nil {
			return nil, huma.Error401Unauthorized("recent reauthentication is required")
		}
		result, err := h.identity.Begin(ctx, identity.BeginInput{
			ProviderID:     input.ProviderID,
			UserID:         middleware.GetUserID(ctx),
			SessionID:      middleware.GetSessionID(ctx),
			Intent:         models.OIDCIntentLink,
			ReturnPath:     input.Body.ReturnPath,
			BrowserBinding: oidcBindingCookieValue(input.Cookie),
			Native:         input.Body.Native,
		})
		if err != nil {
			return nil, oidcHumaError(err)
		}
		out := &OIDCAuthenticatedStartOutput{}
		out.SetCookie = oidcBindingCookie(result.BrowserBinding, result.ExpiresAt, middleware.IsSecureRequest(ctx)).String()
		out.Body.AuthorizationURL = result.AuthorizationURL
		return out, nil
	})
}

func (h *OIDCHandler) registerReauthenticationRoutes(api huma.API) {
	authMiddleware := middleware.AuthMiddleware(api, h.authenticator)
	huma.Register(api, huma.Operation{
		OperationID: "start-oidc-reauthentication",
		Method:      http.MethodPost,
		Path:        "/auth/oidc/{provider_id}/reauth",
		Summary:     "Start action-bound OIDC reauthentication",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware(), authMiddleware},
		Errors:      []int{400, 401},
	}, func(ctx context.Context, input *OIDCAuthenticatedStartInput) (*OIDCAuthenticatedStartOutput, error) {
		if strings.TrimSpace(input.Body.Action) == "" {
			return nil, huma.Error400BadRequest("reauthentication action is required")
		}
		result, err := h.identity.Begin(ctx, identity.BeginInput{
			ProviderID:     input.ProviderID,
			UserID:         middleware.GetUserID(ctx),
			SessionID:      middleware.GetSessionID(ctx),
			Intent:         models.OIDCIntentReauth,
			ReauthAction:   input.Body.Action,
			ReturnPath:     input.Body.ReturnPath,
			BrowserBinding: oidcBindingCookieValue(input.Cookie),
			Native:         input.Body.Native,
		})
		if err != nil {
			return nil, oidcHumaError(err)
		}
		out := &OIDCAuthenticatedStartOutput{}
		out.SetCookie = oidcBindingCookie(result.BrowserBinding, result.ExpiresAt, middleware.IsSecureRequest(ctx)).String()
		out.Body.AuthorizationURL = result.AuthorizationURL
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "reauthenticate-with-password",
		Method:      http.MethodPost,
		Path:        "/auth/reauth/password",
		Summary:     "Create an action-bound reauthentication grant with a password",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware(), authMiddleware},
		Errors:      []int{400, 401, 500},
	}, func(ctx context.Context, input *PasswordReauthInput) (*ReauthGrantOutput, error) {
		if middleware.GetSessionID(ctx) == "" {
			return nil, huma.Error401Unauthorized("a web session is required")
		}
		user, err := h.auth.getUserByID(ctx, middleware.GetUserID(ctx))
		if err != nil || user.PasswordHash == "" {
			return nil, huma.Error401Unauthorized("password reauthentication failed")
		}
		passwordAllowed, err := h.identity.PasswordCredentialAllowed(ctx, user.ID)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to evaluate reauthentication policy")
		}
		if !passwordAllowed || !h.auth.auth.CheckPassword(input.Body.Password, user.PasswordHash) {
			return nil, huma.Error401Unauthorized("password reauthentication failed")
		}
		grant, err := h.identity.CreateReauthGrant(
			ctx,
			user.ID,
			middleware.GetSessionID(ctx),
			input.Body.Action,
			"password",
			"",
		)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to create reauthentication grant")
		}
		out := &ReauthGrantOutput{}
		out.Body.Grant = grant
		out.Body.ExpiresIn = int(identity.ReauthGrantTTL.Seconds())
		return out, nil
	})
}

func (h *OIDCHandler) registerIdentityManagementRoutes(api huma.API) {
	authMiddleware := middleware.AuthMiddleware(api, h.authenticator)
	huma.Register(api, huma.Operation{
		OperationID: "list-linked-oidc-identities",
		Method:      http.MethodGet,
		Path:        "/auth/oidc/identities",
		Summary:     "List OIDC identities linked to the current account",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{authMiddleware},
	}, func(ctx context.Context, _ *struct{}) (*OIDCIdentitiesOutput, error) {
		var rows []struct {
			ID           string    `bun:"id"`
			ProviderID   string    `bun:"provider_id"`
			ProviderName string    `bun:"provider_name"`
			LinkedEmail  string    `bun:"linked_email"`
			LinkedName   string    `bun:"linked_name"`
			Active       bool      `bun:"active"`
			CreatedAt    time.Time `bun:"created_at"`
			LastLoginAt  time.Time `bun:"last_login_at"`
		}
		err := h.auth.db.NewSelect().
			TableExpr("user_identities AS ui").
			ColumnExpr("ui.id, ui.provider_id, ip.name AS provider_name, ui.linked_email, ui.linked_name, ip.is_active AS active, ui.created_at, ui.last_login_at").
			Join("JOIN identity_providers AS ip ON ip.id = ui.provider_id").
			Where("ui.user_id = ?", middleware.GetUserID(ctx)).
			Order("ip.name ASC").
			Scan(ctx, &rows)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error500InternalServerError("failed to list linked identities")
		}
		out := &OIDCIdentitiesOutput{Body: make([]OIDCIdentitySummary, 0, len(rows))}
		for _, row := range rows {
			out.Body = append(out.Body, OIDCIdentitySummary{
				ID: row.ID, ProviderID: row.ProviderID, ProviderName: row.ProviderName,
				LinkedEmail: row.LinkedEmail, LinkedName: row.LinkedName, Active: row.Active,
				CreatedAt: row.CreatedAt, LastLoginAt: row.LastLoginAt,
			})
		}
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "unlink-oidc-identity",
		Method:      http.MethodDelete,
		Path:        "/auth/oidc/identities/{identity_id}",
		Summary:     "Unlink an OIDC identity from the current account",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware(), authMiddleware},
		Errors:      []int{400, 401, 404},
	}, func(ctx context.Context, input *OIDCUnlinkIdentityInput) (*MessageOutput, error) {
		userID := middleware.GetUserID(ctx)
		if err := h.identity.ConsumeReauthGrant(
			ctx,
			input.Body.ReauthGrant,
			userID,
			middleware.GetSessionID(ctx),
			reauthActionIdentityUnlink,
		); err != nil {
			return nil, huma.Error401Unauthorized("recent reauthentication is required")
		}
		if err := h.identity.UnlinkIdentity(ctx, userID, input.IdentityID); errors.Is(err, identity.ErrFinalCredential) {
			return nil, huma.Error400BadRequest("add another sign-in method before unlinking this identity")
		} else if errors.Is(err, identity.ErrIdentityNotFound) {
			return nil, huma.Error404NotFound("linked identity not found")
		} else if err != nil {
			return nil, huma.Error500InternalServerError("failed to unlink identity")
		}
		out := &MessageOutput{}
		out.Body.Message = "Identity unlinked."
		return out, nil
	})
}

func (h *OIDCHandler) registerOIDCLogoutRoute(api huma.API) {
	authMiddleware := middleware.AuthMiddleware(api, h.authenticator)
	huma.Register(api, huma.Operation{
		OperationID: "logout-oidc-session",
		Method:      http.MethodPost,
		Path:        "/auth/oidc/{provider_id}/logout",
		Summary:     "Revoke the OpenPost session and prepare optional provider logout",
		Tags:        []string{tagAuth},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware(), authMiddleware},
	}, func(ctx context.Context, input *OIDCLogoutInput) (*OIDCLogoutOutput, error) {
		sessionID := middleware.GetSessionID(ctx)
		if h.auth.sessions != nil && sessionID != "" {
			if err := h.auth.sessions.RevokeSession(ctx, middleware.GetUserID(ctx), sessionID); err != nil &&
				!errors.Is(err, sql.ErrNoRows) {
				return nil, huma.Error500InternalServerError("failed to revoke OpenPost session")
			}
		}
		logoutURL, _ := h.identity.RPLogoutURL(ctx, input.ProviderID, input.Body.ReturnPath)
		out := &OIDCLogoutOutput{}
		out.SetCookie = expiredSessionCookie(middleware.IsSecureRequest(ctx)).String()
		out.Body.LogoutURL = logoutURL
		return out, nil
	})
}

func (h *OIDCHandler) callback(ctx context.Context, input *OIDCCallbackInput) (*huma.StreamResponse, error) {
	if input.Error != "" {
		message := "Identity provider sign-in was cancelled."
		if input.Error != "access_denied" {
			message = "Identity provider sign-in failed."
		}
		return h.loginErrorRedirect(errors.New(message))
	}
	if strings.TrimSpace(input.Code) == "" || strings.TrimSpace(input.State) == "" {
		return h.loginErrorRedirect(identity.ErrInvalidAuthRequest)
	}
	completion, err := h.identity.Complete(
		ctx,
		input.ProviderID,
		input.State,
		input.Code,
		oidcBindingCookieValue(input.Cookie),
	)
	if err != nil {
		return h.loginErrorRedirect(err)
	}
	expiredBinding := expiredOIDCBindingCookie(middleware.IsSecureRequest(ctx))
	switch completion.Request.Intent {
	case models.OIDCIntentLink:
		return h.completeLinkCallback(ctx, completion, expiredBinding)
	case models.OIDCIntentReauth:
		return h.completeReauthCallback(ctx, completion, expiredBinding)
	case models.OIDCIntentLogin, models.OIDCIntentSignup:
		return h.completeLoginCallback(ctx, completion, expiredBinding)
	default:
		return h.loginErrorRedirect(identity.ErrInvalidAuthRequest)
	}
}

func (h *OIDCHandler) completeLinkCallback(
	ctx context.Context,
	completion *identity.Completion,
	expiredBinding *http.Cookie,
) (*huma.StreamResponse, error) {
	if err := h.recordCompletionAssurance(
		ctx, completion, completion.Request.SessionID, completion.Request.UserID,
	); err != nil {
		return nil, huma.Error500InternalServerError("failed to record linked OIDC assurance")
	}
	location := absoluteOpenPostURL(h.identity.PublicURL(), completion.Request.ReturnPath)
	if !completion.Request.Native {
		return oidcRedirectWithCookies(location, expiredBinding), nil
	}
	handoff, err := h.identity.CreateNativeLinkHandoff(
		ctx,
		completion.Request.UserID,
		completion.Request.SessionID,
	)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to create native OIDC handoff")
	}
	location, err = h.nativeCallbackLocation(handoff)
	if err != nil {
		return nil, err
	}
	return oidcRedirectWithCookies(location, expiredBinding), nil
}

func (h *OIDCHandler) completeReauthCallback(
	ctx context.Context,
	completion *identity.Completion,
	expiredBinding *http.Cookie,
) (*huma.StreamResponse, error) {
	if err := h.recordCompletionAssurance(
		ctx, completion, completion.Request.SessionID, completion.Request.UserID,
	); err != nil {
		return nil, huma.Error500InternalServerError("failed to renew OIDC session assurance")
	}
	location := absoluteOpenPostURL(h.identity.PublicURL(), completion.Request.ReturnPath)
	if !completion.Request.Native {
		location = withFragmentValue(location, "reauth_grant", completion.ReauthGrant)
		return oidcRedirectWithCookies(location, expiredBinding), nil
	}
	handoff, err := h.identity.CreateNativeReauthHandoff(
		ctx,
		completion.Request.UserID,
		completion.Request.SessionID,
		completion.Request.ReauthAction,
		completion.ReauthGrant,
	)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to create native OIDC handoff")
	}
	location, err = h.nativeCallbackLocation(handoff)
	if err != nil {
		return nil, err
	}
	return oidcRedirectWithCookies(location, expiredBinding), nil
}

func (h *OIDCHandler) completeLoginCallback(
	ctx context.Context,
	completion *identity.Completion,
	expiredBinding *http.Cookie,
) (*huma.StreamResponse, error) {
	if completion.NewUser {
		returnPath, telemetryID := takeSignupTelemetryID(completion.Request.ReturnPath)
		completion.Request.ReturnPath = returnPath
		h.auth.captureSignupCompleted(ctx, completion.User.ID, telemetryID)
	}
	authResponse, err := h.auth.issueAuthResponse(ctx, completion.User)
	if err != nil {
		return nil, err
	}
	claims, err := h.auth.auth.ValidateToken(authResponse.Body.Token)
	if err != nil || claims.SessionID == "" {
		return nil, huma.Error500InternalServerError("failed to create OIDC session")
	}
	if err := h.recordCompletionAssurance(ctx, completion, claims.SessionID, completion.User.ID); err != nil {
		if h.auth.sessions != nil {
			_ = h.auth.sessions.RevokeSession(ctx, completion.User.ID, claims.SessionID)
		}
		return nil, huma.Error500InternalServerError("failed to record OIDC session assurance")
	}
	location := absoluteOpenPostURL(h.identity.PublicURL(), completion.Request.ReturnPath)
	if !completion.Request.Native {
		if authResponse.Body.User != nil && authResponse.Body.User.LegalAcceptanceRequired {
			location = legalAcceptanceURL(h.identity.PublicURL(), completion.Request.ReturnPath)
		}
		return oidcRedirectWithCookies(
			location,
			expiredBinding,
			cookieFromString(authResponse.SetCookie),
		), nil
	}
	handoff, err := h.identity.CreateNativeLoginHandoff(
		ctx,
		completion.User.ID,
		claims.SessionID,
		authResponse.Body.Token,
	)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to create native OIDC handoff")
	}
	location, err = h.nativeCallbackLocation(handoff)
	if err != nil {
		return nil, err
	}
	return oidcRedirectWithCookies(
		location,
		expiredBinding,
		cookieFromString(authResponse.SetCookie),
	), nil
}

func (h *OIDCHandler) recordCompletionAssurance(
	ctx context.Context,
	completion *identity.Completion,
	sessionID,
	userID string,
) error {
	return h.identity.RecordAssurance(ctx, identity.AssuranceInput{
		SessionID:   sessionID,
		ProviderID:  completion.Provider.ID,
		UserID:      userID,
		AuthTime:    completion.Identity.AuthTime,
		ACR:         completion.Identity.ACR,
		AMR:         completion.Identity.AMR,
		UpstreamSID: completion.Identity.UpstreamSID,
	})
}

func (h *OIDCHandler) nativeCallbackLocation(code string) (string, error) {
	nativeURL, err := url.Parse(h.identity.NativeCallbackURL())
	if err != nil || nativeURL.Scheme == "" {
		return "", huma.Error500InternalServerError("native OIDC callback is not configured")
	}
	query := nativeURL.Query()
	query.Set("code", code)
	nativeURL.RawQuery = query.Encode()
	return nativeURL.String(), nil
}

func withFragmentValue(rawURL, key, value string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	fragment, err := url.ParseQuery(parsed.Fragment)
	if err != nil {
		fragment = url.Values{}
	}
	fragment.Set(key, value)
	parsed.Fragment = fragment.Encode()
	return parsed.String()
}

func (h *OIDCHandler) providerSummary(provider models.IdentityProvider, organizationName string) OIDCProviderSummary {
	kind := "sso"
	if provider.Source == "first_party" {
		kind = "oauth"
	}
	return OIDCProviderSummary{
		ID:           provider.ID,
		Name:         provider.Name,
		Kind:         kind,
		Organization: organizationName,
		StartURL:     "/api/v1/auth/oidc/" + url.PathEscape(provider.ID) + "/start",
	}
}

func (h *OIDCHandler) loginErrorRedirect(err error) (*huma.StreamResponse, error) {
	message := oidcPublicError(err)
	location := h.identity.PublicURL() + "/login?oidc_error=" + url.QueryEscape(message)
	return oidcRedirect(location), nil
}

func oidcPublicError(err error) string {
	switch {
	case errors.Is(err, identity.ErrEmailConflict):
		return "An account already uses this email. Sign in to that account, then link this provider."
	case errors.Is(err, identity.ErrJITDisabled):
		return "This identity is not assigned to an OpenPost account."
	case errors.Is(err, identity.ErrExplicitSignupRequired):
		return "Choose a plan before creating a new OpenPost account."
	case errors.Is(err, identity.ErrVerifiedEmailRequired):
		return "The identity provider did not return a verified email."
	case errors.Is(err, identity.ErrIdentityCollision):
		return "This identity is already linked to another OpenPost account."
	case errors.Is(err, identity.ErrRegistrationsClosed):
		return "Registrations are disabled for this OpenPost instance."
	case errors.Is(err, identity.ErrProviderDisabled), errors.Is(err, identity.ErrProviderNotFound):
		return "This identity provider is unavailable."
	case errors.Is(err, identity.ErrBrowserBinding), errors.Is(err, identity.ErrInvalidAuthRequest),
		errors.Is(err, identity.ErrNonceMismatch):
		return "This sign-in request is invalid or expired. Start again."
	default:
		return "Identity provider sign-in failed."
	}
}

func oidcHumaError(err error) error {
	switch {
	case errors.Is(err, identity.ErrProviderDisabled), errors.Is(err, identity.ErrProviderNotFound):
		return huma.Error404NotFound("identity provider not found")
	case errors.Is(err, identity.ErrInvalidAuthRequest):
		return huma.Error400BadRequest("invalid OIDC authentication request")
	default:
		return huma.Error500InternalServerError("failed to start OIDC authentication")
	}
}

func oidcRedirect(location string, cookies ...*http.Cookie) *huma.StreamResponse {
	return oidcRedirectWithCookies(location, cookies...)
}

func oidcRedirectWithCookies(location string, cookies ...*http.Cookie) *huma.StreamResponse {
	return &huma.StreamResponse{
		Body: func(ctx huma.Context) {
			ctx.SetHeader("Location", location)
			for _, cookie := range cookies {
				if cookie != nil {
					ctx.AppendHeader("Set-Cookie", cookie.String())
				}
			}
			ctx.SetStatus(http.StatusSeeOther)
		},
	}
}

func oidcBindingCookie(value string, expiresAt time.Time, secure bool) *http.Cookie {
	return &http.Cookie{
		Name:     oidcBindingCookieName,
		Value:    value,
		Path:     "/api/v1/auth/oidc/",
		Expires:  expiresAt.UTC(),
		MaxAge:   int(time.Until(expiresAt).Seconds()),
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	}
}

func expiredOIDCBindingCookie(secure bool) *http.Cookie {
	cookie := oidcBindingCookie("", time.Unix(1, 0), secure)
	cookie.MaxAge = -1
	return cookie
}

func oidcBindingCookieValue(cookieHeader string) string {
	request := &http.Request{Header: http.Header{"Cookie": []string{cookieHeader}}}
	cookie, err := request.Cookie(oidcBindingCookieName)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(cookie.Value)
}

func cookieFromString(raw string) *http.Cookie {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	response := &http.Response{Header: http.Header{"Set-Cookie": []string{raw}}}
	cookies := response.Cookies()
	if len(cookies) == 0 {
		return nil
	}
	return cookies[0]
}

func absoluteOpenPostURL(publicURL, returnPath string) string {
	return strings.TrimRight(publicURL, "/") + identity.SafeReturnPath(returnPath)
}

func legalAcceptanceURL(publicURL, returnPath string) string {
	query := url.Values{}
	query.Set("redirect", identity.SafeReturnPath(returnPath))
	return strings.TrimRight(publicURL, "/") + "/legal-acceptance?" + query.Encode()
}
