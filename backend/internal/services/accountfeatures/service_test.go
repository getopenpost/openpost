package accountfeatures

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
)

func TestDiscordAnalyticsSupportResolvesConnectionModesIndependently(t *testing.T) {
	webhook := platform.NewDiscordAdapter()
	bot := platform.NewDiscordBotAdapter("app", "secret", "bot-token", "https://openpost.test/callback")
	service := NewService(nil, map[string]platform.Adapter{
		"discord":         webhook,
		"discord:webhook": webhook,
		"discord:bot":     bot,
	}, nil)

	webhookAccount := models.SocialAccount{Platform: "discord", CapabilityState: `{"connection_type":"webhook"}`}
	webhookRequired, webhookMissing, webhookUnavailable, webhookSupported := service.supportFor(context.Background(), webhookAccount, FeatureAnalytics)
	if webhookSupported || len(webhookRequired) != 0 || len(webhookMissing) != 0 {
		t.Fatalf("Discord webhook readiness enabled bot analytics: required=%v missing=%v unavailable=%q", webhookRequired, webhookMissing, webhookUnavailable)
	}

	botAccount := models.SocialAccount{Platform: "discord", CapabilityState: `{"connection_type":"bot"}`}
	botRequired, botMissing, botUnavailable, botSupported := service.supportFor(context.Background(), botAccount, FeatureAnalytics)
	if !botSupported || len(botRequired) != 0 || len(botMissing) != 0 {
		t.Fatalf("Discord bot analytics is not independently available: required=%v missing=%v unavailable=%q", botRequired, botMissing, botUnavailable)
	}
}
