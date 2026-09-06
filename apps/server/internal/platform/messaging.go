package platform

import (
	"context"
	"time"
)

type MessagingSupport struct {
	Enabled           bool
	RequiredScopes    []string
	CanSend           bool
	RequiresOptIn     bool
	ReplyWindow       time.Duration
	ConversationModel string
	Unavailable       string
}

type MessageAttachment struct {
	Type      string `json:"type"`
	URL       string `json:"url"`
	Name      string `json:"name,omitempty"`
	MimeType  string `json:"mime_type,omitempty"`
	Thumbnail string `json:"thumbnail,omitempty"`
}

type ProviderMessage struct {
	ID              string
	Direction       string
	AuthorRemoteID  string
	Body            string
	Attachments     []MessageAttachment
	RemoteCreatedAt time.Time
}

type ProviderConversation struct {
	ID                   string
	CounterpartRemoteID  string
	CounterpartName      string
	CounterpartHandle    string
	CounterpartAvatarURL string
	LastMessageAt        time.Time
	LastMessagePreview   string
	LastRemoteMessageID  string
	UnreadCount          int
	ReplyWindowExpiresAt time.Time
	Messages             []ProviderMessage
}

type FetchMessagesRequest struct {
	AccountID, Cursor string
	Limit             int
}
type FetchMessagesResult struct {
	Conversations []ProviderConversation
	NextCursor    string
}
type SendMessageRequest struct {
	AccountID            string
	RemoteConversationID string
	CounterpartRemoteID  string
	CounterpartHandle    string
	ReplyToRemoteID      string
	Body                 string
}
type SendMessageResult struct {
	RemoteMessageID string
	CreatedAt       time.Time
}

// MessagingAdapter is the optional provider seam used by Messaging.
type MessagingAdapter interface {
	MessagingSupport() MessagingSupport
	FetchMessages(context.Context, string, FetchMessagesRequest) (FetchMessagesResult, error)
	SendMessage(context.Context, string, SendMessageRequest) (SendMessageResult, error)
}
