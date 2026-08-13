package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

var discordWebhookPath = regexp.MustCompile(`^/api(?:/v[0-9]+)?/webhooks/([0-9]+)/([A-Za-z0-9._-]+)$`)

type DiscordAdapter struct{}

func NewDiscordAdapter() *DiscordAdapter {
	return &DiscordAdapter{}
}

func (*DiscordAdapter) AuthorizationGrantDescriptor() AuthorizationGrantDescriptor {
	return AuthorizationGrantDescriptor{
		ProjectID:     "discord-incoming-webhook",
		ExecutionMode: "webhook",
		Evidence:      map[string]string{"protocol": "webhook", "exchange": "user_supplied_url"},
	}
}

func (d *DiscordAdapter) GenerateAuthURL(string) (string, map[string]string) {
	return "", nil
}

func (d *DiscordAdapter) ExchangeCode(context.Context, string, map[string]string) (*TokenResult, error) {
	return nil, fmt.Errorf("discord webhooks use a webhook URL, not OAuth")
}

func (d *DiscordAdapter) RefreshCapability() RefreshCapability {
	return RefreshCapability{Supported: false, CredentialSource: RefreshCredentialNone}
}

func (d *DiscordAdapter) RefreshToken(context.Context, RefreshTokenInput) (*TokenResult, error) {
	return nil, fmt.Errorf("discord webhook credentials do not refresh")
}

func (d *DiscordAdapter) GetProfile(ctx context.Context, webhookURL string) (*UserProfile, error) {
	parsed, webhookID, err := validateDiscordWebhookURL(webhookURL)
	if err != nil {
		return nil, err
	}
	body, err := DoRequestNoRedirect(ctx, http.MethodGet, parsed.String(), nil, nil)
	if err != nil {
		return nil, fmt.Errorf("verifying discord webhook: %w", err)
	}
	var webhook struct {
		ID      string `json:"id"`
		Name    string `json:"name"`
		GuildID string `json:"guild_id"`
		Channel struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"channel"`
		Guild struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"guild"`
	}
	if err := json.Unmarshal(body, &webhook); err != nil {
		return nil, fmt.Errorf("decoding discord webhook: %w", err)
	}
	id := firstNonEmptyString(webhook.ID, webhookID)
	username := firstNonEmptyString(webhook.Name, webhook.Channel.Name, "Discord webhook")
	displayName := username
	if webhook.Guild.Name != "" && webhook.Channel.Name != "" {
		displayName = webhook.Guild.Name + " · #" + webhook.Channel.Name
	}
	return &UserProfile{
		ID:          id,
		Username:    username,
		DisplayName: displayName,
		CapabilityState: map[string]string{
			"discord_guild_id":   firstNonEmptyString(webhook.GuildID, webhook.Guild.ID),
			"discord_channel_id": webhook.Channel.ID,
			"connection_type":    "webhook",
		},
	}, nil
}

func (d *DiscordAdapter) UploadMedia(context.Context, string, string, string, io.Reader) (string, error) {
	return "", fmt.Errorf("discord media is attached when the webhook message is sent")
}

func (d *DiscordAdapter) Publish(ctx context.Context, webhookURL, _ string, req *PublishRequest) (PublishResult, error) {
	return executePublishWrite(req, "execute_webhook", func() (string, error) {
		return d.publish(ctx, webhookURL, req, nil)
	})
}

func (d *DiscordAdapter) PublishWithMedia(ctx context.Context, webhookURL, _ string, req *PublishRequest, media []UploadMediaRequest) (PublishResult, error) {
	if len(media) == 0 {
		return d.Publish(ctx, webhookURL, "", req)
	}
	if len(media) > 10 {
		return PublishResult{}, fmt.Errorf("discord webhook messages support up to 10 attachments")
	}
	return executePublishWrite(req, "execute_webhook", func() (string, error) {
		return d.publish(ctx, webhookURL, req, media)
	})
}

func (d *DiscordAdapter) publish(ctx context.Context, webhookURL string, req *PublishRequest, media []UploadMediaRequest) (string, error) {
	parsed, _, err := validateDiscordWebhookURL(webhookURL)
	if err != nil {
		return "", err
	}
	query := parsed.Query()
	query.Set("wait", "true")
	parsed.RawQuery = query.Encode()

	payload := map[string]any{
		"content":          strings.TrimSpace(req.Content),
		"allowed_mentions": map[string]any{"parse": []string{}},
	}
	if req.ReplyToID != "" {
		payload["message_reference"] = map[string]string{"message_id": req.ReplyToID}
	}
	if len(media) > 0 {
		attachments := make([]map[string]any, 0, len(media))
		for index, item := range media {
			attachment := map[string]any{
				"id":       index,
				"filename": discordFilename(item.Filename, index),
			}
			if index < len(req.MediaAltTexts) && strings.TrimSpace(req.MediaAltTexts[index]) != "" {
				attachment["description"] = strings.TrimSpace(req.MediaAltTexts[index])
			}
			attachments = append(attachments, attachment)
		}
		payload["attachments"] = attachments
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("encoding discord webhook message: %w", err)
	}
	var response []byte
	if len(media) == 0 {
		response, err = DoRequestNoRedirect(ctx, http.MethodPost, parsed.String(), bytes.NewReader(body), map[string]string{
			headerContentType: contentTypeJSON,
		})
	} else {
		response, err = doDiscordMultipart(ctx, parsed.String(), body, media)
	}
	if err != nil {
		return "", fmt.Errorf("sending discord webhook message: %w", err)
	}
	var message struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(response, &message); err != nil {
		return "", fmt.Errorf("decoding discord webhook response: %w", err)
	}
	if message.ID == "" {
		return "", fmt.Errorf("discord webhook response did not include a message id")
	}
	return message.ID, nil
}

func doDiscordMultipart(ctx context.Context, endpoint string, payload []byte, media []UploadMediaRequest) ([]byte, error) {
	reader, writer := io.Pipe()
	form := multipart.NewWriter(writer)
	writeDone := make(chan error, 1)
	go func() {
		var writeErr error
		defer func() {
			if closeErr := form.Close(); writeErr == nil {
				writeErr = closeErr
			}
			_ = writer.CloseWithError(writeErr)
			writeDone <- writeErr
		}()
		if writeErr = form.WriteField("payload_json", string(payload)); writeErr != nil {
			return
		}
		for index, item := range media {
			filename := discordFilename(item.Filename, index)
			part, err := form.CreateFormFile("files["+strconv.Itoa(index)+"]", filename)
			if err != nil {
				writeErr = err
				return
			}
			if _, err := io.Copy(part, item.Reader); err != nil {
				writeErr = err
				return
			}
		}
	}()
	response, requestErr := DoRequestNoRedirect(ctx, http.MethodPost, endpoint, reader, map[string]string{
		headerContentType: form.FormDataContentType(),
	})
	if requestErr != nil {
		_ = reader.CloseWithError(requestErr)
	}
	writeErr := <-writeDone
	if requestErr != nil {
		return nil, requestErr
	}
	if writeErr != nil {
		return nil, fmt.Errorf("encoding discord webhook attachments: %w", writeErr)
	}
	return response, nil
}

func discordFilename(filename string, index int) string {
	name := strings.TrimSpace(filepath.Base(filename))
	if name == "" || name == "." {
		return "attachment-" + strconv.Itoa(index+1)
	}
	return name
}

func (d *DiscordAdapter) DeletePublished(ctx context.Context, webhookURL, messageID string) error {
	parsed, _, err := validateDiscordWebhookURL(webhookURL)
	if err != nil {
		return err
	}
	parsed.Path += "/messages/" + url.PathEscape(strings.TrimSpace(messageID))
	if _, err := DoRequestNoRedirect(ctx, http.MethodDelete, parsed.String(), nil, nil); err != nil {
		return fmt.Errorf("deleting discord webhook message: %w", err)
	}
	return nil
}

func validateDiscordWebhookURL(raw string) (*url.URL, string, error) {
	if strings.ContainsAny(raw, "\r\n\t") {
		return nil, "", fmt.Errorf("discord webhook URL contains invalid control characters")
	}
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, "", fmt.Errorf("invalid discord webhook URL: %w", err)
	}
	if parsed.Scheme != "https" || parsed.User != nil || parsed.Fragment != "" {
		return nil, "", fmt.Errorf("discord webhook URL must be an HTTPS Discord URL")
	}
	switch strings.ToLower(parsed.Hostname()) {
	case "discord.com", "canary.discord.com", "ptb.discord.com", "discordapp.com":
	default:
		return nil, "", fmt.Errorf("discord webhook URL host is not allowed")
	}
	if parsed.Port() != "" {
		return nil, "", fmt.Errorf("discord webhook URL must not include a port")
	}
	match := discordWebhookPath.FindStringSubmatch(parsed.EscapedPath())
	if len(match) != 3 || match[1] == "" || match[2] == "" {
		return nil, "", fmt.Errorf("discord webhook URL path is invalid")
	}
	parsed.RawQuery = ""
	return parsed, match[1], nil
}

func validateDiscordMedia(media []MediaItem) []MediaValidationIssue {
	if len(media) > 10 {
		return []MediaValidationIssue{{
			Provider: providerDiscord,
			Severity: severityError,
			Message:  "Discord webhook messages support up to 10 attachments.",
		}}
	}
	return nil
}
