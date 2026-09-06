package passwordmail

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/mail"
	"net/url"
	"strings"

	"github.com/openpost/backend/internal/services/notifications"
	"github.com/openpost/backend/internal/services/transactionalmail"
)

const (
	defaultResendAPIBase     = "https://api.resend.com"
	defaultCloudflareAPIBase = "https://api.cloudflare.com/client/v4"
	maxProviderErrorBody     = 8 << 10
)

type ResendConfig struct {
	APIKey  string
	From    string
	BaseURL string
	Client  *http.Client
}

type ResendSender struct {
	apiKey  string
	from    *mail.Address
	baseURL string
	client  *http.Client
}

func NewResendSender(config ResendConfig) (*ResendSender, error) {
	apiKey := strings.TrimSpace(config.APIKey)
	if apiKey == "" {
		return nil, errors.New("missing Resend API key")
	}
	from, err := mail.ParseAddress(strings.TrimSpace(config.From))
	if err != nil {
		return nil, fmt.Errorf("invalid Resend from address: %w", err)
	}
	baseURL, err := normalizeHTTPSBaseURL(config.BaseURL, defaultResendAPIBase)
	if err != nil {
		return nil, fmt.Errorf("invalid Resend API base URL: %w", err)
	}
	client := config.Client
	if client == nil {
		client = &http.Client{Timeout: defaultTimeout}
	}
	return &ResendSender{apiKey: apiKey, from: from, baseURL: baseURL, client: client}, nil
}

func (s *ResendSender) SendPasswordReset(ctx context.Context, message ResetMessage) error {
	content, err := resetContent(message)
	if err != nil {
		return err
	}
	return s.send(ctx, message.Recipient, message.IdempotencyKey, content)
}

func (s *ResendSender) SendEmailVerification(ctx context.Context, message VerificationMessage) error {
	content, err := verificationContent(message)
	if err != nil {
		return err
	}
	return s.send(ctx, message.Recipient, message.IdempotencyKey, content)
}

func (s *ResendSender) SendIdentityEmail(ctx context.Context, message IdentityMessage) error {
	content, err := notificationContent(notificationMessage(message))
	if err != nil {
		return err
	}
	return s.send(ctx, message.Recipient, message.IdempotencyKey, content)
}

func (s *ResendSender) DeliverNotificationEmail(ctx context.Context, message notifications.EmailMessage) error {
	content, err := notificationContent(notificationMessage(message))
	if err != nil {
		return err
	}
	return s.send(ctx, message.Recipient, message.IdempotencyKey, content)
}

func (s *ResendSender) DeliverWorkspaceInvitationEmail(ctx context.Context, message transactionalmail.WorkspaceInvitationMessage) error {
	return s.SendWorkspaceInvitation(ctx, message)
}

func (s *ResendSender) SendWorkspaceInvitation(ctx context.Context, message transactionalmail.WorkspaceInvitationMessage) error {
	content, err := workspaceInvitationContent(message)
	if err != nil {
		return err
	}
	return s.send(ctx, message.Recipient, message.IdempotencyKey, content)
}

func (s *ResendSender) send(ctx context.Context, recipient, idempotencyKey string, content messageContent) error {
	payload := map[string]any{
		"from":    s.from.String(),
		"to":      []string{strings.TrimSpace(recipient)},
		"subject": content.Subject,
		"text":    content.Text,
		"html":    content.HTML,
	}
	headers := map[string]string{
		"Authorization": "Bearer " + s.apiKey,
		"User-Agent":    "OpenPost transactional email",
	}
	if key := strings.TrimSpace(idempotencyKey); key != "" {
		headers["Idempotency-Key"] = key
	}
	return sendJSON(ctx, s.client, s.baseURL+"/emails", headers, payload, "Resend")
}

type CloudflareConfig struct {
	AccountID string
	APIToken  string
	From      string
	BaseURL   string
	Client    *http.Client
}

type CloudflareSender struct {
	accountID string
	apiToken  string
	from      *mail.Address
	baseURL   string
	client    *http.Client
}

func NewCloudflareSender(config CloudflareConfig) (*CloudflareSender, error) {
	accountID := strings.TrimSpace(config.AccountID)
	apiToken := strings.TrimSpace(config.APIToken)
	if accountID == "" {
		return nil, errors.New("missing Cloudflare account ID")
	}
	if apiToken == "" {
		return nil, errors.New("missing Cloudflare Email Service API token")
	}
	from, err := mail.ParseAddress(strings.TrimSpace(config.From))
	if err != nil {
		return nil, fmt.Errorf("invalid Cloudflare from address: %w", err)
	}
	baseURL, err := normalizeHTTPSBaseURL(config.BaseURL, defaultCloudflareAPIBase)
	if err != nil {
		return nil, fmt.Errorf("invalid Cloudflare API base URL: %w", err)
	}
	client := config.Client
	if client == nil {
		client = &http.Client{Timeout: defaultTimeout}
	}
	return &CloudflareSender{accountID: accountID, apiToken: apiToken, from: from, baseURL: baseURL, client: client}, nil
}

func (s *CloudflareSender) SendPasswordReset(ctx context.Context, message ResetMessage) error {
	content, err := resetContent(message)
	if err != nil {
		return err
	}
	return s.send(ctx, message.Recipient, content)
}

func (s *CloudflareSender) SendEmailVerification(ctx context.Context, message VerificationMessage) error {
	content, err := verificationContent(message)
	if err != nil {
		return err
	}
	return s.send(ctx, message.Recipient, content)
}

func (s *CloudflareSender) SendIdentityEmail(ctx context.Context, message IdentityMessage) error {
	content, err := notificationContent(notificationMessage(message))
	if err != nil {
		return err
	}
	return s.send(ctx, message.Recipient, content)
}

func (s *CloudflareSender) DeliverNotificationEmail(ctx context.Context, message notifications.EmailMessage) error {
	content, err := notificationContent(notificationMessage(message))
	if err != nil {
		return err
	}
	return s.send(ctx, message.Recipient, content)
}

func (s *CloudflareSender) DeliverWorkspaceInvitationEmail(ctx context.Context, message transactionalmail.WorkspaceInvitationMessage) error {
	return s.SendWorkspaceInvitation(ctx, message)
}

func (s *CloudflareSender) SendWorkspaceInvitation(ctx context.Context, message transactionalmail.WorkspaceInvitationMessage) error {
	content, err := workspaceInvitationContent(message)
	if err != nil {
		return err
	}
	return s.send(ctx, message.Recipient, content)
}

func (s *CloudflareSender) send(ctx context.Context, recipient string, content messageContent) error {
	from := map[string]string{"address": s.from.Address}
	if s.from.Name != "" {
		from["name"] = s.from.Name
	}
	payload := map[string]any{
		"from":    from,
		"to":      strings.TrimSpace(recipient),
		"subject": content.Subject,
		"text":    content.Text,
		"html":    content.HTML,
	}
	endpoint := fmt.Sprintf("%s/accounts/%s/email/sending/send", s.baseURL, url.PathEscape(s.accountID))
	return sendJSON(ctx, s.client, endpoint, map[string]string{
		"Authorization": "Bearer " + s.apiToken,
	}, payload, "Cloudflare Email Service")
}

func sendJSON(
	ctx context.Context,
	client *http.Client,
	endpoint string,
	headers map[string]string,
	payload any,
	provider string,
) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode %s request: %w", provider, err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(encoded))
	if err != nil {
		return fmt.Errorf("create %s request: %w", provider, err)
	}
	request.Header.Set("Content-Type", "application/json")
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("send email with %s: %w", provider, err)
	}
	defer response.Body.Close()
	body, readErr := io.ReadAll(io.LimitReader(response.Body, maxProviderErrorBody))
	if readErr != nil {
		return fmt.Errorf("read %s response: %w", provider, readErr)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("%s returned HTTP %d: %s", provider, response.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

func normalizeHTTPSBaseURL(value, fallback string) (string, error) {
	value = strings.TrimRight(strings.TrimSpace(value), "/")
	if value == "" {
		value = fallback
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return "", errors.New("base URL must be an absolute HTTPS URL")
	}
	return value, nil
}
