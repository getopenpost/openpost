package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/accountavatar"
	"github.com/openpost/backend/internal/services/accountfeatures"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/openpost/backend/internal/services/youtubeprofile"
	"github.com/openpost/backend/internal/textutil"
	"github.com/uptrace/bun"
)

func (h *OAuthHandler) checkWorkspaceAccess(ctx context.Context, workspaceID, userID string) error {
	allowed, err := workspaceReadAllowed(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError("failed to check workspace access")
	}
	if !allowed {
		return huma.Error403Forbidden("workspace not accessible")
	}
	return nil
}

func (h *OAuthHandler) checkWorkspaceEditAccess(ctx context.Context, workspaceID, userID string) error {
	allowed, err := workspaceEditAllowed(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError("failed to check workspace access")
	}
	if !allowed {
		return huma.Error403Forbidden("workspace editor role required")
	}
	return nil
}

// checkWorkspaceConnectAccess gates starting and completing an account
// connection. A client may do this without being able to author content, which
// is the whole point of the role. Disconnecting an account stays at the edit
// level: it is destructive, and it is not what the role exists for.
func (h *OAuthHandler) checkWorkspaceConnectAccess(ctx context.Context, workspaceID, userID string) error {
	allowed, err := workspaceConnectAllowed(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError("failed to check workspace access")
	}
	if !allowed {
		return huma.Error403Forbidden("workspace role cannot connect accounts")
	}
	return nil
}

func (h *OAuthHandler) ListAccounts(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-accounts",
		Method:      http.MethodGet,
		Path:        "/accounts",
		Summary:     "List connected social accounts for a workspace",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *ListAccountsInput) (*ListAccountsOutput, error) {
		userID := middleware.GetUserID(ctx)
		if err := h.checkWorkspaceAccess(ctx, input.WorkspaceID, userID); err != nil {
			return nil, err
		}
		accounts, err := h.listWorkspaceAccounts(ctx, input.WorkspaceID)
		if err != nil {
			return nil, err
		}
		if installationID := middleware.GetInstallationID(ctx); installationID != "" {
			accounts, err = filterExternalAppAccounts(ctx, h.db, installationID, input.WorkspaceID, accounts)
			if err != nil {
				return nil, huma.Error500InternalServerError("failed to apply external application account grants")
			}
		}
		grantCounts := countGrantDestinations(accounts)
		supported, enabled := h.resolveListMessaging(ctx, input.WorkspaceID, userID, accounts)
		response := buildListResponses(accounts, grantCounts, supported, enabled, h.disableLinkedInThreadReplies)
		if h.connectorStore != nil {
			var bindings []models.ProviderAccountBinding
			if err := h.db.NewSelect().Model(&bindings).
				Where("workspace_id = ?", input.WorkspaceID).Scan(ctx); err != nil {
				return nil, huma.Error500InternalServerError("failed to list connector account bindings")
			}
			installationByAccount := make(map[string]string, len(bindings))
			for _, binding := range bindings {
				installationByAccount[binding.SocialAccountID] = binding.InstallationID
			}
			for index := range response {
				response[index].ProviderInstallationID = installationByAccount[response[index].ID]
			}
		}
		return &ListAccountsOutput{Body: response}, nil
	})
}

func filterExternalAppAccounts(ctx context.Context, db *bun.DB, installationID, workspaceID string, accounts []models.SocialAccount) ([]models.SocialAccount, error) {
	var grant models.ExternalAppWorkspaceGrant
	if err := db.NewSelect().Model(&grant).Where("installation_id = ? AND workspace_id = ? AND revoked_at IS NULL", installationID, workspaceID).Scan(ctx); err != nil {
		return nil, err
	}
	var rows []models.ExternalAppAccountGrant
	if err := db.NewSelect().Model(&rows).Where("installation_id = ? AND workspace_id = ?", installationID, workspaceID).Scan(ctx); err != nil {
		return nil, err
	}
	allowed := make(map[string]struct{}, len(rows))
	for _, row := range rows {
		allowed[row.SocialAccountID] = struct{}{}
	}
	out := make([]models.SocialAccount, 0, len(accounts))
	for _, account := range accounts {
		if _, ok := allowed[account.ID]; ok {
			out = append(out, account)
		}
	}
	return out, nil
}

func (h *OAuthHandler) listWorkspaceAccounts(ctx context.Context, workspaceID string) ([]models.SocialAccount, error) {
	var accounts []models.SocialAccount
	err := h.db.NewSelect().Model(&accounts).Where("workspace_id = ?", workspaceID).Where("is_active = ?", true).Order("created_at DESC").Scan(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to list accounts")
	}
	return accounts, nil
}

func countGrantDestinations(accounts []models.SocialAccount) map[string]int {
	counts := make(map[string]int, len(accounts))
	for _, acc := range accounts {
		if acc.OAuthGrantID != "" {
			counts[acc.OAuthGrantID]++
		}
	}
	return counts
}

func (h *OAuthHandler) resolveListMessaging(ctx context.Context, workspaceID, userID string, accounts []models.SocialAccount) (map[string]bool, map[string]bool) {
	if h.accountFeatures == nil || len(accounts) == 0 {
		return map[string]bool{}, map[string]bool{}
	}
	ids := make([]string, len(accounts))
	for i, a := range accounts {
		ids[i] = a.ID
	}
	actor := workspaceActor(ctx, userID)
	features, err := h.accountFeatures.Read(ctx, workspaceID, actor, ids)
	if err != nil {
		return map[string]bool{}, map[string]bool{}
	}
	supported := make(map[string]bool, len(features))
	enabled := make(map[string]bool, len(features))
	for _, f := range features {
		if f.Feature == accountfeatures.FeatureMessaging {
			supported[f.SocialAccountID] = f.Supported
			enabled[f.SocialAccountID] = f.EffectiveEnabled
		}
	}
	return supported, enabled
}

func buildListResponses(accounts []models.SocialAccount, grantCounts map[string]int, supported, enabled map[string]bool, disableLinkedInReplies bool) []AccountResponse {
	response := make([]AccountResponse, len(accounts))
	for i, acc := range accounts {
		resp := accountResponse(acc, disableLinkedInReplies)
		if sup, ok := supported[acc.ID]; ok {
			resp.MessagingSupported = sup
		}
		if en, ok := enabled[acc.ID]; ok {
			resp.MessagesEnabled = en
		} else if _, ok := supported[acc.ID]; ok {
			resp.MessagesEnabled = false
		}
		resp.GrantDestinationCount = max(grantCounts[acc.OAuthGrantID], 1)
		resp.SharedGrant = resp.GrantDestinationCount > 1
		response[i] = resp
	}
	return response
}

func (h *OAuthHandler) UpdateAccount(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "update-account",
		Method:      http.MethodPatch,
		Path:        "/accounts/{account_id}",
		Summary:     "Update a social account",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 409},
	}, func(ctx context.Context, input *UpdateAccountInput) (*UpdateAccountOutput, error) {
		slug := strings.TrimSpace(input.Body.Slug)
		if err := validateAccountSlug(slug); err != nil {
			return nil, err
		}
		account, err := h.getEditableAccount(ctx, input.AccountID, middleware.GetUserID(ctx))
		if err != nil {
			return nil, err
		}
		if err := h.handleUpdateMessaging(ctx, account, input.Body.MessagesEnabled); err != nil {
			return nil, err
		}
		if err := h.ensureSlugAvailable(ctx, account.WorkspaceID, account.ID, slug); err != nil {
			return nil, err
		}
		if err := h.updateAccountIdentity(ctx, account.ID, slug, input.Body.Alias); err != nil {
			return nil, err
		}
		updated, err := h.fetchUpdatedAccount(ctx, account.ID)
		if err != nil {
			return nil, err
		}
		resp := accountResponse(updated, h.disableLinkedInThreadReplies)
		resp = h.enrichResponseMessaging(ctx, updated, middleware.GetUserID(ctx), resp)
		return &UpdateAccountOutput{Body: resp}, nil
	})
}

func (h *OAuthHandler) RefreshAccountMetadata(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "refresh-account-metadata",
		Method:      http.MethodPost,
		Path:        "/accounts/{account_id}/refresh-metadata",
		Summary:     "Refresh a connected account's provider profile metadata",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404, 409, 501, 502},
	}, func(ctx context.Context, input *RefreshAccountMetadataInput) (*RefreshAccountMetadataOutput, error) {
		account, err := h.getEditableAccount(ctx, input.AccountID, middleware.GetUserID(ctx))
		if err != nil {
			return nil, err
		}
		if h.tokenSource == nil {
			return nil, huma.Error501NotImplemented("account metadata refresh is unavailable")
		}
		if h.connectorStore != nil {
			_, bindingErr := h.connectorStore.BindingForAccount(ctx, account.WorkspaceID, account.ID)
			switch {
			case bindingErr == nil:
				return nil, huma.Error501NotImplemented("profile refresh is unavailable for connector accounts")
			case !errors.Is(bindingErr, sql.ErrNoRows):
				return nil, huma.Error500InternalServerError("failed to resolve the account provider")
			}
		}

		adapter, _ := h.provider(platform.AccountProviderKey(account.Platform, account.InstanceURL, account.CapabilityState))
		if adapter == nil {
			return nil, huma.Error501NotImplemented("profile refresh is unavailable for this account provider")
		}
		accessToken, err := h.tokenSource.GetValidAccessToken(ctx, account.ID)
		if err != nil {
			return nil, huma.Error502BadGateway("the provider access token could not be loaded")
		}
		updated, err := h.refreshAccountProfile(ctx, account, adapter, accessToken)
		if err != nil {
			return nil, err
		}
		resp := accountResponse(updated, h.disableLinkedInThreadReplies)
		resp = h.enrichResponseMessaging(ctx, updated, middleware.GetUserID(ctx), resp)
		return &RefreshAccountMetadataOutput{Body: resp}, nil
	})
}

func (h *OAuthHandler) refreshAccountProfile(ctx context.Context, account models.SocialAccount, adapter platform.Adapter, accessToken string) (models.SocialAccount, error) {
	if account.Platform == "youtube" {
		return h.refreshYouTubeAccountProfile(ctx, account, adapter, accessToken)
	}
	profile, err := refreshProviderAccountMetadata(ctx, adapter, accessToken, account)
	if err != nil {
		if errors.Is(err, platform.ErrAccountMetadataRefreshUnsupported) {
			return models.SocialAccount{}, huma.Error501NotImplemented("profile refresh is unavailable for this account type")
		}
		return models.SocialAccount{}, huma.Error502BadGateway("the provider profile could not be refreshed")
	}
	if profile == nil || strings.TrimSpace(profile.ID) == "" {
		return models.SocialAccount{}, huma.Error502BadGateway("the provider returned an invalid account profile")
	}
	if strings.TrimSpace(profile.ID) != strings.TrimSpace(account.AccountID) {
		return models.SocialAccount{}, huma.Error409Conflict("the provider returned a different account identity; reconnect this account instead")
	}
	cachedAvatarURL := ""
	if h.accountAvatars != nil && strings.TrimSpace(profile.AvatarURL) != "" {
		cachedAvatarURL, err = h.accountAvatars.CacheAvatar(ctx, account.ID, profile.AvatarURL)
		if err != nil {
			log.Printf("failed to cache %s avatar for account %s", account.Platform, account.ID)
			return models.SocialAccount{}, huma.Error502BadGateway("the provider profile photo could not be saved")
		}
		cachedProfile := *profile
		cachedProfile.AvatarURL = cachedAvatarURL
		profile = &cachedProfile
	}

	if err := h.updateAccountProfileMetadata(ctx, account, profile); err != nil {
		if cachedAvatarURL != "" {
			_ = h.accountAvatars.Delete(ctx, cachedAvatarURL)
		}
		return models.SocialAccount{}, err
	}
	if cachedAvatarURL != "" && account.AccountAvatarURL != cachedAvatarURL {
		_ = h.accountAvatars.Delete(ctx, account.AccountAvatarURL)
	}
	return h.fetchUpdatedAccount(ctx, account.ID)
}

func (h *OAuthHandler) refreshYouTubeAccountProfile(ctx context.Context, account models.SocialAccount, adapter platform.Adapter, accessToken string) (models.SocialAccount, error) {
	service := youtubeprofile.NewService(h.db, h.tokenSource, h.accountAvatars)
	if err := service.Refresh(ctx, account, adapter, accessToken); err != nil {
		if errors.Is(err, youtubeprofile.ErrIdentityChanged) {
			return models.SocialAccount{}, huma.Error409Conflict("the provider returned a different account identity; reconnect this account instead")
		}
		if errors.Is(err, youtubeprofile.ErrAccountChanged) {
			return models.SocialAccount{}, huma.Error409Conflict("the account changed while its profile was refreshing; try again")
		}
		if errors.Is(err, platform.ErrAccountMetadataRefreshUnsupported) {
			return models.SocialAccount{}, huma.Error501NotImplemented("profile refresh is unavailable for this account type")
		}
		return models.SocialAccount{}, huma.Error502BadGateway("the provider profile could not be refreshed")
	}
	return h.fetchUpdatedAccount(ctx, account.ID)
}

func (h *OAuthHandler) SetAccountAvatarStorage(storage mediastore.BlobStorage) {
	if storage == nil {
		h.accountAvatars = nil
		if h.accountSaver != nil {
			h.accountSaver.SetAvatarCache(nil)
		}
		return
	}
	h.accountAvatars = accountavatar.New(storage)
	if h.accountSaver != nil {
		h.accountSaver.SetAvatarCache(h.accountAvatars)
	}
}

func (h *OAuthHandler) updateAccountProfileMetadata(ctx context.Context, account models.SocialAccount, profile *platform.UserProfile) error {
	username := strings.TrimSpace(textutil.FirstNonEmpty(profile.Username, profile.DisplayName))
	avatarURL := strings.TrimSpace(profile.AvatarURL)
	if username == "" && avatarURL == "" {
		return nil
	}

	// Share the connection transaction's fence. Fetching the provider profile and
	// photo stays outside the lock, then the revision predicates reject stale work.
	return organizationguard.WithWorkspace(ctx, h.db, account.WorkspaceID, func(ctx context.Context, db bun.IDB) error {
		query := db.NewUpdate().Model((*models.SocialAccount)(nil)).
			Where("id = ? AND workspace_id = ? AND account_id = ? AND is_active = ?", account.ID, account.WorkspaceID, account.AccountID, true).
			Where("account_avatar_url = ?", account.AccountAvatarURL).
			Where("account_username = ? AND oauth_grant_id = ?", account.AccountUsername, account.OAuthGrantID)
		if username != "" {
			query = query.Set("account_username = ?", username)
		}
		if avatarURL != "" {
			query = query.Set("account_avatar_url = ?", avatarURL)
		}
		result, err := query.Exec(ctx)
		if err != nil {
			return huma.Error500InternalServerError("failed to update account metadata")
		}
		updated, err := result.RowsAffected()
		if err != nil {
			return huma.Error500InternalServerError("failed to verify account metadata update")
		}
		if updated != 1 {
			return huma.Error409Conflict("the account changed while its profile was refreshing; try again")
		}
		return nil
	})
}

func refreshProviderAccountMetadata(ctx context.Context, adapter platform.Adapter, accessToken string, account models.SocialAccount) (*platform.UserProfile, error) {
	if refresher, ok := adapter.(platform.AccountMetadataRefresher); ok {
		capabilityState := map[string]string{}
		_ = json.Unmarshal([]byte(account.CapabilityState), &capabilityState)
		return refresher.RefreshAccountMetadata(ctx, accessToken, platform.AccountMetadataRequest{
			AccountID: account.AccountID, CapabilityState: capabilityState,
		})
	}
	return adapter.GetProfile(ctx, accessToken)
}

func validateAccountSlug(slug string) error {
	if !accountSlugPattern.MatchString(slug) || strings.Contains(slug, "--") {
		return huma.Error400BadRequest("slug must be 1-63 lowercase letters, numbers, and single hyphens")
	}
	return nil
}

func (h *OAuthHandler) handleUpdateMessaging(ctx context.Context, account models.SocialAccount, messagesEnabled *bool) error {
	if messagesEnabled == nil {
		return nil
	}
	if h.accountFeatures != nil {
		return h.handleFeatureMessagingUpdate(ctx, account, *messagesEnabled)
	}
	return h.handleLegacyMessagingUpdate(ctx, account, *messagesEnabled)
}

func (h *OAuthHandler) handleFeatureMessagingUpdate(ctx context.Context, account models.SocialAccount, enabled bool) error {
	actor := workspaceActor(ctx, middleware.GetUserID(ctx))
	features, err := h.accountFeatures.Read(ctx, account.WorkspaceID, actor, []string{account.ID})
	if err != nil {
		return huma.Error500InternalServerError("failed to resolve feature support")
	}
	supported := false
	for _, f := range features {
		if f.Feature == accountfeatures.FeatureMessaging {
			supported = f.Supported
		}
	}
	if enabled && !supported {
		return huma.Error400BadRequest("messages are not supported for this provider")
	}
	if _, err := h.accountFeatures.BatchSave(ctx, account.WorkspaceID, actor, []accountfeatures.ChoiceInput{{
		AccountID: account.ID,
		Feature:   accountfeatures.FeatureMessaging,
		Enabled:   enabled,
		Source:    "legacy_patch",
	}}); err != nil {
		return huma.Error400BadRequest(err.Error())
	}
	return nil
}

func (h *OAuthHandler) handleLegacyMessagingUpdate(ctx context.Context, account models.SocialAccount, enabled bool) error {
	capabilityState := map[string]string{}
	_ = json.Unmarshal([]byte(account.CapabilityState), &capabilityState)
	if capabilityState == nil {
		capabilityState = map[string]string{}
	}
	if enabled && !accountMessagingSupported(account.Platform) {
		return huma.Error400BadRequest("messages are not supported for this provider")
	}
	capabilityState["messages_enabled"] = strings.TrimSpace(fmt.Sprintf("%t", enabled))
	encoded, _ := json.Marshal(capabilityState)
	if _, err := h.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("capability_state_json = ?", string(encoded)).Where("id = ?", account.ID).Exec(ctx); err != nil {
		return huma.Error500InternalServerError("failed to update account")
	}
	return nil
}

func (h *OAuthHandler) ensureSlugAvailable(ctx context.Context, workspaceID, accountID, slug string) error {
	var existing models.SocialAccount
	err := h.db.NewSelect().Model(&existing).Where("workspace_id = ?", workspaceID).Where("slug = ?", slug).Where("id != ?", accountID).Where("is_active = ?", true).Scan(ctx)
	if err == nil {
		return huma.Error409Conflict("slug is already used by another active account in this workspace")
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return huma.Error500InternalServerError("failed to check slug uniqueness")
	}
	return nil
}

func (h *OAuthHandler) updateAccountIdentity(ctx context.Context, accountID, slug string, alias *string) error {
	query := h.db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("slug = ?", slug).Where("id = ?", accountID)
	if alias != nil {
		query.Set("alias = ?", strings.TrimSpace(*alias))
	}
	if _, err := query.Exec(ctx); err != nil {
		return huma.Error500InternalServerError("failed to update account")
	}
	return nil
}

func (h *OAuthHandler) fetchUpdatedAccount(ctx context.Context, accountID string) (models.SocialAccount, error) {
	var account models.SocialAccount
	if err := h.db.NewSelect().Model(&account).Where("id = ?", accountID).Scan(ctx); err != nil {
		return account, huma.Error500InternalServerError("failed to fetch account")
	}
	return account, nil
}

func (h *OAuthHandler) enrichResponseMessaging(ctx context.Context, account models.SocialAccount, userID string, resp AccountResponse) AccountResponse {
	if h.accountFeatures == nil {
		return resp
	}
	actor := workspaceActor(ctx, userID)
	features, err := h.accountFeatures.Read(ctx, account.WorkspaceID, actor, []string{account.ID})
	if err != nil {
		return resp
	}
	for _, f := range features {
		if f.Feature == accountfeatures.FeatureMessaging {
			resp.MessagingSupported = f.Supported
			resp.MessagesEnabled = f.EffectiveEnabled
		}
	}
	return resp
}

func (h *OAuthHandler) getAccessibleAccount(ctx context.Context, accountID, userID string) (models.SocialAccount, error) {
	var account models.SocialAccount
	err := h.db.NewSelect().
		Model(&account).
		Where("id = ?", accountID).
		Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return account, huma.Error404NotFound("account not found")
		}
		return account, huma.Error500InternalServerError("failed to fetch account")
	}

	if err := h.checkWorkspaceAccess(ctx, account.WorkspaceID, userID); err != nil {
		return account, err
	}
	return account, nil
}

func (h *OAuthHandler) getEditableAccount(ctx context.Context, accountID, userID string) (models.SocialAccount, error) {
	account, err := h.getAccessibleAccount(ctx, accountID, userID)
	if err != nil {
		return account, err
	}
	if err := h.checkWorkspaceEditAccess(ctx, account.WorkspaceID, userID); err != nil {
		return account, err
	}
	return account, nil
}

func accountResponse(acc models.SocialAccount, disableLinkedInThreadReplies bool) AccountResponse {
	threadRepliesSupported := !disableLinkedInThreadReplies || acc.Platform != "linkedin"
	var capabilityCheckedAt *time.Time
	if !acc.CapabilityCheckedAt.IsZero() {
		checkedAt := acc.CapabilityCheckedAt
		capabilityCheckedAt = &checkedAt
	}
	capabilityState := map[string]string{}
	_ = json.Unmarshal([]byte(acc.CapabilityState), &capabilityState)
	fediverseSoftware := capabilityState["fediverse_software"]
	if fediverseSoftware == "" {
		switch acc.Platform {
		case mastodonProvider, pixelfedProvider, "peertube", "lemmy", "piefed":
			fediverseSoftware = acc.Platform
		}
	}
	accountKind := textutil.FirstNonEmpty(
		capabilityState["linkedin_account_type"],
		capabilityState["instagram_account_type"],
		capabilityState["connection_type"],
	)

	return AccountResponse{
		ID:                     acc.ID,
		Slug:                   acc.Slug,
		Alias:                  acc.Alias,
		Platform:               acc.Platform,
		AccountID:              acc.AccountID,
		AccountUsername:        acc.AccountUsername,
		AccountAvatarURL:       acc.AccountAvatarURL,
		InstanceURL:            acc.InstanceURL,
		IsActive:               acc.IsActive,
		LimitProfile:           accountLimitProfile(acc),
		CapabilityCheckedAt:    capabilityCheckedAt,
		ThreadRepliesSupported: threadRepliesSupported,
		AccountKind:            accountKind,
		FediverseSoftware:      fediverseSoftware,
		MessagingSupported:     accountMessagingSupported(acc.Platform),
		MessagesEnabled:        capabilityState["messages_enabled"] == "true",
		GrantDestinationCount:  1,
	}
}

func accountMessagingSupported(provider string) bool {
	switch provider {
	case "x", "bluesky", "mastodon", "facebook", "instagram":
		return true
	default:
		return false
	}
}
