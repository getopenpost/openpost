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
	ID          string `json:"id"`
	URL         string `json:"url"`
	Visibility  string `json:"visibility"`
	InReplyToID string `json:"in_reply_to_id"`
	Content     string `json:"content"`
	CreatedAt   string `json:"created_at"`
	EditedAt    string `json:"edited_at"`
	Favourited  bool   `json:"favourited"`
	Account     struct {
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

type mastodonMessageConversation struct {
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

func (m *MastodonAdapter) FetchMessages(ctx context.Context, accessToken string, input FetchMessagesRequest) (FetchMessagesResult, error) {
	limit := input.Limit
	if limit <= 0 || limit > 40 {
		limit = 40
	}
	query := url.Values{"limit": {fmt.Sprint(limit)}}
	if input.Cursor != "" {
		query.Set("max_id", input.Cursor)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, m.compat.instanceURL+"/api/v1/conversations?"+query.Encode(), nil)
	if err != nil {
		return FetchMessagesResult{}, err
	}
	request.Header.Set(headerAuthorization, bearerPrefix+accessToken)
	response, err := httpClient.Do(request)
	if err != nil {
		return FetchMessagesResult{}, sanitizeTransportError(err)
	}
	defer response.Body.Close()
	body, err := readProviderBody(response)
	if err != nil {
		return FetchMessagesResult{}, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return FetchMessagesResult{}, NewHTTPError(response.StatusCode, response.Header, body)
	}
	next := ""
	for _, link := range strings.Split(response.Header.Get("Link"), ",") {
		target, params, ok := strings.Cut(link, ";")
		if !ok || !strings.Contains(params, `rel="next"`) {
			continue
		}
		remote, parseErr := url.Parse(strings.Trim(strings.TrimSpace(target), "<>"))
		if parseErr == nil {
			next = remote.Query().Get("max_id")
		}
	}

	var list []mastodonMessageConversation
	if err := json.Unmarshal(body, &list); err != nil {
		return FetchMessagesResult{}, fmt.Errorf("decoding Mastodon conversations: %w", err)
	}
	result, err := m.hydrateMessageConversations(ctx, accessToken, input.AccountID, list)
	result.NextCursor = next
	return result, err
}

func (m *MastodonAdapter) hydrateMessageConversations(ctx context.Context, accessToken, accountID string, list []mastodonMessageConversation) (FetchMessagesResult, error) {
	result := FetchMessagesResult{}
	for _, conversation := range list {
		statuses := []mastodonMessageStatus{conversation.LastStatus}
		if conversation.LastStatus.ID != "" {
			contextBody, contextErr := DoRequest(ctx, http.MethodGet, m.compat.instanceURL+"/api/v1/statuses/"+url.PathEscape(conversation.LastStatus.ID)+"/context", nil, map[string]string{
				headerAuthorization: bearerPrefix + accessToken,
			})
			if contextErr != nil {
				return FetchMessagesResult{}, contextErr
			}
			var statusContext struct {
				Ancestors   []mastodonMessageStatus `json:"ancestors"`
				Descendants []mastodonMessageStatus `json:"descendants"`
			}
			if err := json.Unmarshal(contextBody, &statusContext); err != nil {
				return FetchMessagesResult{}, fmt.Errorf("decoding Mastodon message context: %w", err)
			}
			statuses = make([]mastodonMessageStatus, 0, len(statusContext.Ancestors)+1+len(statusContext.Descendants))
			statuses = append(statuses, statusContext.Ancestors...)
			statuses = append(statuses, conversation.LastStatus)
			statuses = append(statuses, statusContext.Descendants...)
		}
		counterpartID, counterpartHandle, counterpartName, counterpartAvatar := "", "", "", ""
		for _, account := range conversation.Accounts {
			if account.ID != accountID {
				counterpartID, counterpartHandle = account.ID, prefixHandle(account.Acct)
				counterpartName, counterpartAvatar = account.DisplayName, account.Avatar
				break
			}
		}
		messages := make([]ProviderMessage, 0, len(statuses))
		for _, status := range statuses {
			if status.ID == "" || status.Visibility != "direct" {
				continue
			}
			createdAt := ProviderTime(status.CreatedAt)
			direction := "inbound"
			if status.Account.ID == accountID {
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
		lastAt := ProviderTime(conversation.LastStatus.CreatedAt)
		result.Conversations = append(result.Conversations, ProviderConversation{
			ID: conversation.ID, CounterpartRemoteID: counterpartID,
			CounterpartHandle: counterpartHandle, CounterpartName: counterpartName,
			CounterpartAvatarURL: counterpartAvatar, LastMessageAt: lastAt,
			LastMessagePreview:  mastodonPlainText(conversation.LastStatus.Content),
			LastRemoteMessageID: conversation.LastStatus.ID, UnreadCount: boolToCount(conversation.Unread), UnreadCountKnown: true,
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
