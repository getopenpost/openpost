package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	blueskyChatProxy       = "did:web:api.bsky.chat#bsky_chat"
	blueskyChatMessageView = "chat.bsky.convo.defs#messageView"
)

func (b *BlueskyAdapter) MessagingSupport() MessagingSupport {
	return MessagingSupport{
		Enabled: true, CanSend: true, RequiresOptIn: true,
		ConversationModel: "direct_message",
		Unavailable:       "Bluesky messages require an app-password session.",
	}
}

func (b *BlueskyAdapter) FetchMessages(ctx context.Context, accessToken string, input FetchMessagesRequest) (FetchMessagesResult, error) {
	limit := input.Limit
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	query := url.Values{"limit": {fmt.Sprint(limit)}}
	if input.Cursor != "" {
		query.Set("cursor", input.Cursor)
	}
	body, err := b.chatRequest(ctx, input.AccountID, accessToken, http.MethodGet, "/xrpc/chat.bsky.convo.listConvos?"+query.Encode(), nil)
	if err != nil {
		return FetchMessagesResult{}, err
	}
	var list struct {
		Conversations []blueskyChatConversation `json:"convos"`
		Cursor        string                    `json:"cursor"`
	}
	if err := json.Unmarshal(body, &list); err != nil {
		return FetchMessagesResult{}, fmt.Errorf("decoding Bluesky conversations: %w", err)
	}
	result := FetchMessagesResult{NextCursor: list.Cursor}
	for _, remote := range list.Conversations {
		convo := remote.provider(input.AccountID)
		if remote.LastMessage.ID != "" && (remote.LastMessage.Type == "" || remote.LastMessage.Type == blueskyChatMessageView) {
			convo.Messages = []ProviderMessage{remote.LastMessage.provider(input.AccountID)}
		}
		result.Conversations = append(result.Conversations, convo)
	}
	return result, nil
}

func (b *BlueskyAdapter) SendMessage(ctx context.Context, accessToken string, input SendMessageRequest) (SendMessageResult, error) {
	payload, _ := json.Marshal(map[string]any{
		"convoId": input.RemoteConversationID,
		"message": map[string]string{"text": strings.TrimSpace(input.Body)},
	})
	body, err := b.chatRequest(ctx, input.AccountID, accessToken, http.MethodPost, "/xrpc/chat.bsky.convo.sendMessage", bytes.NewReader(payload))
	if err != nil {
		return SendMessageResult{}, err
	}
	var result struct {
		ID     string `json:"id"`
		SentAt string `json:"sentAt"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return SendMessageResult{}, fmt.Errorf("decoding Bluesky sent message: %w", err)
	}
	sentAt := ProviderTime(result.SentAt)
	return SendMessageResult{RemoteMessageID: result.ID, CreatedAt: sentAt}, nil
}

const blueskyChatHostTTL = time.Hour

type blueskyChatHost struct {
	adapter *BlueskyAdapter
	expires time.Time
}

// chatAdapter returns the adapter that serves an account's chat requests. The
// bsky.social entryway answers proxied chat.bsky methods with 501
// MethodNotImplemented, so Bluesky-hosted accounts call the PDS host named in
// their DID document. An adapter for any other PDS already addresses it.
func (b *BlueskyAdapter) chatAdapter(ctx context.Context, did string) (*BlueskyAdapter, error) {
	if b.pdsURL != BlueskyDefaultPDSURL {
		return b, nil
	}
	if !strings.HasPrefix(did, "did:") {
		return nil, fmt.Errorf("bluesky chat requires the account DID")
	}
	if cached, ok := b.chatHosts.Load(did); ok {
		if host := cached.(blueskyChatHost); time.Now().Before(host.expires) {
			return host.adapter, nil
		}
	}
	documentURL, err := blueskyDIDDocumentURL(did)
	if err != nil {
		return nil, err
	}
	resolveCtx, cancel := context.WithTimeout(ctx, blueskyResolveTimeout)
	defer cancel()
	policy := blueskyPDSPolicy()
	document, err := blueskyGuardedGet(resolveCtx, blueskyPDSHTTPClient(policy), policy, documentURL)
	if err != nil {
		return nil, fmt.Errorf("fetching bluesky did document for chat: %w", err)
	}
	endpoint, err := blueskyPDSEndpoint(document, did, "")
	if err != nil {
		return nil, err
	}
	adapter := NewResolvedBlueskyAdapter(endpoint)
	b.chatHosts.Store(did, blueskyChatHost{adapter: adapter, expires: time.Now().Add(blueskyChatHostTTL)})
	return adapter, nil
}

func (b *BlueskyAdapter) chatRequest(ctx context.Context, accountDID, accessToken, method, path string, body io.Reader) ([]byte, error) {
	target, err := b.chatAdapter(ctx, accountDID)
	if err != nil {
		return nil, fmt.Errorf("bluesky messages: %w", err)
	}
	headers := map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
		"atproto-proxy":     blueskyChatProxy,
	}
	if method == http.MethodPost {
		headers[headerContentType] = contentTypeJSON
	}
	response, err := target.doRequest(ctx, method, target.pdsURL+path, body, headers)
	if err != nil {
		return nil, fmt.Errorf("bluesky messages: %w", err)
	}
	return response, nil
}
