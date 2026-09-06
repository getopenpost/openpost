package telegram

import (
	"context"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/providerreadiness"
)

func (*Service) AnalyticsSupport() platform.AnalyticsSupport {
	return platform.AnalyticsSupport{
		Account: true, Content: false,
		ContentUnavailable: "Telegram reactions arrive through authenticated updates; the Bot API does not expose post views or history reads.",
	}
}

func (*Service) UsesProviderToken() bool { return false }

func (service *Service) FetchAccountAnalytics(ctx context.Context, _ string, input platform.AccountAnalyticsRequest) (platform.AnalyticsValues, error) {
	measurements, err := service.FetchAccountAnalyticsMeasurements(ctx, "", input)
	if err != nil {
		return nil, err
	}
	values, _, err := measurements.ValuesAndMetadata(capabilities.ProviderTelegram)
	return values, err
}

func (service *Service) FetchAccountAnalyticsMeasurements(ctx context.Context, _ string, input platform.AccountAnalyticsRequest) (platform.AnalyticsMeasurements, error) {
	var account models.SocialAccount
	if service.readiness == nil || service.db == nil || service.db.NewSelect().Model(&account).
		Where("platform = ? AND account_id = ? AND is_active = ?", capabilities.ProviderTelegram, input.AccountID, true).Scan(ctx) != nil ||
		!service.readiness.DecideAccountOperation(
			ctx, account, providerreadiness.OperationAnalytics, providerreadiness.ExecutionIntentProduction,
		).AnalyticsReady {
		return nil, platform.NewAnalyticsError(platform.AnalyticsStatusPermissionRequired, "telegram_analytics_readiness_blocked")
	}
	counter, ok := service.api.(MemberCountBotAPI)
	if !ok {
		return nil, platform.NewAnalyticsError(platform.AnalyticsStatusUnsupported, "telegram_member_count_unavailable")
	}
	count, err := counter.GetChatMemberCount(ctx, input.AccountID)
	if err != nil {
		return nil, err
	}
	return platform.AnalyticsMeasurements{
		platform.MetricMembers: {
			Value: max(0, count),
			AnalyticsMetricMetadata: platform.AnalyticsMetricMetadata{
				Unit: platform.AnalyticsMetricUnitCount, Aggregation: platform.AnalyticsMetricAggregationCurrentSnapshot,
				Source: capabilities.ProviderTelegram,
			},
		},
	}, nil
}

func (*Service) FetchContentAnalytics(context.Context, string, platform.ContentAnalyticsRequest) (platform.AnalyticsValues, error) {
	return nil, platform.NewAnalyticsError(platform.AnalyticsStatusUnsupported, "telegram_content_reads_unavailable")
}

func (*Service) FetchContentAnalyticsMeasurements(context.Context, string, platform.ContentAnalyticsRequest) (platform.AnalyticsMeasurements, error) {
	return nil, platform.NewAnalyticsError(platform.AnalyticsStatusUnsupported, "telegram_content_reads_unavailable")
}

var _ platform.AnalyticsAdapter = (*Service)(nil)
var _ platform.SemanticAnalyticsAdapter = (*Service)(nil)
