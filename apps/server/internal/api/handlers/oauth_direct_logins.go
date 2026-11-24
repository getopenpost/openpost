package handlers

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	account_saver "github.com/openpost/backend/internal/services/account_saver"
	"github.com/openpost/backend/internal/textutil"
)

type BlueskyLoginInput struct {
	Body struct {
		WorkspaceID string `json:"workspace_id" doc:"Workspace ID"`
		Handle      string `json:"handle" doc:"Bluesky handle (e.g. user.bsky.social)"`
		AppPassword string `json:"app_password" doc:"Bluesky app password (Settings > App Passwords)"`
		Intent      string `json:"intent,omitempty" enum:"production,certification_test" doc:"Typed execution intent; certification_test requires an unscoped instance administrator"`
	}
}

type BlueskyLoginOutput struct {
	Body AccountConnectionResponse
}

func (h *OAuthHandler) BlueskyLogin(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "bluesky-login",
		Method:      http.MethodPost,
		Path:        "/accounts/bluesky/login",
		Summary:     "Connect Bluesky account using app password",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 502},
	}, func(ctx context.Context, input *BlueskyLoginInput) (*BlueskyLoginOutput, error) {
		userID := middleware.GetUserID(ctx)
		intent, err := h.connectionIntent(ctx, input.Body.Intent)
		if err != nil {
			return nil, err
		}
		if err := h.ensureCanStartAccountConnection(ctx, input.Body.WorkspaceID, userID); err != nil {
			return nil, err
		}

		adapter, ok := h.provider("bluesky")
		if !ok {
			return nil, huma.Error400BadRequest("bluesky not configured")
		}
		if err := h.requireProviderConnection(ctx, "bluesky", "", intent); err != nil {
			return nil, err
		}

		loginAdapter, resolvedDID, err := h.blueskyLoginAdapter(ctx, adapter, input.Body.Handle)
		if err != nil {
			return nil, err
		}
		pdsURL := loginAdapter.PDSURL()

		did, handle, accessToken, refreshToken, expiresIn, err := loginAdapter.CreateSession(ctx, input.Body.Handle, input.Body.AppPassword)
		if err != nil {
			// Transport errors name internal hosts, so only the log carries the detail.
			log.Printf("[BlueskyLogin] Session creation failed: %v", err)
			return nil, huma.Error500InternalServerError("bluesky login failed")
		}
		if resolvedDID != "" && did != resolvedDID {
			log.Printf("[BlueskyLogin] PDS %s returned did %s for a handle resolving to %s", pdsURL, did, resolvedDID)
			return nil, huma.Error500InternalServerError("bluesky login failed")
		}
		if err := h.requireProviderConnectionCompletion(
			ctx, "bluesky", "", string(intent), userID,
		); err != nil {
			return nil, err
		}

		// Build a TokenResult for Bluesky and delegate saving to AccountSaver so encryption and DB insert are centralized
		tokenResp := &platform.TokenResult{
			AccessToken:  accessToken,
			RefreshToken: refreshToken,
			ExpiresIn:    expiresIn,
			Extra:        nil,
		}
		profile := &platform.UserProfile{
			ID:       did,
			Username: textutil.FirstNonEmpty(handle, input.Body.Handle),
		}
		providerProfile, profileErr := loginAdapter.GetProfile(ctx, accessToken)
		if profileErr != nil {
			log.Printf("[BlueskyLogin] Profile unavailable after session creation: %v", profileErr)
		} else if providerProfile != nil {
			profile.ID = textutil.FirstNonEmpty(providerProfile.ID, profile.ID)
			profile.Username = textutil.FirstNonEmpty(providerProfile.Username, profile.Username)
			profile.DisplayName = providerProfile.DisplayName
			profile.AvatarURL = providerProfile.AvatarURL
			profile.CapabilityState = providerProfile.CapabilityState
		}
		if err := h.requireProviderConnectionCompletion(
			ctx, "bluesky", "", string(intent), userID,
		); err != nil {
			return nil, err
		}
		accountID := textutil.FirstNonEmpty(profile.ID, did)
		if providerKey := platform.AccountProviderKey("bluesky", pdsURL, ""); providerKey != "bluesky" {
			h.registerProvider(providerKey, loginAdapter)
		}

		account, err := h.accountSaver.SaveAccountFromInput(ctx, account_saver.SaveAccountInput{
			Actor:            workspaceActor(ctx, userID),
			UserID:           userID,
			PlatformName:     "bluesky",
			WorkspaceID:      input.Body.WorkspaceID,
			AccountID:        accountID,
			AccountUsername:  textutil.FirstNonEmpty(profile.Username, input.Body.Handle),
			AccountAvatarURL: profile.AvatarURL,
			InstanceURL:      pdsURL,
			Token:            tokenResp,
			Grant:            authorizationGrantInput(loginAdapter, accountID),
		})
		if err != nil {
			log.Printf("[BlueskyLogin] Failed to save account: %v", err)
			return nil, huma.Error403Forbidden(accountConnectionErrorMessage(err))
		}

		resp := h.normalizedAccountConnectionResponse(input.Body.WorkspaceID, []*models.SocialAccount{account}, account.ClaimedFirst)
		return &BlueskyLoginOutput{Body: resp}, nil
	})
}

type DevNullLoginInput struct {
	Body struct {
		WorkspaceID string `json:"workspace_id" doc:"Workspace ID"`
		Username    string `json:"username" doc:"dev/null username (your GitHub username)"`
		PrivateKey  string `json:"private_key" doc:"OpenSSH private key whose public half is on your GitHub account (stored encrypted, used only to sign commits)"`
		Intent      string `json:"intent,omitempty" enum:"production,certification_test" doc:"Typed execution intent; certification_test requires an unscoped instance administrator"`
	}
}

type DevNullLoginOutput struct {
	Body AccountConnectionResponse
}

// DevNullLogin connects a dev/null account with an SSH private key. The key
// is verified against dev-null.sh and then stored encrypted; every publish
// signs its commit payload with it, exactly like the official commit script.
func (h *OAuthHandler) DevNullLogin(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "devnull-login",
		Method:      http.MethodPost,
		Path:        "/accounts/devnull/login",
		Summary:     "Connect a dev/null account using an SSH private key",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 502},
	}, func(ctx context.Context, input *DevNullLoginInput) (*DevNullLoginOutput, error) {
		userID := middleware.GetUserID(ctx)
		intent, err := h.connectionIntent(ctx, input.Body.Intent)
		if err != nil {
			return nil, err
		}
		if err := h.ensureCanStartAccountConnection(ctx, input.Body.WorkspaceID, userID); err != nil {
			return nil, err
		}
		if err := h.requireProviderConnection(ctx, "devnull", "", intent); err != nil {
			return nil, err
		}

		adapter, ok := h.provider("devnull")
		if !ok {
			return nil, huma.Error400BadRequest("devnull not configured")
		}
		loginAdapter, ok := adapter.(interface {
			Login(context.Context, string, string) (*platform.TokenResult, *platform.UserProfile, error)
		})
		if !ok {
			return nil, huma.Error500InternalServerError("devnull login failed")
		}
		tokenResp, profile, err := loginAdapter.Login(ctx, strings.TrimSpace(input.Body.Username), input.Body.PrivateKey)
		if err != nil {
			log.Printf("[DevNullLogin] Login failed: %v", err)
			return nil, huma.Error400BadRequest(devNullLoginErrorMessage(err))
		}
		if err := h.requireProviderConnectionCompletion(ctx, "devnull", "", string(intent), userID); err != nil {
			return nil, err
		}

		account, err := h.accountSaver.SaveAccountFromInput(ctx, account_saver.SaveAccountInput{
			Actor:            workspaceActor(ctx, userID),
			UserID:           userID,
			PlatformName:     "devnull",
			WorkspaceID:      input.Body.WorkspaceID,
			AccountID:        profile.ID,
			AccountUsername:  textutil.FirstNonEmpty(profile.Username, input.Body.Username),
			AccountAvatarURL: profile.AvatarURL,
			InstanceURL:      platform.DevNullDefaultBaseURL,
			Token:            tokenResp,
			CapabilityState:  profile.CapabilityState,
			Grant:            authorizationGrantInput(adapter, profile.ID),
		})
		if err != nil {
			log.Printf("[DevNullLogin] Failed to save account: %v", err)
			return nil, huma.Error403Forbidden(accountConnectionErrorMessage(err))
		}
		resp := h.normalizedAccountConnectionResponse(input.Body.WorkspaceID, []*models.SocialAccount{account}, account.ClaimedFirst)
		return &DevNullLoginOutput{Body: resp}, nil
	})
}

func devNullLoginErrorMessage(err error) string {
	message := strings.TrimSpace(err.Error())
	if message == "" {
		return "dev/null login failed"
	}
	// Adapter errors are already curated and secret-free.
	return message
}

type FediverseLoginInput struct {
	Body struct {
		WorkspaceID string `json:"workspace_id" doc:"Workspace ID"`
		InstanceURL string `json:"instance_url" doc:"Fediverse instance URL"`
		Username    string `json:"username" doc:"Instance username"`
		Password    string `json:"password" doc:"Instance password (exchanged once, never stored)"`
		Channel     string `json:"channel,omitempty" doc:"PeerTube channel to connect (required when the account owns several)"`
		Intent      string `json:"intent,omitempty" enum:"production,certification_test" doc:"Typed execution intent; certification_test requires an unscoped instance administrator"`
	}
}

type FediverseLoginOutput struct {
	Body FediverseLoginResponse
}

type FediverseLoginResponse struct {
	AccountConnectionResponse
	SelectionRequired bool                              `json:"selection_required,omitempty" doc:"True when the caller must complete channel selection"`
	ConnectionID      string                            `json:"connection_id,omitempty" doc:"Pending selection ID for the channel picker"`
	Options           []platform.AccountSelectionOption `json:"options,omitempty" doc:"Selectable channels when selection is required"`
}

// fediverseLogin connects a credential-based Fediverse account (PeerTube,
// Lemmy, PieFed) following the Bluesky app-password shape: the password is
// exchanged once for tokens and never stored.
func (h *OAuthHandler) fediverseLogin(ctx context.Context, provider string, body FediverseLoginInput) (*FediverseLoginOutput, error) {
	userID := middleware.GetUserID(ctx)
	intent, err := h.connectionIntent(ctx, body.Body.Intent)
	if err != nil {
		return nil, err
	}
	if err := h.ensureCanStartAccountConnection(ctx, body.Body.WorkspaceID, userID); err != nil {
		return nil, err
	}
	instanceURL, err := normalizeFediverseInstanceURL(body.Body.InstanceURL)
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	if err := h.requireProviderConnection(ctx, provider, instanceURL, intent); err != nil {
		return nil, err
	}

	adapter, ok := platform.NewInstanceAdapter(provider, instanceURL)
	if !ok {
		return nil, huma.Error400BadRequest(fmt.Sprintf("%s does not support instance credentials", provider))
	}
	h.registerProvider(platform.AccountProviderKey(provider, instanceURL, ""), adapter)

	tokenResp, profile, err := fediverseInstanceLogin(ctx, adapter, strings.TrimSpace(body.Body.Username), body.Body.Password)
	if err != nil {
		log.Printf("[FediverseLogin] Login failed: provider=%s instance=%s error=%v", provider, instanceURL, err)
		return nil, huma.Error500InternalServerError(provider + " login failed")
	}
	if err := h.requireProviderConnectionCompletion(ctx, provider, instanceURL, string(intent), userID); err != nil {
		return nil, err
	}

	if provider == "peertube" {
		return h.savePeerTubeLogin(ctx, userID, provider, body.Body.WorkspaceID, instanceURL, string(intent), adapter, tokenResp, profile, strings.TrimSpace(body.Body.Channel))
	}

	account, err := h.accountSaver.SaveAccountFromInput(ctx, account_saver.SaveAccountInput{
		Actor:            workspaceActor(ctx, userID),
		UserID:           userID,
		PlatformName:     provider,
		WorkspaceID:      body.Body.WorkspaceID,
		AccountID:        profile.ID,
		AccountUsername:  textutil.FirstNonEmpty(profile.Username, body.Body.Username),
		AccountAvatarURL: profile.AvatarURL,
		InstanceURL:      instanceURL,
		Token:            tokenResp,
		CapabilityState:  profile.CapabilityState,
		Grant:            authorizationGrantInput(adapter, profile.ID),
	})
	if err != nil {
		log.Printf("[FediverseLogin] Failed to save account: %v", err)
		return nil, huma.Error403Forbidden(accountConnectionErrorMessage(err))
	}
	resp := h.normalizedAccountConnectionResponse(body.Body.WorkspaceID, []*models.SocialAccount{account}, account.ClaimedFirst)
	return &FediverseLoginOutput{Body: FediverseLoginResponse{AccountConnectionResponse: resp}}, nil
}

func fediverseInstanceLogin(ctx context.Context, adapter platform.Adapter, username, password string) (*platform.TokenResult, *platform.UserProfile, error) {
	type instanceLoginer interface {
		Login(ctx context.Context, username, password string) (*platform.TokenResult, *platform.UserProfile, error)
	}
	loginer, ok := adapter.(instanceLoginer)
	if !ok {
		return nil, nil, fmt.Errorf("provider does not support instance credentials")
	}
	return loginer.Login(ctx, username, password)
}

func (h *OAuthHandler) savePeerTubeLogin(
	ctx context.Context,
	userID, provider, workspaceID, instanceURL, executionIntent string,
	adapter platform.Adapter,
	tokenResp *platform.TokenResult,
	_ *platform.UserProfile,
	requestedChannel string,
) (*FediverseLoginOutput, error) {
	selector, ok := adapter.(platform.AccountSelectionAdapter)
	if !ok {
		return nil, huma.Error500InternalServerError("peertube channel selection is unavailable")
	}
	channels, err := selector.ListAccountSelections(ctx, tokenResp)
	if err != nil {
		return nil, huma.Error500InternalServerError("peertube channel listing failed")
	}
	if len(channels) == 0 {
		return nil, huma.Error400BadRequest("this PeerTube account owns no channels")
	}
	if requestedChannel != "" {
		for _, channel := range channels {
			if channel.ID == requestedChannel {
				return h.saveSelectedPeerTubeChannel(ctx, userID, provider, workspaceID, instanceURL, executionIntent, adapter, tokenResp, channel.ID)
			}
		}
		return nil, huma.Error400BadRequest("unknown peertube channel selection")
	}
	if len(channels) == 1 {
		return h.saveSelectedPeerTubeChannel(ctx, userID, provider, workspaceID, instanceURL, executionIntent, adapter, tokenResp, channels[0].ID)
	}
	if err := h.requireProviderConnectionCompletion(ctx, provider, instanceURL, executionIntent, userID); err != nil {
		return nil, err
	}
	pending, err := h.createPendingAccountSelection(ctx, userID, provider, workspaceID, instanceURL, executionIntent, tokenResp, channels)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to save pending channel selection")
	}
	return &FediverseLoginOutput{Body: FediverseLoginResponse{SelectionRequired: true, ConnectionID: pending.ID, Options: channels}}, nil
}

func (h *OAuthHandler) saveSelectedPeerTubeChannel(
	ctx context.Context,
	userID, provider, workspaceID, instanceURL, executionIntent string,
	adapter platform.Adapter,
	tokenResp *platform.TokenResult,
	channelID string,
) (*FediverseLoginOutput, error) {
	selector, ok := adapter.(platform.AccountSelectionAdapter)
	if !ok {
		return nil, huma.Error500InternalServerError("peertube channel selection is unavailable")
	}
	selected, err := selector.SelectAccount(ctx, tokenResp, channelID)
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	if err := h.requireProviderConnectionCompletion(ctx, provider, instanceURL, executionIntent, userID); err != nil {
		return nil, err
	}
	account, err := h.accountSaver.SaveAccountFromInput(ctx, account_saver.SaveAccountInput{
		Actor:            workspaceActor(ctx, userID),
		UserID:           userID,
		PlatformName:     provider,
		WorkspaceID:      workspaceID,
		AccountID:        selected.AccountID,
		AccountUsername:  selected.AccountUsername,
		AccountAvatarURL: selected.AccountAvatarURL,
		InstanceURL:      instanceURL,
		Token:            selected.Token,
		CapabilityState:  selected.CapabilityState,
		Grant:            authorizationGrantInput(adapter, selected.AccountID),
	})
	if err != nil {
		log.Printf("[FediverseLogin] Failed to save account: %v", err)
		return nil, huma.Error403Forbidden(accountConnectionErrorMessage(err))
	}
	resp := h.normalizedAccountConnectionResponse(workspaceID, []*models.SocialAccount{account}, account.ClaimedFirst)
	return &FediverseLoginOutput{Body: FediverseLoginResponse{AccountConnectionResponse: resp}}, nil
}

func (h *OAuthHandler) PeerTubeLogin(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "peertube-login",
		Method:      http.MethodPost,
		Path:        "/accounts/peertube/login",
		Summary:     "Connect a PeerTube account using instance credentials",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 500},
	}, func(ctx context.Context, input *FediverseLoginInput) (*FediverseLoginOutput, error) {
		return h.fediverseLogin(ctx, "peertube", *input)
	})
}

func (h *OAuthHandler) LemmyLogin(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "lemmy-login",
		Method:      http.MethodPost,
		Path:        "/accounts/lemmy/login",
		Summary:     "Connect a Lemmy account using instance credentials",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 500},
	}, func(ctx context.Context, input *FediverseLoginInput) (*FediverseLoginOutput, error) {
		return h.fediverseLogin(ctx, "lemmy", *input)
	})
}

func (h *OAuthHandler) PieFedLogin(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "piefed-login",
		Method:      http.MethodPost,
		Path:        "/accounts/piefed/login",
		Summary:     "Connect a PieFed account using instance credentials",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 500},
	}, func(ctx context.Context, input *FediverseLoginInput) (*FediverseLoginOutput, error) {
		return h.fediverseLogin(ctx, "piefed", *input)
	})
}

type DiscordWebhookLoginInput struct {
	Body struct {
		WorkspaceID string `json:"workspace_id" doc:"Workspace ID"`
		WebhookURL  string `json:"webhook_url" doc:"Discord incoming webhook URL"`
		Intent      string `json:"intent,omitempty" enum:"production,certification_test" doc:"Typed execution intent; certification_test requires an unscoped instance administrator"`
	}
}

type DiscordWebhookLoginOutput struct {
	Body AccountConnectionResponse
}

func (h *OAuthHandler) DiscordWebhookLogin(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "discord-webhook-login",
		Method:      http.MethodPost,
		Path:        "/accounts/discord/webhook",
		Summary:     "Connect a Discord channel using an incoming webhook",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403},
	}, func(ctx context.Context, input *DiscordWebhookLoginInput) (*DiscordWebhookLoginOutput, error) {
		userID := middleware.GetUserID(ctx)
		intent, err := h.connectionIntent(ctx, input.Body.Intent)
		if err != nil {
			return nil, err
		}
		if err := h.ensureCanStartAccountConnection(ctx, input.Body.WorkspaceID, userID); err != nil {
			return nil, err
		}
		webhookAdapter, _ := h.provider("discord:" + platform.ConnectionModeWebhook)
		adapter, ok := webhookAdapter.(*platform.DiscordAdapter)
		if !ok {
			legacyAdapter, _ := h.provider("discord")
			adapter, ok = legacyAdapter.(*platform.DiscordAdapter)
		}
		if !ok {
			return nil, huma.Error400BadRequest("discord webhooks are not configured")
		}
		if err := h.requireProviderConnection(ctx, "discord", "", intent); err != nil {
			return nil, err
		}
		webhookURL := strings.TrimSpace(input.Body.WebhookURL)
		profile, err := adapter.GetProfile(ctx, webhookURL)
		if err != nil {
			return nil, huma.Error400BadRequest(err.Error())
		}
		if err := h.requireProviderConnectionCompletion(
			ctx, "discord", "", string(intent), userID,
		); err != nil {
			return nil, err
		}
		token := &platform.TokenResult{
			AccessToken: webhookURL,
			TokenType:   "Webhook",
		}
		account, err := h.accountSaver.SaveAccountFromInput(ctx, account_saver.SaveAccountInput{
			Actor:            workspaceActor(ctx, userID),
			UserID:           userID,
			PlatformName:     "discord",
			WorkspaceID:      input.Body.WorkspaceID,
			AccountID:        profile.ID,
			AccountUsername:  textutil.FirstNonEmpty(profile.DisplayName, profile.Username),
			AccountAvatarURL: profile.AvatarURL,
			Token:            token,
			CapabilityState:  profile.CapabilityState,
			Grant:            authorizationGrantInput(adapter, profile.ID),
		})
		if err != nil {
			logAccountConnectionError("discord", "account_save_failed", err)
			return nil, huma.Error403Forbidden(accountConnectionErrorMessage(err))
		}
		resp := h.normalizedAccountConnectionResponse(input.Body.WorkspaceID, []*models.SocialAccount{account}, account.ClaimedFirst)
		return &DiscordWebhookLoginOutput{Body: resp}, nil
	})
}
