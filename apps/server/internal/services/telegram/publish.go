package telegram

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/uptrace/bun"
)

const (
	telegramTextLimit       = 4096
	telegramCaptionLimit    = 1024
	telegramMediaGroupLimit = 10
	telegramPhotoSizeLimit  = 10 * 1024 * 1024
	telegramFileSizeLimit   = 50 * 1024 * 1024

	telegramReceiptPrepared = "prepared"
	telegramReceiptSending  = "sending"
	telegramReceiptAccepted = "accepted"
	telegramReceiptFailed   = "failed"
)

type telegramPublishStep struct {
	request      OutboundRequest
	messageCount int
}

func (*Service) UsesInstanceCredential() bool { return true }

func (service *Service) Publish(ctx context.Context, _ string, accountID string, req *platform.PublishRequest) (platform.PublishResult, error) {
	return service.publish(ctx, accountID, req, nil)
}

func (service *Service) PublishWithMedia(ctx context.Context, _ string, accountID string, req *platform.PublishRequest, media []platform.UploadMediaRequest) (platform.PublishResult, error) {
	return service.publish(ctx, accountID, req, media)
}

// UploadMedia is intentionally unsupported: Telegram receives media in the
// same fenced Bot API request that creates the visible message.
func (*Service) UploadMedia(context.Context, string, string, string, io.Reader) (string, error) {
	return "", ErrInvalidPublish
}

//nolint:gocyclo // Connection identity, live membership, and permission checks form one fail-closed boundary.
func (service *Service) ValidatePublishingTarget(ctx context.Context, _ string, accountID string, settings map[string]interface{}) error {
	if service == nil || service.db == nil || service.api == nil {
		return ErrProviderUnavailable
	}
	chatID := strings.TrimSpace(stringValue(settings, "chat_id"))
	accountID = strings.TrimSpace(accountID)
	if chatID == "" || accountID == "" || chatID != accountID {
		return ErrChatIdentityMismatch
	}
	var connection models.TelegramConnection
	if err := service.db.NewSelect().Model(&connection).Where("chat_id = ?", accountID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrChatIdentityMismatch
		}
		return ErrPersistenceFailed
	}
	bot, err := service.api.GetMe(ctx)
	if err != nil || bot.ID == 0 {
		return ErrProviderUnavailable
	}
	chat, err := service.api.GetChat(ctx, accountID)
	if err != nil {
		return ErrProviderUnavailable
	}
	chat.Type = strings.ToLower(strings.TrimSpace(chat.Type))
	if strconv.FormatInt(chat.ID, 10) != accountID || chat.Type != connection.ChatType {
		return ErrChatIdentityMismatch
	}
	member, err := service.api.GetChatMember(ctx, accountID, bot.ID)
	if err != nil {
		return ErrProviderUnavailable
	}
	if err := verifyDestinationPermissions(chat, member); err != nil {
		return err
	}
	now := service.now().UTC()
	if _, err := service.db.NewUpdate().Model((*models.TelegramConnection)(nil)).
		Set("permissions_verified_at = ?", now).Where("social_account_id = ?", connection.SocialAccountID).Exec(ctx); err != nil {
		return ErrPersistenceFailed
	}
	return nil
}

//nolint:gocyclo // Ordered receipt recovery and each provider mutation must remain in one durable state machine.
func (service *Service) publish(ctx context.Context, accountID string, req *platform.PublishRequest, media []platform.UploadMediaRequest) (platform.PublishResult, error) {
	if req == nil || strings.TrimSpace(req.OperationID) == "" || strings.TrimSpace(req.RenditionID) == "" {
		return platform.PublishResult{}, ErrInvalidPublish
	}
	if err := service.ValidatePublishingTarget(ctx, "", accountID, req.Settings); err != nil {
		return platform.PublishResult{}, err
	}
	publishingAPI, ok := service.api.(PublishingBotAPI)
	if !ok {
		return platform.PublishResult{}, ErrProviderUnavailable
	}
	steps, err := telegramPublishPlan(accountID, req, media)
	if err != nil {
		return platform.PublishResult{}, err
	}
	if err := service.preparePublishReceipts(ctx, req.OperationID, req.RenditionID, steps); err != nil {
		return platform.PublishResult{}, err
	}
	prepared := platform.PublishResult{ProviderState: "telegram_messages", RetrySafety: platform.PublishRetryNever}
	if err := req.BeginWrite(prepared); err != nil {
		return platform.PublishResult{}, err
	}
	for requestIndex, step := range steps {
		rows, err := service.publishStepReceipts(ctx, req.OperationID, requestIndex)
		if err != nil {
			return platform.PublishResult{}, err
		}
		allAccepted := true
		for _, row := range rows {
			if row.Status == telegramReceiptSending {
				return platform.PublishResult{}, ErrPublishAmbiguous
			}
			if row.Status != telegramReceiptAccepted {
				allAccepted = false
			}
		}
		if allAccepted {
			continue
		}
		for _, row := range rows {
			if row.Status == telegramReceiptAccepted {
				return platform.PublishResult{}, ErrPublishAmbiguous
			}
		}
		if err := service.markPublishStepSending(ctx, req.OperationID, requestIndex); err != nil {
			return platform.PublishResult{}, err
		}
		messages, sendErr := publishingAPI.Send(ctx, step.request)
		if sendErr != nil {
			failureResult := platform.PublishResult{
				SubmissionState: platform.PublishSubmissionUnknown,
				ProviderState:   "telegram_messages",
				RetrySafety:     platform.PublishRetryNever,
			}
			if definitelyNotAccepted(sendErr) {
				_ = service.markPublishStepFailed(context.WithoutCancel(ctx), req.OperationID, requestIndex, safeTelegramErrorCode(sendErr))
				failureResult.SubmissionState = platform.PublishSubmissionRejected
				failureResult.RetrySafety = platform.PublishRetrySafe
			}
			return failureResult, sendErr
		}
		if len(messages) != step.messageCount {
			return platform.PublishResult{}, ErrPublishAmbiguous
		}
		messageIDs := make([]string, len(messages))
		for index, message := range messages {
			if message.MessageID == 0 {
				return platform.PublishResult{}, ErrPublishAmbiguous
			}
			messageIDs[index] = strconv.FormatInt(message.MessageID, 10)
		}
		if err := service.acceptPublishStep(context.WithoutCancel(ctx), req.OperationID, requestIndex, messageIDs); err != nil {
			return platform.PublishResult{}, ErrPublishAmbiguous
		}
		if requestIndex < len(steps)-1 {
			accepted, err := service.acceptedPublishReceipts(context.WithoutCancel(ctx), req.OperationID)
			if err != nil || len(accepted) == 0 {
				return platform.PublishResult{}, ErrPersistenceFailed
			}
			partial := platform.PublishResult{
				ExternalID: accepted[0].MessageID, SubmissionState: platform.PublishSubmissionPending,
				ProviderState: "telegram_messages_partial", RetrySafety: platform.PublishRetrySafe,
			}
			if err := req.Checkpoint(partial); err != nil {
				return partial, err
			}
		}
	}

	accepted, err := service.acceptedPublishReceipts(ctx, req.OperationID)
	if err != nil || len(accepted) == 0 {
		return platform.PublishResult{}, ErrPersistenceFailed
	}
	result := platform.AcceptedPublishResult(accepted[0].MessageID)
	result.ProviderState = "telegram_messages"
	if err := req.Checkpoint(result); err != nil {
		return result, err
	}
	return result, nil
}

//nolint:gocyclo // Telegram media compatibility, size limits, and caption splitting are validated together.
func telegramPublishPlan(accountID string, req *platform.PublishRequest, media []platform.UploadMediaRequest) ([]telegramPublishStep, error) {
	disableNotification := boolValue(req.Settings, "disable_notification")
	protectContent := boolValue(req.Settings, "protect_content")
	if len(media) == 0 {
		if utf8.RuneCountInString(req.Content) == 0 || utf8.RuneCountInString(req.Content) > telegramTextLimit {
			return nil, ErrInvalidPublish
		}
		return []telegramPublishStep{{request: OutboundRequest{
			Kind: "message", ChatID: accountID, Text: req.Content,
			DisableNotification: disableNotification, ProtectContent: protectContent,
		}, messageCount: 1}}, nil
	}
	if len(media) > telegramMediaGroupLimit {
		return nil, ErrInvalidPublish
	}

	outbound := make([]OutboundMedia, 0, len(media))
	documentCount := 0
	for _, item := range media {
		kind, limit := telegramMediaKind(item.MimeType)
		if kind == "" || item.Size <= 0 || item.Size > limit || item.Reader == nil {
			return nil, ErrInvalidPublish
		}
		if kind == "document" {
			documentCount++
		}
		outbound = append(outbound, OutboundMedia{Type: kind, MimeType: item.MimeType, Filename: item.Filename, Reader: item.Reader})
	}
	if len(outbound) > 1 && documentCount != 0 && documentCount != len(outbound) {
		return nil, ErrInvalidPublish
	}

	caption, followups := splitTelegramCaption(req.Content)
	kind := outbound[0].Type
	if len(outbound) > 1 {
		kind = "media_group"
	}
	steps := []telegramPublishStep{{request: OutboundRequest{
		Kind: kind, ChatID: accountID, Caption: caption, Media: outbound,
		DisableNotification: disableNotification, ProtectContent: protectContent,
	}, messageCount: len(outbound)}}
	if len(outbound) == 1 {
		steps[0].messageCount = 1
	}
	for _, text := range followups {
		steps = append(steps, telegramPublishStep{request: OutboundRequest{
			Kind: "message", ChatID: accountID, Text: text,
			DisableNotification: disableNotification, ProtectContent: protectContent,
		}, messageCount: 1})
	}
	return steps, nil
}

func telegramMediaKind(mimeType string) (string, int64) {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/jpeg", "image/png", "image/webp":
		return "photo", telegramPhotoSizeLimit
	case "video/mp4", "video/quicktime":
		return "video", telegramFileSizeLimit
	case "application/pdf", "image/gif":
		return "document", telegramFileSizeLimit
	default:
		return "", 0
	}
}

func splitTelegramCaption(text string) (string, []string) {
	runes := []rune(text)
	if len(runes) <= telegramCaptionLimit {
		return text, nil
	}
	caption := string(runes[:telegramCaptionLimit])
	runes = runes[telegramCaptionLimit:]
	followups := make([]string, 0, (len(runes)+telegramTextLimit-1)/telegramTextLimit)
	for len(runes) > 0 {
		end := min(len(runes), telegramTextLimit)
		followups = append(followups, string(runes[:end]))
		runes = runes[end:]
	}
	return caption, followups
}

func (service *Service) preparePublishReceipts(ctx context.Context, operationID, renditionID string, steps []telegramPublishStep) error {
	var existing []models.TelegramPublishReceipt
	if err := service.db.NewSelect().Model(&existing).Where("operation_id = ?", operationID).Order("message_index ASC").Scan(ctx); err != nil {
		return ErrPersistenceFailed
	}
	expected := 0
	for _, step := range steps {
		expected += step.messageCount
	}
	if len(existing) > 0 {
		if len(existing) != expected {
			return ErrPublishAmbiguous
		}
		position := 0
		for requestIndex, step := range steps {
			for range step.messageCount {
				row := existing[position]
				if row.RenditionID != renditionID || row.RequestIndex != requestIndex || row.MessageIndex != position || row.RequestKind != step.request.Kind {
					return ErrPublishAmbiguous
				}
				position++
			}
		}
		return nil
	}
	now := service.now().UTC()
	rows := make([]models.TelegramPublishReceipt, 0, expected)
	position := 0
	for requestIndex, step := range steps {
		for range step.messageCount {
			rows = append(rows, models.TelegramPublishReceipt{
				ID: uuid.NewString(), OperationID: operationID, RenditionID: renditionID,
				RequestIndex: requestIndex, MessageIndex: position, RequestKind: step.request.Kind,
				Status: telegramReceiptPrepared, CreatedAt: now, UpdatedAt: now,
			})
			position++
		}
	}
	if _, err := service.db.NewInsert().Model(&rows).Exec(ctx); err != nil {
		return ErrPersistenceFailed
	}
	return nil
}

func (service *Service) publishStepReceipts(ctx context.Context, operationID string, requestIndex int) ([]models.TelegramPublishReceipt, error) {
	var rows []models.TelegramPublishReceipt
	if err := service.db.NewSelect().Model(&rows).
		Where("operation_id = ? AND request_index = ?", operationID, requestIndex).
		Order("message_index ASC").Scan(ctx); err != nil || len(rows) == 0 {
		return nil, ErrPersistenceFailed
	}
	return rows, nil
}

func (service *Service) markPublishStepSending(ctx context.Context, operationID string, requestIndex int) error {
	now := service.now().UTC()
	result, err := service.db.NewUpdate().Model((*models.TelegramPublishReceipt)(nil)).
		Set("status = ?", telegramReceiptSending).Set("safe_error_code = ''").
		Set("sending_started_at = ?", now).Set("updated_at = ?", now).
		Where("operation_id = ? AND request_index = ?", operationID, requestIndex).
		Where("status IN (?, ?)", telegramReceiptPrepared, telegramReceiptFailed).Exec(ctx)
	if err != nil {
		return ErrPersistenceFailed
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return ErrPublishAmbiguous
	}
	return nil
}

func (service *Service) markPublishStepFailed(ctx context.Context, operationID string, requestIndex int, code string) error {
	now := service.now().UTC()
	_, err := service.db.NewUpdate().Model((*models.TelegramPublishReceipt)(nil)).
		Set("status = ?", telegramReceiptFailed).Set("safe_error_code = ?", code).
		Set("updated_at = ?", now).Where("operation_id = ? AND request_index = ? AND status = ?", operationID, requestIndex, telegramReceiptSending).Exec(ctx)
	return err
}

func (service *Service) acceptPublishStep(ctx context.Context, operationID string, requestIndex int, messageIDs []string) error {
	now := service.now().UTC()
	return service.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var rows []models.TelegramPublishReceipt
		if err := tx.NewSelect().Model(&rows).Where("operation_id = ? AND request_index = ?", operationID, requestIndex).
			Order("message_index ASC").Scan(txCtx); err != nil || len(rows) != len(messageIDs) {
			return ErrPersistenceFailed
		}
		for index, row := range rows {
			result, err := tx.NewUpdate().Model((*models.TelegramPublishReceipt)(nil)).
				Set("status = ?", telegramReceiptAccepted).Set("message_id = ?", messageIDs[index]).
				Set("accepted_at = ?", now).Set("updated_at = ?", now).
				Where("id = ? AND status = ?", row.ID, telegramReceiptSending).Exec(txCtx)
			if err != nil {
				return err
			}
			updated, _ := result.RowsAffected()
			if updated != 1 {
				return ErrPublishAmbiguous
			}
		}
		return nil
	})
}

func (service *Service) acceptedPublishReceipts(ctx context.Context, operationID string) ([]models.TelegramPublishReceipt, error) {
	var rows []models.TelegramPublishReceipt
	err := service.db.NewSelect().Model(&rows).Where("operation_id = ? AND status = ?", operationID, telegramReceiptAccepted).
		Order("message_index ASC").Scan(ctx)
	return rows, err
}

func definitelyNotAccepted(err error) bool {
	var providerErr *platform.HTTPError
	return errors.As(err, &providerErr) && providerErr.StatusCode >= http.StatusBadRequest && providerErr.StatusCode < http.StatusInternalServerError
}

func safeTelegramErrorCode(err error) string {
	var safe interface{ SafeCode() string }
	if errors.As(err, &safe) {
		return safe.SafeCode()
	}
	var providerErr *platform.HTTPError
	if errors.As(err, &providerErr) && providerErr.Code != "" {
		return providerErr.Code
	}
	return string(CodeProviderUnavailable)
}

func stringValue(settings map[string]interface{}, key string) string {
	value, _ := settings[key].(string)
	return value
}

func boolValue(settings map[string]interface{}, key string) bool {
	value, _ := settings[key].(bool)
	return value
}
