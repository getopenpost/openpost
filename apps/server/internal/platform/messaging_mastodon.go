package platform

import (
	"context"
	"encoding/json"
	"fmt"
	stdhtml "html"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
)

var mastodonHTMLTags = regexp.MustCompile(`<[^>]+>`)

type mastodonMessageStatus struct {
	ID         string `json:"id"`
	Content    string `json:"content"`
	CreatedAt  string `json:"created_at"`
	EditedAt   string `json:"edited_at"`
	Favourited bool   `json:"favourited"`
	Account    struct {
		ID          string `json:"id"`
		Acct        string `json:"acct"`
		DisplayName string `json:"display_name"`
		Avatar      string `json:"avatar"`
	} `json:"account"`
	Mentions []struct {
		ID   string `json:"id"`
		Acct string `json:"acct"`
	} `json:"mentions"`
	MediaAttachments []struct {
		Type        string `json:"type"`
		URL         string `json:"url"`
		PreviewURL  string `json:"preview_url"`
		Description string `json:"description"`
	} `json:"media_attachments"`
}

func (m *MastodonAdapter) MessagingSupport() MessagingSupport {
	return MessagingSupport{
		Enabled: true, CanSend: true, RequiresOptIn: true,
		ConversationModel: "direct_status",
		Unavailable:       "Mastodon direct conversations are direct-visibility posts. They are not end-to-end encrypted.",
	}
}

func (m *MastodonAdapter) FetchMessages(ctx context.Context, accessToken string, input FetchMessagesRequest) (FetchMessagesResult, error) {
	query := url.Values{"limit": {"40"}}
	if input.Cursor != "" {
		query.Set("max_id", input.Cursor)
	}
	body, err := DoRequest(ctx, http.MethodGet, m.instanceURL+"/api/v1/conversations?"+query.Encode(), nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return FetchMessagesResult{}, fmt.Errorf("fetching Mastodon conversations: %w", err)
	}
	var list []struct {
		ID         string                `json:"id"`
		Unread     bool                  `json:"unread"`
		LastStatus mastodonMessageStatus `json:"last_status"`
		Accounts   []struct {
			ID          string `json:"id"`
			Acct        string `json:"acct"`
			DisplayName string `json:"display_name"`
			Avatar      string `json:"avatar"`
		} `json:"accounts"`
	}
	if err := json.Unmarshal(body, &list); err != nil {
		return FetchMessagesResult{}, fmt.Errorf("decoding Mastodon conversations: %w", err)
	}
	result := FetchMessagesResult{}
	for _, conversation := range list {
		statuses := []mastodonMessageStatus{conversation.LastStatus}
		if conversation.LastStatus.ID != "" {
			contextBody, contextErr := DoRequest(ctx, http.MethodGet, m.instanceURL+"/api/v1/statuses/"+url.PathEscape(conversation.LastStatus.ID)+"/context", nil, map[string]string{
				headerAuthorization: bearerPrefix + accessToken,
			})
			if contextErr == nil {
				var statusContext struct {
					Ancestors   []mastodonMessageStatus `json:"ancestors"`
					Descendants []mastodonMessageStatus `json:"descendants"`
				}
				if json.Unmarshal(contextBody, &statusContext) == nil {
					statuses = make([]mastodonMessageStatus, 0, len(statusContext.Ancestors)+1+len(statusContext.Descendants))
					statuses = append(statuses, statusContext.Ancestors...)
					statuses = append(statuses, conversation.LastStatus)
					statuses = append(statuses, statusContext.Descendants...)
				}
			}
		}
		counterpartID, counterpartHandle, counterpartName, counterpartAvatar := "", "", "", ""
		for _, account := range conversation.Accounts {
			if account.ID != input.AccountID {
				counterpartID, counterpartHandle = account.ID, prefixHandle(account.Acct)
				counterpartName, counterpartAvatar = account.DisplayName, account.Avatar
				break
			}
		}
		messages := make([]ProviderMessage, 0, len(statuses))
		for _, status := range statuses {
			if status.ID == "" {
				continue
			}
			createdAt, _ := time.Parse(time.RFC3339, status.CreatedAt)
			direction := "inbound"
			if status.Account.ID == input.AccountID {
				direction = "outbound"
			}
			attachments := make([]MessageAttachment, 0, len(status.MediaAttachments))
			for _, attachment := range status.MediaAttachments {
				attachments = append(attachments, MessageAttachment{
					Type: attachment.Type, URL: attachment.URL, Name: attachment.Description,
					Thumbnail: attachment.PreviewURL,
				})
			}
			messages = append(messages, ProviderMessage{
				ID: status.ID, Direction: direction, AuthorRemoteID: status.Account.ID,
				Body: mastodonPlainText(status.Content), Attachments: attachments, RemoteCreatedAt: createdAt,
			})
		}
		sort.Slice(messages, func(a, b int) bool { return messages[a].RemoteCreatedAt.Before(messages[b].RemoteCreatedAt) })
		lastAt, _ := time.Parse(time.RFC3339, conversation.LastStatus.CreatedAt)
		result.Conversations = append(result.Conversations, ProviderConversation{
			ID: conversation.ID, CounterpartRemoteID: counterpartID,
			CounterpartHandle: counterpartHandle, CounterpartName: counterpartName,
			CounterpartAvatarURL: counterpartAvatar, LastMessageAt: lastAt,
			LastMessagePreview:  mastodonPlainText(conversation.LastStatus.Content),
			LastRemoteMessageID: conversation.LastStatus.ID, UnreadCount: boolToCount(conversation.Unread),
			Messages: messages,
		})
	}
	return result, nil
}

func (m *MastodonAdapter) SendMessage(ctx context.Context, accessToken string, input SendMessageRequest) (SendMessageResult, error) {
	handle := strings.TrimSpace(strings.TrimPrefix(input.CounterpartHandle, "@"))
	body := strings.TrimSpace(input.Body)
	if handle != "" && !strings.Contains(body, "@"+handle) {
		body = "@" + handle + " " + body
	}
	result, err := m.Publish(ctx, accessToken, input.AccountID, &PublishRequest{
		Content: body, ReplyToID: input.ReplyToRemoteID,
		Settings: map[string]interface{}{"visibility": "direct"},
	})
	if err != nil {
		return SendMessageResult{}, err
	}
	return SendMessageResult{RemoteMessageID: result.ExternalID, CreatedAt: time.Now().UTC()}, nil
}

func mastodonPlainText(value string) string {
	return strings.TrimSpace(stdhtml.UnescapeString(mastodonHTMLTags.ReplaceAllString(value, "")))
}

func boolToCount(value bool) int {
	if value {
		return 1
	}
	return 0
}
