package telegram

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/openpost/backend/internal/services/botingress"
)

type update struct {
	UpdateID     int64             `json:"update_id"`
	Message      *message          `json:"message"`
	ChannelPost  *message          `json:"channel_post"`
	MyChatMember *membershipUpdate `json:"my_chat_member"`
}

type chatReference struct {
	ID   int64  `json:"id"`
	Type string `json:"type"`
}

type membershipUpdate struct {
	Date          int64         `json:"date"`
	Chat          chatReference `json:"chat"`
	NewChatMember struct {
		Status string `json:"status"`
	} `json:"new_chat_member"`
}

type message struct {
	MessageID int64         `json:"message_id"`
	Date      int64         `json:"date"`
	Text      string        `json:"text"`
	Chat      chatReference `json:"chat"`
}

type UpdateNormalizer struct {
	botUsername string
}

func NewUpdateNormalizer(botUsername string) *UpdateNormalizer {
	return &UpdateNormalizer{botUsername: strings.TrimPrefix(strings.ToLower(strings.TrimSpace(botUsername)), "@")}
}

//nolint:gocyclo // Update-shape exclusivity and chat-type checks form one authentication-adjacent parser boundary.
func (normalizer *UpdateNormalizer) Normalize(body []byte) (botingress.NormalizedEvent, error) {
	var incoming update
	if err := json.Unmarshal(body, &incoming); err != nil || incoming.UpdateID <= 0 {
		return botingress.NormalizedEvent{}, ErrInvalidUpdate
	}

	if incoming.MyChatMember != nil {
		if incoming.Message != nil || incoming.ChannelPost != nil {
			return botingress.NormalizedEvent{}, ErrInvalidUpdate
		}
		return normalizeMembershipUpdate(incoming.UpdateID, incoming.MyChatMember)
	}

	item := incoming.Message
	if incoming.ChannelPost != nil {
		if item != nil {
			return botingress.NormalizedEvent{}, ErrInvalidUpdate
		}
		item = incoming.ChannelPost
	}
	if item == nil || item.Chat.ID == 0 || item.MessageID <= 0 {
		return botingress.NormalizedEvent{}, ErrInvalidUpdate
	}
	chatType := strings.ToLower(strings.TrimSpace(item.Chat.Type))
	if incoming.ChannelPost != nil && chatType != "channel" {
		return botingress.NormalizedEvent{}, ErrInvalidUpdate
	}
	if incoming.Message != nil && chatType != "group" && chatType != "supergroup" {
		return botingress.NormalizedEvent{}, ErrUnsupportedChat
	}
	credential, ok := normalizer.connectionCredential(item.Text)
	if !ok {
		// Ordinary group conversation is deliberately outside analytics and ingress.
		return botingress.NormalizedEvent{}, ErrInvalidUpdate
	}
	occurredAt := time.Now().UTC()
	if item.Date > 0 {
		occurredAt = time.Unix(item.Date, 0).UTC()
	}
	return botingress.NormalizedEvent{
		ProviderEventID:      strconv.FormatInt(incoming.UpdateID, 10),
		Kind:                 "telegram.connection_requested",
		SubjectReference:     strconv.FormatInt(item.Chat.ID, 10),
		ParentReference:      chatType,
		OccurredAt:           occurredAt,
		ConnectionCredential: credential,
	}, nil
}

func normalizeMembershipUpdate(updateID int64, membership *membershipUpdate) (botingress.NormalizedEvent, error) {
	chatType := strings.ToLower(strings.TrimSpace(membership.Chat.Type))
	status := strings.ToLower(strings.TrimSpace(membership.NewChatMember.Status))
	if membership.Chat.ID == 0 || (chatType != "channel" && chatType != "group" && chatType != "supergroup") || !validMembershipStatus(status) {
		return botingress.NormalizedEvent{}, ErrInvalidUpdate
	}
	occurredAt := time.Now().UTC()
	if membership.Date > 0 {
		occurredAt = time.Unix(membership.Date, 0).UTC()
	}
	return botingress.NormalizedEvent{
		ProviderEventID: strconv.FormatInt(updateID, 10), Kind: "telegram.membership_changed",
		SubjectReference: strconv.FormatInt(membership.Chat.ID, 10),
		ParentReference:  chatType + ":" + status, OccurredAt: occurredAt,
	}, nil
}

func validMembershipStatus(status string) bool {
	switch status {
	case "creator", "administrator", "member", "restricted", "left", "kicked":
		return true
	default:
		return false
	}
}

func (normalizer *UpdateNormalizer) connectionCredential(text string) (string, bool) {
	fields := strings.Fields(strings.TrimSpace(text))
	if len(fields) != 2 {
		return "", false
	}
	command := strings.ToLower(fields[0])
	if command != "/connect" {
		parts := strings.Split(command, "@")
		if len(parts) != 2 || parts[0] != "/connect" || normalizer.botUsername == "" || parts[1] != normalizer.botUsername {
			return "", false
		}
	}
	credential := strings.TrimSpace(fields[1])
	if !strings.HasPrefix(credential, "opbn1.") || len(credential) > 2048 {
		return "", false
	}
	return credential, true
}
