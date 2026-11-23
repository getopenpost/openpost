package billing

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/openpost/backend/internal/textutil"

	"github.com/PaddleHQ/paddle-go-sdk/v5"
	"github.com/openpost/backend/internal/discordwebhook"
	"github.com/openpost/backend/internal/models"
)

const (
	discordBillingSuccessColor = 0x2ECC71
	discordBillingWarningColor = 0xF1C40F
	discordBillingErrorColor   = 0xE74C3C
	discordBillingInfoColor    = 0x3498DB
)

type billingDiscordNotifier struct {
	webhookURL string
	client     *http.Client
}

type discordWebhookPayload struct {
	Username        string          `json:"username,omitempty"`
	AllowedMentions discordMentions `json:"allowed_mentions"`
	Embeds          []discordEmbed  `json:"embeds"`
}

type discordMentions struct {
	Parse []string `json:"parse"`
}

type discordEmbed struct {
	Title       string                 `json:"title"`
	Description string                 `json:"description,omitempty"`
	Color       int                    `json:"color"`
	Timestamp   string                 `json:"timestamp,omitempty"`
	Fields      []discordEmbedField    `json:"fields,omitempty"`
	Thumbnail   *discordEmbedThumbnail `json:"thumbnail,omitempty"`
	Footer      discordEmbedFooter     `json:"footer"`
}

type discordEmbedField struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Inline bool   `json:"inline,omitempty"`
}

type discordEmbedThumbnail struct {
	URL string `json:"url"`
}

type discordEmbedFooter struct {
	Text string `json:"text"`
}

type paddleBillingNotification struct {
	event          paddleEvent
	transaction    *paddle.Transaction
	subscription   *paddle.Subscription
	checkout       models.BillingCheckoutAttempt
	user           *models.User
	organization   *models.Organization
	email          string
	name           string
	avatarURL      string
	planName       string
	customerID     string
	subscriptionID string
	transactionID  string
	status         string
	amount         string
	color          int
}

func newBillingDiscordNotifier(webhookURL string) (*billingDiscordNotifier, error) {
	webhookURL = strings.TrimSpace(webhookURL)
	if err := validateBillingDiscordWebhookURL(webhookURL); err != nil {
		return nil, err
	}
	if webhookURL == "" {
		return nil, nil
	}
	return &billingDiscordNotifier{webhookURL: webhookURL, client: discordwebhook.NewClient()}, nil
}

func validateBillingDiscordWebhookURL(rawURL string) error {
	if rawURL == "" {
		return nil
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || parsed.Hostname() == "" {
		return fmt.Errorf("billing Discord webhook URL must be an HTTPS Discord webhook URL")
	}
	host := strings.ToLower(parsed.Hostname())
	if host != "discord.com" && host != "discordapp.com" {
		return fmt.Errorf("billing Discord webhook URL must use discord.com or discordapp.com")
	}
	if !strings.HasPrefix(parsed.EscapedPath(), "/api/webhooks/") {
		return fmt.Errorf("billing Discord webhook URL must point to a Discord webhook")
	}
	return nil
}

func (n *billingDiscordNotifier) send(ctx context.Context, payload discordWebhookPayload) error {
	return discordwebhook.Send(ctx, n.client, n.webhookURL, payload)
}

func (s *Service) notifyPaddleEvent(ctx context.Context, event paddleEvent, customer *paddle.Customer, subscription *paddle.Subscription, transaction *paddle.Transaction) error {
	if s.discordInitErr != nil {
		return configurationError("initializing billing Discord notifier: %v", s.discordInitErr)
	}
	if s.discordNotifier == nil {
		return nil
	}
	if s.db == nil {
		return fmt.Errorf("billing database is not configured")
	}
	var recorded models.BillingWebhookEvent
	if err := s.db.NewSelect().Model(&recorded).Where("event_id = ?", event.EventID).Scan(ctx); err != nil {
		return fmt.Errorf("loading recorded Paddle webhook event: %w", err)
	}
	if !recorded.DiscordNotificationSentAt.IsZero() {
		return nil
	}
	notification, err := s.buildPaddleBillingNotification(ctx, event, customer, subscription, transaction)
	if err != nil {
		return err
	}
	if err := s.discordNotifier.send(ctx, notification.discordPayload()); err != nil {
		return err
	}
	_, err = s.db.NewUpdate().Model((*models.BillingWebhookEvent)(nil)).
		Set("discord_notification_sent_at = ?", s.now().UTC()).
		Where("event_id = ?", event.EventID).
		Where("discord_notification_sent_at IS NULL").Exec(ctx)
	if err != nil {
		return fmt.Errorf("marking Paddle webhook Discord notification sent: %w", err)
	}
	return nil
}

func (s *Service) buildPaddleBillingNotification(ctx context.Context, event paddleEvent, customer *paddle.Customer, subscription *paddle.Subscription, transaction *paddle.Transaction) (paddleBillingNotification, error) {
	notification := newPaddleBillingNotification(event, customer, subscription, transaction)
	if err := s.applyBillingNotificationUser(ctx, &notification); err != nil {
		return paddleBillingNotification{}, err
	}
	s.resolveBillingNotificationPlan(&notification)
	return notification, nil
}

func newPaddleBillingNotification(event paddleEvent, customer *paddle.Customer, subscription *paddle.Subscription, transaction *paddle.Transaction) paddleBillingNotification {
	notification := paddleBillingNotification{event: event, transaction: transaction, subscription: subscription, color: discordBillingColor(event.EventType)}
	if customer != nil {
		notification.customerID = strings.TrimSpace(customer.ID)
		notification.email = strings.TrimSpace(customer.Email)
		notification.name = customerName(customer.Name)
	}
	if subscription != nil {
		notification.customerID = textutil.FirstNonEmpty(notification.customerID, subscription.CustomerID)
		notification.subscriptionID = strings.TrimSpace(subscription.ID)
		notification.status = strings.TrimSpace(string(subscription.Status))
	}
	if transaction != nil {
		notification.customerID = textutil.FirstNonEmpty(notification.customerID, pointerString(transaction.CustomerID), transaction.Customer.ID)
		notification.transactionID = strings.TrimSpace(transaction.ID)
		notification.status = textutil.FirstNonEmpty(string(transaction.Status), notification.status)
		notification.amount = formatPaddleAmount(transaction.Details.Totals.Total, transaction.CurrencyCode)
		notification.email = textutil.FirstNonEmpty(notification.email, transaction.Customer.Email)
		notification.name = textutil.FirstNonEmpty(notification.name, customerName(transaction.Customer.Name))
		notification.subscriptionID = textutil.FirstNonEmpty(notification.subscriptionID, pointerString(transaction.SubscriptionID))
	}
	return notification
}

func (s *Service) applyBillingNotificationUser(ctx context.Context, notification *paddleBillingNotification) error {
	attempt, organization, user, err := s.resolveBillingNotificationUser(ctx, *notification)
	if err != nil {
		return err
	}
	notification.checkout, notification.organization, notification.user = attempt, organization, user
	notification.email = textutil.FirstNonEmpty(notification.email, s.billingCustomerEmail(ctx, notification.customerID))
	if user != nil {
		notification.email = textutil.FirstNonEmpty(user.Email, notification.email)
		notification.name = textutil.FirstNonEmpty(user.DisplayName, user.Username, notification.name)
		notification.avatarURL = s.publicAvatarURL(user.AvatarURL)
	}
	notification.email = textutil.FirstNonEmpty(notification.email, "Unavailable")
	notification.name = textutil.FirstNonEmpty(notification.name, "Unavailable")
	return nil
}

func (s *Service) resolveBillingNotificationPlan(notification *paddleBillingNotification) {
	planID := notification.checkout.PlanID
	if planID == "" && notification.subscription != nil {
		priceID, _ := subscriptionCatalogIDs(notification.subscription)
		planID = s.planIDForProviderPrice(priceID)
	}
	if planID == "" && notification.transaction != nil {
		for _, item := range notification.transaction.Details.LineItems {
			planID = s.planIDForProviderPrice(item.PriceID)
			if planID != "" {
				break
			}
		}
	}
	if plan, ok := s.paddle.Plans[planID]; ok {
		notification.planName = textutil.FirstNonEmpty(plan.Name, planID)
	} else {
		notification.planName = textutil.FirstNonEmpty(planID, "Unavailable")
	}
}

func (n paddleBillingNotification) discordPayload() discordWebhookPayload {
	fields := []discordEmbedField{{Name: "Event", Value: n.event.EventType, Inline: true}, {Name: "Email", Value: n.email, Inline: true}, {Name: "Name", Value: n.name, Inline: true}}
	fields = appendOptionalField(fields, "User", userID(n.user))
	fields = appendOptionalField(fields, "Plan", n.planName)
	fields = appendOptionalField(fields, "Status", n.status)
	fields = appendOptionalField(fields, "Amount", n.amount)
	fields = appendOptionalField(fields, "Paddle customer", n.customerID)
	fields = appendOptionalField(fields, "Subscription", n.subscriptionID)
	fields = appendOptionalField(fields, "Transaction", n.transactionID)
	if n.organization != nil {
		fields = appendOptionalField(fields, "Organization", n.organization.Name)
	}
	embed := discordEmbed{Title: "Paddle " + humanizeBillingEvent(n.event.EventType), Description: "A billing event was received by OpenPost.", Color: n.color, Timestamp: n.event.OccurredAt, Fields: fields, Footer: discordEmbedFooter{Text: "Paddle event " + n.event.EventID}}
	if n.avatarURL != "" {
		embed.Thumbnail = &discordEmbedThumbnail{URL: n.avatarURL}
	}
	return discordWebhookPayload{Username: "OpenPost billing", AllowedMentions: discordMentions{Parse: []string{}}, Embeds: []discordEmbed{embed}}
}

func appendOptionalField(fields []discordEmbedField, name, value string) []discordEmbedField {
	if strings.TrimSpace(value) == "" {
		return fields
	}
	return append(fields, discordEmbedField{Name: name, Value: value, Inline: true})
}

func (s *Service) resolveBillingNotificationUser(ctx context.Context, notification paddleBillingNotification) (models.BillingCheckoutAttempt, *models.Organization, *models.User, error) {
	attempt, err := s.billingNotificationCheckout(ctx, notification)
	if err != nil {
		return models.BillingCheckoutAttempt{}, nil, nil, err
	}
	organizationID, err := s.billingNotificationOrganizationID(ctx, attempt.OrganizationID, notification.subscriptionID)
	if err != nil {
		return models.BillingCheckoutAttempt{}, nil, nil, err
	}
	organization, err := s.loadBillingOrganization(ctx, organizationID)
	if err != nil {
		return models.BillingCheckoutAttempt{}, nil, nil, err
	}
	user, err := s.notificationUser(ctx, attempt.UserID, organization, notification.email)
	return attempt, organization, user, err
}

func (s *Service) billingNotificationCheckout(ctx context.Context, notification paddleBillingNotification) (models.BillingCheckoutAttempt, error) {
	customData := paddle.CustomData(nil)
	if notification.transaction != nil {
		customData = notification.transaction.CustomData
	}
	if len(customData) == 0 && notification.subscription != nil {
		customData = notification.subscription.CustomData
	}
	attempt, err := s.checkoutAttempt(ctx, customDataString(customData, "checkout_id"))
	if err != nil || attempt.OrganizationID != "" || notification.subscriptionID == "" {
		return attempt, err
	}
	return s.checkoutAttemptForSubscription(ctx, notification.subscriptionID)
}

func (s *Service) billingNotificationOrganizationID(ctx context.Context, organizationID, subscriptionID string) (string, error) {
	if organizationID != "" || subscriptionID == "" {
		return organizationID, nil
	}
	var subscription models.BillingSubscription
	err := s.db.NewSelect().Model(&subscription).Where("provider = ?", ProviderPaddle).Where("provider_subscription_id = ?", subscriptionID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("loading billing subscription for Discord notification: %w", err)
	}
	return subscription.OrganizationID, nil
}

func (s *Service) loadBillingOrganization(ctx context.Context, organizationID string) (*models.Organization, error) {
	if organizationID == "" {
		return nil, nil
	}
	organization := &models.Organization{}
	err := s.db.NewSelect().Model(organization).Where("id = ?", organizationID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("loading organization for Discord notification: %w", err)
	}
	return organization, nil
}

func (s *Service) notificationUser(ctx context.Context, userID string, organization *models.Organization, email string) (*models.User, error) {
	if userID == "" && organization != nil {
		userID = organization.CreatedByID
	}
	if userID != "" {
		user, err := s.loadBillingUser(ctx, userID)
		if err != nil || user != nil {
			return user, err
		}
	}
	if email == "" {
		return nil, nil
	}
	return s.loadBillingUserByEmail(ctx, email)
}

func (s *Service) loadBillingUser(ctx context.Context, userID string) (*models.User, error) {
	var user models.User
	err := s.db.NewSelect().Model(&user).Where("id = ?", strings.TrimSpace(userID)).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("loading user for Discord notification: %w", err)
	}
	return &user, nil
}

func (s *Service) loadBillingUserByEmail(ctx context.Context, email string) (*models.User, error) {
	var user models.User
	err := s.db.NewSelect().Model(&user).Where("LOWER(email) = LOWER(?)", strings.TrimSpace(email)).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("loading user by email for Discord notification: %w", err)
	}
	return &user, nil
}

func (s *Service) billingCustomerEmail(ctx context.Context, customerID string) string {
	if strings.TrimSpace(customerID) == "" {
		return ""
	}
	var customer models.BillingCustomer
	if err := s.db.NewSelect().Model(&customer).Where("provider = ?", ProviderPaddle).Where("provider_customer_id = ?", customerID).Scan(ctx); err != nil {
		return ""
	}
	return strings.TrimSpace(customer.Email)
}

func (s *Service) publicAvatarURL(rawURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return ""
	}
	if parsed.Scheme == "https" && parsed.Hostname() != "" {
		return parsed.String()
	}
	if !strings.HasPrefix(parsed.Path, "/") {
		return ""
	}
	base, err := url.Parse(strings.TrimRight(strings.TrimSpace(s.paddle.AppURL), "/"))
	if err != nil || base.Scheme != "https" || base.Hostname() == "" {
		return ""
	}
	return base.ResolveReference(parsed).String()
}

func discordBillingColor(eventType string) int {
	switch {
	case strings.HasSuffix(eventType, ".completed"), strings.HasSuffix(eventType, ".paid"), strings.HasSuffix(eventType, ".activated"), strings.HasSuffix(eventType, ".trialing"):
		return discordBillingSuccessColor
	case strings.HasSuffix(eventType, ".canceled"), strings.HasSuffix(eventType, ".payment_failed"):
		return discordBillingErrorColor
	case strings.HasSuffix(eventType, ".past_due"), strings.HasSuffix(eventType, ".paused"):
		return discordBillingWarningColor
	default:
		return discordBillingInfoColor
	}
}

func humanizeBillingEvent(eventType string) string {
	parts := strings.FieldsFunc(eventType, func(r rune) bool { return r == '.' || r == '_' })
	for index, part := range parts {
		if part != "" {
			parts[index] = strings.ToUpper(part[:1]) + part[1:]
		}
	}
	return strings.Join(parts, " ")
}

func formatPaddleAmount(raw string, currency paddle.CurrencyCode) string {
	raw = strings.TrimSpace(raw)
	code := strings.ToUpper(strings.TrimSpace(string(currency)))
	if raw == "" {
		return ""
	}
	if !allDigitsWithOptionalSign(raw) {
		return textutil.FirstNonEmpty(code+" "+raw, raw)
	}
	digits := 2
	switch code {
	case "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF":
		digits = 0
	}
	sign := ""
	if strings.HasPrefix(raw, "-") {
		sign, raw = "-", strings.TrimPrefix(raw, "-")
	}
	if digits == 0 {
		return strings.TrimSpace(code + " " + sign + raw)
	}
	for len(raw) <= digits {
		raw = "0" + raw
	}
	return strings.TrimSpace(code + " " + sign + raw[:len(raw)-digits] + "." + raw[len(raw)-digits:])
}

func allDigitsWithOptionalSign(value string) bool {
	value = strings.TrimPrefix(value, "-")
	if value == "" {
		return false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func customerName(name *string) string {
	if name == nil {
		return ""
	}
	return strings.TrimSpace(*name)
}

func userID(user *models.User) string {
	if user == nil {
		return ""
	}
	return user.ID
}

func pointerString(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}
