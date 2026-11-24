package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	account_saver "github.com/openpost/backend/internal/services/account_saver"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/uptrace/bun"
)

func (h *OAuthHandler) redirectWithAccountSelection(platformName, connectionID string) (*huma.StreamResponse, error) {
	location := h.frontendURL + "/accounts/callback?status=selection_required&platform=" + url.QueryEscape(platformName) + "&connection_id=" + url.QueryEscape(connectionID)
	return &huma.StreamResponse{
		Body: func(ctx huma.Context) {
			ctx.SetHeader("Location", location)
			ctx.SetStatus(http.StatusTemporaryRedirect)
		},
	}, nil
}

func (h *OAuthHandler) saveAccountSelectionAndRedirect(
	ctx context.Context,
	userID, platformName, workspaceID, instanceURL, executionIntent string,
	tokenResp *platform.TokenResult,
	selector platform.AccountSelectionAdapter,
) (*huma.StreamResponse, error) {
	if err := h.checkWorkspaceConnectAccess(ctx, workspaceID, userID); err != nil {
		return h.redirectWithOAuthFailure(platformName, "workspace_access_denied", err, workspaceID)
	}
	if err := h.requireProviderConnectionCompletion(
		ctx, platformName, instanceURL, executionIntent, userID,
	); err != nil {
		return h.redirectWithOAuthFailure(platformName, "connection_unavailable", err, workspaceID)
	}

	options, err := selector.ListAccountSelections(ctx, tokenResp)
	if err != nil {
		if errors.Is(err, platform.ErrNoFacebookPages) {
			return h.redirectWithOAuthFailure(platformName, oauthFailureReasonFacebookNoPages, err, workspaceID)
		}
		if errors.Is(err, platform.ErrNoInstagramProfessionalAccount) {
			return h.redirectWithOAuthFailure(platformName, oauthFailureReasonInstagramNoPageLinkedAccount, err, workspaceID)
		}
		return h.redirectWithOAuthFailure(platformName, "account_selection_failed", err, workspaceID)
	}
	if len(options) == 0 {
		return h.redirectWithOAuthFailure(platformName, "account_selection_failed", nil, workspaceID)
	}
	if err := h.requireProviderConnectionCompletion(
		ctx, platformName, instanceURL, executionIntent, userID,
	); err != nil {
		return h.redirectWithOAuthFailure(platformName, "connection_unavailable", err, workspaceID)
	}

	pending, err := h.createPendingAccountSelection(
		ctx, userID, platformName, workspaceID, instanceURL,
		executionIntent, tokenResp, options,
	)
	if err != nil {
		return h.redirectWithOAuthFailure(platformName, "account_save_failed", err, workspaceID)
	}

	log.Printf("[Callback] Pending account selection created: ID=%s platform=%s", pending.ID, platformName)
	return h.redirectWithAccountSelection(platformName, pending.ID)
}

func (h *OAuthHandler) createPendingAccountSelection(
	ctx context.Context,
	userID, platformName, workspaceID, instanceURL, executionIntent string,
	tokenResp *platform.TokenResult,
	options []platform.AccountSelectionOption,
) (*models.OAuthAccountSelection, error) {
	if h.crypto == nil {
		return nil, fmt.Errorf("token encryptor is not configured")
	}
	if tokenResp == nil {
		return nil, fmt.Errorf("token response is required")
	}

	encAccess, err := h.crypto.Encrypt(tokenResp.AccessToken)
	if err != nil {
		return nil, err
	}

	var encRefresh []byte
	if tokenResp.RefreshToken != "" {
		encRefresh, err = h.crypto.Encrypt(tokenResp.RefreshToken)
		if err != nil {
			return nil, err
		}
	}

	optionsJSON, err := json.Marshal(options)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	extra := make(map[string]string, len(tokenResp.Extra)+1)
	for key, value := range tokenResp.Extra {
		extra[key] = value
	}
	if tokenResp.RefreshExpiresIn > 0 {
		extra[pendingSelectionRefreshExpiresAtKey] = now.Add(time.Duration(tokenResp.RefreshExpiresIn) * time.Second).Format(time.RFC3339Nano)
	}
	extraJSON, err := json.Marshal(extra)
	if err != nil {
		return nil, err
	}

	var tokenExpiresAt time.Time
	if tokenResp.ExpiresIn > 0 {
		tokenExpiresAt = now.Add(time.Duration(tokenResp.ExpiresIn) * time.Second)
	}

	pending := &models.OAuthAccountSelection{
		ID:              uuid.NewString(),
		UserID:          userID,
		WorkspaceID:     workspaceID,
		Platform:        platformName,
		InstanceURL:     instanceURL,
		ExecutionIntent: executionIntent,
		AccessTokenEnc:  encAccess,
		RefreshTokenEnc: encRefresh,
		TokenType:       tokenResp.TokenType,
		TokenExpiresAt:  tokenExpiresAt,
		TokenExtraJSON:  string(extraJSON),
		OptionsJSON:     string(optionsJSON),
		ExpiresAt:       now.Add(pendingAccountSelectionTTL),
		CreatedAt:       now,
	}
	if _, err := h.db.NewInsert().Model(pending).Exec(ctx); err != nil {
		return nil, err
	}
	return pending, nil
}

func (h *OAuthHandler) GetAccountSelection(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-account-selection",
		Method:      http.MethodGet,
		Path:        "/accounts/selections/{connection_id}",
		Summary:     "Get pending OAuth account-selection options",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404},
	}, func(ctx context.Context, input *GetAccountSelectionInput) (*GetAccountSelectionOutput, error) {
		pending, err := h.loadPendingAccountSelection(ctx, input.ConnectionID, middleware.GetUserID(ctx))
		if err != nil {
			return nil, err
		}

		options, err := parseAccountSelectionOptions(pending.OptionsJSON)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to parse account selection options")
		}

		return &GetAccountSelectionOutput{Body: AccountSelectionResponse{
			ID:          pending.ID,
			Platform:    pending.Platform,
			WorkspaceID: pending.WorkspaceID,
			ExpiresAt:   pending.ExpiresAt,
			Options:     options,
		}}, nil
	})
}

//nolint:gocyclo // Validation and the atomic multi-account handoff share one OAuth completion boundary.
func (h *OAuthHandler) CompleteAccountSelection(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "complete-account-selection",
		Method:      http.MethodPost,
		Path:        "/accounts/selections/{connection_id}/complete",
		Summary:     "Complete OAuth account selection and save the selected account",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404},
	}, h.completeAccountSelection)
}

func (h *OAuthHandler) completeAccountSelection(ctx context.Context, input *CompleteAccountSelectionInput) (*CompleteAccountSelectionOutput, error) {
	normalizedSelections, err := normalizeAccountSelectionIDs(input)
	if err != nil {
		return nil, err
	}

	userID := middleware.GetUserID(ctx)
	pending, err := h.loadPendingAccountSelection(ctx, input.ConnectionID, userID)
	if err != nil {
		return nil, err
	}
	if err := h.reservePendingAccountSelection(ctx, pending.ID); err != nil {
		return nil, err
	}
	selectionCompleted := false
	defer func() {
		if selectionCompleted {
			return
		}
		if _, releaseErr := h.db.NewDelete().Model((*models.OAuthAccountSelectionReservation)(nil)).
			Where("selection_id = ?", pending.ID).Exec(context.WithoutCancel(ctx)); releaseErr != nil {
			log.Printf("[OAuth Selection] Failed to release selection reservation: %v", releaseErr)
		}
	}()
	if err := h.requireProviderConnectionCompletion(
		ctx, pending.Platform, pending.InstanceURL, pending.ExecutionIntent, userID,
	); err != nil {
		return nil, err
	}

	saveInputs, err := h.collectAccountSaveInputs(ctx, pending, userID, normalizedSelections)
	if err != nil {
		return nil, err
	}

	out, err := h.persistAccountSelection(ctx, userID, pending, saveInputs)
	if err != nil {
		return nil, err
	}
	selectionCompleted = true
	return out, nil
}

func normalizeAccountSelectionIDs(input *CompleteAccountSelectionInput) ([]string, error) {
	selectionIDs := append([]string(nil), input.Body.SelectionIDs...)
	if selectionID := strings.TrimSpace(input.Body.SelectionID); selectionID != "" {
		selectionIDs = append(selectionIDs, selectionID)
	}
	seenSelections := map[string]struct{}{}
	normalizedSelections := make([]string, 0, len(selectionIDs))
	for _, selectionID := range selectionIDs {
		selectionID = strings.TrimSpace(selectionID)
		if selectionID == "" {
			continue
		}
		if _, exists := seenSelections[selectionID]; exists {
			continue
		}
		seenSelections[selectionID] = struct{}{}
		normalizedSelections = append(normalizedSelections, selectionID)
	}
	if len(normalizedSelections) == 0 {
		return nil, huma.Error400BadRequest("selection_ids must include at least one account")
	}
	return normalizedSelections, nil
}

func (h *OAuthHandler) collectAccountSaveInputs(ctx context.Context, pending *models.OAuthAccountSelection, userID string, normalizedSelections []string) ([]account_saver.SaveAccountInput, error) {
	adapter, err := h.getProvider(pending.Platform, "")
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	if pending.InstanceURL != "" {
		if rebuilt, ok := platform.NewInstanceAdapter(pending.Platform, pending.InstanceURL); ok {
			adapter = rebuilt
		}
	}
	selector, ok := adapter.(platform.AccountSelectionAdapter)
	if !ok {
		return nil, huma.Error400BadRequest(fmt.Sprintf("%s does not support account selection", pending.Platform))
	}

	tokenResp, err := h.tokenResultFromPendingSelection(pending)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to decrypt pending account selection")
	}

	if pending.Platform != "linkedin" && len(normalizedSelections) > 1 {
		return nil, huma.Error400BadRequest("this provider supports one account per connection")
	}
	saveInputs := make([]account_saver.SaveAccountInput, 0, len(normalizedSelections))
	for _, selectionID := range normalizedSelections {
		if err := h.requireProviderConnectionCompletion(
			ctx, pending.Platform, pending.InstanceURL, pending.ExecutionIntent, userID,
		); err != nil {
			return nil, err
		}
		selected, err := selector.SelectAccount(ctx, tokenResp, selectionID)
		if err != nil {
			return nil, huma.Error400BadRequest(err.Error())
		}
		if selected == nil {
			return nil, huma.Error400BadRequest("selected account was not found")
		}
		if selected.Token == nil {
			selected.Token = tokenResp
		}
		saveInputs = append(saveInputs, account_saver.SaveAccountInput{
			Actor:                 workspaceActor(ctx, userID),
			UserID:                userID,
			PlatformName:          pending.Platform,
			WorkspaceID:           pending.WorkspaceID,
			AccountID:             selected.AccountID,
			AccountUsername:       selected.AccountUsername,
			AccountAvatarURL:      selected.AccountAvatarURL,
			ProfileFetchedAt:      time.Now().UTC(),
			InstanceURL:           selectedAccountInstanceURL(pending.Platform, selected.InstanceURL, pending.InstanceURL),
			Token:                 selected.Token,
			CapabilityState:       selected.CapabilityState,
			Grant:                 authorizationGrantInput(adapter, firstNonEmptyTokenValue(tokenResp, "_grant_subject", "user_id", "open_id", "sub")),
			FirstConnectionOrigin: pending.ID,
		})
	}
	return saveInputs, nil
}

func (h *OAuthHandler) persistAccountSelection(ctx context.Context, userID string, pending *models.OAuthAccountSelection, saveInputs []account_saver.SaveAccountInput) (*CompleteAccountSelectionOutput, error) {
	saver := h.accountSaver
	if saver == nil {
		saver = account_saver.NewAccountSaver(h.db, h.crypto)
		saver.SetAvatarCache(h.accountAvatars)
	}
	if err := h.requireProviderConnectionCompletion(
		ctx, pending.Platform, pending.InstanceURL, pending.ExecutionIntent, userID,
	); err != nil {
		return nil, err
	}
	accounts, err := saver.SaveAccountsFromInputs(ctx, saveInputs)
	if err != nil {
		log.Printf("[OAuth Selection] Failed to save selected accounts: %v", err)
		return nil, huma.Error403Forbidden(accountConnectionErrorMessage(err))
	}
	accountIDs := make([]string, len(accounts))
	for index, account := range accounts {
		accountIDs[index] = account.ID
	}
	firstConnection := accounts[0].ClaimedFirst
	h.captureDestinationConnected(ctx, userID, pending.WorkspaceID, pending.Platform, len(accounts), firstConnection)
	if err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewUpdate().Model((*models.OAuthAccountSelection)(nil)).
			Set("consumed_at = ?", time.Now().UTC()).Where("id = ?", pending.ID).Exec(txCtx); err != nil {
			return err
		}
		_, err := tx.NewDelete().Model((*models.OAuthAccountSelectionReservation)(nil)).
			Where("selection_id = ?", pending.ID).Exec(txCtx)
		return err
	}); err != nil {
		logAccountConnectionError(pending.Platform, "account_selection_completion_failed", err)
		return nil, huma.Error500InternalServerError("failed to complete account selection")
	}
	return &CompleteAccountSelectionOutput{Body: AccountSelectionCompletionResponse{
		AccountResponse:   accountResponse(*accounts[0], h.disableLinkedInThreadReplies),
		WorkspaceID:       pending.WorkspaceID,
		AccountIDs:        accountIDs,
		OpenFreshComposer: firstConnection,
	}}, nil
}

func (h *OAuthHandler) captureDestinationConnected(
	ctx context.Context,
	userID, workspaceID, platformName string,
	accountCount int,
	firstConnection bool,
) {
	if !firstConnection || h.telemetry == nil {
		return
	}
	if err := h.telemetry.Capture(ctx, telemetry.Event{
		Name: telemetry.EventDestinationConnected, DistinctID: userID, WorkspaceID: workspaceID,
		Properties: map[string]any{"platform": platformName, "account_count": accountCount},
	}); err != nil {
		log.Printf("Failed to enqueue destination connection telemetry: %v", err)
	}
}

func (h *OAuthHandler) reservePendingAccountSelection(ctx context.Context, selectionID string) error {
	now := time.Now().UTC()
	if _, err := h.db.NewDelete().Model((*models.OAuthAccountSelectionReservation)(nil)).
		Where("selection_id = ?", selectionID).
		Where("reserved_at < ?", now.Add(-10*time.Minute)).Exec(ctx); err != nil {
		return huma.Error500InternalServerError("failed to reserve account selection")
	}
	result, err := h.db.NewInsert().Model(&models.OAuthAccountSelectionReservation{
		SelectionID: selectionID,
		ReservedAt:  now,
	}).On("CONFLICT (selection_id) DO NOTHING").Exec(ctx)
	if err != nil {
		return huma.Error500InternalServerError("failed to reserve account selection")
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return huma.Error500InternalServerError("failed to reserve account selection")
	}
	if rows != 1 {
		return huma.Error404NotFound("account selection not found or expired")
	}
	return nil
}

func (h *OAuthHandler) loadPendingAccountSelection(ctx context.Context, connectionID, userID string) (*models.OAuthAccountSelection, error) {
	var pending models.OAuthAccountSelection
	err := h.db.NewSelect().
		Model(&pending).
		Where("id = ?", connectionID).
		Where("user_id = ?", userID).
		Where("consumed_at IS NULL").
		Where("expires_at > ?", time.Now().UTC()).
		Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error404NotFound("account selection not found or expired")
		}
		return nil, huma.Error500InternalServerError("failed to fetch account selection")
	}
	if err := h.checkWorkspaceConnectAccess(ctx, pending.WorkspaceID, userID); err != nil {
		return nil, err
	}
	return &pending, nil
}

func (h *OAuthHandler) tokenResultFromPendingSelection(pending *models.OAuthAccountSelection) (*platform.TokenResult, error) {
	if pending == nil {
		return nil, fmt.Errorf("pending selection is required")
	}
	if h.crypto == nil {
		return nil, fmt.Errorf("token encryptor is not configured")
	}

	accessToken, err := h.crypto.Decrypt(pending.AccessTokenEnc)
	if err != nil {
		return nil, err
	}

	refreshToken := ""
	if len(pending.RefreshTokenEnc) > 0 {
		refreshToken, err = h.crypto.Decrypt(pending.RefreshTokenEnc)
		if err != nil {
			return nil, err
		}
	}

	extra := map[string]string{}
	if strings.TrimSpace(pending.TokenExtraJSON) != "" {
		if err := json.Unmarshal([]byte(pending.TokenExtraJSON), &extra); err != nil {
			return nil, err
		}
	}
	refreshExpiresIn := 0
	if rawExpiry := strings.TrimSpace(extra[pendingSelectionRefreshExpiresAtKey]); rawExpiry != "" {
		delete(extra, pendingSelectionRefreshExpiresAtKey)
		refreshExpiresAt, err := time.Parse(time.RFC3339Nano, rawExpiry)
		if err != nil {
			return nil, fmt.Errorf("parse pending refresh token expiry: %w", err)
		}
		refreshExpiresIn = int(time.Until(refreshExpiresAt).Seconds())
		if refreshExpiresIn < 0 {
			refreshExpiresIn = 0
		}
	}

	expiresIn := 0
	if !pending.TokenExpiresAt.IsZero() {
		expiresIn = int(time.Until(pending.TokenExpiresAt).Seconds())
		if expiresIn < 0 {
			expiresIn = 0
		}
	}

	return &platform.TokenResult{
		AccessToken:      accessToken,
		RefreshToken:     refreshToken,
		ExpiresIn:        expiresIn,
		RefreshExpiresIn: refreshExpiresIn,
		TokenType:        pending.TokenType,
		Extra:            extra,
	}, nil
}

func parseAccountSelectionOptions(raw string) ([]platform.AccountSelectionOption, error) {
	var options []platform.AccountSelectionOption
	if strings.TrimSpace(raw) == "" {
		return options, nil
	}
	if err := json.Unmarshal([]byte(raw), &options); err != nil {
		return nil, err
	}
	return options, nil
}
