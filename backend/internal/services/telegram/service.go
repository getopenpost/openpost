package telegram

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/botingress"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/uptrace/bun"
)

const (
	WebhookPath               = "/api/v1/webhooks/telegram"
	WebhookSecretHeader       = "X-Telegram-Bot-Api-Secret-Token"
	CoverageSinceInstallation = "since_installation"
	CoverageDescription       = "Channel posts are observed since bot installation; Telegram does not provide history backfill."
)

var slugUnsafe = regexp.MustCompile(`[^a-z0-9]+`)

type ReadinessGate interface {
	DecideConnection(context.Context, string, string, providerreadiness.ExecutionIntent) providerreadiness.Decision
	DecideAccountOperation(context.Context, models.SocialAccount, providerreadiness.Operation, providerreadiness.ExecutionIntent) providerreadiness.Decision
}

type AccountContentStore interface {
	UpsertAccountContent(context.Context, string, platform.AccountContentItem) (*models.AccountContent, error)
	RecordAccountContentObservation(context.Context, string, string, string, string, platform.AnalyticsMeasurements, time.Time) error
}

type Service struct {
	db                  *bun.DB
	api                 BotAPI
	botUsername         string
	webhookSecret       string
	accountContentStore AccountContentStore
	readiness           ReadinessGate
	now                 func() time.Time
}

func NewService(db *bun.DB, api BotAPI, botUsername, webhookSecret string) *Service {
	return &Service{
		db: db, api: api,
		botUsername:   strings.TrimPrefix(strings.TrimSpace(botUsername), "@"),
		webhookSecret: strings.TrimSpace(webhookSecret),
		now:           func() time.Time { return time.Now().UTC() },
	}
}

func (service *Service) SetAccountContentStore(store AccountContentStore) {
	service.accountContentStore = store
}

func (service *Service) SetProviderReadiness(readiness ReadinessGate) {
	service.readiness = readiness
}

func (service *Service) SetNowForTest(now func() time.Time) {
	if now != nil {
		service.now = now
	}
}

func (service *Service) BotUsername() string {
	if service == nil {
		return ""
	}
	return service.botUsername
}

func (service *Service) OperationReady(ctx context.Context, operation providerreadiness.Operation) bool {
	if service == nil || service.readiness == nil {
		return false
	}
	if operation == providerreadiness.OperationConnect {
		return service.readiness.DecideConnection(ctx, capabilities.ProviderTelegram, "", providerreadiness.ExecutionIntentProduction).Connectable
	}
	return false
}

func (service *Service) Available() bool {
	return service != nil && service.db != nil && service.api != nil && service.botUsername != "" && service.webhookSecret != ""
}

func (service *Service) ConfigureWebhook(ctx context.Context, publicURL string) error {
	if !service.Available() || !service.OperationReady(ctx, providerreadiness.OperationConnect) {
		return ErrProviderUnavailable
	}
	base, err := url.Parse(strings.TrimSpace(publicURL))
	if err != nil || base.Scheme != "https" || base.Host == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		return ErrProviderUnavailable
	}
	base.Path = strings.TrimRight(base.Path, "/") + WebhookPath
	return service.api.SetWebhook(ctx, SetWebhookRequest{
		URL: base.String(), SecretToken: service.webhookSecret,
		AllowedUpdates: append([]string(nil), RequiredUpdateTypes...),
	})
}

func (service *Service) RegisterWebhook(e *echo.Echo, ingress *botingress.Service) {
	if service == nil || e == nil || ingress == nil {
		return
	}
	normalizer := NewUpdateNormalizer(service.botUsername)
	e.POST(WebhookPath, func(c echo.Context) error {
		request := c.Request()
		request.Body = http.MaxBytesReader(c.Response(), request.Body, botingress.MaxEventBodyBytes)
		body, err := io.ReadAll(request.Body)
		if err != nil || len(body) > botingress.MaxEventBodyBytes {
			return c.JSON(http.StatusRequestEntityTooLarge, map[string]bool{"ok": false})
		}
		verifier := botingress.SecretHeaderVerifier{HeaderName: WebhookSecretHeader, Secret: service.webhookSecret}
		if err := verifier.Verify(request.Header, body); err != nil {
			return c.JSON(http.StatusUnauthorized, map[string]bool{"ok": false})
		}
		normalized, err := normalizer.Normalize(body)
		if err != nil {
			return c.JSON(http.StatusOK, map[string]bool{"ok": true})
		}
		if !service.ingressEventReady(request.Context(), normalized) {
			return c.JSON(http.StatusServiceUnavailable, map[string]bool{"ok": false})
		}
		_, acceptErr := ingress.Accept(request.Context(), botingress.AcceptRequest{
			Provider: "telegram", Headers: request.Header, Body: body,
			Verifier:   verifier,
			Normalizer: normalizer,
		})
		if errors.Is(acceptErr, botingress.ErrInvalidSignature) {
			return c.JSON(http.StatusUnauthorized, map[string]bool{"ok": false})
		}
		if errors.Is(acceptErr, botingress.ErrIngressUnavailable) {
			return c.JSON(http.StatusServiceUnavailable, map[string]bool{"ok": false})
		}
		// Telegram receives one fixed acknowledgement. Connection credentials and
		// rejection details are never reflected into provider responses.
		return c.JSON(http.StatusOK, map[string]bool{"ok": true})
	})
}

func (service *Service) ingressEventReady(ctx context.Context, event botingress.NormalizedEvent) bool {
	switch event.Kind {
	case "telegram.connection_requested", "telegram.membership_changed":
		return service.OperationReady(ctx, providerreadiness.OperationConnect)
	case "telegram.channel_post", "telegram.reaction_count":
		var connection models.TelegramConnection
		if err := service.db.NewSelect().Model(&connection).
			Where("chat_id = ? AND chat_type = ?", strings.TrimSpace(event.SubjectReference), "channel").Scan(ctx); err != nil {
			return false
		}
		var account models.SocialAccount
		if err := service.db.NewSelect().Model(&account).
			Where("id = ? AND is_active = ?", connection.SocialAccountID, true).Scan(ctx); err != nil || service.readiness == nil {
			return false
		}
		return service.readiness.DecideAccountOperation(ctx, account, providerreadiness.OperationObservation, providerreadiness.ExecutionIntentProduction).Observable
	default:
		return false
	}
}

//nolint:gocyclo // Identity, membership, and destination permission checks remain one pre-persistence boundary.
func (service *Service) Process(ctx context.Context, event models.BotIngressEvent) error {
	if !service.Available() || event.Provider != "telegram" {
		return ErrInvalidUpdate
	}
	switch event.Kind {
	case "telegram.membership_changed":
		if !service.OperationReady(ctx, providerreadiness.OperationConnect) {
			return ErrProviderUnavailable
		}
		return service.recordMembership(ctx, event)
	case "telegram.channel_post", "telegram.reaction_count":
		return service.processObservation(ctx, event)
	case "telegram.connection_requested":
		if event.WorkspaceID == "" || !service.OperationReady(ctx, providerreadiness.OperationConnect) {
			return ErrProviderUnavailable
		}
	default:
		return ErrInvalidUpdate
	}
	chatID := strings.TrimSpace(event.SubjectReference)
	parsedChatID, err := strconv.ParseInt(chatID, 10, 64)
	if err != nil || parsedChatID == 0 {
		return ErrInvalidUpdate
	}
	bot, err := service.api.GetMe(ctx)
	if err != nil || bot.ID == 0 {
		return ErrProviderUnavailable
	}
	chat, err := service.api.GetChat(ctx, chatID)
	if err != nil {
		return ErrProviderUnavailable
	}
	chat.Type = strings.ToLower(strings.TrimSpace(chat.Type))
	if chat.ID != parsedChatID || chat.Type != event.ParentReference {
		return ErrChatIdentityMismatch
	}
	if chat.Type != "channel" && chat.Type != "group" && chat.Type != "supergroup" {
		return ErrUnsupportedChat
	}
	member, err := service.api.GetChatMember(ctx, chatID, bot.ID)
	if err != nil {
		return ErrProviderUnavailable
	}
	if err := verifyDestinationPermissions(chat, member); err != nil {
		return err
	}

	installedAt := event.OccurredAt.UTC()
	now := service.now().UTC()
	if installedAt.IsZero() || installedAt.After(now) {
		installedAt = now
	}
	installedAt = service.coverageStart(ctx, chatID, chat.Type, installedAt)
	return service.saveConnection(ctx, event.WorkspaceID, chat, installedAt, now)
}

func (service *Service) processObservation(ctx context.Context, event models.BotIngressEvent) error {
	var connection models.TelegramConnection
	if err := service.db.NewSelect().Model(&connection).
		Where("chat_id = ? AND chat_type = ?", strings.TrimSpace(event.SubjectReference), "channel").Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return ErrPersistenceFailed
	}
	var account models.SocialAccount
	if err := service.db.NewSelect().Model(&account).
		Where("id = ? AND is_active = ?", connection.SocialAccountID, true).Scan(ctx); err != nil {
		return ErrPersistenceFailed
	}
	if strings.TrimSpace(event.ID) != "" {
		if _, err := service.db.NewUpdate().Model((*models.BotIngressEvent)(nil)).
			Set("workspace_id = ?", account.WorkspaceID).Set("social_account_id = ?", account.ID).
			Where("id = ?", event.ID).Exec(ctx); err != nil {
			return ErrPersistenceFailed
		}
	}
	if service.readiness == nil || !service.readiness.DecideAccountOperation(
		ctx, account, providerreadiness.OperationObservation, providerreadiness.ExecutionIntentProduction,
	).Observable {
		return ErrProviderUnavailable
	}
	if event.OccurredAt.Before(connection.CoverageStartedAt) {
		return nil
	}
	if service.accountContentStore == nil {
		return ErrProviderUnavailable
	}
	switch event.Kind {
	case "telegram.channel_post":
		return service.importChannelPost(ctx, account, event)
	case "telegram.reaction_count":
		return service.recordReactionCount(ctx, account, event)
	default:
		return ErrInvalidUpdate
	}
}

func (service *Service) importChannelPost(ctx context.Context, account models.SocialAccount, event models.BotIngressEvent) error {
	messageID := strings.TrimSpace(event.ParentReference)
	if _, err := strconv.ParseInt(messageID, 10, 64); err != nil {
		return ErrInvalidUpdate
	}
	item := platform.AccountContentItem{
		ProviderContentID: messageID, ContentProfile: event.ContentProfile, Text: event.ContentText,
		PublishedAt: event.OccurredAt.UTC(), Origin: platform.AccountContentOriginExternal,
		OriginConfidence: platform.AccountContentOriginConfidenceExact,
	}
	var rendition models.Rendition
	if err := service.db.NewSelect().Model(&rendition).
		Where("social_account_id = ? AND platform = ? AND external_id = ?", account.ID, capabilities.ProviderTelegram, messageID).
		Scan(ctx); err == nil {
		item.RenditionID = rendition.ID
	} else if !errors.Is(err, sql.ErrNoRows) {
		return ErrPersistenceFailed
	}
	content, err := service.accountContentStore.UpsertAccountContent(ctx, account.ID, item)
	if err != nil {
		return ErrPersistenceFailed
	}
	if content != nil {
		if _, err := service.db.NewUpdate().Model((*models.AccountContentObservation)(nil)).
			Set("account_content_id = ?", content.ID).
			Where("social_account_id = ? AND provider_content_id = ? AND account_content_id IS NULL", account.ID, messageID).Exec(ctx); err != nil {
			return ErrPersistenceFailed
		}
	}
	return nil
}

func (service *Service) recordReactionCount(ctx context.Context, account models.SocialAccount, event models.BotIngressEvent) error {
	var values platform.AnalyticsValues
	if err := json.Unmarshal([]byte(event.MetricsJSON), &values); err != nil {
		return ErrInvalidUpdate
	}
	reactionCount, measured := values[platform.MetricReactions]
	if len(values) != 1 || !measured || reactionCount < 0 {
		return ErrInvalidUpdate
	}
	measurement := platform.AnalyticsMeasurements{
		platform.MetricReactions: {
			Value: reactionCount,
			AnalyticsMetricMetadata: platform.AnalyticsMetricMetadata{
				Unit: platform.AnalyticsMetricUnitCount, Aggregation: platform.AnalyticsMetricAggregationLifetimeTotal,
				Source: capabilities.ProviderTelegram,
			},
		},
	}
	// Telegram may redeliver semantically identical counts under a new update
	// ID. The provider observation identity coalesces the message/time pair.
	observationID := "reaction_count:" + event.SubjectReference + ":" + event.ParentReference + ":" +
		event.OccurredAt.UTC().Format(time.RFC3339) + ":" + strconv.FormatInt(reactionCount, 10)
	if err := service.accountContentStore.RecordAccountContentObservation(
		ctx, account.ID, observationID, event.ParentReference, "reaction_count", measurement, event.OccurredAt,
	); err != nil {
		return ErrPersistenceFailed
	}
	return nil
}

//nolint:gocyclo // Membership transition validation and bounded persistence stay at one provider boundary.
func (service *Service) recordMembership(ctx context.Context, event models.BotIngressEvent) error {
	chatID := strings.TrimSpace(event.SubjectReference)
	parsedChatID, err := strconv.ParseInt(chatID, 10, 64)
	parts := strings.Split(event.ParentReference, ":")
	if err != nil || parsedChatID == 0 || len(parts) != 2 || !validMembershipStatus(parts[1]) {
		return ErrInvalidUpdate
	}
	chat, err := service.api.GetChat(ctx, chatID)
	if err != nil {
		return ErrProviderUnavailable
	}
	chat.Type = strings.ToLower(strings.TrimSpace(chat.Type))
	if chat.ID != parsedChatID || chat.Type != parts[0] {
		return ErrChatIdentityMismatch
	}
	now := service.now().UTC()
	occurredAt := event.OccurredAt.UTC()
	if occurredAt.IsZero() || occurredAt.After(now) {
		occurredAt = now
	}
	var existing models.TelegramChatInstallation
	loadErr := service.db.NewSelect().Model(&existing).Where("chat_id = ?", chatID).Scan(ctx)
	if loadErr != nil && !errors.Is(loadErr, sql.ErrNoRows) {
		return ErrPersistenceFailed
	}
	installedAt := existing.InstalledAt
	if membershipInstalled(parts[1]) && (errors.Is(loadErr, sql.ErrNoRows) || !membershipInstalled(existing.MembershipStatus)) {
		installedAt = occurredAt
	}
	row := &models.TelegramChatInstallation{
		ChatID: chatID, ChatType: chat.Type, MembershipStatus: parts[1],
		InstalledAt: installedAt, UpdatedAt: now,
	}
	if _, err := service.db.NewInsert().Model(row).
		On("CONFLICT (chat_id) DO UPDATE").
		Set("chat_type = EXCLUDED.chat_type").
		Set("membership_status = EXCLUDED.membership_status").
		Set("installed_at = EXCLUDED.installed_at").
		Set("updated_at = EXCLUDED.updated_at").Exec(ctx); err != nil {
		return ErrPersistenceFailed
	}
	if membershipInstalled(parts[1]) && !installedAt.IsZero() {
		if _, err := service.db.NewUpdate().Model((*models.TelegramConnection)(nil)).
			Set("installed_at = ?", installedAt).
			Set("coverage_started_at = ?", installedAt).
			Where("chat_id = ? AND coverage_started_at > ?", chatID, installedAt).Exec(ctx); err != nil {
			return ErrPersistenceFailed
		}
	}
	return nil
}

func membershipInstalled(status string) bool {
	return status != "" && status != "left" && status != "kicked"
}

func (service *Service) coverageStart(ctx context.Context, chatID, chatType string, fallback time.Time) time.Time {
	var installation models.TelegramChatInstallation
	if err := service.db.NewSelect().Model(&installation).
		Where("chat_id = ? AND chat_type = ?", chatID, chatType).Scan(ctx); err != nil {
		return fallback
	}
	if !membershipInstalled(installation.MembershipStatus) || installation.InstalledAt.IsZero() || installation.InstalledAt.After(fallback) {
		return fallback
	}
	return installation.InstalledAt.UTC()
}

func verifyDestinationPermissions(chat Chat, member ChatMember) error {
	status := strings.ToLower(strings.TrimSpace(member.Status))
	switch chat.Type {
	case "channel":
		if status != "administrator" && status != "creator" {
			return ErrBotNotMember
		}
		if status != "creator" && !member.CanPostMessages {
			return ErrInsufficientPermissions
		}
	case "group", "supergroup":
		switch status {
		case "creator", "administrator":
			return nil
		case "member":
			if chat.Permissions.CanSendMessages {
				return nil
			}
			return ErrInsufficientPermissions
		case "restricted":
			if member.IsMember && member.CanSendMessages {
				return nil
			}
			return ErrInsufficientPermissions
		default:
			return ErrBotNotMember
		}
	default:
		return ErrUnsupportedChat
	}
	return nil
}

func (service *Service) saveConnection(ctx context.Context, workspaceID string, chat Chat, installedAt, now time.Time) error {
	chatID := strconv.FormatInt(chat.ID, 10)
	return service.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var owner models.TelegramConnection
		err := tx.NewSelect().Model(&owner).Where("chat_id = ?", chatID).Scan(txCtx)
		if err == nil && owner.WorkspaceID != workspaceID {
			return ErrChatAlreadyConnected
		}
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return ErrPersistenceFailed
		}

		account, exists, err := service.telegramAccount(txCtx, tx, workspaceID, chatID)
		if err != nil {
			return ErrPersistenceFailed
		}
		capability, err := json.Marshal(map[string]string{
			"connection_mode":              "bot",
			"chat_type":                    chat.Type,
			"content_coverage":             CoverageSinceInstallation,
			"content_coverage_started_at":  installedAt.Format(time.RFC3339),
			"group_conversation_analytics": "disabled",
			"permissions_verified_at":      now.Format(time.RFC3339),
		})
		if err != nil {
			return ErrPersistenceFailed
		}
		name := strings.TrimSpace(chat.Title)
		if name == "" {
			name = strings.TrimPrefix(strings.TrimSpace(chat.Username), "@")
		}
		if !exists {
			slug, err := service.availableSlug(txCtx, tx, workspaceID, name, chatID)
			if err != nil {
				return ErrPersistenceFailed
			}
			account = models.SocialAccount{
				ID: uuid.NewString(), WorkspaceID: workspaceID,
				Slug:     slug,
				Platform: "telegram", AccountID: chatID, AccountUsername: name,
				AccessTokenEnc: []byte{}, CapabilityState: string(capability),
				CapabilityCheckedAt: now, IsActive: true, CreatedAt: now,
			}
			if _, err := tx.NewInsert().Model(&account).Exec(txCtx); err != nil {
				return ErrPersistenceFailed
			}
		} else {
			account.AccountUsername = name
			account.CapabilityState = string(capability)
			account.CapabilityCheckedAt = now
			account.IsActive = true
			account.ErrorMessage = ""
			if _, err := tx.NewUpdate().Model(&account).
				Column("account_username", "capability_state_json", "capability_checked_at", "is_active", "error_message").
				WherePK().Exec(txCtx); err != nil {
				return ErrPersistenceFailed
			}
		}

		connection := &models.TelegramConnection{
			SocialAccountID: account.ID, WorkspaceID: workspaceID, ChatID: chatID, ChatType: chat.Type,
			InstalledAt: installedAt, CoverageStartedAt: installedAt,
			CoverageKind: CoverageSinceInstallation, PermissionsVerifiedAt: now, CreatedAt: now,
		}
		if _, err := tx.NewInsert().Model(connection).
			On("CONFLICT (social_account_id) DO UPDATE").
			Set("workspace_id = EXCLUDED.workspace_id").Set("chat_id = EXCLUDED.chat_id").
			Set("chat_type = EXCLUDED.chat_type").Set("installed_at = EXCLUDED.installed_at").
			Set("coverage_started_at = EXCLUDED.coverage_started_at").
			Set("coverage_kind = EXCLUDED.coverage_kind").
			Set("permissions_verified_at = EXCLUDED.permissions_verified_at").Exec(txCtx); err != nil {
			return ErrPersistenceFailed
		}
		coverage := &models.AccountContentDiscoveryState{
			ID: uuid.NewString(), WorkspaceID: workspaceID, SocialAccountID: account.ID,
			Platform: capabilities.ProviderTelegram, Status: string(platform.AccountContentDiscoveryPartial),
			CoverageStatus: string(platform.AccountContentDiscoveryPartial), CoverageDescription: CoverageDescription,
			BackfillWatermark: installedAt, LastSuccessAt: now, NextEligibleAt: time.Time{}, CreatedAt: now, UpdatedAt: now,
		}
		if _, err := tx.NewInsert().Model(coverage).
			On("CONFLICT (social_account_id) DO UPDATE").
			Set("status = EXCLUDED.status").Set("coverage_status = EXCLUDED.coverage_status").
			Set("coverage_description = EXCLUDED.coverage_description").
			Set("backfill_watermark = EXCLUDED.backfill_watermark").
			Set("last_success_at = EXCLUDED.last_success_at").Set("updated_at = EXCLUDED.updated_at").Exec(txCtx); err != nil {
			return ErrPersistenceFailed
		}
		return nil
	})
}

func (service *Service) telegramAccount(ctx context.Context, db bun.IDB, workspaceID, chatID string) (models.SocialAccount, bool, error) {
	var account models.SocialAccount
	err := db.NewSelect().Model(&account).
		Where("workspace_id = ? AND platform = ? AND account_id = ?", workspaceID, "telegram", chatID).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return models.SocialAccount{}, false, nil
	}
	return account, err == nil, err
}

func (service *Service) availableSlug(ctx context.Context, db bun.IDB, workspaceID, name, chatID string) (string, error) {
	base := strings.Trim(slugUnsafe.ReplaceAllString(strings.ToLower("telegram-"+name), "-"), "-")
	if base == "telegram" || base == "" {
		base = "telegram-" + strings.TrimLeft(chatID, "-")
	}
	if len(base) > 55 {
		base = strings.Trim(base[:55], "-")
	}
	for suffix := 1; ; suffix++ {
		candidate := base
		if suffix > 1 {
			candidate = fmt.Sprintf("%s-%d", base, suffix)
		}
		count, err := db.NewSelect().Model((*models.SocialAccount)(nil)).
			Where("workspace_id = ? AND slug = ? AND is_active = ?", workspaceID, candidate, true).Count(ctx)
		if err != nil {
			return "", err
		}
		if count == 0 {
			return candidate, nil
		}
	}
}
