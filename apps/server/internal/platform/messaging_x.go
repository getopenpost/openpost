package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

func (x *XAdapter) MessagingSupport() MessagingSupport {
	return MessagingSupport{
		Enabled:           true,
		CanSend:           true,
		RequiresOptIn:     true,
		ConversationModel: "direct_message",
		Unavailable:       "The X app must have Direct Messages permission. Existing accounts may need to reconnect.",
	}
}

//nolint:gocyclo // X returns events and participant expansions separately; normalization joins both bounded sets.
func (x *XAdapter) FetchMessages(ctx context.Context, accessToken string, input FetchMessagesRequest) (FetchMessagesResult, error) {
	query := url.Values{
		"dm_event.fields": {"id,text,created_at,sender_id,dm_conversation_id,event_type"},
		"expansions":      {"sender_id"},
		"user.fields":     {"username,name,profile_image_url"},
		"max_results":     {"100"},
	}
	if input.Cursor != "" {
		query.Set("pagination_token", input.Cursor)
	}
	body, err := x.doSignedRequest(ctx, accessToken, http.MethodGet, x.apiURL("/2/dm_events")+"?"+query.Encode(), nil, nil)
	if err != nil {
		return FetchMessagesResult{}, fmt.Errorf("fetching X direct messages: %w", err)
	}
	var response struct {
		Data []struct {
			ID             string `json:"id"`
			Text           string `json:"text"`
			CreatedAt      string `json:"created_at"`
			SenderID       string `json:"sender_id"`
			ConversationID string `json:"dm_conversation_id"`
			EventType      string `json:"event_type"`
		} `json:"data"`
		Includes struct {
			Users []struct {
				ID              string `json:"id"`
				Username        string `json:"username"`
				Name            string `json:"name"`
				ProfileImageURL string `json:"profile_image_url"`
			} `json:"users"`
		} `json:"includes"`
		Meta struct {
			NextToken string `json:"next_token"`
		} `json:"meta"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return FetchMessagesResult{}, fmt.Errorf("decoding X direct messages: %w", err)
	}
	users := make(map[string]struct {
		Username, Name, Avatar string
	}, len(response.Includes.Users))
	for _, user := range response.Includes.Users {
		users[user.ID] = struct{ Username, Name, Avatar string }{user.Username, user.Name, user.ProfileImageURL}
	}
	byConversation := map[string][]ProviderMessage{}
	for _, event := range response.Data {
		if event.EventType != "" && event.EventType != "MessageCreate" {
			continue
		}
		createdAt, _ := time.Parse(time.RFC3339, event.CreatedAt)
		direction := "inbound"
		if event.SenderID == input.AccountID {
			direction = "outbound"
		}
		byConversation[event.ConversationID] = append(byConversation[event.ConversationID], ProviderMessage{
			ID: event.ID, Direction: direction, AuthorRemoteID: event.SenderID,
			Body: event.Text, RemoteCreatedAt: createdAt,
		})
	}
	missingCounterparts := make([]string, 0)
	seenMissing := map[string]struct{}{}
	for conversationID, messages := range byConversation {
		counterpartID := xCounterpartID(conversationID, input.AccountID, messages)
		if counterpartID == "" {
			continue
		}
		if _, ok := users[counterpartID]; ok {
			continue
		}
		if _, seen := seenMissing[counterpartID]; seen {
			continue
		}
		seenMissing[counterpartID] = struct{}{}
		missingCounterparts = append(missingCounterparts, counterpartID)
	}
	if len(missingCounterparts) > 0 {
		hydrated, err := x.fetchMessageUsers(ctx, accessToken, missingCounterparts)
		if err == nil {
			for id, profile := range hydrated {
				users[id] = profile
			}
		}
	}
	result := FetchMessagesResult{NextCursor: response.Meta.NextToken}
	for conversationID, messages := range byConversation {
		sort.Slice(messages, func(a, b int) bool { return messages[a].RemoteCreatedAt.Before(messages[b].RemoteCreatedAt) })
		counterpartID := xCounterpartID(conversationID, input.AccountID, messages)
		counterpart := users[counterpartID]
		last := messages[len(messages)-1]
		result.Conversations = append(result.Conversations, ProviderConversation{
			ID:                   conversationID,
			CounterpartRemoteID:  counterpartID,
			CounterpartName:      counterpart.Name,
			CounterpartHandle:    prefixHandle(counterpart.Username),
			CounterpartAvatarURL: counterpart.Avatar,
			LastMessageAt:        last.RemoteCreatedAt,
			LastMessagePreview:   last.Body,
			LastRemoteMessageID:  last.ID,
			Messages:             messages,
		})
	}
	return result, nil
}

func (x *XAdapter) fetchMessageUsers(ctx context.Context, accessToken string, ids []string) (map[string]struct {
	Username, Name, Avatar string
}, error) {
	query := url.Values{
		"ids":         {strings.Join(ids, ",")},
		"user.fields": {"username,name,profile_image_url"},
	}
	body, err := x.doSignedRequest(ctx, accessToken, http.MethodGet, x.apiURL("/2/users")+"?"+query.Encode(), nil, nil)
	if err != nil {
		return nil, fmt.Errorf("fetching X message participants: %w", err)
	}
	var response struct {
		Data []struct {
			ID              string `json:"id"`
			Username        string `json:"username"`
			Name            string `json:"name"`
			ProfileImageURL string `json:"profile_image_url"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decoding X message participants: %w", err)
	}
	users := make(map[string]struct {
		Username, Name, Avatar string
	}, len(response.Data))
	for _, user := range response.Data {
		users[user.ID] = struct{ Username, Name, Avatar string }{user.Username, user.Name, user.ProfileImageURL}
	}
	return users, nil
}

func (x *XAdapter) SendMessage(ctx context.Context, accessToken string, input SendMessageRequest) (SendMessageResult, error) {
	if input.RemoteConversationID == "" {
		return SendMessageResult{}, fmt.Errorf("x conversation id is required")
	}
	body, _ := json.Marshal(map[string]string{"text": strings.TrimSpace(input.Body)})
	response, err := x.doSignedRequest(ctx, accessToken, http.MethodPost,
		x.apiURL("/2/dm_conversations/")+url.PathEscape(input.RemoteConversationID)+"/messages",
		bytes.NewReader(body), map[string]string{headerContentType: contentTypeJSON})
	if err != nil {
		return SendMessageResult{}, fmt.Errorf("sending X direct message: %w", err)
	}
	var result struct {
		Data struct {
			ID string `json:"dm_event_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response, &result); err != nil {
		return SendMessageResult{}, fmt.Errorf("decoding X direct message: %w", err)
	}
	return SendMessageResult{RemoteMessageID: result.Data.ID, CreatedAt: time.Now().UTC()}, nil
}

func xCounterpartID(conversationID, ourID string, messages []ProviderMessage) string {
	for _, message := range messages {
		if message.AuthorRemoteID != "" && message.AuthorRemoteID != ourID {
			return message.AuthorRemoteID
		}
	}
	parts := strings.Split(conversationID, "-")
	if len(parts) == 2 {
		if parts[0] == ourID {
			return parts[1]
		}
		if parts[1] == ourID {
			return parts[0]
		}
	}
	return ""
}

func prefixHandle(handle string) string {
	handle = strings.TrimSpace(handle)
	if handle == "" || strings.HasPrefix(handle, "@") {
		return handle
	}
	return "@" + handle
}
