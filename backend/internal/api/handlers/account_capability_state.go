package handlers

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/uptrace/bun"
)

const accountCapabilityStateFreshness = platform.XCapabilityStateFreshness

func persistAccountCapabilityState(
	ctx context.Context,
	db *bun.DB,
	accountID string,
	result platform.AccountCapabilityResult,
) error {
	if db == nil || strings.TrimSpace(accountID) == "" || len(result.State) == 0 {
		return nil
	}
	// Preference data must survive capability refresh and reconnect. Never
	// persist messaging choice inside capability_state_json; it lives in
	// account_features.
	if _, ok := result.State["messages_enabled"]; ok {
		filtered := make(map[string]string, len(result.State))
		for k, v := range result.State {
			if k == "messages_enabled" {
				continue
			}
			filtered[k] = v
		}
		result.State = filtered
		if len(result.State) == 0 {
			return nil
		}
	}
	encoded, err := json.Marshal(result.State)
	if err != nil {
		return err
	}
	_, err = db.NewUpdate().
		Model((*models.SocialAccount)(nil)).
		Set("capability_state_json = ?", string(encoded)).
		Set("capability_checked_at = ?", time.Now().UTC()).
		Where("id = ?", accountID).
		Exec(ctx)
	return err
}

func accountLimitProfile(account models.SocialAccount) string {
	if account.Platform != capabilities.ProviderX {
		return ""
	}
	if platform.XStoredCapabilityHasPremiumLimits(account.CapabilityState, account.CapabilityCheckedAt, time.Now().UTC()) {
		return "x-premium"
	}
	return "standard"
}

func standardXPublishingCapabilities() platform.AccountCapabilityResult {
	return platform.XPublishingCapabilities(platform.XSubscriptionTypeUnknown)
}
