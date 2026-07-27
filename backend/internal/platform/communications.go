package platform

import (
	"context"
	"time"
)

// EngagementSupport describes a provider's normalized comment and reply
// capabilities. It remains separate from publishing so providers can support
// collection without changing the core Adapter contract.
type EngagementSupport struct {
	Enabled        bool
	RequiredScopes []string
	CanReply       bool
	CanHide        bool
	CanDelete      bool
	Unavailable    string
}

type EngagementAdapter interface {
	CommentAdapter
	EngagementSupport() EngagementSupport
}

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
	AccountID string
	Cursor    string
	Limit     int
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

// MessagingAdapter is an optional extension for providers that expose a
// supported account inbox. Fetching and sending are always orchestrated by the
// durable communications service rather than page requests.
type MessagingAdapter interface {
	MessagingSupport() MessagingSupport
	FetchMessages(ctx context.Context, accessToken string, input FetchMessagesRequest) (FetchMessagesResult, error)
	SendMessage(ctx context.Context, accessToken string, input SendMessageRequest) (SendMessageResult, error)
}
