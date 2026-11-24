package handlers

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	account_saver "github.com/openpost/backend/internal/services/account_saver"
	"github.com/openpost/backend/internal/services/oauthstate"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/textutil"
)

func (h *OAuthHandler) ensureCanStartAccountConnection(ctx context.Context, workspaceID, userID string) error {
	if err := h.checkWorkspaceConnectAccess(ctx, workspaceID, userID); err != nil {
		return err
	}
	if err := h.accountSaver.CheckSocialAccountQuota(ctx, middleware.GetUserID(ctx), workspaceID); err != nil {
		return huma.Error403Forbidden(accountConnectionErrorMessage(err))
	}
	return nil
}

func (h *OAuthHandler) connectionIntent(ctx context.Context, raw string) (providerreadiness.ExecutionIntent, error) {
	switch providerreadiness.ExecutionIntent(strings.TrimSpace(raw)) {
	case "", providerreadiness.ExecutionIntentProduction:
		return providerreadiness.ExecutionIntentProduction, nil
	case providerreadiness.ExecutionIntentCertificationTest:
		if err := requireUnscopedInstanceAdmin(ctx, h.db); err != nil {
			return "", err
		}
		return providerreadiness.ExecutionIntentCertificationTest, nil
	default:
		return "", huma.Error400BadRequest("invalid provider readiness execution intent")
	}
}

func (h *OAuthHandler) persistedConnectionIntent(
	ctx context.Context,
	raw, userID string,
) (providerreadiness.ExecutionIntent, error) {
	intent := providerreadiness.ExecutionIntent(strings.TrimSpace(raw))
	switch intent {
	case providerreadiness.ExecutionIntentProduction:
		return intent, nil
	case providerreadiness.ExecutionIntentCertificationTest:
		if strings.TrimSpace(userID) == "" {
			return "", huma.Error403Forbidden("provider certification initiator is unavailable")
		}
		var isAdmin bool
		if err := h.db.NewSelect().
			Model((*models.User)(nil)).
			Column("is_admin").
			Where("id = ?", userID).
			Scan(ctx, &isAdmin); err != nil {
			return "", huma.Error403Forbidden("provider certification initiator is unavailable")
		}
		if !isAdmin {
			return "", huma.Error403Forbidden("provider certification requires a current instance administrator")
		}
		return intent, nil
	default:
		return "", huma.Error409Conflict("invalid or expired provider readiness execution intent")
	}
}

func (h *OAuthHandler) requireProviderConnectionCompletion(
	ctx context.Context,
	provider, instanceURL, rawIntent, userID string,
) error {
	intent, err := h.persistedConnectionIntent(ctx, rawIntent, userID)
	if err != nil {
		return err
	}
	return h.requireProviderConnection(ctx, provider, instanceURL, intent)
}

func (h *OAuthHandler) requireProviderConnection(
	ctx context.Context,
	provider, instanceURL string,
	intent providerreadiness.ExecutionIntent,
) error {
	if h.readiness == nil {
		return huma.Error409Conflict((&providerreadiness.NotReadyError{
			Decision: providerreadiness.UnavailableDecision(providerreadiness.OperationConnect),
		}).Error())
	}
	decision := h.readiness.DecideConnection(ctx, provider, instanceURL, intent)
	if decision.Connectable {
		return nil
	}
	return huma.Error409Conflict((&providerreadiness.NotReadyError{Decision: decision}).Error())
}

func (h *OAuthHandler) GetAuthURL(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-auth-url",
		Method:      http.MethodGet,
		Path:        "/accounts/{platform}/auth-url",
		Summary:     "Get OAuth authorization URL for a platform",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 409},
	}, func(ctx context.Context, input *GetAuthURLInput) (*GetAuthURLOutput, error) {
		if input.Platform == "bluesky" {
			return nil, huma.Error400BadRequest("bluesky uses app passwords, not OAuth redirect")
		}
		if input.Platform == "devnull" {
			return nil, huma.Error400BadRequest("dev/null uses SSH keys, not OAuth redirect")
		}
		if input.WorkspaceID == "" {
			return nil, huma.Error400BadRequest(errWorkspaceIDRequired)
		}

		userID := middleware.GetUserID(ctx)
		intent, err := h.connectionIntent(ctx, input.Intent)
		if err != nil {
			return nil, err
		}
		if err := h.ensureCanStartAccountConnection(ctx, input.WorkspaceID, userID); err != nil {
			return nil, err
		}

		adapter, serverNameForState, err := h.authURLProvider(ctx, input)
		if err != nil {
			return nil, err
		}
		if err := h.requireProviderConnection(ctx, input.Platform, serverNameForState, intent); err != nil {
			return nil, err
		}
		return h.generateProviderAuthURL(ctx, input, userID, adapter, serverNameForState, intent)
	})
}

func (h *OAuthHandler) authURLProvider(
	ctx context.Context,
	input *GetAuthURLInput,
) (platform.Adapter, string, error) {
	if input.ConnectionMode != "" && input.ConnectionMode != platform.ConnectionModeOAuth && input.Platform != "instagram" {
		return nil, "", huma.Error400BadRequest("connection_mode is only supported for Instagram")
	}
	if input.Platform == "instagram" {
		return h.instagramAuthURLProvider(input)
	}
	if isCompatOAuthProvider(input.Platform) {
		if input.ServerName == "" && input.InstanceURL == "" {
			return nil, "", huma.Error400BadRequest(fmt.Sprintf("server_name or instance_url required for %s", input.Platform))
		}
		adapter, instanceURL, err := h.getCompatProvider(ctx, input.Platform, input.ServerName, input.InstanceURL)
		if err != nil {
			return nil, "", huma.Error400BadRequest(err.Error())
		}
		return adapter, instanceURL, nil
	}
	adapter, err := h.getProvider(input.Platform, input.ServerName)
	if err != nil {
		return nil, "", huma.Error400BadRequest(err.Error())
	}
	if input.Platform == "discord" {
		return adapter, platform.ConnectionModeBot, nil
	}
	return adapter, "", nil
}

func (h *OAuthHandler) instagramAuthURLProvider(input *GetAuthURLInput) (platform.Adapter, string, error) {
	if input.ConnectionMode != "" && input.ConnectionMode != platform.ConnectionModeOAuth && input.ConnectionMode != platform.ConnectionModeInstagramLogin {
		return nil, "", huma.Error400BadRequest("unsupported Instagram connection mode")
	}
	mode := input.ConnectionMode
	if mode == "" {
		mode = platform.ConnectionModeOAuth
	}
	adapter, err := h.getProvider(input.Platform, mode)
	if err != nil {
		return nil, "", huma.Error400BadRequest(err.Error())
	}
	return adapter, mode, nil
}

func (h *OAuthHandler) generateProviderAuthURL(
	ctx context.Context,
	input *GetAuthURLInput,
	userID string,
	adapter platform.Adapter,
	serverNameForState string,
	intent providerreadiness.ExecutionIntent,
) (*GetAuthURLOutput, error) {
	if input.Platform == "x" {
		return generateXAuthURL(input, userID, adapter, intent)
	}
	state, err := h.oauthStates.Create(ctx, oauthstate.Payload{
		UserID: userID, WorkspaceID: input.WorkspaceID, Platform: input.Platform,
		ServerName: textutil.FirstNonEmpty(serverNameForState, input.ServerName), ExecutionIntent: string(intent),
	})
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to create oauth state")
	}
	authURL, _ := adapter.GenerateAuthURL(state)
	if authURL == "" {
		return nil, huma.Error400BadRequest(fmt.Sprintf("%s does not support OAuth redirect", input.Platform))
	}
	resp := &GetAuthURLOutput{}
	resp.Body.URL = authURL
	return resp, nil
}

func generateXAuthURL(
	input *GetAuthURLInput,
	userID string,
	adapter platform.Adapter,
	intent providerreadiness.ExecutionIntent,
) (*GetAuthURLOutput, error) {
	xAdapter, ok := adapter.(*platform.XAdapter)
	if !ok {
		return nil, huma.Error500InternalServerError("x adapter type mismatch")
	}
	authURL, err := xAdapter.GenerateAuthURLWithIntent(userID, input.WorkspaceID, string(intent))
	if err != nil {
		log.Printf("[X OAuth] auth url generation failed: %v", err)
		return nil, huma.Error400BadRequest("X authorization could not be started")
	}
	resp := &GetAuthURLOutput{}
	resp.Body.URL = authURL
	return resp, nil
}

//nolint:gocyclo
func (h *OAuthHandler) Callback(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "oauth-callback",
		Method:      http.MethodGet,
		Path:        "/accounts/{platform}/callback",
		Summary:     "Handle OAuth callback from provider",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.OptionalAuthMiddleware(api, h.auth)},
		Errors:      []int{400},
		Hidden:      true,
	}, func(ctx context.Context, input *OAuthCallbackInput) (*huma.StreamResponse, error) {
		if resp, err := h.oauthCallbackDenialResponse(ctx, input); err != nil || resp != nil {
			return resp, err
		}
		session, resp, err := h.resolveOAuthCallbackSession(ctx, input)
		if err != nil || resp != nil {
			return resp, err
		}
		if resp, err := h.resolveOAuthCallbackAdapter(ctx, input, session); err != nil || resp != nil {
			return resp, err
		}
		return h.finishOAuthCallback(ctx, input, session)
	})
}

func (h *OAuthHandler) finishOAuthCallback(ctx context.Context, input *OAuthCallbackInput, session *oauthCallbackSession) (*huma.StreamResponse, error) {
	if err := h.requireProviderConnectionCompletion(
		ctx, input.Platform, session.instanceRef, session.executionIntent, session.userID,
	); err != nil {
		return h.redirectWithOAuthFailure(input.Platform, "connection_unavailable", err, session.workspaceID)
	}

	tokenResp, err := session.adapter.ExchangeCode(ctx, input.Code, session.extra)
	if err != nil {
		return h.redirectWithOAuthFailure(input.Platform, "token_exchange_failed", err, session.workspaceID)
	}

	if err := h.requireProviderConnectionCompletion(
		ctx, input.Platform, session.instanceRef, session.executionIntent, session.userID,
	); err != nil {
		return h.redirectWithOAuthFailure(input.Platform, "connection_unavailable", err, session.workspaceID)
	}

	if selector, ok := session.adapter.(platform.AccountSelectionAdapter); ok && (input.Platform != "instagram" || session.instanceRef != platform.ConnectionModeInstagramLogin) {
		profile, profileErr := session.adapter.GetProfile(ctx, tokenResp.AccessToken)
		if profileErr != nil {
			logAccountConnectionError(input.Platform, "selection_profile_fetch_failed", profileErr)
		} else if profile != nil && profile.ID != "" {
			if tokenResp.Extra == nil {
				tokenResp.Extra = map[string]string{}
			}
			tokenResp.Extra["_grant_subject"] = profile.ID
		}
		return h.saveAccountSelectionAndRedirect(
			ctx, session.userID, input.Platform, session.workspaceID, session.instanceRef,
			session.executionIntent, tokenResp, selector,
		)
	}

	profile, err := session.adapter.GetProfile(ctx, tokenResp.AccessToken)
	if err != nil {
		return h.redirectWithOAuthFailure(input.Platform, "profile_fetch_failed", err, session.workspaceID)
	}

	return h.saveAccountAndRedirect(
		ctx, session.userID, input.Platform, session.workspaceID, session.instanceRef, session.executionIntent,
		profile, tokenResp, session.adapter,
	)
}

func (h *OAuthHandler) oauthCallbackDenialResponse(ctx context.Context, input *OAuthCallbackInput) (*huma.StreamResponse, error) {
	if input.Platform == "x" && input.Denied != "" {
		input.OAuthToken = input.Denied
		workspaceID := h.callbackErrorWorkspace(ctx, input)
		return h.redirectWithOAuthFeedback("cancelled", "", workspaceID)
	}
	if input.Error != "" {
		workspaceID := h.callbackErrorWorkspace(ctx, input)
		if strings.EqualFold(input.Error, "access_denied") || strings.EqualFold(input.Error, "cancelled") {
			return h.redirectWithOAuthFeedback("cancelled", "", workspaceID)
		}
		return h.redirectWithOAuthFailure(input.Platform, "authorization_failed", nil, workspaceID)
	}

	if input.Code == "" && input.OAuthToken == "" {
		return h.redirectWithOAuthFailure(input.Platform, "missing_code", nil)
	}
	return nil, nil
}

type oauthCallbackSession struct {
	workspaceID     string
	userID          string
	executionIntent string
	instanceRef     string
	adapter         platform.Adapter
	extra           map[string]string
}

func (h *OAuthHandler) resolveOAuthCallbackSession(ctx context.Context, input *OAuthCallbackInput) (*oauthCallbackSession, *huma.StreamResponse, error) {
	workspaceID := ""
	userID := ""
	executionIntent := ""
	instanceRef := ""
	var adapter platform.Adapter

	extra := make(map[string]string)
	if input.Platform == "x" {
		var err error
		adapter, err = h.getProvider(input.Platform, input.ServerName)
		if err != nil {
			resp, err := h.redirectWithOAuthFailure(input.Platform, "provider_unavailable", err)
			return nil, resp, err
		}
		extra["oauth_token"] = input.OAuthToken
		extra["oauth_verifier"] = input.Verifier
	}

	if input.Platform == "x" {
		xAdapter, ok := adapter.(*platform.XAdapter)
		if !ok {
			resp, err := h.redirectWithOAuthFailure(input.Platform, "provider_unavailable", nil)
			return nil, resp, err
		}
		requestMeta, ok := xAdapter.GetRequestMetaForRequestToken(input.OAuthToken)
		if !ok {
			resp, err := h.redirectWithOAuthFailure(input.Platform, "invalid_state", nil)
			return nil, resp, err
		}
		workspaceID = requestMeta.WorkspaceID
		userID = requestMeta.UserID
		executionIntent = requestMeta.ExecutionIntent
	} else {
		statePayload, err := h.oauthStates.Consume(ctx, input.State)
		if err != nil {
			resp, err := h.redirectWithOAuthFailure(input.Platform, "invalid_state", nil)
			return nil, resp, err
		}
		if statePayload.Platform != input.Platform {
			resp, err := h.redirectWithOAuthFailure(input.Platform, "invalid_state", nil)
			return nil, resp, err
		}
		userID = statePayload.UserID
		workspaceID = statePayload.WorkspaceID
		executionIntent = statePayload.ExecutionIntent
		switch input.Platform {
		case mastodonProvider, pixelfedProvider:
			input.ServerName = statePayload.ServerName
			instanceRef = statePayload.ServerName
		case "discord":
			instanceRef = platform.ConnectionModeBot
		case "instagram":
			input.ServerName = statePayload.ServerName
			instanceRef = statePayload.ServerName
		}
	}

	if middleware.GetUserID(ctx) == "" || middleware.GetUserID(ctx) != userID {
		resp, err := h.redirectWithOAuthFailure(input.Platform, "session_mismatch", nil, workspaceID)
		return nil, resp, err
	}
	if err := h.checkWorkspaceConnectAccess(ctx, workspaceID, userID); err != nil {
		resp, err := h.redirectWithOAuthFailure(input.Platform, "workspace_access_denied", err, workspaceID)
		return nil, resp, err
	}
	if err := h.requireProviderConnectionCompletion(
		ctx, input.Platform, instanceRef, executionIntent, userID,
	); err != nil {
		resp, err := h.redirectWithOAuthFailure(input.Platform, "connection_unavailable", err, workspaceID)
		return nil, resp, err
	}

	return &oauthCallbackSession{workspaceID: workspaceID, userID: userID, executionIntent: executionIntent, instanceRef: instanceRef, adapter: adapter, extra: extra}, nil, nil
}

func (h *OAuthHandler) resolveOAuthCallbackAdapter(ctx context.Context, input *OAuthCallbackInput, session *oauthCallbackSession) (*huma.StreamResponse, error) {
	if input.Platform != "x" {
		var err error
		if isCompatOAuthProvider(input.Platform) {
			session.adapter, _, err = h.getCompatProvider(ctx, input.Platform, input.ServerName, "")
			if err != nil {
				resp, err := h.redirectWithOAuthFailure(input.Platform, "provider_unavailable", err, session.workspaceID)
				return resp, err
			}
			session.instanceRef = mastodonInstanceURL(session.adapter)
		} else {
			session.adapter, err = h.getProvider(input.Platform, input.ServerName)
			if err != nil {
				resp, err := h.redirectWithOAuthFailure(input.Platform, "provider_unavailable", err, session.workspaceID)
				return resp, err
			}
		}
	}
	return nil, nil
}

func (h *OAuthHandler) callbackErrorWorkspace(ctx context.Context, input *OAuthCallbackInput) string {
	if input.Platform == "x" {
		adapter, err := h.getProvider(input.Platform, input.ServerName)
		if err != nil {
			return ""
		}
		xAdapter, ok := adapter.(*platform.XAdapter)
		if !ok {
			return ""
		}
		meta, ok := xAdapter.GetRequestMetaForRequestToken(input.OAuthToken)
		if ok {
			return meta.WorkspaceID
		}
		return ""
	}
	payload, err := h.oauthStates.Consume(ctx, input.State)
	if err != nil || payload.Platform != input.Platform {
		return ""
	}
	return payload.WorkspaceID
}

func (h *OAuthHandler) saveAccountAndRedirect(
	ctx context.Context,
	userID, platformName, workspaceID, instanceURL, executionIntent string,
	profile *platform.UserProfile,
	tokenResp *platform.TokenResult,
	adapter platform.Adapter,
) (*huma.StreamResponse, error) {
	accountID := profile.ID
	if platformName == "threads" && tokenResp.Extra != nil {
		if uid, ok := tokenResp.Extra["user_id"]; ok && uid != "" {
			if profile.ID != "" && uid != profile.ID {
				return h.redirectWithOAuthFailure(platformName, "identity_mismatch", nil, workspaceID)
			}
			accountID = uid
		}
	}
	grantSubject := accountID
	if platformName == "instagram" && instanceURL == platform.ConnectionModeInstagramLogin {
		// The code exchange identifies the app-scoped authorization subject;
		// /me.user_id identifies the professional destination used by Graph.
		grantSubject = textutil.FirstNonEmpty(firstNonEmptyTokenValue(tokenResp, "user_id"), accountID)
	}
	if err := h.requireProviderConnectionCompletion(
		ctx, platformName, instanceURL, executionIntent, userID,
	); err != nil {
		return h.redirectWithOAuthFailure(platformName, "connection_unavailable", err, workspaceID)
	}

	account, err := h.accountSaver.SaveAccountFromInput(ctx, account_saver.SaveAccountInput{
		Actor:            workspaceActor(ctx, userID),
		UserID:           userID,
		PlatformName:     platformName,
		WorkspaceID:      workspaceID,
		AccountID:        accountID,
		AccountUsername:  profile.Username,
		AccountAvatarURL: profile.AvatarURL,
		InstanceURL:      selectedAccountInstanceURL(platformName, instanceURL),
		Token:            tokenResp,
		CapabilityState:  h.fediverseCapabilityState(ctx, platformName, instanceURL, profile),
		Grant:            authorizationGrantInput(adapter, grantSubject),
	})
	if err != nil {
		return h.redirectWithOAuthFailure(platformName, "account_save_failed", err, workspaceID)
	}
	firstConnection := account.ClaimedFirst
	h.captureDestinationConnected(ctx, userID, workspaceID, platformName, 1, firstConnection)

	log.Printf("[Callback] Account saved successfully: ID=%s", account.ID)
	if firstConnection {
		return redirectResponse(h.composerConnectionURL(workspaceID, []string{account.ID})), nil
	}
	return redirectResponse(h.accountManagementRedirectURL()), nil
}

func redirectResponse(location string) *huma.StreamResponse {
	return &huma.StreamResponse{
		Body: func(ctx huma.Context) {
			ctx.SetHeader("Location", location)
			ctx.SetStatus(http.StatusTemporaryRedirect)
		},
	}
}

func (h *OAuthHandler) composerConnectionURL(workspaceID string, accountIDs []string) string {
	query := url.Values{}
	query.Set("workspace_id", workspaceID)
	query.Set("account_ids", strings.Join(accountIDs, ","))
	return h.frontendURL + "/?" + query.Encode()
}

func (h *OAuthHandler) accountManagementRedirectURL() string {
	return h.frontendURL + "/settings?tab=accounts"
}

func (h *OAuthHandler) normalizedAccountConnectionResponse(workspaceID string, accounts []*models.SocialAccount, openFreshComposer bool) AccountConnectionResponse {
	accountIDs := make([]string, 0, len(accounts))
	for _, a := range accounts {
		accountIDs = append(accountIDs, a.ID)
	}
	firstID := ""
	if len(accounts) > 0 {
		firstID = accounts[0].ID
	}
	return AccountConnectionResponse{
		WorkspaceID:       workspaceID,
		AccountID:         firstID,
		AccountIDs:        accountIDs,
		OpenFreshComposer: openFreshComposer,
	}
}

func accountConnectionErrorMessage(err error) string {
	msg := strings.TrimSpace(err.Error())
	switch {
	case strings.EqualFold(msg, "active subscription required"):
		return "Active subscription required to connect social accounts. Choose a plan in Billing, then try connecting again."
	case strings.Contains(msg, "social_accounts limit exceeded"), strings.Contains(msg, "social account limit exceeded"):
		return "Social account limit reached for this workspace. Upgrade your plan or disconnect an account, then try again."
	case msg != "":
		return "Failed to save account"
	default:
		return "Failed to save account"
	}
}

func (h *OAuthHandler) ExchangeCode(api huma.API) {
	for _, provider := range []string{mastodonProvider, pixelfedProvider} {
		h.registerCompatExchangeCode(api, provider)
	}
}

func (h *OAuthHandler) registerCompatExchangeCode(api huma.API, provider string) {
	displayName := compatProviderDisplayName(provider)
	huma.Register(api, huma.Operation{
		OperationID: "exchange-" + provider + "-code",
		Method:      http.MethodPost,
		Path:        "/accounts/" + provider + "/exchange",
		Summary:     "Exchange " + displayName + " OOB authorization code",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400},
	}, func(ctx context.Context, input *ExchangeCodeInput) (*ExchangeCodeOutput, error) {
		return h.exchangeCompatCode(ctx, provider, input)
	})
}

func (h *OAuthHandler) exchangeCompatCode(ctx context.Context, provider string, input *ExchangeCodeInput) (*ExchangeCodeOutput, error) {
	userID := middleware.GetUserID(ctx)
	intent, err := h.connectionIntent(ctx, input.Body.Intent)
	if err != nil {
		return nil, err
	}
	if err := h.ensureCanStartAccountConnection(ctx, input.Body.WorkspaceID, userID); err != nil {
		return nil, err
	}
	serverName := strings.TrimRight(strings.TrimSpace(input.Body.ServerName), "/")
	requestedInstance := textutil.FirstNonEmpty(strings.TrimRight(strings.TrimSpace(input.Body.InstanceURL), "/"), serverName)
	if strings.TrimSpace(input.Body.InstanceURL) == "" {
		if adapter, lookupErr := h.getProvider(provider, requestedInstance); lookupErr == nil {
			requestedInstance = textutil.FirstNonEmpty(mastodonInstanceURL(adapter), requestedInstance)
		}
	}
	if err := h.requireProviderConnection(ctx, provider, requestedInstance, intent); err != nil {
		return nil, err
	}

	adapter, _, err := h.getCompatProvider(ctx, provider, serverName, input.Body.InstanceURL)
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	instanceURL := mastodonInstanceURL(adapter)
	if err := h.requireProviderConnectionCompletion(
		ctx, provider, instanceURL, string(intent), userID,
	); err != nil {
		return nil, err
	}

	tokenResp, err := adapter.ExchangeCode(ctx, input.Body.Code, nil)
	if err != nil {
		logAccountConnectionError(provider, "token_exchange_failed", err)
		return nil, huma.Error500InternalServerError("Provider token exchange failed")
	}
	if err := h.requireProviderConnectionCompletion(
		ctx, provider, instanceURL, string(intent), userID,
	); err != nil {
		return nil, err
	}

	profile, err := adapter.GetProfile(ctx, tokenResp.AccessToken)
	if err != nil {
		logAccountConnectionError(provider, "compat_profile_fetch_failed", err)
		return nil, huma.Error500InternalServerError("Provider profile lookup failed")
	}

	if err := h.requireProviderConnectionCompletion(
		ctx, provider, instanceURL, string(intent), userID,
	); err != nil {
		return nil, err
	}

	account, err := h.accountSaver.SaveAccountFromInput(ctx, account_saver.SaveAccountInput{
		Actor:            workspaceActor(ctx, userID),
		UserID:           userID,
		PlatformName:     provider,
		WorkspaceID:      input.Body.WorkspaceID,
		AccountID:        profile.ID,
		AccountUsername:  profile.Username,
		AccountAvatarURL: profile.AvatarURL,
		InstanceURL:      instanceURL,
		Token:            tokenResp,
		CapabilityState:  h.fediverseCapabilityState(ctx, provider, instanceURL, profile),
		Grant:            authorizationGrantInput(adapter, profile.ID),
	})
	if err != nil {
		log.Printf("[ExchangeCode] Failed to save account: %v", err)
		return nil, huma.Error403Forbidden(accountConnectionErrorMessage(err))
	}
	firstConnection := account.ClaimedFirst

	log.Printf("[ExchangeCode] Account saved successfully")
	resp := h.normalizedAccountConnectionResponse(input.Body.WorkspaceID, []*models.SocialAccount{account}, firstConnection)
	return &ExchangeCodeOutput{Body: resp}, nil
}
