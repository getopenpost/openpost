package telegram

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/botingress"
)

type update struct {
	UpdateID             int64                `json:"update_id"`
	Message              *message             `json:"message"`
	ChannelPost          *message             `json:"channel_post"`
	MyChatMember         *membershipUpdate    `json:"my_chat_member"`
	MessageReactionCount *reactionCountUpdate `json:"message_reaction_count"`
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
	Caption   string        `json:"caption"`
	Chat      chatReference `json:"chat"`
	Photo     []struct{}    `json:"photo"`
	Video     *struct{}     `json:"video"`
}

type reactionCountUpdate struct {
	Chat      chatReference `json:"chat"`
	MessageID int64         `json:"message_id"`
	Date      int64         `json:"date"`
	Reactions []struct {
		TotalCount int64 `json:"total_count"`
	} `json:"reactions"`
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
	shapes := 0
	for _, present := range []bool{incoming.Message != nil, incoming.ChannelPost != nil, incoming.MyChatMember != nil, incoming.MessageReactionCount != nil} {
		if present {
			shapes++
		}
	}
	if shapes != 1 {
		return botingress.NormalizedEvent{}, ErrInvalidUpdate
	}
	if incoming.MyChatMember != nil {
		return normalizeMembershipUpdate(incoming.UpdateID, incoming.MyChatMember)
	}
	if incoming.MessageReactionCount != nil {
		return normalizeReactionCount(incoming.UpdateID, incoming.MessageReactionCount)
	}

	item := incoming.Message
	if incoming.ChannelPost != nil {
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
	if credential, ok := normalizer.connectionCredential(item.Text); ok {
		return botingress.NormalizedEvent{
			ProviderEventID: strconv.FormatInt(incoming.UpdateID, 10), Kind: "telegram.connection_requested",
			SubjectReference: strconv.FormatInt(item.Chat.ID, 10), ParentReference: chatType,
			OccurredAt: telegramUpdateTime(item.Date), ConnectionCredential: credential,
		}, nil
	}
	if incoming.Message != nil {
		// Ordinary group conversation is deliberately outside analytics and ingress.
		return botingress.NormalizedEvent{}, ErrInvalidUpdate
	}
	text := item.Text
	if text == "" {
		text = item.Caption
	}
	return botingress.NormalizedEvent{
		ProviderEventID: strconv.FormatInt(incoming.UpdateID, 10), Kind: "telegram.channel_post",
		SubjectReference: strconv.FormatInt(item.Chat.ID, 10), ParentReference: strconv.FormatInt(item.MessageID, 10),
		ContentProfile: telegramMessageProfile(item), ContentText: text, OccurredAt: telegramUpdateTime(item.Date),
	}, nil
}

func normalizeReactionCount(updateID int64, reaction *reactionCountUpdate) (botingress.NormalizedEvent, error) {
	chatType := strings.ToLower(strings.TrimSpace(reaction.Chat.Type))
	if reaction.Chat.ID == 0 || reaction.MessageID <= 0 || chatType != "channel" || len(reaction.Reactions) > 100 {
		return botingress.NormalizedEvent{}, ErrInvalidUpdate
	}
	var total int64
	for _, count := range reaction.Reactions {
		if count.TotalCount < 0 || total > (1<<63-1)-count.TotalCount {
			return botingress.NormalizedEvent{}, ErrInvalidUpdate
		}
		total += count.TotalCount
	}
	metrics, err := json.Marshal(platform.AnalyticsValues{platform.MetricReactions: total})
	if err != nil {
		return botingress.NormalizedEvent{}, ErrInvalidUpdate
	}
	return botingress.NormalizedEvent{
		ProviderEventID: strconv.FormatInt(updateID, 10), Kind: "telegram.reaction_count",
		SubjectReference: strconv.FormatInt(reaction.Chat.ID, 10), ParentReference: strconv.FormatInt(reaction.MessageID, 10),
		MetricsJSON: string(metrics), OccurredAt: telegramUpdateTime(reaction.Date),
	}, nil
}

func telegramMessageProfile(item *message) string {
	switch {
	case len(item.Photo) > 0:
		return models.ContentProfileImagePost
	case item.Video != nil:
		return models.ContentProfileShortVideo
	default:
		return models.ContentProfileShortText
	}
}

func telegramUpdateTime(unix int64) time.Time {
	if unix > 0 {
		return time.Unix(unix, 0).UTC()
	}
	return time.Now().UTC()
}

func normalizeMembershipUpdate(updateID int64, membership *membershipUpdate) (botingress.NormalizedEvent, error) {
	chatType := strings.ToLower(strings.TrimSpace(membership.Chat.Type))
	status := strings.ToLower(strings.TrimSpace(membership.NewChatMember.Status))
	if membership.Chat.ID == 0 || (chatType != "channel" && chatType != "group" && chatType != "supergroup") || !validMembershipStatus(status) {
		return botingress.NormalizedEvent{}, ErrInvalidUpdate
	}
	return botingress.NormalizedEvent{
		ProviderEventID: strconv.FormatInt(updateID, 10), Kind: "telegram.membership_changed",
		SubjectReference: strconv.FormatInt(membership.Chat.ID, 10),
		ParentReference:  chatType + ":" + status, OccurredAt: telegramUpdateTime(membership.Date),
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
