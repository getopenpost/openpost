package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

// MetaMessagingWebhookAdapter resolves official webhook messages to the same
// Graph conversation and message IDs used by REST and send responses.
// Intake authenticates and persists raw bytes before calling this interface.
type MetaMessagingWebhookAdapter interface {
	NormalizeMessagingWebhook(context.Context, string, string, json.RawMessage) (FetchMessageEventsResult, error)
}

func (f *FacebookAdapter) NormalizeMessagingWebhook(ctx context.Context, token, accountID string, event json.RawMessage) (FetchMessageEventsResult, error) {
	return (metaMessagingAdapter{graphURL: f.graphURL, platformParam: "messenger"}).normalizeWebhook(ctx, token, accountID, event)
}
func (i *InstagramAdapter) NormalizeMessagingWebhook(ctx context.Context, token, accountID string, event json.RawMessage) (FetchMessageEventsResult, error) {
	return i.messagingAdapter().normalizeWebhook(ctx, token, accountID, event)
}

type metaWebhookMessage struct {
	ID          string `json:"mid"`
	Text        string `json:"text"`
	IsEcho      bool   `json:"is_echo"`
	IsDeleted   bool   `json:"is_deleted"`
	Attachments []struct {
		Type    string `json:"type"`
		Payload struct {
			URL string `json:"url"`
		} `json:"payload"`
	} `json:"attachments"`
	// A story reply carries the story in reply_to instead of an attachment.
	ReplyTo struct {
		Story struct {
			URL string `json:"url"`
		} `json:"story"`
	} `json:"reply_to"`
}

type metaWebhookEvent struct {
	Sender struct {
		ID string `json:"id"`
	} `json:"sender"`
	Recipient struct {
		ID string `json:"id"`
	} `json:"recipient"`
	Timestamp int64               `json:"timestamp"`
	Message   *metaWebhookMessage `json:"message"`
	Read      *struct {
		Watermark int64  `json:"watermark"`
		MessageID string `json:"mid"`
	} `json:"read"`
	Reaction *struct {
		MessageID string `json:"mid"`
		Action    string `json:"action"`
		Emoji     string `json:"emoji"`
		Reaction  string `json:"reaction"`
	} `json:"reaction"`
}

func (m metaMessagingAdapter) normalizeWebhook(ctx context.Context, token, accountID string, raw json.RawMessage) (FetchMessageEventsResult, error) {
	var event metaWebhookEvent
	if json.Unmarshal(raw, &event) != nil {
		return FetchMessageEventsResult{}, errors.New("invalid Meta messaging event")
	}
	if event.Message == nil && event.Read == nil && event.Reaction == nil {
		return FetchMessageEventsResult{}, nil
	}
	if accountID == "" || (event.Sender.ID != accountID && event.Recipient.ID != accountID) {
		return FetchMessageEventsResult{}, errors.New("meta event recipient is not the bound account")
	}
	counterpart := event.Sender.ID
	if counterpart == accountID {
		counterpart = event.Recipient.ID
	}
	if counterpart == "" || counterpart == accountID {
		return FetchMessageEventsResult{}, errors.New("meta event counterpart unavailable")
	}
	conversation, err := m.webhookConversation(ctx, token, accountID, counterpart)
	if err != nil {
		return FetchMessageEventsResult{}, err
	}
	return event.batch(conversation, accountID)
}

func (m metaMessagingAdapter) webhookConversation(ctx context.Context, token, accountID, counterpart string) (ProviderConversation, error) {
	query := url.Values{"user_id": {counterpart}, "fields": {"id,participants,updated_time"}, "limit": {"1"}}
	if m.platformParam != "" {
		query.Set("platform", m.platformParam)
	}
	body, err := DoRequest(ctx, http.MethodGet, m.graphURL(accountID+"/conversations")+"?"+query.Encode(), nil, map[string]string{headerAuthorization: bearerPrefix + token})
	if err != nil {
		return ProviderConversation{}, err
	}
	var response struct {
		Data []struct {
			ID           string `json:"id"`
			Participants struct {
				Data []struct {
					ID       string `json:"id"`
					Name     string `json:"name"`
					Username string `json:"username"`
				} `json:"data"`
			} `json:"participants"`
		} `json:"data"`
	}
	if json.Unmarshal(body, &response) != nil {
		return ProviderConversation{}, errors.New("invalid Meta conversation lookup")
	}
	if len(response.Data) != 1 || response.Data[0].ID == "" {
		return ProviderConversation{}, errors.New("meta conversation is not available yet")
	}
	remote := response.Data[0]
	conversation := ProviderConversation{ID: remote.ID, CounterpartRemoteID: counterpart, Partial: true}
	for _, participant := range remote.Participants.Data {
		if participant.ID == counterpart {
			conversation.CounterpartName = participant.Name
			conversation.CounterpartHandle = prefixHandle(participant.Username)
		}
	}
	return conversation, nil
}

func (event metaWebhookEvent) batch(conversation ProviderConversation, accountID string) (FetchMessageEventsResult, error) {
	result := FetchMessageEventsResult{}
	if event.Message != nil {
		message := event.Message
		if message.ID == "" {
			return FetchMessageEventsResult{}, errors.New("missing Meta message identity")
		}
		if message.IsDeleted {
			result.DeletedMessages = []DeletedProviderMessage{{ConversationID: conversation.ID, MessageID: message.ID}}
		} else {
			if err := event.applyMessage(&conversation, accountID); err != nil {
				return FetchMessageEventsResult{}, err
			}
		}
	}
	if event.Read != nil {
		read := ProviderReadState{ConversationID: conversation.ID, MessageID: event.Read.MessageID, ActorRemoteID: event.Sender.ID}
		if event.Read.Watermark > 0 {
			read.ReadAt = time.UnixMilli(event.Read.Watermark).UTC()
		}
		result.ReadStates = append(result.ReadStates, read)
	}
	if event.Reaction != nil {
		reaction := event.Reaction
		if reaction.MessageID == "" || (reaction.Action != "react" && reaction.Action != "unreact") {
			return FetchMessageEventsResult{}, fmt.Errorf("unsupported Meta reaction event")
		}
		result.Reactions = append(result.Reactions, ProviderMessageReaction{ConversationID: conversation.ID, MessageID: reaction.MessageID, ActorRemoteID: event.Sender.ID, Value: firstNonEmptyString(reaction.Emoji, reaction.Reaction), Deleted: reaction.Action == "unreact"})
	}
	result.Conversations = []ProviderConversation{conversation}
	return result, nil
}

func (event metaWebhookEvent) applyMessage(conversation *ProviderConversation, accountID string) error {
	direction := "inbound"
	if event.Sender.ID == accountID {
		direction = "outbound"
	}
	if event.Message.IsEcho && direction != "outbound" {
		return errors.New("meta echo sender does not match bound account")
	}
	if event.Timestamp <= 0 {
		return errors.New("missing Meta message timestamp")
	}
	at := time.UnixMilli(event.Timestamp).UTC()
	message := ProviderMessage{ID: event.Message.ID, Body: event.Message.Text, Direction: direction, AuthorRemoteID: event.Sender.ID, RemoteCreatedAt: at}
	for _, attachment := range event.Message.Attachments {
		if attachment.Payload.URL != "" {
			message.Attachments = append(message.Attachments, MessageAttachment{Type: attachment.Type, URL: attachment.Payload.URL})
		}
	}
	if story := event.Message.ReplyTo.Story.URL; story != "" {
		message.Attachments = append(message.Attachments, MessageAttachment{Type: "story_reply", URL: story})
	}
	conversation.Messages = []ProviderMessage{message}
	conversation.LastMessageAt = at
	conversation.LastMessagePreview = message.Body
	conversation.LastRemoteMessageID = message.ID
	if direction == "inbound" {
		conversation.ReplyWindowExpiresAt = at.Add(24 * time.Hour)
	}
	return nil
}
