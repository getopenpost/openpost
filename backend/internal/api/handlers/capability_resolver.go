package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/publicurl"
	"github.com/uptrace/bun"
)

type CapabilityResolverHandler struct {
	db          *bun.DB
	auth        middleware.Authenticator
	providers   map[string]platform.Adapter
	tokenSource AccessTokenSource
	publicMedia *publicurl.MediaVerifier
	readiness   *providerreadiness.Service
	cacheMu     sync.Mutex
	cache       map[string]accountCapabilityCacheEntry
}

type accountCapabilityCacheEntry struct {
	result    platform.AccountCapabilityResult
	expiresAt time.Time
}

func NewCapabilityResolverHandler(
	db *bun.DB,
	auth middleware.Authenticator,
	providers map[string]platform.Adapter,
	tokenSource AccessTokenSource,
) *CapabilityResolverHandler {
	return &CapabilityResolverHandler{
		db:          db,
		auth:        auth,
		providers:   providers,
		tokenSource: tokenSource,
		cache:       map[string]accountCapabilityCacheEntry{},
	}
}

func (h *CapabilityResolverHandler) SetPublicMediaVerifier(verifier *publicurl.MediaVerifier) {
	h.publicMedia = verifier
}

func (h *CapabilityResolverHandler) SetProviderReadiness(service *providerreadiness.Service) {
	h.readiness = service
}

type ResolveCapabilityMediaInput struct {
	MediaID string `json:"media_id" doc:"Media attachment ID"`
	AltText string `json:"alt_text,omitempty" doc:"Destination alt-text override"`
}

type ResolveCapabilitySegmentInput struct {
	ID          string                        `json:"id" doc:"Stable segment ID"`
	Content     string                        `json:"content,omitempty" doc:"Canonical segment body"`
	Title       string                        `json:"title,omitempty" doc:"Canonical segment title"`
	Description string                        `json:"description,omitempty" doc:"Canonical segment description"`
	URL         string                        `json:"url,omitempty" doc:"Canonical segment URL"`
	Media       []ResolveCapabilityMediaInput `json:"media,omitempty" doc:"Ordered segment media"`
}

type ResolveCapabilitiesInput struct {
	Body struct {
		AccountIDs              []string                        `json:"account_ids" minItems:"1" uniqueItems:"true" doc:"Connected account IDs"`
		Intent                  string                          `json:"intent,omitempty" enum:"post,thread,story,short_video,video" doc:"Deprecated compatibility alias for creation_preset"`
		CreationPreset          string                          `json:"creation_preset,omitempty" enum:"post,thread,story,short_video,video" doc:"Starter preset used only to choose initial destination formats"`
		RequestedOutputProfiles map[string]string               `json:"requested_output_profiles,omitempty" doc:"Explicit or saved output profiles keyed by connected account ID"`
		SourceURL               string                          `json:"source_url,omitempty" doc:"Canonical source URL"`
		Locale                  string                          `json:"locale,omitempty" doc:"BCP 47 locale for option labels"`
		Region                  string                          `json:"region,omitempty" doc:"ISO 3166-1 alpha-2 region"`
		Segments                []ResolveCapabilitySegmentInput `json:"segments" minItems:"1" doc:"Ordered canonical segments"`
		Settings                map[string]map[string]any       `json:"account_settings,omitempty" doc:"Destination settings keyed by connected account ID"`
	}
}

type ResolvedAccountCapability struct {
	AccountID          string                     `json:"account_id"`
	ImmediateReadiness providerreadiness.Decision `json:"immediate_readiness"`
	ScheduledReadiness providerreadiness.Decision `json:"scheduled_readiness"`
	capabilities.ResolvedCapability
}

type ResolveCapabilitiesOutput struct {
	Body struct {
		Accounts []ResolvedAccountCapability `json:"accounts"`
	}
}

func (h *CapabilityResolverHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "resolve-publishing-capabilities",
		Method:      http.MethodPost,
		Path:        "/capabilities/resolve",
		Summary:     "Resolve publishing capabilities for connected accounts",
		Tags:        []string{tagCapabilities},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 502},
	}, func(ctx context.Context, input *ResolveCapabilitiesInput) (*ResolveCapabilitiesOutput, error) {
		accounts, workspaceID, err := h.loadResolveAccounts(ctx, input.Body.AccountIDs)
		if err != nil {
			return nil, err
		}
		if err := providerReadinessWorkspaceAccess(ctx, h.db, workspaceID, middleware.GetUserID(ctx)); err != nil {
			return nil, err
		}
		segments, err := h.resolveSegments(ctx, workspaceID, input.Body.Segments)
		if err != nil {
			return nil, err
		}

		output := &ResolveCapabilitiesOutput{}
		output.Body.Accounts = make([]ResolvedAccountCapability, 0, len(accounts))
		for _, account := range accounts {
			accountSegments := segmentsWithDestinationFields(segments, input.Body.Settings[account.ID])
			resolved := capabilities.Resolve(account.Platform, capabilities.ResolveInput{
				Intent:                 input.Body.Intent,
				CreationPreset:         input.Body.CreationPreset,
				RequestedOutputProfile: input.Body.RequestedOutputProfiles[account.ID],
				SourceURL:              input.Body.SourceURL,
				Segments:               accountSegments,
				Settings:               input.Body.Settings[account.ID],
			})
			h.mergeAccountCapability(
				ctx,
				account,
				input.Body.Locale,
				input.Body.Region,
				input.Body.Settings[account.ID],
				accountSegments,
				&resolved,
			)
			satisfyCanonicalURLRequirement(&resolved, input.Body.SourceURL, segments)
			output.Body.Accounts = append(output.Body.Accounts, ResolvedAccountCapability{
				AccountID:          account.ID,
				ImmediateReadiness: h.publicationReadiness(ctx, account, resolved.Capability, providerreadiness.OperationPublishImmediate, input.Body.Settings[account.ID]),
				ScheduledReadiness: h.publicationReadiness(ctx, account, resolved.Capability, providerreadiness.OperationPublishScheduled, input.Body.Settings[account.ID]),
				ResolvedCapability: resolved,
			})
		}
		return output, nil
	})
}

func (h *CapabilityResolverHandler) publicationReadiness(
	ctx context.Context,
	account models.SocialAccount,
	capability capabilities.Capability,
	operation providerreadiness.Operation,
	settings map[string]any,
) providerreadiness.Decision {
	if h.readiness == nil {
		return providerreadiness.Decision{State: providerreadiness.EffectiveStateDegraded}
	}
	return h.readiness.DecideAccountPublication(
		ctx,
		account,
		capability,
		operation,
		providerreadiness.ExecutionIntentProduction,
		providerreadiness.PublicationPolicyMode(account, capability, settings),
	)
}

func segmentsWithDestinationFields(segments []capabilities.ResolveSegment, settings map[string]any) []capabilities.ResolveSegment {
	if len(segments) == 0 || len(settings) == 0 {
		return segments
	}
	title, _ := settings["title"].(string)
	description, _ := settings["description"].(string)
	if strings.TrimSpace(title) == "" && strings.TrimSpace(description) == "" {
		return segments
	}
	cloned := append([]capabilities.ResolveSegment(nil), segments...)
	if strings.TrimSpace(cloned[0].Title) == "" {
		cloned[0].Title = title
	}
	if strings.TrimSpace(description) != "" && strings.TrimSpace(cloned[0].Body) == "" {
		cloned[0].Body = description
	}
	return cloned
}

func (h *CapabilityResolverHandler) loadResolveAccounts(ctx context.Context, accountIDs []string) ([]models.SocialAccount, string, error) {
	ids := uniqueNonEmpty(accountIDs)
	if len(ids) == 0 {
		return nil, "", huma.Error400BadRequest("at least one account_id is required")
	}
	var accounts []models.SocialAccount
	if err := h.db.NewSelect().
		Model(&accounts).
		Where("id IN (?)", bun.List(ids)).
		Where("is_active = ?", true).
		Scan(ctx); err != nil {
		return nil, "", huma.Error500InternalServerError("failed to load connected accounts")
	}
	if len(accounts) != len(ids) {
		return nil, "", huma.Error404NotFound("one or more connected accounts were not found")
	}
	byID := make(map[string]models.SocialAccount, len(accounts))
	workspaceID := accounts[0].WorkspaceID
	for _, account := range accounts {
		if account.WorkspaceID != workspaceID {
			return nil, "", huma.Error400BadRequest("all accounts must belong to one workspace")
		}
		byID[account.ID] = account
	}
	ordered := make([]models.SocialAccount, 0, len(ids))
	for _, id := range ids {
		ordered = append(ordered, byID[id])
	}
	return ordered, workspaceID, nil
}

func (h *CapabilityResolverHandler) resolveSegments(
	ctx context.Context,
	workspaceID string,
	inputs []ResolveCapabilitySegmentInput,
) ([]capabilities.ResolveSegment, error) {
	if len(inputs) == 0 {
		inputs = []ResolveCapabilitySegmentInput{{ID: "segment-1"}}
	}
	mediaIDs := []string{}
	for _, segment := range inputs {
		for _, media := range segment.Media {
			mediaIDs = append(mediaIDs, media.MediaID)
		}
	}
	mediaByID := map[string]models.MediaAttachment{}
	ids := uniqueNonEmpty(mediaIDs)
	if len(ids) > 0 {
		var media []models.MediaAttachment
		if err := h.db.NewSelect().
			Model(&media).
			Where("workspace_id = ?", workspaceID).
			Where("id IN (?)", bun.List(ids)).
			Scan(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to load media for capability resolution")
		}
		if len(media) != len(ids) {
			return nil, huma.Error400BadRequest("one or more media attachments are invalid or outside this workspace")
		}
		for index := range media {
			if err := refreshPublicMediaState(ctx, h.db, h.publicMedia, &media[index]); err != nil {
				return nil, huma.Error500InternalServerError("failed to refresh public media status")
			}
			item := media[index]
			mediaByID[item.ID] = item
		}
	}

	segments := make([]capabilities.ResolveSegment, 0, len(inputs))
	for index, input := range inputs {
		segment := capabilities.ResolveSegment{
			ID:    publicationFirstNonEmpty(input.ID, fmt.Sprintf("segment-%d", index+1)),
			Body:  input.Content,
			Title: input.Title,
			URL:   input.URL,
		}
		for _, mediaInput := range input.Media {
			media := mediaByID[mediaInput.MediaID]
			segment.Media = append(segment.Media, capabilities.MediaItem{
				ID:              media.ID,
				MimeType:        media.MimeType,
				Size:            media.Size,
				Width:           media.Width,
				Height:          media.Height,
				DurationMS:      media.DurationMS,
				FrameRate:       media.FrameRate,
				VideoCodec:      strings.ToLower(media.VideoCodec),
				AudioCodec:      strings.ToLower(media.AudioCodec),
				AudioChannels:   media.AudioChannels,
				AltText:         publicationFirstNonEmpty(mediaInput.AltText, media.AltText),
				AnalysisStatus:  media.AnalysisStatus,
				AnalysisError:   media.AnalysisError,
				PublicURLReady:  media.PublicURLReady,
				PublicURLStatus: media.PublicURLStatus,
				PublicURLError:  media.PublicURLError,
				URL:             "/media/" + media.ID,
			})
		}
		segments = append(segments, segment)
	}
	return segments, nil
}

//nolint:gocyclo
func (h *CapabilityResolverHandler) mergeAccountCapability(
	ctx context.Context,
	account models.SocialAccount,
	locale string,
	region string,
	settings map[string]any,
	segments []capabilities.ResolveSegment,
	resolved *capabilities.ResolvedCapability,
) {
	if account.Platform == capabilities.ProviderX {
		applyDynamicCapabilityConstraints(resolved, standardXPublishingCapabilities().Constraints, segments)
	}
	adapter := h.adapterForResolveAccount(account)
	provider, ok := adapter.(platform.AccountCapabilityProvider)
	if !ok || h.tokenSource == nil {
		return
	}
	cacheKey := strings.Join([]string{
		account.ID,
		resolved.OutputProfile,
		firstResolvedIntent(*resolved),
		firstResolvedMediaShape(*resolved),
		strings.ToLower(strings.TrimSpace(locale)),
		strings.ToUpper(strings.TrimSpace(region)),
		accountCapabilitySettingsKey(settings),
	}, "|")
	result, expiresAt, ok := h.cachedAccountCapability(cacheKey)
	if !ok {
		accessToken, err := h.tokenSource.GetValidAccessToken(ctx, account.ID)
		if err != nil {
			h.addDynamicCapabilityFailure(resolved, settings, "Account authorization could not be refreshed.")
			return
		}
		result, err = provider.ResolveAccountPublishingCapabilities(ctx, accessToken, platform.AccountCapabilityInput{
			Intent:        firstResolvedIntent(*resolved),
			OutputProfile: resolved.OutputProfile,
			MediaShape:    firstResolvedMediaShape(*resolved),
			Locale:        locale,
			RegionCode:    region,
			Settings:      settings,
		})
		if err != nil {
			h.addDynamicCapabilityFailure(resolved, settings, err.Error())
			return
		}
		if persistErr := persistAccountCapabilityState(ctx, h.db, account.ID, result); persistErr != nil {
			h.addDynamicCapabilityFailure(resolved, settings, "Account limits were verified but could not be cached.")
		}
		expiresAt = time.Now().UTC().Add(accountCapabilityTTL(account.Platform))
		h.storeAccountCapability(cacheKey, result, expiresAt)
	}
	resolved.ExpiresAt = expiresAt.Format(time.RFC3339)
	if result.Revision != "" {
		resolved.CapabilityRevision += "+" + result.Revision
	}
	if result.UnavailableReason != "" {
		resolved.UnavailableReason = result.UnavailableReason
		resolved.Compatible = false
	}
	resolved.DynamicOptions = map[string][]capabilities.Option{}
	for source, options := range result.Options {
		for _, option := range options {
			resolved.DynamicOptions[source] = append(resolved.DynamicOptions[source], capabilities.Option{
				Value: option.Value,
				Label: option.Label,
			})
		}
	}
	for key, value := range result.Constraints {
		resolved.ActiveConstraints[key] = value
	}
	applyDynamicCapabilityConstraints(resolved, result.Constraints, segments)
	for settingIndex := range resolved.Settings {
		setting := &resolved.Settings[settingIndex]
		if available, exists := result.AvailableFeatures[setting.Key]; exists {
			if available {
				setting.UnavailableReason = ""
			} else {
				setting.UnavailableReason = "This setting is not available for the connected account."
			}
		}
	}
	for groupIndex := range resolved.SettingGroups {
		for settingIndex := range resolved.SettingGroups[groupIndex].Settings {
			setting := &resolved.SettingGroups[groupIndex].Settings[settingIndex]
			if available, exists := result.AvailableFeatures[setting.Key]; exists {
				if available {
					setting.UnavailableReason = ""
				} else {
					setting.UnavailableReason = "This setting is not available for the connected account."
				}
			}
		}
	}
	for _, setting := range resolved.Settings {
		if !setting.Required || setting.OptionsSource == "" || !capabilitySettingDependenciesMet(setting, settings) {
			continue
		}
		if len(resolved.DynamicOptions[setting.OptionsSource]) == 0 {
			h.addDynamicCapabilityFailure(resolved, settings, setting.Label+" options are not available.")
			return
		}
	}
}

func satisfyCanonicalURLRequirement(
	resolved *capabilities.ResolvedCapability,
	sourceURL string,
	segments []capabilities.ResolveSegment,
) {
	if resolved == nil || resolved.ActiveConstraints["media_shape"] != capabilities.MediaShapeLink {
		return
	}
	hasURL := strings.TrimSpace(sourceURL) != ""
	for _, segment := range segments {
		hasURL = hasURL || strings.TrimSpace(segment.URL) != ""
	}
	if !hasURL {
		return
	}

	issues := resolved.Issues[:0]
	removed := false
	for _, issue := range resolved.Issues {
		if issue.Code == "setting_required" && (issue.Field == "url" || issue.Field == "link_url") {
			removed = true
			continue
		}
		issues = append(issues, issue)
	}
	if !removed {
		return
	}

	resolved.Issues = issues
	resolved.Compatible = strings.TrimSpace(resolved.UnavailableReason) == ""
	for _, issue := range issues {
		if issue.Severity == "error" {
			resolved.Compatible = false
			break
		}
	}
}

func applyDynamicCapabilityConstraints(resolved *capabilities.ResolvedCapability, constraints map[string]interface{}, segments []capabilities.ResolveSegment) {
	capabilities.ApplyAccountConstraints(resolved, segments, constraints)
	resolved.ActiveConstraints["text_limit"] = resolved.TextLimit
	resolved.ActiveConstraints["media"] = resolved.Media
	for index := range resolved.Settings {
		applyDynamicSettingConstraints(&resolved.Settings[index], constraints)
	}
	for groupIndex := range resolved.SettingGroups {
		for settingIndex := range resolved.SettingGroups[groupIndex].Settings {
			applyDynamicSettingConstraints(&resolved.SettingGroups[groupIndex].Settings[settingIndex], constraints)
		}
	}
}

func applyDynamicSettingConstraints(setting *capabilities.SettingDefinition, constraints map[string]interface{}) {
	switch setting.Key {
	case "poll_options":
		if value, ok := dynamicInt(constraints["poll_max_options"]); ok && value > 0 {
			setting.Constraints.MaxItems = value
		}
		if value, ok := dynamicInt(constraints["poll_option_max_length"]); ok && value > 0 {
			setting.Constraints.MaxLength = value
		}
	case "poll_expires_in_seconds":
		if value, ok := dynamicInt(constraints["poll_min_expiration_seconds"]); ok && value > 0 {
			minimum := float64(value)
			setting.Constraints.Minimum = &minimum
		}
		if value, ok := dynamicInt(constraints["poll_max_expiration_seconds"]); ok && value > 0 {
			maximum := float64(value)
			setting.Constraints.Maximum = &maximum
		}
	}
}

func dynamicInt(value interface{}) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, true
	case int64:
		return int(typed), true
	case float64:
		return int(typed), true
	default:
		return 0, false
	}
}

func dynamicInt64(value interface{}) (int64, bool) {
	switch typed := value.(type) {
	case int:
		return int64(typed), true
	case int64:
		return typed, true
	case float64:
		return int64(typed), true
	default:
		return 0, false
	}
}

func (h *CapabilityResolverHandler) addDynamicCapabilityFailure(resolved *capabilities.ResolvedCapability, settings map[string]any, message string) {
	required := false
	for _, setting := range resolved.Settings {
		required = required || (setting.Required && setting.OptionsSource != "" && capabilitySettingDependenciesMet(setting, settings))
	}
	severity := "warning"
	code := "dynamic_options_unavailable"
	if required {
		severity = "error"
		code = "required_dynamic_options_unavailable"
		resolved.Compatible = false
	}
	resolved.Issues = append(resolved.Issues, capabilities.ValidationIssue{
		Severity:        severity,
		Code:            code,
		Message:         message,
		FallbackMessage: message,
		Provider:        resolved.Provider,
		Profile:         resolved.Profile,
		OutputProfile:   resolved.OutputProfile,
		Scope:           capabilities.SettingScopeDestination,
		Field:           "dynamic_options",
	})
}

func accountCapabilitySettingsKey(settings map[string]any) string {
	payload, err := json.Marshal(settings)
	if err != nil {
		return "invalid"
	}
	digest := sha256.Sum256(payload)
	return hex.EncodeToString(digest[:])
}

//nolint:gocyclo
func capabilitySettingDependenciesMet(setting capabilities.SettingDefinition, settings map[string]any) bool {
	for _, condition := range setting.Dependencies {
		value, exists := settings[condition.Key]
		present := exists && value != nil && strings.TrimSpace(fmt.Sprint(value)) != ""
		switch condition.Operator {
		case "present":
			if !present {
				return false
			}
		case "absent":
			if present {
				return false
			}
		case "equals":
			if !present || fmt.Sprint(value) != fmt.Sprint(condition.Value) {
				return false
			}
		case "not_equals":
			if present && fmt.Sprint(value) == fmt.Sprint(condition.Value) {
				return false
			}
		case "in":
			values := []string{}
			switch typed := condition.Value.(type) {
			case []string:
				values = typed
			case []any:
				for _, candidate := range typed {
					values = append(values, fmt.Sprint(candidate))
				}
			default:
				return false
			}
			found := false
			for _, candidate := range values {
				found = found || candidate == fmt.Sprint(value)
			}
			if !found {
				return false
			}
		}
	}
	return true
}

func (h *CapabilityResolverHandler) adapterForResolveAccount(account models.SocialAccount) platform.Adapter {
	key := account.Platform
	if account.Platform == capabilities.ProviderMastodon {
		key = capabilities.ProviderMastodon + ":" + account.InstanceURL
	}
	return h.providers[key]
}

func (h *CapabilityResolverHandler) cachedAccountCapability(key string) (platform.AccountCapabilityResult, time.Time, bool) {
	h.cacheMu.Lock()
	defer h.cacheMu.Unlock()
	entry, ok := h.cache[key]
	if !ok || !entry.expiresAt.After(time.Now().UTC()) {
		delete(h.cache, key)
		return platform.AccountCapabilityResult{}, time.Time{}, false
	}
	return entry.result, entry.expiresAt, true
}

func (h *CapabilityResolverHandler) storeAccountCapability(key string, result platform.AccountCapabilityResult, expiresAt time.Time) {
	h.cacheMu.Lock()
	defer h.cacheMu.Unlock()
	h.cache[key] = accountCapabilityCacheEntry{result: result, expiresAt: expiresAt}
}

func accountCapabilityTTL(provider string) time.Duration {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case capabilities.ProviderTikTok:
		return 5 * time.Minute
	case capabilities.ProviderYouTube:
		return 15 * time.Minute
	case capabilities.ProviderMastodon:
		return time.Hour
	default:
		return 15 * time.Minute
	}
}

func firstResolvedIntent(resolved capabilities.ResolvedCapability) string {
	if len(resolved.Intents) == 0 {
		return ""
	}
	return resolved.Intents[0]
}

func firstResolvedMediaShape(resolved capabilities.ResolvedCapability) string {
	if shape, ok := resolved.ActiveConstraints["media_shape"].(string); ok {
		return shape
	}
	return ""
}
