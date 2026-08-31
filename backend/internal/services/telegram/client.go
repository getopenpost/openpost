package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/openpost/backend/internal/platform"
)

const defaultBotAPIBaseURL = "https://api.telegram.org"

var RequiredUpdateTypes = []string{
	"message",
	"channel_post",
	"my_chat_member",
	"message_reaction",
	"message_reaction_count",
}

type BotAPI interface {
	GetMe(context.Context) (User, error)
	GetChat(context.Context, string) (Chat, error)
	GetChatMember(context.Context, string, int64) (ChatMember, error)
	SetWebhook(context.Context, SetWebhookRequest) error
}

type User struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
}

type ChatPermissions struct {
	CanSendMessages bool `json:"can_send_messages"`
}

type Chat struct {
	ID          int64           `json:"id"`
	Type        string          `json:"type"`
	Title       string          `json:"title"`
	Username    string          `json:"username"`
	Permissions ChatPermissions `json:"permissions"`
}

type ChatMember struct {
	Status          string `json:"status"`
	IsMember        bool   `json:"is_member"`
	CanPostMessages bool   `json:"can_post_messages"`
	CanSendMessages bool   `json:"can_send_messages"`
}

type SetWebhookRequest struct {
	URL            string   `json:"url"`
	SecretToken    string   `json:"secret_token"`
	AllowedUpdates []string `json:"allowed_updates"`
}

type Message struct {
	MessageID int64 `json:"message_id"`
}

type OutboundMedia struct {
	Type     string
	MimeType string
	Filename string
	Reader   io.Reader
}

type OutboundRequest struct {
	Kind                string
	ChatID              string
	Text                string
	Caption             string
	DisableNotification bool
	ProtectContent      bool
	Media               []OutboundMedia
}

type PublishingBotAPI interface {
	Send(context.Context, OutboundRequest) ([]Message, error)
}

type HTTPBotAPI struct {
	token   string
	baseURL string
	client  *http.Client
}

func NewHTTPBotAPI(token string, client *http.Client) *HTTPBotAPI {
	if client == nil {
		client = http.DefaultClient
	}
	return &HTTPBotAPI{token: strings.TrimSpace(token), baseURL: defaultBotAPIBaseURL, client: client}
}

func NewHTTPBotAPIForTest(token, baseURL string, client *http.Client) *HTTPBotAPI {
	api := NewHTTPBotAPI(token, client)
	api.baseURL = strings.TrimRight(baseURL, "/")
	return api
}

func (api *HTTPBotAPI) GetMe(ctx context.Context) (User, error) {
	var user User
	if err := api.call(ctx, "getMe", struct{}{}, &user); err != nil {
		return User{}, err
	}
	return user, nil
}

func (api *HTTPBotAPI) GetChat(ctx context.Context, chatID string) (Chat, error) {
	var chat Chat
	if err := api.call(ctx, "getChat", map[string]string{"chat_id": chatID}, &chat); err != nil {
		return Chat{}, err
	}
	return chat, nil
}

func (api *HTTPBotAPI) GetChatMember(ctx context.Context, chatID string, userID int64) (ChatMember, error) {
	var member ChatMember
	if err := api.call(ctx, "getChatMember", map[string]any{"chat_id": chatID, "user_id": userID}, &member); err != nil {
		return ChatMember{}, err
	}
	return member, nil
}

func (api *HTTPBotAPI) SetWebhook(ctx context.Context, request SetWebhookRequest) error {
	return api.call(ctx, "setWebhook", request, &struct{}{})
}

func (api *HTTPBotAPI) Send(ctx context.Context, request OutboundRequest) ([]Message, error) {
	if request.Kind == "message" {
		var message Message
		err := api.call(ctx, "sendMessage", map[string]any{
			"chat_id": request.ChatID, "text": request.Text,
			"disable_notification": request.DisableNotification, "protect_content": request.ProtectContent,
		}, &message)
		if err != nil {
			return nil, err
		}
		return []Message{message}, nil
	}
	method := map[string]string{"photo": "sendPhoto", "video": "sendVideo", "document": "sendDocument", "media_group": "sendMediaGroup"}[request.Kind]
	if method == "" || len(request.Media) == 0 {
		return nil, ErrProviderUnavailable
	}
	fields := map[string]string{
		"chat_id":              request.ChatID,
		"disable_notification": strconv.FormatBool(request.DisableNotification),
		"protect_content":      strconv.FormatBool(request.ProtectContent),
	}
	if request.Kind == "media_group" {
		items := make([]map[string]any, 0, len(request.Media))
		for index, media := range request.Media {
			item := map[string]any{"type": media.Type, "media": "attach://media_" + strconv.Itoa(index)}
			if index == 0 && request.Caption != "" {
				item["caption"] = request.Caption
			}
			items = append(items, item)
		}
		encoded, err := json.Marshal(items)
		if err != nil {
			return nil, ErrProviderUnavailable
		}
		fields["media"] = string(encoded)
	} else {
		fields[request.Kind] = "attach://media_0"
		if request.Caption != "" {
			fields["caption"] = request.Caption
		}
	}
	var messages []Message
	if request.Kind == "media_group" {
		if err := api.callMultipart(ctx, method, fields, request.Media, &messages); err != nil {
			return nil, err
		}
		return messages, nil
	}
	var message Message
	if err := api.callMultipart(ctx, method, fields, request.Media, &message); err != nil {
		return nil, err
	}
	return []Message{message}, nil
}

type botAPIEnvelope struct {
	OK     bool            `json:"ok"`
	Result json.RawMessage `json:"result"`
}

//nolint:gocyclo // Every provider transport failure collapses into one credential-safe error boundary.
func (api *HTTPBotAPI) call(ctx context.Context, method string, input, output any) error {
	if api == nil || api.client == nil || api.token == "" || api.baseURL == "" {
		return ErrProviderUnavailable
	}
	payload, err := json.Marshal(input)
	if err != nil {
		return ErrProviderUnavailable
	}
	// Telegram's Bot API requires the instance-owned token in its provider path.
	// Request URLs and transport errors are never returned or logged by this boundary.
	endpoint := api.baseURL + "/bot" + url.PathEscape(api.token) + "/" + method
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return ErrProviderUnavailable
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := api.client.Do(req)
	if err != nil {
		return ErrProviderUnavailable
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return ErrProviderUnavailable
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return platform.NewHTTPError(response.StatusCode, response.Header, body)
	}
	var envelope botAPIEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil || !envelope.OK {
		return ErrProviderUnavailable
	}
	if len(envelope.Result) == 0 || string(envelope.Result) == "true" {
		return nil
	}
	if err := json.Unmarshal(envelope.Result, output); err != nil {
		return ErrProviderUnavailable
	}
	return nil
}

//nolint:gocyclo // Streaming multipart setup and credential-safe error collapse share one transport boundary.
func (api *HTTPBotAPI) callMultipart(ctx context.Context, method string, fields map[string]string, media []OutboundMedia, output any) error {
	if api == nil || api.client == nil || api.token == "" || api.baseURL == "" {
		return ErrProviderUnavailable
	}
	reader, writer := io.Pipe()
	multipartWriter := multipart.NewWriter(writer)
	writeDone := make(chan error, 1)
	go func() {
		var writeErr error
		for name, value := range fields {
			if writeErr = multipartWriter.WriteField(name, value); writeErr != nil {
				break
			}
		}
		if writeErr == nil {
			for index, item := range media {
				filename := filepath.Base(strings.TrimSpace(item.Filename))
				if filename == "." || filename == "" {
					filename = "media-" + strconv.Itoa(index)
				}
				part, err := multipartWriter.CreateFormFile("media_"+strconv.Itoa(index), filename)
				if err != nil {
					writeErr = err
					break
				}
				if item.Reader == nil {
					writeErr = io.ErrUnexpectedEOF
					break
				}
				if _, err := io.Copy(part, item.Reader); err != nil {
					writeErr = err
					break
				}
			}
		}
		if closeErr := multipartWriter.Close(); writeErr == nil {
			writeErr = closeErr
		}
		_ = writer.CloseWithError(writeErr)
		writeDone <- writeErr
	}()

	endpoint := api.baseURL + "/bot" + url.PathEscape(api.token) + "/" + method
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, reader)
	if err != nil {
		_ = reader.Close()
		return ErrProviderUnavailable
	}
	req.Header.Set("Content-Type", multipartWriter.FormDataContentType())
	response, err := api.client.Do(req)
	if err != nil {
		_ = reader.Close()
		return ErrProviderUnavailable
	}
	defer response.Body.Close()
	if writeErr := <-writeDone; writeErr != nil {
		return ErrProviderUnavailable
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return ErrProviderUnavailable
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return platform.NewHTTPError(response.StatusCode, response.Header, body)
	}
	var envelope botAPIEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil || !envelope.OK || len(envelope.Result) == 0 {
		return ErrProviderUnavailable
	}
	if err := json.Unmarshal(envelope.Result, output); err != nil {
		return ErrProviderUnavailable
	}
	return nil
}
