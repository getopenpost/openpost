package handlers

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	account_saver "github.com/openpost/backend/internal/services/account_saver"
	"github.com/openpost/backend/internal/services/botingress"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/providerreadiness"
	telegramservice "github.com/openpost/backend/internal/services/telegram"
	"github.com/uptrace/bun"
)

type TelegramConnectionHandler struct {
	db          *bun.DB
	auth        middleware.Authenticator
	ingress     *botingress.Service
	telegram    *telegramservice.Service
	entitlement entitlements.Service
}

type IssueTelegramConnectionCodeInput struct {
	Body struct {
		WorkspaceID    string `json:"workspace_id" minLength:"1" maxLength:"200" doc:"Workspace receiving the Telegram destination"`
		ExpectedChatID string `json:"expected_chat_id" minLength:"1" maxLength:"64" doc:"Canonical non-zero numeric Telegram chat ID that must redeem the command"`
	}
}

type IssueTelegramConnectionCodeResponse struct {
	Code        string    `json:"code" doc:"One-time command to post in the destination chat. Returned only by this issuance response."`
	BotUsername string    `json:"bot_username" doc:"Instance-owned Telegram bot username"`
	ExpiresAt   time.Time `json:"expires_at" doc:"When the one-time command expires"`
}

type IssueTelegramConnectionCodeOutput struct {
	Body IssueTelegramConnectionCodeResponse
}

func NewTelegramConnectionHandler(db *bun.DB, auth middleware.Authenticator, ingress *botingress.Service, telegram *telegramservice.Service, entitlement entitlements.Service) *TelegramConnectionHandler {
	return &TelegramConnectionHandler{db: db, auth: auth, ingress: ingress, telegram: telegram, entitlement: entitlement}
}

func (handler *TelegramConnectionHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "issue-telegram-connection-code",
		Method:      http.MethodPost,
		Path:        "/accounts/telegram/connection-code",
		Summary:     "Issue a one-time Telegram connection command",
		Description: "Returns the signed command exactly once. It expires after 15 minutes and is never placed in a URL, job, log, or later response.",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, handler.auth)},
		Errors:      []int{400, 403, 503},
	}, handler.issueCode)
}

func (handler *TelegramConnectionHandler) issueCode(ctx context.Context, input *IssueTelegramConnectionCodeInput) (*IssueTelegramConnectionCodeOutput, error) {
	if handler == nil || handler.db == nil || handler.ingress == nil || handler.telegram == nil || !handler.telegram.Available() ||
		!handler.telegram.OperationReady(ctx, providerreadiness.OperationConnect) {
		return nil, huma.Error503ServiceUnavailable("telegram connections are unavailable")
	}
	workspaceID := strings.TrimSpace(input.Body.WorkspaceID)
	allowed, err := workspaceEditAllowed(ctx, handler.db, workspaceID, middleware.GetUserID(ctx))
	if err != nil {
		return nil, huma.Error503ServiceUnavailable("failed to verify workspace access")
	}
	if !allowed {
		return nil, huma.Error403Forbidden("workspace editor access is required")
	}
	if err := account_saver.NewAccountSaver(handler.db, nil, handler.entitlement).
		CheckSocialAccountQuota(ctx, middleware.GetUserID(ctx), workspaceID); err != nil {
		return nil, huma.Error403Forbidden("social account limit exceeded")
	}
	expectedChatID := strings.TrimSpace(input.Body.ExpectedChatID)
	chatID, parseErr := strconv.ParseInt(expectedChatID, 10, 64)
	if parseErr != nil || chatID == 0 || strconv.FormatInt(chatID, 10) != expectedChatID {
		return nil, huma.Error400BadRequest("expected_chat_id must be a canonical non-zero numeric Telegram chat ID")
	}
	issued, err := handler.ingress.IssueNonce(ctx, botingress.IssueNonceInput{
		Provider: "telegram", WorkspaceID: workspaceID,
		CreatedByUserID: middleware.GetUserID(ctx), ExpectedSubjectReference: expectedChatID,
	})
	if err != nil {
		return nil, huma.Error503ServiceUnavailable("telegram connection code is unavailable")
	}
	// This authenticated response is the only plaintext delivery boundary for
	// the credential. Persistence stores only its digest.
	return &IssueTelegramConnectionCodeOutput{Body: IssueTelegramConnectionCodeResponse{
		Code:        "/connect " + issued.Credential,
		BotUsername: handler.telegram.BotUsername(), ExpiresAt: issued.ExpiresAt,
	}}, nil
}
