package telegram

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
)

// ConnectedChatOption returns only the chat verified for this SocialAccount.
// Telegram's bot credential belongs to the instance, not to the account.
func (service *Service) ConnectedChatOption(ctx context.Context, account models.SocialAccount) (*platform.DestinationOption, error) {
	if service == nil || service.db == nil {
		return nil, ErrProviderUnavailable
	}
	if account.Platform != capabilities.ProviderTelegram || !account.IsActive ||
		account.ID == "" || account.WorkspaceID == "" || account.AccountID == "" {
		return nil, nil
	}
	var connection models.TelegramConnection
	err := service.db.NewSelect().Model(&connection).
		Where("social_account_id = ? AND workspace_id = ? AND chat_id = ?",
			account.ID, account.WorkspaceID, account.AccountID).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load Telegram installation options: %w", err)
	}
	if connection.InstalledAt.IsZero() || connection.PermissionsVerifiedAt.IsZero() {
		return nil, nil
	}
	label := strings.TrimSpace(account.AccountUsername)
	if label == "" {
		label = connection.ChatID
	}
	return &platform.DestinationOption{Value: connection.ChatID, Label: label}, nil
}
