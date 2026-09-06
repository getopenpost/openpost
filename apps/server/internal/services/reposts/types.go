package reposts

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
)

const (
	JobTypeSweep    = jobregistry.TypeRepostSweep
	JobTypeEvaluate = jobregistry.TypeRepostEvaluate
	JobTypeExecute  = jobregistry.TypeRepostExecute

	ModeInherit = "inherit"
	ModeOff     = "off"
	ModeCustom  = "custom"

	ThresholdAll = "all"
	ThresholdAny = "any"

	RoleSource = "source"
	RoleTarget = "target"

	StatusPending   = "pending"
	StatusReady     = "ready"
	StatusSucceeded = "succeeded"
	StatusSkipped   = "skipped"
	StatusFailed    = "failed"
)

const (
	maxDelay            = 30 * 24 * time.Hour
	maxEvaluationWindow = 30 * 24 * time.Hour
	maxAccountsPerRule  = 50
	maxThreshold        = int64(1_000_000_000_000)
)

var supportedPlatforms = []string{"bluesky", "linkedin", "mastodon", "x"}

var ErrInvalidInput = errors.New("invalid repost input")

func invalidInputf(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalidInput, fmt.Sprintf(format, args...))
}

type Rule struct {
	DelaySeconds            int    `json:"delay_seconds" minimum:"0" maximum:"2592000" doc:"Wait after publishing before the first eligibility check"`
	EvaluationWindowSeconds int    `json:"evaluation_window_seconds" minimum:"900" maximum:"2592000" doc:"How long OpenPost may wait for engagement gates"`
	ThresholdMode           string `json:"threshold_mode" enum:"all,any" doc:"Require all configured thresholds or any one"`
	MinLikes                int64  `json:"min_likes" minimum:"0" doc:"Minimum likes; zero disables this gate"`
	MinComments             int64  `json:"min_comments" minimum:"0" doc:"Minimum comments; zero disables this gate"`
	MinReposts              int64  `json:"min_reposts" minimum:"0" doc:"Minimum reposts or shares; zero disables this gate"`
	MinViews                int64  `json:"min_views" minimum:"0" doc:"Minimum views; zero disables this gate"`
	RequirePlateau          bool   `json:"require_plateau" doc:"Wait until stored engagement has stopped changing"`
	PlateauChecks           int    `json:"plateau_checks" minimum:"2" maximum:"12" doc:"Consecutive unchanged analytics checks required"`
}

type Override struct {
	Mode             string   `json:"mode" enum:"inherit,off,custom" doc:"Use workspace rules, disable reposts, or use this post's custom rule"`
	TargetAccountIDs []string `json:"target_account_ids,omitempty" doc:"Target accounts for a custom override"`
	Rule             Rule     `json:"rule,omitempty" doc:"Custom timing and engagement gates"`
}

func (o Override) MarshalJSON() ([]byte, error) {
	if o.Mode == ModeInherit || o.Mode == ModeOff || o.Mode == "" {
		mode := o.Mode
		if mode == "" {
			mode = ModeInherit
		}
		return json.Marshal(struct {
			Mode string `json:"mode"`
		}{Mode: mode})
	}
	type overrideAlias Override
	return json.Marshal(overrideAlias(o))
}

type PolicyInput struct {
	ID               string   `json:"id,omitempty"`
	Name             string   `json:"name"`
	Enabled          bool     `json:"enabled"`
	SourceAccountIDs []string `json:"source_account_ids,omitempty" doc:"Empty means every compatible source account in this workspace"`
	TargetAccountIDs []string `json:"target_account_ids"`
	Rule             Rule     `json:"rule"`
}

type PolicyResponse struct {
	PolicyInput
	CreatedAt string `json:"created_at,omitempty"`
	UpdatedAt string `json:"updated_at,omitempty"`
}

type AccountOption struct {
	ID                string `json:"id"`
	WorkspaceID       string `json:"workspace_id"`
	WorkspaceName     string `json:"workspace_name"`
	Platform          string `json:"platform"`
	Username          string `json:"username"`
	AvatarURL         string `json:"avatar_url,omitempty"`
	InstanceURL       string `json:"instance_url,omitempty"`
	SupportsRepost    bool   `json:"supports_repost"`
	UnavailableReason string `json:"unavailable_reason,omitempty"`
	CrossWorkspace    bool   `json:"cross_workspace"`
	GrantRequired     bool   `json:"grant_required"`
	GrantActive       bool   `json:"grant_active"`
}

type GrantResponse struct {
	ID                  string `json:"id"`
	SourceWorkspaceID   string `json:"source_workspace_id"`
	SourceWorkspaceName string `json:"source_workspace_name"`
	TargetWorkspaceID   string `json:"target_workspace_id"`
	TargetWorkspaceName string `json:"target_workspace_name"`
	TargetAccountID     string `json:"target_account_id"`
	TargetUsername      string `json:"target_username"`
	Platform            string `json:"platform"`
	Direction           string `json:"direction" enum:"outbound,inbound"`
	CreatedAt           string `json:"created_at"`
}

type SettingsResponse struct {
	WorkspaceID        string           `json:"workspace_id"`
	CanManage          bool             `json:"can_manage"`
	SupportedPlatforms []string         `json:"supported_platforms"`
	Policies           []PolicyResponse `json:"policies"`
	Accounts           []AccountOption  `json:"accounts"`
	Grants             []GrantResponse  `json:"grants"`
}

type ruleSnapshot struct {
	PolicyName string `json:"policy_name,omitempty"`
	Rule       Rule   `json:"rule"`
}

func DefaultRule() Rule {
	return Rule{
		DelaySeconds:            int((24 * time.Hour).Seconds()),
		EvaluationWindowSeconds: int((7 * 24 * time.Hour).Seconds()),
		ThresholdMode:           ThresholdAll,
		PlateauChecks:           2,
	}
}

//nolint:gocyclo
func NormalizeRule(rule Rule) (Rule, error) {
	if rule.EvaluationWindowSeconds == 0 {
		rule.EvaluationWindowSeconds = DefaultRule().EvaluationWindowSeconds
	}
	if rule.ThresholdMode == "" {
		rule.ThresholdMode = ThresholdAll
	}
	if rule.PlateauChecks == 0 {
		rule.PlateauChecks = 2
	}
	if rule.DelaySeconds < 0 || time.Duration(rule.DelaySeconds)*time.Second > maxDelay {
		return Rule{}, invalidInputf("repost delay must be between 0 and 30 days")
	}
	window := time.Duration(rule.EvaluationWindowSeconds) * time.Second
	if window < 15*time.Minute || window > maxEvaluationWindow {
		return Rule{}, invalidInputf("repost evaluation window must be between 15 minutes and 30 days")
	}
	if rule.EvaluationWindowSeconds < rule.DelaySeconds {
		return Rule{}, invalidInputf("repost evaluation window cannot end before its delay")
	}
	if rule.ThresholdMode != ThresholdAll && rule.ThresholdMode != ThresholdAny {
		return Rule{}, invalidInputf("repost threshold mode must be all or any")
	}
	for name, value := range map[string]int64{
		"likes": rule.MinLikes, "comments": rule.MinComments, "reposts": rule.MinReposts, "views": rule.MinViews,
	} {
		if value < 0 || value > maxThreshold {
			return Rule{}, invalidInputf("minimum %s must be between 0 and %d", name, maxThreshold)
		}
	}
	if rule.PlateauChecks < 2 || rule.PlateauChecks > 12 {
		return Rule{}, invalidInputf("plateau checks must be between 2 and 12")
	}
	return rule, nil
}

func NormalizeOverride(input Override) (Override, error) {
	input.Mode = strings.TrimSpace(input.Mode)
	if input.Mode == "" {
		input.Mode = ModeInherit
	}
	switch input.Mode {
	case ModeInherit, ModeOff:
		return Override{Mode: input.Mode}, nil
	case ModeCustom:
		input.TargetAccountIDs = uniqueIDs(input.TargetAccountIDs)
		if len(input.TargetAccountIDs) == 0 {
			return Override{}, invalidInputf("custom repost settings require at least one target account")
		}
		if len(input.TargetAccountIDs) > maxAccountsPerRule {
			return Override{}, invalidInputf("custom repost settings support at most %d target accounts", maxAccountsPerRule)
		}
		rule, err := NormalizeRule(input.Rule)
		if err != nil {
			return Override{}, err
		}
		input.Rule = rule
		return input, nil
	default:
		return Override{}, invalidInputf("repost mode must be inherit, off, or custom")
	}
}

func SupportsPlatform(platform string) bool {
	return slices.Contains(supportedPlatforms, strings.ToLower(strings.TrimSpace(platform)))
}

func uniqueIDs(ids []string) []string {
	seen := make(map[string]struct{}, len(ids))
	result := make([]string, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	return result
}
