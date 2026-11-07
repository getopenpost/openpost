package oauth2messaging

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/uptrace/bun"
)

const XActivityProvider = "x_activity"
const InboundOperation = "dm_received"
const InboundCostMicrousd int64 = 10_000

// AddPricing adds the official XAA inbound price to the existing policy. The
// caller installs the result through usage.Service.SetProviderCostPolicy.
func AddPricing(policy usage.ProviderCostPolicy, monthlyBudgetMicrousd int64) usage.ProviderCostPolicy {
	providers := make(map[string]usage.ProviderCostPricing, len(policy.Providers)+1)
	for key, value := range policy.Providers {
		providers[key] = value
	}
	providers[XActivityProvider] = usage.ProviderCostPricing{Currency: "USD", MonthlyBudgetMicrousd: monthlyBudgetMicrousd, PricingSourceURL: "https://docs.x.com/x-api/activity/event-pricing", OperationCostMicrousd: map[string]int64{InboundOperation: InboundCostMicrousd}}
	return usage.ProviderCostPolicy{Providers: providers}
}

type SubscriptionResult struct {
	ID             string    `json:"id"`
	ExpiresAt      time.Time `json:"expires_at"`
	ReservedEvents int       `json:"reserved_events"`
}

// StartSubscription is explicit operator work, never a side effect of OAuth or
// viewing an inbox. Expiry limits time, not event count or provider billing.
func (s *Service) StartSubscription(ctx context.Context, workspaceID, accountID, eventType string, eventLimit int) (SubscriptionResult, error) {
	if !s.paidEnabled() {
		return SubscriptionResult{}, ErrBudget
	}
	if (eventType != "dm.received" && eventType != "dm.sent") || eventLimit < 1 || eventLimit > 100 {
		return SubscriptionResult{}, errors.New("x activity supports legacy dm.received/dm.sent with 1 to 100 reserved events")
	}
	account, err := s.account(ctx, workspaceID, accountID)
	if err != nil {
		return SubscriptionResult{}, err
	}
	tagged, err := s.AccessToken(ctx, workspaceID, accountID)
	if err != nil {
		return SubscriptionResult{}, err
	}
	now := s.now()
	sub := subscription{ID: uuid.NewString(), SocialAccountID: accountID, WorkspaceID: workspaceID, RemoteUserID: account.AccountID, EventType: eventType, EventLimit: eventLimit, State: "pending", ExpiresAt: now.Add(15 * time.Minute), CreatedAt: now}
	// The unique live-account/event index prevents concurrent duplicate activation.
	if _, err = s.db.NewInsert().Model(&sub).Exec(ctx); err != nil {
		return SubscriptionResult{}, err
	}
	if err = s.reserveAllowance(ctx, sub); err != nil {
		return SubscriptionResult{}, err
	}
	payload := map[string]any{"event_type": eventType, "filter": map[string]string{"user_id": account.AccountID}, "webhook_id": s.config.WebhookID, "tag": sub.ID, "expires_at": sub.ExpiresAt.Format(time.RFC3339)}
	raw, _ := json.Marshal(payload)
	body, err := s.request(ctx, http.MethodPost, s.apiBase+"/2/activity/subscriptions", strings.NewReader(string(raw)), map[string]string{"Authorization": "Bearer " + messagingBearer(tagged), "Content-Type": "application/json"})
	if err != nil {
		// Transport failures may have activated the subscription. Retain all
		// exposure and block recreation until operator reconciliation.
		s.activationFailure(ctx, sub, err)
		return SubscriptionResult{}, err
	}
	var response struct {
		Data struct {
			Subscription struct {
				ID string `json:"subscription_id"`
			} `json:"subscription"`
		} `json:"data"`
	}
	if json.Unmarshal(body, &response) != nil || response.Data.Subscription.ID == "" {
		_, _ = s.db.NewUpdate().Model(&sub).Set("state = ?", "unknown").WherePK().Exec(ctx)
		return SubscriptionResult{}, errors.New("x subscription response lacks subscription identity; reconcile before retrying")
	}
	_, err = s.db.NewUpdate().Model(&sub).Set("remote_subscription_id = ?", response.Data.Subscription.ID).Set("state = ?", "active").WherePK().Exec(ctx)
	return SubscriptionResult{ID: sub.ID, ExpiresAt: sub.ExpiresAt, ReservedEvents: eventLimit}, err
}
func (s *Service) reserveAllowance(ctx context.Context, sub subscription) error {
	if sub.EventType != "dm.received" {
		return nil
	}
	for slot := 1; slot <= sub.EventLimit; slot++ {
		reserved, err := s.costs.ReserveProviderCost(ctx, usage.ProviderCostEventInput{WorkspaceID: sub.WorkspaceID, Provider: XActivityProvider, Operation: InboundOperation, OperationKey: slotKey(sub.ID, slot), Units: 1, OccurredAt: sub.CreatedAt})
		if err == nil && reserved.Enabled && reserved.CostMicrousd == InboundCostMicrousd {
			continue
		}
		// No activation I/O occurred. Release only these unspent reservations.
		for previous := 1; previous <= slot; previous++ {
			_ = s.costs.ReleaseProviderCost(ctx, slotKey(sub.ID, previous))
		}
		_, _ = s.db.NewUpdate().Model(&sub).Set("state = ?", "stopped").WherePK().Exec(ctx)
		if err != nil {
			return err
		}
		return ErrBudget
	}
	return nil
}

func slotKey(subscriptionID string, slot int) string {
	return fmt.Sprintf("xaa:%s:%d", subscriptionID, slot)
}

func (s *Service) StopSubscription(ctx context.Context, workspaceID, id string) error {
	var sub subscription
	if err := s.db.NewSelect().Model(&sub).Where("id = ? AND workspace_id = ?", id, workspaceID).Scan(ctx); err != nil {
		return err
	}
	if sub.RemoteSubscriptionID == "" {
		return errors.New("x subscription identity is unknown; reconcile in the X console")
	}
	if _, err := s.db.NewUpdate().Model(&sub).Set("last_stop_attempt_at = ?", s.now()).WherePK().Exec(ctx); err != nil {
		return err
	}
	tagged, err := s.AccessToken(ctx, workspaceID, sub.SocialAccountID)
	if err != nil {
		return err
	}
	body, err := s.request(ctx, http.MethodDelete, s.apiBase+"/2/activity/subscriptions/"+url.PathEscape(sub.RemoteSubscriptionID), nil, map[string]string{"Authorization": "Bearer " + messagingBearer(tagged)})
	if err != nil {
		return err
	}
	var confirmation struct {
		Data struct {
			Deleted bool `json:"deleted"`
		} `json:"data"`
		Errors []json.RawMessage `json:"errors"`
	}
	if json.Unmarshal(body, &confirmation) != nil || !confirmation.Data.Deleted || len(confirmation.Errors) > 0 {
		return errors.New("x subscription deletion was not confirmed")
	}
	_, err = s.db.NewUpdate().Model(&sub).Set("state = ?", "stopped").WherePK().Exec(ctx)
	// Keep unused exposure reserved. Queued deliveries and provider invoices can
	// outlive deletion; only explicit reconciliation may release the balance.
	return err
}

func (s *Service) Challenge(token string) (string, error) {
	if s.config.ClientSecret == "" || token == "" || len(token) > 2048 {
		return "", ErrUnavailable
	}
	return sign(s.config.ClientSecret, []byte(token)), nil
}
func sign(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	return "sha256=" + base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

type activityData struct {
	EventUUID string `json:"event_uuid"`
	EventType string `json:"event_type"`
	Tag       string `json:"tag"`
	Filter    struct {
		UserID string `json:"user_id"`
	} `json:"filter"`
	Payload json.RawMessage `json:"payload"`
}
type activityEnvelope struct {
	Data activityData `json:"data"`
}

// Receive verifies raw bytes and commits an encrypted, idempotent receipt
// before acknowledgment. Provider I/O and content application happen in Drain.
func (s *Service) Receive(ctx context.Context, signature string, body []byte) error {
	if s.config.ClientSecret == "" || len(body) > 1<<20 || !hmac.Equal([]byte(signature), []byte(sign(s.config.ClientSecret, body))) {
		return ErrAccessDenied
	}
	var envelope activityEnvelope
	if json.Unmarshal(body, &envelope) != nil || envelope.Data.EventUUID == "" || len(envelope.Data.EventUUID) > 100 {
		return errors.New("invalid X activity envelope")
	}
	event := envelope.Data
	// Never import encrypted XChat as plaintext, even if a forged body contains
	// a field named text. Only subscriptions created by this owner are accepted.
	if event.EventType != "dm.received" && event.EventType != "dm.sent" {
		return nil
	}
	encrypted, err := s.encryptor.Encrypt(string(body))
	if err != nil {
		return err
	}
	if err = s.storeReceipt(ctx, event, encrypted); err != nil {
		return err
	}
	if s.receiptScheduler != nil {
		return s.receiptScheduler(ctx)
	}
	return nil
}

func (s *Service) storeReceipt(ctx context.Context, event activityData, encrypted []byte) error {
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		exists, err := tx.NewSelect().Model((*receipt)(nil)).Where("event_uuid = ?", event.EventUUID).Exists(ctx)
		if err != nil || exists {
			return err
		}
		var sub subscription
		if err = tx.NewSelect().Model(&sub).Where("id = ? AND remote_user_id = ? AND event_type = ?", event.Tag, event.Filter.UserID, event.EventType).Scan(ctx); err != nil {
			return err
		}
		// Validate identity and payload before consuming an allowance slot.
		if _, err = normalizeLegacyPayload(event, sub.RemoteUserID); err != nil {
			return err
		}
		var slot int
		err = tx.NewUpdate().Model((*subscription)(nil)).Set("received = received + 1").Where("id = ? AND received < event_limit", sub.ID).Returning("received").Scan(ctx, &slot)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrBudget
		}
		if err != nil {
			return err
		}
		key := ""
		if event.EventType == "dm.received" {
			key = slotKey(sub.ID, slot)
		}
		row := receipt{EventUUID: event.EventUUID, SubscriptionID: sub.ID, SocialAccountID: sub.SocialAccountID, PayloadEncrypted: encrypted, CostOperationKey: key, CreatedAt: s.now()}
		_, err = tx.NewInsert().Model(&row).Exec(ctx)
		return err
	})
}

// SetReceiptScheduler connects receipt commits to the owning durable queue.
// Configure it at startup, before serving webhook deliveries.
func (s *Service) SetReceiptScheduler(schedule func(context.Context) error) {
	s.receiptScheduler = schedule
}

type ApplyMessages func(context.Context, string, platform.FetchMessagesResult) error

// Drain is called from the durable inbox sweep/receipt job. Application is
// idempotent by remote message ID. A crash after apply safely replays a receipt.
func (s *Service) Drain(ctx context.Context, apply ApplyMessages, limit int) (int, error) {
	if apply == nil {
		return 0, errors.New("x messaging receipt consumer is unavailable")
	}
	if limit < 1 || limit > 100 {
		limit = 100
	}
	var receipts []receipt
	if err := s.db.NewSelect().Model(&receipts).Where("processed = ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?)", false, s.now()).Order("attempts ASC").OrderExpr("COALESCE(next_attempt_at, created_at) ASC").Order("event_uuid ASC").Limit(int64(limit)).Scan(ctx); err != nil {
		return 0, errors.Join(err, s.Maintain(ctx))
	}
	processed := 0
	var failures error
	for _, row := range receipts {
		if err := s.applyReceipt(ctx, apply, row); err != nil {
			failures = errors.Join(failures, err, s.deferReceipt(ctx, row))
			continue
		}
		processed++
	}
	return processed, errors.Join(failures, s.Maintain(ctx))
}

func (s *Service) applyReceipt(ctx context.Context, apply ApplyMessages, row receipt) error {
	var sub subscription
	if err := s.db.NewSelect().Model(&sub).Where("id = ?", row.SubscriptionID).Scan(ctx); err != nil {
		return err
	}
	body, err := s.encryptor.Decrypt(row.PayloadEncrypted)
	if err != nil {
		return err
	}
	batch, err := normalizeLegacyEvent([]byte(body), sub.RemoteUserID)
	if err != nil {
		return err
	}
	if row.CostOperationKey != "" {
		if s.costs == nil {
			return ErrBudget
		}
		if _, err = s.costs.ConfirmProviderCost(ctx, row.CostOperationKey); err != nil {
			return err
		}
	}
	if err = apply(ctx, row.SocialAccountID, batch); err != nil {
		return err
	}
	if _, err = s.db.NewUpdate().Model(&row).Set("processed = ?", true).WherePK().Exec(ctx); err != nil {
		return err
	}

	return nil
}

func normalizeLegacyEvent(body []byte, ourID string) (platform.FetchMessagesResult, error) {
	var envelope activityEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return platform.FetchMessagesResult{}, err
	}
	return normalizeLegacyPayload(envelope.Data, ourID)
}

func normalizeLegacyPayload(data activityData, ourID string) (platform.FetchMessagesResult, error) {
	var payload struct {
		Events []struct {
			Type      string `json:"type"`
			ID        string `json:"id"`
			Timestamp string `json:"created_timestamp"`
			Message   struct {
				Target struct {
					RecipientID string `json:"recipient_id"`
				} `json:"target"`
				SenderID string `json:"sender_id"`
				Data     struct {
					Text string `json:"text"`
				} `json:"message_data"`
			} `json:"message_create"`
		} `json:"direct_message_events"`
		Users map[string]struct {
			Data struct {
				ID       string `json:"id"`
				Name     string `json:"name"`
				Username string `json:"username"`
				Avatar   string `json:"profile_image_url"`
			} `json:"data"`
		} `json:"users"`
	}
	if err := json.Unmarshal(data.Payload, &payload); err != nil {
		return platform.FetchMessagesResult{}, err
	}
	if len(payload.Events) != 1 {
		return platform.FetchMessagesResult{}, errors.New("x legacy delivery must contain one message event")
	}
	result := platform.FetchMessagesResult{}
	event := payload.Events[0]

	sender, recipient := event.Message.SenderID, event.Message.Target.RecipientID
	if !validLegacyIdentity(event.Type, event.ID, sender, recipient, ourID) {
		return result, errors.New("x message identity does not match subscription")
	}
	inbound := data.EventType == "dm.received"
	if (inbound && recipient != ourID) || (!inbound && sender != ourID) {
		return result, errors.New("x message direction does not match subscription")
	}
	timestamp, err := strconv.ParseInt(event.Timestamp, 10, 64)
	if err != nil || timestamp <= 0 {
		return result, errors.New("invalid X message timestamp")
	}
	counterpart, direction := sender, "inbound"
	if sender == ourID {
		counterpart, direction = recipient, "outbound"
	}
	pair := []string{sender, recipient}
	sort.Slice(pair, func(i, j int) bool { return numericIDLess(pair[i], pair[j]) })
	created := time.UnixMilli(timestamp).UTC()
	user := payload.Users[counterpart].Data
	conversation := platform.ProviderConversation{ID: strings.Join(pair, "-"), CounterpartRemoteID: counterpart, CounterpartName: user.Name, CounterpartHandle: user.Username, CounterpartAvatarURL: user.Avatar, LastMessageAt: created, LastMessagePreview: event.Message.Data.Text, LastRemoteMessageID: event.ID, Messages: []platform.ProviderMessage{{ID: event.ID, Direction: direction, AuthorRemoteID: sender, Body: event.Message.Data.Text, RemoteCreatedAt: created}}}
	result.Conversations = append(result.Conversations, conversation)
	return result, nil
}

func numericIDLess(a, b string) bool {
	if len(a) != len(b) {
		return len(a) < len(b)
	}
	return a < b
}

func messagingBearer(tagged string) string {
	token, _ := platform.XMessagingOAuth2Bearer(tagged)
	return token
}

// Maintain retries subscription shutdown even after all receipts were applied.
// Expiration is provider-enforced; reservations remain until reconciliation.
func (s *Service) Maintain(ctx context.Context) error {
	_, err := s.db.NewDelete().Model((*authRequest)(nil)).Where("expires_at < ?", s.now()).Exec(ctx)
	if err != nil {
		return err
	}
	var subscriptions []subscription
	if err = s.db.NewSelect().Model(&subscriptions).Where("state = ? AND (received >= event_limit OR expires_at <= ?) AND (last_stop_attempt_at IS NULL OR last_stop_attempt_at <= ?)", "active", s.now(), s.now().Add(-30*time.Second)).OrderExpr("COALESCE(last_stop_attempt_at, created_at) ASC").Limit(100).Scan(ctx); err != nil {
		return err
	}
	var failures error
	for _, sub := range subscriptions {
		if err = s.StopSubscription(ctx, sub.WorkspaceID, sub.ID); err != nil {
			failures = errors.Join(failures, err)
		}
	}
	return failures
}

func validLegacyIdentity(kind, id, sender, recipient, ourID string) bool {
	return kind == "message_create" && id != "" && sender != "" && recipient != "" && (sender == ourID || recipient == ourID)
}

func (s *Service) deferReceipt(ctx context.Context, row receipt) error {
	delay := 30 * time.Second
	for attempt := 0; attempt < row.Attempts && delay < 10*time.Minute; attempt++ {
		delay *= 2
	}
	if delay > 10*time.Minute {
		delay = 10 * time.Minute
	}
	_, err := s.db.NewUpdate().Model(&row).Set("attempts = attempts + 1").Set("next_attempt_at = ?", s.now().Add(delay)).WherePK().Where("processed = ?", false).Exec(ctx)
	return err
}
func (s *Service) activationFailure(ctx context.Context, sub subscription, activationErr error) {
	var httpErr *platform.HTTPError
	// Only explicit request/auth/validation rejection proves no subscription was
	// created. Duplicate/conflict and server errors retain uncertain exposure.
	if errors.As(activationErr, &httpErr) && (httpErr.StatusCode == 401 || httpErr.StatusCode == 403 || httpErr.StatusCode == 422) {
		if sub.EventType == "dm.received" {
			for slot := 1; slot <= sub.EventLimit; slot++ {
				_ = s.costs.ReleaseProviderCost(ctx, slotKey(sub.ID, slot))
			}
		}
		_, _ = s.db.NewUpdate().Model(&sub).Set("state = ?", "stopped").WherePK().Exec(ctx)
		return
	}
	_, _ = s.db.NewUpdate().Model(&sub).Set("state = ?", "unknown").WherePK().Exec(ctx)
}
