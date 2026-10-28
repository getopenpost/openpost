package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
)

var ErrMessageBootstrapCursorRequired = errors.New("provider log did not supply a bootstrap cursor")

type blueskyChatReaction struct {
	Value  string `json:"value"`
	Sender struct {
		DID string `json:"did"`
	} `json:"sender"`
}

type blueskyChatMessage struct {
	Reactions []blueskyChatReaction `json:"reactions"`
	Type      string                `json:"$type"`
	ID        string                `json:"id"`
	Text      string                `json:"text"`
	SentAt    string                `json:"sentAt"`
	Sender    struct {
		DID string `json:"did"`
	} `json:"sender"`
}

type blueskyChatConversation struct {
	ID      string `json:"id"`
	Members []struct {
		DID         string `json:"did"`
		Handle      string `json:"handle"`
		DisplayName string `json:"displayName"`
		Avatar      string `json:"avatar"`
	} `json:"members"`
	LastMessage blueskyChatMessage `json:"lastMessage"`
	UnreadCount int                `json:"unreadCount"`
}

func (c blueskyChatConversation) provider(accountID string) ProviderConversation {
	at := ProviderTime(c.LastMessage.SentAt)
	result := ProviderConversation{ID: c.ID, LastMessageAt: at, LastRemoteMessageID: c.LastMessage.ID, UnreadCount: c.UnreadCount, UnreadCountKnown: true}
	if c.LastMessage.Type == "" || c.LastMessage.Type == blueskyChatMessageView {
		result.LastMessagePreview = c.LastMessage.Text
	}
	for _, member := range c.Members {
		if member.DID != accountID {
			result.CounterpartRemoteID = member.DID
			result.CounterpartName = member.DisplayName
			result.CounterpartHandle = prefixHandle(member.Handle)
			result.CounterpartAvatarURL = member.Avatar
			break
		}
	}
	return result
}

func (m blueskyChatMessage) provider(accountID string) ProviderMessage {
	at := ProviderTime(m.SentAt)
	direction := "inbound"
	if m.Sender.DID == accountID {
		direction = "outbound"
	}
	result := ProviderMessage{ID: m.ID, Direction: direction, AuthorRemoteID: m.Sender.DID, Body: m.Text, RemoteCreatedAt: at, ReactionsKnown: true}
	for _, reaction := range m.Reactions {
		result.Reactions = append(result.Reactions, ProviderMessageReaction{MessageID: m.ID, ActorRemoteID: reaction.Sender.DID, Value: reaction.Value})
	}
	return result
}

// FetchMessageEvents consumes one bounded prefix of the official account log.
// getLog has no limit argument. A local prefix checkpoints its final revision,
// so unprocessed events on the server page are replayed on the next request.
type blueskyChatLog struct {
	Type           string             `json:"$type"`
	Rev            string             `json:"rev"`
	ConversationID string             `json:"convoId"`
	Message        blueskyChatMessage `json:"message"`
	Reaction       struct {
		Value  string `json:"value"`
		Sender struct {
			DID string `json:"did"`
		} `json:"sender"`
	} `json:"reaction"`
}

func (b *BlueskyAdapter) FetchMessageEvents(ctx context.Context, token string, input FetchMessageEventsRequest) (FetchMessageEventsResult, error) {
	path := "/xrpc/chat.bsky.convo.getLog"
	if input.Cursor != "" {
		path += "?" + url.Values{"cursor": {input.Cursor}}.Encode()
	}
	body, err := b.chatRequest(ctx, token, http.MethodGet, path, nil)
	if err != nil {
		return FetchMessageEventsResult{}, err
	}
	var response struct {
		Cursor string           `json:"cursor"`
		Logs   []blueskyChatLog `json:"logs"`
	}
	if err = json.Unmarshal(body, &response); err != nil {
		return FetchMessageEventsResult{}, fmt.Errorf("decoding Bluesky log: %w", err)
	}
	if input.Cursor == "" {
		if response.Cursor == "" {
			return FetchMessageEventsResult{}, ErrMessageBootstrapCursorRequired
		}
		return FetchMessageEventsResult{NextCursor: response.Cursor, Bootstrap: true}, nil
	}
	limit := input.Limit
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	logs := response.Logs
	if len(logs) > limit {
		logs = logs[:limit]
	}
	result := FetchMessageEventsResult{NextCursor: input.Cursor, HasMore: len(logs) > 0}
	if len(logs) > 0 {
		result.NextCursor = logs[len(logs)-1].Rev
		if result.NextCursor == "" || result.NextCursor == input.Cursor {
			return FetchMessageEventsResult{}, errors.New("bluesky log cursor did not advance")
		}
	}
	return b.hydrateMessageLog(ctx, token, input.AccountID, logs, result)
}

type blueskyMessageLogBatch struct {
	result   FetchMessageEventsResult
	touched  map[string]bool
	removed  map[string]bool
	messages map[string][]ProviderMessage
}

func (batch *blueskyMessageLogBatch) apply(event blueskyChatLog, accountID string) {
	cid := event.ConversationID
	if cid == "" {
		return
	}
	kind := strings.TrimPrefix(event.Type, "chat.bsky.convo.defs#")
	switch kind {
	case "logLeaveConvo":
		batch.removed[cid] = true
		delete(batch.touched, cid)
		delete(batch.messages, cid)
	case "logBeginConvo", "logAcceptConvo":
		delete(batch.removed, cid)
		batch.touched[cid] = true
	case "logCreateMessage":
		batch.touched[cid] = true
		batch.createMessage(cid, event.Message, accountID)
	case "logDeleteMessage":
		batch.touched[cid] = true
		batch.result.DeletedMessages = append(batch.result.DeletedMessages, DeletedProviderMessage{ConversationID: cid, MessageID: event.Message.ID})
	case "logReadMessage", "logReadConvo":
		batch.touched[cid] = true
		batch.result.ReadStates = append(batch.result.ReadStates, ProviderReadState{ConversationID: cid, MessageID: event.Message.ID, ActorRemoteID: accountID})
	case "logAddReaction", "logRemoveReaction":
		batch.result.Reactions = append(batch.result.Reactions, ProviderMessageReaction{ConversationID: cid, MessageID: event.Message.ID, ActorRemoteID: event.Reaction.Sender.DID, Value: event.Reaction.Value, Deleted: kind == "logRemoveReaction"})
	default:
		// Refresh metadata for unknown kinds without materializing blank messages.
		batch.touched[cid] = true
	}
}

func (batch *blueskyMessageLogBatch) createMessage(cid string, message blueskyChatMessage, accountID string) {
	if message.ID == "" {
		return
	}
	switch message.Type {
	case "chat.bsky.convo.defs#deletedMessageView":
		batch.result.DeletedMessages = append(batch.result.DeletedMessages, DeletedProviderMessage{ConversationID: cid, MessageID: message.ID})
	case "", blueskyChatMessageView:
		batch.messages[cid] = append(batch.messages[cid], message.provider(accountID))
	}
}

func (b *BlueskyAdapter) hydrateMessageLog(ctx context.Context, token, accountID string, logs []blueskyChatLog, result FetchMessageEventsResult) (FetchMessageEventsResult, error) {
	batch := blueskyMessageLogBatch{result: result, touched: map[string]bool{}, removed: map[string]bool{}, messages: map[string][]ProviderMessage{}}
	for _, event := range logs {
		batch.apply(event, accountID)
	}
	for cid := range batch.removed {
		batch.result.DeletedConversations = append(batch.result.DeletedConversations, cid)
	}
	for cid := range batch.touched {
		if batch.removed[cid] {
			continue
		}
		data, err := b.chatRequest(ctx, token, http.MethodGet, "/xrpc/chat.bsky.convo.getConvo?"+url.Values{"convoId": {cid}}.Encode(), nil)
		if err != nil {
			var status *HTTPError
			if errors.As(err, &status) && status.Code == "InvalidConvo" && (status.StatusCode == http.StatusBadRequest || status.StatusCode == http.StatusNotFound) {
				batch.forgetConversation(cid)
				continue
			}
			return FetchMessageEventsResult{}, err
		}
		var response struct {
			Conversation blueskyChatConversation `json:"convo"`
		}
		if err = json.Unmarshal(data, &response); err != nil {
			return FetchMessageEventsResult{}, fmt.Errorf("decoding Bluesky conversation: %w", err)
		}
		if response.Conversation.ID != cid {
			return FetchMessageEventsResult{}, errors.New("bluesky conversation identity mismatch")
		}
		convo := response.Conversation.provider(accountID)
		convo.Messages = batch.messages[cid]
		batch.result.Conversations = append(batch.result.Conversations, convo)
	}
	return batch.result, nil
}

func (batch *blueskyMessageLogBatch) forgetConversation(cid string) {
	batch.result.DeletedConversations = append(batch.result.DeletedConversations, cid)
	batch.result.ReadStates = slices.DeleteFunc(batch.result.ReadStates, func(state ProviderReadState) bool { return state.ConversationID == cid })
	batch.result.Reactions = slices.DeleteFunc(batch.result.Reactions, func(reaction ProviderMessageReaction) bool { return reaction.ConversationID == cid })
	batch.result.DeletedMessages = slices.DeleteFunc(batch.result.DeletedMessages, func(message DeletedProviderMessage) bool { return message.ConversationID == cid })
}

func (b *BlueskyAdapter) FetchMessageHistory(ctx context.Context, token string, input FetchMessageHistoryRequest) (FetchMessageHistoryResult, error) {
	limit := input.Limit
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	query := url.Values{"convoId": {input.ConversationID}, "limit": {fmt.Sprint(limit)}}
	if input.Cursor != "" {
		query.Set("cursor", input.Cursor)
	}
	body, err := b.chatRequest(ctx, token, http.MethodGet, "/xrpc/chat.bsky.convo.getMessages?"+query.Encode(), nil)
	if err != nil {
		return FetchMessageHistoryResult{}, err
	}
	var response struct {
		Messages []blueskyChatMessage `json:"messages"`
		Cursor   string               `json:"cursor"`
	}
	if err = json.Unmarshal(body, &response); err != nil {
		return FetchMessageHistoryResult{}, fmt.Errorf("decoding Bluesky history: %w", err)
	}
	result := FetchMessageHistoryResult{NextCursor: response.Cursor}
	// Provider history is newest-first; stored messages are oldest-first.
	for i := len(response.Messages) - 1; i >= 0; i-- {
		m := response.Messages[i]
		if m.ID == "" {
			continue
		}
		switch m.Type {
		case "", blueskyChatMessageView:
			result.Messages = append(result.Messages, m.provider(input.AccountID))
		case "chat.bsky.convo.defs#deletedMessageView":
			result.DeletedMessages = append(result.DeletedMessages, DeletedProviderMessage{ConversationID: input.ConversationID, MessageID: m.ID})
		}
	}
	return result, nil
}
