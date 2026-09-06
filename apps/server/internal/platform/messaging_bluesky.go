package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

const blueskyChatProxy = "did:web:api.bsky.chat#bsky_chat"

func (b *BlueskyAdapter) MessagingSupport() MessagingSupport {
	return MessagingSupport{
		Enabled: true, CanSend: true, RequiresOptIn: true,
		ConversationModel: "direct_message",
		Unavailable:       "Bluesky messages require an app-password session.",
	}
}

func (b *BlueskyAdapter) FetchMessages(ctx context.Context, accessToken string, input FetchMessagesRequest) (FetchMessagesResult, error) {
	query := url.Values{"limit": {"100"}}
	if input.Cursor != "" {
		query.Set("cursor", input.Cursor)
	}
	body, err := b.chatRequest(ctx, accessToken, http.MethodGet, "/xrpc/chat.bsky.convo.listConvos?"+query.Encode(), nil)
	if err != nil {
		return FetchMessagesResult{}, err
	}
	var list struct {
		Conversations []struct {
			ID      string `json:"id"`
			Members []struct {
				DID         string `json:"did"`
				Handle      string `json:"handle"`
				DisplayName string `json:"displayName"`
				Avatar      string `json:"avatar"`
			} `json:"members"`
			LastMessage struct {
				ID     string `json:"id"`
				Text   string `json:"text"`
				SentAt string `json:"sentAt"`
			} `json:"lastMessage"`
			UnreadCount int `json:"unreadCount"`
		} `json:"convos"`
		Cursor string `json:"cursor"`
	}
	if err := json.Unmarshal(body, &list); err != nil {
		return FetchMessagesResult{}, fmt.Errorf("decoding Bluesky conversations: %w", err)
	}
	result := FetchMessagesResult{NextCursor: list.Cursor}
	for _, conversation := range list.Conversations {
		messageQuery := url.Values{"convoId": {conversation.ID}, "limit": {"100"}}
		messageBody, err := b.chatRequest(ctx, accessToken, http.MethodGet, "/xrpc/chat.bsky.convo.getMessages?"+messageQuery.Encode(), nil)
		if err != nil {
			return FetchMessagesResult{}, err
		}
		var messageList struct {
			Messages []struct {
				ID     string `json:"id"`
				Text   string `json:"text"`
				SentAt string `json:"sentAt"`
				Sender struct {
					DID string `json:"did"`
				} `json:"sender"`
			} `json:"messages"`
		}
		if err := json.Unmarshal(messageBody, &messageList); err != nil {
			return FetchMessagesResult{}, fmt.Errorf("decoding Bluesky messages: %w", err)
		}
		messages := make([]ProviderMessage, 0, len(messageList.Messages))
		for _, message := range messageList.Messages {
			if message.ID == "" {
				continue
			}
			sentAt, _ := time.Parse(time.RFC3339Nano, message.SentAt)
			direction := "inbound"
			if message.Sender.DID == input.AccountID {
				direction = "outbound"
			}
			messages = append(messages, ProviderMessage{
				ID: message.ID, Direction: direction, AuthorRemoteID: message.Sender.DID,
				Body: message.Text, RemoteCreatedAt: sentAt,
			})
		}
		sort.Slice(messages, func(a, c int) bool { return messages[a].RemoteCreatedAt.Before(messages[c].RemoteCreatedAt) })
		var counterpart struct{ DID, Handle, Name, Avatar string }
		for _, member := range conversation.Members {
			if member.DID != input.AccountID {
				counterpart = struct{ DID, Handle, Name, Avatar string }{member.DID, member.Handle, member.DisplayName, member.Avatar}
				break
			}
		}
		lastAt, _ := time.Parse(time.RFC3339Nano, conversation.LastMessage.SentAt)
		result.Conversations = append(result.Conversations, ProviderConversation{
			ID: conversation.ID, CounterpartRemoteID: counterpart.DID,
			CounterpartName: counterpart.Name, CounterpartHandle: prefixHandle(counterpart.Handle),
			CounterpartAvatarURL: counterpart.Avatar, LastMessageAt: lastAt,
			LastMessagePreview: conversation.LastMessage.Text, LastRemoteMessageID: conversation.LastMessage.ID,
			UnreadCount: conversation.UnreadCount, Messages: messages,
		})
	}
	return result, nil
}

func (b *BlueskyAdapter) SendMessage(ctx context.Context, accessToken string, input SendMessageRequest) (SendMessageResult, error) {
	payload, _ := json.Marshal(map[string]any{
		"convoId": input.RemoteConversationID,
		"message": map[string]string{"text": strings.TrimSpace(input.Body)},
	})
	body, err := b.chatRequest(ctx, accessToken, http.MethodPost, "/xrpc/chat.bsky.convo.sendMessage", bytes.NewReader(payload))
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
	sentAt, _ := time.Parse(time.RFC3339Nano, result.SentAt)
	return SendMessageResult{RemoteMessageID: result.ID, CreatedAt: sentAt}, nil
}

func (b *BlueskyAdapter) chatRequest(ctx context.Context, accessToken, method, path string, body io.Reader) ([]byte, error) {
	headers := map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
		"atproto-proxy":     blueskyChatProxy,
	}
	if method == http.MethodPost {
		headers[headerContentType] = contentTypeJSON
	}
	response, err := DoRequest(ctx, method, b.pdsURL+path, body, headers)
	if err != nil {
		return nil, fmt.Errorf("bluesky messages: %w", err)
	}
	return response, nil
}
