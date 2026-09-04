// Package externalwebhooks owns durable, signed delivery of OpenPost events to
// external applications. Authorization grants and delivery retries deliberately
// have separate lifecycles.
package externalwebhooks

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/netguard"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/uptrace/bun"
)

const (
	StatusPending   = "pending"
	StatusDelivered = "delivered"
	StatusFailed    = "failed"
)

var ErrInvalidSubscription = errors.New("invalid webhook subscription")

var webhookURLPolicy = netguard.URLPolicy{Label: "webhook URL", AllowedSchemes: []string{"https"}, AllowCustomPorts: true}

type Service struct {
	db          *bun.DB
	encryptor   *servicecrypto.TokenEncryptor
	httpClient  *http.Client
	now         func() time.Time
	validateURL func(context.Context, *url.URL) error
}

type CreateInput struct {
	InstallationID, WorkspaceID, URL string
	EventTypes                       []string
}

type CreateResult struct {
	Subscription models.ExternalWebhookSubscription
	Secret       string
}

type deliveryPayload struct {
	DeliveryID string `json:"delivery_id"`
}

func NewService(db *bun.DB, encryptor *servicecrypto.TokenEncryptor) *Service {
	return &Service{db: db, encryptor: encryptor, httpClient: netguard.NewHTTPClient(15*time.Second, webhookURLPolicy), now: func() time.Time { return time.Now().UTC() }, validateURL: func(ctx context.Context, value *url.URL) error {
		return netguard.ValidateURL(ctx, value, webhookURLPolicy)
	}}
}

func (s *Service) SetURLValidator(validate func(context.Context, *url.URL) error) {
	if validate != nil {
		s.validateURL = validate
	}
}

func (s *Service) SetHTTPClient(client *http.Client) {
	if client != nil {
		s.httpClient = client
	}
}

func (s *Service) Create(ctx context.Context, input CreateInput) (*CreateResult, error) {
	if s.encryptor == nil || strings.TrimSpace(input.InstallationID) == "" || strings.TrimSpace(input.WorkspaceID) == "" {
		return nil, ErrInvalidSubscription
	}
	parsed, err := url.Parse(strings.TrimSpace(input.URL))
	if err != nil || s.validateURL(ctx, parsed) != nil {
		return nil, ErrInvalidSubscription
	}
	events := uniqueSorted(input.EventTypes)
	if len(events) == 0 {
		return nil, ErrInvalidSubscription
	}
	grantCount, err := s.db.NewSelect().Model((*models.ExternalAppWorkspaceGrant)(nil)).Where("installation_id = ? AND workspace_id = ? AND revoked_at IS NULL", input.InstallationID, input.WorkspaceID).Count(ctx)
	if err != nil || grantCount != 1 {
		return nil, ErrInvalidSubscription
	}
	secret, err := webhookSecret()
	if err != nil {
		return nil, err
	}
	ciphertext, err := s.encryptor.Encrypt(secret)
	if err != nil {
		return nil, err
	}
	now := s.now()
	subscription := models.ExternalWebhookSubscription{
		ID: uuid.NewString(), InstallationID: strings.TrimSpace(input.InstallationID), WorkspaceID: strings.TrimSpace(input.WorkspaceID),
		URL: parsed.String(), SecretHash: hash(secret), SecretEncrypted: ciphertext, EventTypes: strings.Join(events, " "), CreatedAt: now,
	}
	if _, err := s.db.NewInsert().Model(&subscription).Exec(ctx); err != nil {
		return nil, err
	}
	return &CreateResult{Subscription: subscription, Secret: secret}, nil
}

func (s *Service) List(ctx context.Context, installationID string) ([]models.ExternalWebhookSubscription, error) {
	var subscriptions []models.ExternalWebhookSubscription
	err := s.db.NewSelect().Model(&subscriptions).Where("installation_id = ?", strings.TrimSpace(installationID)).Order("created_at DESC").Scan(ctx)
	return subscriptions, err
}

func (s *Service) Revoke(ctx context.Context, installationID, subscriptionID string) error {
	result, err := s.db.NewUpdate().Model((*models.ExternalWebhookSubscription)(nil)).Set("revoked_at = ?", s.now()).Where("id = ? AND installation_id = ? AND revoked_at IS NULL", subscriptionID, installationID).Exec(ctx)
	if err != nil {
		return err
	}
	rows, _ := result.RowsAffected()
	if rows != 1 {
		return ErrInvalidSubscription
	}
	return nil
}

func (s *Service) ListDeliveries(ctx context.Context, installationID string, limit int) ([]models.ExternalWebhookDelivery, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	var deliveries []models.ExternalWebhookDelivery
	err := s.db.NewSelect().Model(&deliveries).
		Join("JOIN external_webhook_subscriptions AS subscription ON subscription.id = external_webhook_delivery.subscription_id").
		Where("subscription.installation_id = ?", installationID).Order("external_webhook_delivery.created_at DESC").Limit(limit).Scan(ctx)
	return deliveries, err
}

func EnqueueEvent(ctx context.Context, db bun.IDB, event models.PublicationLifecycleEvent) error {
	var subscriptions []models.ExternalWebhookSubscription
	if err := db.NewSelect().Model(&subscriptions).
		Join("JOIN external_app_workspace_grants AS grant ON grant.installation_id = external_webhook_subscription.installation_id AND grant.workspace_id = external_webhook_subscription.workspace_id").
		Join("JOIN external_app_installations AS installation ON installation.id = external_webhook_subscription.installation_id").
		Where("external_webhook_subscription.workspace_id = ?", event.WorkspaceID).
		Where("external_webhook_subscription.revoked_at IS NULL AND grant.revoked_at IS NULL AND installation.revoked_at IS NULL").
		Scan(ctx); err != nil {
		if missingTable(err) {
			return nil
		}
		return err
	}
	metadata := json.RawMessage(event.MetadataJSON)
	if !json.Valid(metadata) {
		metadata = json.RawMessage(`{}`)
	}
	payload, err := json.Marshal(map[string]any{
		"id": event.ID, "type": event.Type, "created_at": event.CreatedAt.UTC().Format(time.RFC3339Nano),
		"workspace_id": event.WorkspaceID, "publication_id": event.PublicationID, "rendition_id": event.RenditionID,
		"status": event.Status, "message": event.Message, "metadata": metadata,
	})
	if err != nil {
		return err
	}
	for _, subscription := range subscriptions {
		if !eventSubscribed(subscription.EventTypes, event.Type) {
			continue
		}
		now := event.CreatedAt
		if now.IsZero() {
			now = time.Now().UTC()
		}
		delivery := models.ExternalWebhookDelivery{ID: uuid.NewString(), SubscriptionID: subscription.ID, EventID: event.ID, EventType: event.Type, PayloadJSON: string(payload), Status: StatusPending, CreatedAt: now, UpdatedAt: now}
		result, insertErr := db.NewInsert().Model(&delivery).On("CONFLICT (subscription_id, event_id) DO NOTHING").Exec(ctx)
		if insertErr != nil {
			return insertErr
		}
		rows, _ := result.RowsAffected()
		if rows == 0 {
			continue
		}
		jobPayload, _ := json.Marshal(deliveryPayload{DeliveryID: delivery.ID})
		job, jobErr := jobregistry.NewJob(jobregistry.TypeExternalWebhookDelivery, string(jobPayload), now)
		if jobErr != nil {
			return jobErr
		}
		job.ScopeID = delivery.ID
		job.DedupeKey = "external-webhook:" + delivery.ID
		if _, insertErr := db.NewInsert().Model(job).Exec(ctx); insertErr != nil {
			return insertErr
		}
	}
	return nil
}

func missingTable(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such table") || strings.Contains(message, "does not exist")
}

func (s *Service) HandleJob(ctx context.Context, payload string) error {
	var requested deliveryPayload
	if json.Unmarshal([]byte(payload), &requested) != nil || strings.TrimSpace(requested.DeliveryID) == "" {
		return ErrInvalidSubscription
	}
	var delivery models.ExternalWebhookDelivery
	if err := s.db.NewSelect().Model(&delivery).Where("id = ?", requested.DeliveryID).Scan(ctx); err != nil {
		return err
	}
	var subscription models.ExternalWebhookSubscription
	if err := s.db.NewSelect().Model(&subscription).
		Join("JOIN external_app_workspace_grants AS grant ON grant.installation_id = external_webhook_subscription.installation_id AND grant.workspace_id = external_webhook_subscription.workspace_id").
		Join("JOIN external_app_installations AS installation ON installation.id = external_webhook_subscription.installation_id").
		Where("external_webhook_subscription.id = ?", delivery.SubscriptionID).
		Where("external_webhook_subscription.revoked_at IS NULL AND grant.revoked_at IS NULL AND installation.revoked_at IS NULL").
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	secret, err := s.encryptor.Decrypt(subscription.SecretEncrypted)
	if err != nil {
		return err
	}
	timestamp := s.now().UTC().Format(time.RFC3339Nano)
	signature := Signature(secret, timestamp, delivery.PayloadJSON)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, subscription.URL, bytes.NewBufferString(delivery.PayloadJSON))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "OpenPost-Webhooks/1.0")
	req.Header.Set("X-OpenPost-Delivery", delivery.ID)
	req.Header.Set("X-OpenPost-Event", delivery.EventType)
	req.Header.Set("X-OpenPost-Timestamp", timestamp)
	req.Header.Set("X-OpenPost-Signature", "v1="+signature)
	response, err := s.httpClient.Do(req)
	if err != nil {
		s.recordFailure(ctx, delivery.ID, 0, err.Error())
		return err
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 64*1024))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		err = fmt.Errorf("webhook returned HTTP %d", response.StatusCode)
		s.recordFailure(ctx, delivery.ID, response.StatusCode, err.Error())
		return err
	}
	now := s.now()
	_, err = s.db.NewUpdate().Model((*models.ExternalWebhookDelivery)(nil)).Set("status = ?", StatusDelivered).Set("attempt_count = attempt_count + 1").Set("response_status = ?", response.StatusCode).Set("last_error = ''").Set("delivered_at = ?", now).Set("updated_at = ?", now).Where("id = ?", delivery.ID).Exec(ctx)
	return err
}

func (s *Service) recordFailure(ctx context.Context, deliveryID string, status int, message string) {
	_, _ = s.db.NewUpdate().Model((*models.ExternalWebhookDelivery)(nil)).Set("status = ?", StatusFailed).Set("attempt_count = attempt_count + 1").Set("response_status = ?", status).Set("last_error = ?", message).Set("updated_at = ?", s.now()).Where("id = ?", deliveryID).Exec(ctx)
}

func Signature(secret, timestamp, payload string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp + "." + payload))
	return hex.EncodeToString(mac.Sum(nil))
}

func webhookSecret() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return "op_webhook_" + base64.RawURLEncoding.EncodeToString(value), nil
}

func hash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func eventSubscribed(scope, eventType string) bool {
	events := strings.Fields(scope)
	return slices.Contains(events, "*") || slices.Contains(events, strings.TrimSpace(eventType))
}

func uniqueSorted(values []string) []string {
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			set[value] = struct{}{}
		}
	}
	out := make([]string, 0, len(set))
	for value := range set {
		out = append(out, value)
	}
	slices.Sort(out)
	return out
}
