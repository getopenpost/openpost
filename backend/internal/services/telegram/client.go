package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
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
	if err != nil || response.StatusCode < 200 || response.StatusCode >= 300 {
		return ErrProviderUnavailable
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
