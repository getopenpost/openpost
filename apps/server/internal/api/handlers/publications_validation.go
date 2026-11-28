package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/providerreadiness"
	repostservice "github.com/openpost/backend/internal/services/reposts"
	"github.com/uptrace/bun"
)

func providerReadinessExecutionIntent(
	ctx context.Context,
	db *bun.DB,
	raw string,
) (providerreadiness.ExecutionIntent, error) {
	switch providerreadiness.ExecutionIntent(strings.TrimSpace(raw)) {
	case "", providerreadiness.ExecutionIntentProduction:
		return providerreadiness.ExecutionIntentProduction, nil
	case providerreadiness.ExecutionIntentCertificationTest:
		if err := requireUnscopedInstanceAdmin(ctx, db); err != nil {
			return "", err
		}
		return providerreadiness.ExecutionIntentCertificationTest, nil
	default:
		return "", huma.Error400BadRequest("invalid provider readiness execution intent")
	}
}

func normalizedReadinessIntent(intents []providerreadiness.ExecutionIntent) providerreadiness.ExecutionIntent {
	if len(intents) > 0 && intents[0] == providerreadiness.ExecutionIntentCertificationTest {
		return providerreadiness.ExecutionIntentCertificationTest
	}
	return providerreadiness.ExecutionIntentProduction
}

func (h *PublicationHandler) validatePublicationByID(ctx context.Context, publicationID string) ([]capabilities.ValidationIssue, error) {
	if err := h.refreshPublicationPublicMedia(ctx, publicationID); err != nil {
		return nil, err
	}
	issues, err := h.validatePublicationByIDWithDB(ctx, h.db, publicationID)
	if err != nil {
		return nil, err
	}
	dynamicIssues, err := h.validateDynamicPublicationCapabilities(ctx, publicationID)
	if err != nil {
		return nil, err
	}
	return append(issues, dynamicIssues...), nil
}

func (h *PublicationHandler) refreshPublicationPublicMedia(ctx context.Context, publicationID string) error {
	if h.publicMedia == nil {
		return nil
	}
	var media []models.MediaAttachment
	if err := h.db.NewSelect().
		TableExpr("media_attachments AS m").
		ColumnExpr("DISTINCT m.*").
		Join("JOIN rendition_media AS rm ON rm.media_id = m.id").
		Join("JOIN renditions AS r ON r.id = rm.rendition_id").
		Where("r.publication_id = ?", publicationID).
		Scan(ctx, &media); err != nil {
		return huma.Error500InternalServerError("failed to load public media status")
	}
	for index := range media {
		if err := refreshPublicMediaState(ctx, h.db, h.publicMedia, &media[index]); err != nil {
			return huma.Error500InternalServerError("failed to refresh public media status")
		}
	}
	return nil
}

//nolint:gocyclo
func (h *PublicationHandler) validateDynamicPublicationCapabilities(ctx context.Context, publicationID string) ([]capabilities.ValidationIssue, error) {
	var publication models.Publication
	if err := h.db.NewSelect().Model(&publication).Where("id = ?", publicationID).Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to load publication capabilities")
	}
	var renditions []models.Rendition
	if err := h.db.NewSelect().Model(&renditions).Where("publication_id = ?", publicationID).Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to load rendition capabilities")
	}
	accounts, err := h.loadValidationAccountsWithDB(ctx, h.db, renditionAccountIDsFromModels(renditions))
	if err != nil {
		return nil, err
	}
	issues := []capabilities.ValidationIssue{}
	for _, rendition := range renditions {
		account, ok := accounts[rendition.SocialAccountID]
		if !ok {
			continue
		}
		key := platform.AccountProviderKey(account.Platform, account.InstanceURL, account.CapabilityState)
		h.providersMu.RLock()
		adapter := h.providers[key]
		h.providersMu.RUnlock()
		result := platform.AccountCapabilityResult{}
		hasResult := false
		if account.Platform == capabilities.ProviderX {
			result = standardXPublishingCapabilities()
			hasResult = true
		}
		provider, ok := adapter.(platform.AccountCapabilityProvider)
		destinationSettings := map[string]interface{}{}
		_ = json.Unmarshal([]byte(rendition.SettingsJSON), &destinationSettings)
		switch {
		case ok && h.tokenSource != nil:
			token, tokenErr := h.tokenSource.GetValidAccessToken(ctx, account.ID)
			if tokenErr != nil {
				issue := dynamicPublicationIssue(
					rendition,
					"account_capability_authorization_failed",
					"Account authorization could not be refreshed.",
					"authorization",
				)
				if account.Platform == capabilities.ProviderX {
					issue.Severity = "warning"
					issues = append(issues, issue)
				} else {
					issues = append(issues, issue)
					continue
				}
			} else {
				resolved, resolveErr := provider.ResolveAccountPublishingCapabilities(ctx, token, platform.AccountCapabilityInput{
					Intent:        publishingIntentForProfile(rendition.Profile),
					OutputProfile: rendition.OutputProfile,
					Settings:      destinationSettings,
				})
				if resolveErr != nil {
					issue := dynamicPublicationIssue(
						rendition,
						"account_capability_refresh_failed",
						resolveErr.Error(),
						"capabilities",
					)
					if account.Platform == capabilities.ProviderX {
						issue.Severity = "warning"
						issues = append(issues, issue)
					} else {
						issues = append(issues, issue)
						continue
					}
				} else {
					result = resolved
					hasResult = true
					if persistErr := persistAccountCapabilityState(ctx, h.db, account.ID, result); persistErr != nil {
						issue := dynamicPublicationIssue(
							rendition,
							"account_capability_cache_failed",
							"Account limits were verified but could not be cached.",
							"capabilities",
						)
						issue.Severity = "warning"
						issues = append(issues, issue)
					}
				}
			}
		case !hasResult:
			continue
		default:
			issue := dynamicPublicationIssue(
				rendition,
				"account_capability_refresh_failed",
				"Account limits could not be refreshed; standard X limits were applied.",
				"capabilities",
			)
			issue.Severity = "warning"
			issues = append(issues, issue)
		}
		segments, loadErr := h.loadRenditionSegmentResponsesWithDB(ctx, h.db, rendition)
		if loadErr != nil {
			return nil, loadErr
		}
		for segmentIndex, segment := range segments {
			settings := mergePublicationSettings(destinationSettings, segment.Settings)
			for key, available := range result.AvailableFeatures {
				if available || !publicationSettingEnabled(settings[key]) {
					continue
				}
				issue := dynamicPublicationIssue(
					rendition,
					"account_capability_removed",
					fmt.Sprintf("%s is no longer available for this account.", key),
					key,
				)
				issue.SegmentID = segment.ID
				issue.Scope = capabilities.SettingScopeSegment
				issue.ScopeID = segment.ID
				issues = append(issues, issue)
			}
			for source, options := range result.Options {
				key := dynamicOptionSettingKey(source)
				if key == "" {
					continue
				}
				selected := strings.TrimSpace(fmt.Sprint(settings[key]))
				if selected == "" {
					continue
				}
				found := false
				for _, option := range options {
					found = found || option.Value == selected
				}
				if !found {
					issue := dynamicPublicationIssue(
						rendition,
						"dynamic_option_removed",
						fmt.Sprintf("%s is no longer available for this account.", key),
						key,
					)
					issue.SegmentID = segment.ID
					issue.Scope = capabilities.SettingScopeSegment
					issue.ScopeID = segment.ID
					issues = append(issues, issue)
				}
			}
			issues = append(issues, validateDynamicConstraints(rendition, segment, segmentIndex, settings, result.Constraints)...)
		}
	}
	return issues, nil
}

func validateDynamicConstraints(rendition models.Rendition, segment RenditionSegmentResponse, position int, settings map[string]interface{}, constraints map[string]interface{}) []capabilities.ValidationIssue {
	issues := []capabilities.ValidationIssue{}
	appendIssue := func(code, message, field string) {
		issue := dynamicPublicationIssue(rendition, code, message, field)
		issue.SegmentID = segment.ID
		issue.Scope = capabilities.SettingScopeSegment
		issue.ScopeID = segment.ID
		issue.Parameters = map[string]any{"segment_position": position}
		issues = append(issues, issue)
	}
	if limit, ok := dynamicInt(constraints["text_limit"]); ok && limit > 0 && capabilities.TextLength(rendition.Platform, segment.Body) > limit {
		appendIssue("dynamic_text_limit", fmt.Sprintf("Text is over the current %d character limit.", limit), "body")
	}
	outputMedia := deliveredSegmentMedia(segment)
	if limit, ok := dynamicInt(constraints["media_max_count"]); ok && limit > 0 && len(outputMedia) > limit {
		appendIssue("dynamic_media_limit", fmt.Sprintf("This account currently supports at most %d media items.", limit), "media")
	}
	issues = append(issues, validateDynamicVideoConstraints(rendition, segment, position, constraints)...)
	if limit, ok := dynamicInt(constraints["poll_max_options"]); ok && limit > 0 {
		if count := len(strings.Split(strings.TrimSpace(fmt.Sprint(settings["poll_options"])), "\n")); count > limit {
			appendIssue("dynamic_poll_limit", fmt.Sprintf("This account currently supports at most %d poll options.", limit), "poll_options")
		}
	}
	return issues
}

func validateDynamicVideoConstraints(rendition models.Rendition, segment RenditionSegmentResponse, position int, constraints map[string]interface{}) []capabilities.ValidationIssue {
	issues := []capabilities.ValidationIssue{}
	appendIssue := func(code, message string) {
		issue := dynamicPublicationIssue(rendition, code, message, "media")
		issue.SegmentID = segment.ID
		issue.Scope = capabilities.SettingScopeSegment
		issue.ScopeID = segment.ID
		issue.Parameters = map[string]any{"segment_position": position}
		issues = append(issues, issue)
	}
	if limit, ok := dynamicInt(constraints["max_video_duration_seconds"]); ok && limit > 0 {
		for _, media := range segment.Media {
			if strings.HasPrefix(strings.ToLower(media.MimeType), "video/") && media.DurationMS > int64(limit)*1000 {
				appendIssue("dynamic_video_duration", fmt.Sprintf("Video must be %d seconds or less for this account.", limit))
				break
			}
		}
	}
	if limit, ok := dynamicInt64(constraints["max_video_size_bytes"]); ok && limit > 0 {
		for _, media := range segment.Media {
			if strings.HasPrefix(strings.ToLower(media.MimeType), "video/") && media.Size > limit {
				appendIssue("dynamic_video_size", "Video file is too large for this account.")
				break
			}
		}
	}
	return issues
}

func dynamicPublicationIssue(rendition models.Rendition, code, message, field string) capabilities.ValidationIssue {
	return capabilities.ValidationIssue{
		Severity:        "error",
		Code:            code,
		Message:         message,
		FallbackMessage: message,
		Provider:        rendition.Platform,
		Profile:         rendition.Profile,
		OutputProfile:   rendition.OutputProfile,
		Scope:           capabilities.SettingScopeDestination,
		ScopeID:         rendition.ID,
		Field:           field,
	}
}

func publicationSettingEnabled(value interface{}) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case bool:
		return typed
	case string:
		return strings.TrimSpace(typed) != "" && !strings.EqualFold(strings.TrimSpace(typed), "false")
	default:
		return true
	}
}

func dynamicOptionSettingKey(source string) string {
	switch source {
	case "tiktok_privacy_levels":
		return "privacy_level"
	case "youtube_categories":
		return "category_id"
	case "youtube_playlists":
		return "playlist_id"
	default:
		return ""
	}
}

func (h *PublicationHandler) validatePublicationByIDWithDB(ctx context.Context, db bun.IDB, publicationID string) ([]capabilities.ValidationIssue, error) {
	var renditions []models.Rendition
	if err := db.NewSelect().Model(&renditions).Where("publication_id = ?", publicationID).Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to load renditions")
	}
	mediaByRendition, _, err := h.loadRenditionMediaWithDB(ctx, db, renditionIDs(renditions))
	if err != nil {
		return nil, err
	}
	accountsByID, err := h.loadValidationAccountsWithDB(ctx, db, renditionAccountIDsFromModels(renditions))
	if err != nil {
		return nil, err
	}
	canonicalSegments, _, err := h.loadCanonicalSegmentInputsWithDB(ctx, db, publicationID)
	if err != nil {
		return nil, err
	}
	issues := []capabilities.ValidationIssue{}
	for _, rendition := range renditions {
		destinationSettings := map[string]interface{}{}
		_ = json.Unmarshal([]byte(rendition.SettingsJSON), &destinationSettings)
		segments, loadErr := h.loadRenditionSegmentResponsesWithDB(ctx, db, rendition)
		if loadErr != nil {
			return nil, loadErr
		}
		for segmentIndex, segment := range segments {
			issues = append(issues, validatePublicationPoll(rendition, segment, canonicalSegments, len(segments))...)
			issues = append(issues, validatePublicationMentions(rendition, accountsByID[rendition.SocialAccountID], segment, canonicalSegments, len(segments))...)
			segment = projectSegmentMentionText(segment, rendition, accountsByID[rendition.SocialAccountID], canonicalSegments, len(segments))
			segmentSettings := mergePublicationSettings(destinationSettings, segment.Settings)
			issues = append(issues, validateTextCardOutput(rendition, segment, segmentSettings)...)
			segmentMedia := deliveredSegmentMedia(segment)
			if strings.HasPrefix(segment.ID, "legacy:") {
				segmentMedia = mediaByRendition[rendition.ID]
			}
			mediaItems := capabilityMediaFromSummaries(segmentMedia)
			segmentIssues := capabilities.ValidateOutput(
				rendition.Platform,
				rendition.OutputProfile,
				rendition.Profile,
				segment.Body,
				publicationFirstNonEmpty(segment.Title, rendition.Title),
				publicationFirstNonEmpty(segment.Description, rendition.Description),
				mediaItems,
				segmentSettings,
			)
			segmentIssues = append(segmentIssues, instagramLoginSettingsIssues(accountsByID[rendition.SocialAccountID], rendition, segmentSettings)...)
			for index := range segmentIssues {
				segmentIssues[index].SegmentID = segment.ID
				segmentIssues[index].Scope = capabilities.SettingScopeSegment
				segmentIssues[index].ScopeID = segment.ID
				if segmentIssues[index].OutputProfile == "" {
					segmentIssues[index].OutputProfile = rendition.OutputProfile
				}
				segmentIssues[index].Parameters = mergeIssueParameters(segmentIssues[index].Parameters, map[string]any{
					"segment_position": segmentIndex,
				})
			}
			issues = append(issues, segmentIssues...)
			for _, media := range segment.Media {
				mediaIssues := capabilities.ValidateMediaSettings(
					rendition.Platform,
					rendition.OutputProfile,
					rendition.Profile,
					capabilityMediaFromSummary(media),
					media.Settings,
				)
				mediaIssues = append(mediaIssues, instagramLoginMediaSettingsIssues(accountsByID[rendition.SocialAccountID], rendition, media)...)
				for index := range mediaIssues {
					mediaIssues[index].SegmentID = segment.ID
					mediaIssues[index].Parameters = mergeIssueParameters(mediaIssues[index].Parameters, map[string]any{
						"segment_position": segmentIndex,
					})
				}
				issues = append(issues, mediaIssues...)
			}
		}
		if account, ok := accountsByID[rendition.SocialAccountID]; ok {
			if issue := discordChannelIssue(account, rendition.Profile, rendition.OutputProfile, destinationSettings); issue != nil {
				issue.ScopeID = rendition.ID
				issues = append(issues, *issue)
			}
			issues = append(issues, renditionScopeIssues(rendition, account)...)
		}
		issues = append(issues, renditionProcessingIssues(rendition)...)
	}
	return issues, nil
}

func instagramLoginSettingsIssues(account models.SocialAccount, rendition models.Rendition, settings map[string]any) []capabilities.ValidationIssue {
	if !isInstagramLoginAccount(account) {
		return nil
	}
	return capabilities.InstagramLoginSettingsIssues(capabilities.Capability{
		Provider: rendition.Platform, Profile: rendition.Profile, OutputProfile: rendition.OutputProfile,
	}, settings)
}

func instagramLoginMediaSettingsIssues(account models.SocialAccount, rendition models.Rendition, media MediaSummary) []capabilities.ValidationIssue {
	issues := instagramLoginSettingsIssues(account, rendition, media.Settings)
	for index := range issues {
		issues[index].MediaID = media.ID
		issues[index].ScopeID = media.ID
	}
	return issues
}

func capabilityMediaFromSummary(item MediaSummary) capabilities.MediaItem {
	return capabilities.MediaItem{
		ID:              item.ID,
		MimeType:        item.MimeType,
		Size:            item.Size,
		Width:           item.Width,
		Height:          item.Height,
		DurationMS:      item.DurationMS,
		AnalysisStatus:  item.AnalysisStatus,
		AnalysisError:   item.AnalysisError,
		PublicURLReady:  item.PublicURLReady,
		PublicURLStatus: item.PublicURLStatus,
		PublicURLError:  item.PublicURLError,
		URL:             item.URL,
		AltText:         item.AltText,
	}
}

func capabilityMediaFromSummaries(items []MediaSummary) []capabilities.MediaItem {
	out := make([]capabilities.MediaItem, 0, len(items))
	for _, item := range items {
		out = append(out, capabilityMediaFromSummary(item))
	}
	return out
}

func mergePublicationSettings(base, overrides map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(base)+len(overrides))
	for key, value := range base {
		out[key] = value
	}
	for key, value := range overrides {
		out[key] = value
	}
	return out
}

func mergeIssueParameters(base, extra map[string]any) map[string]any {
	out := make(map[string]any, len(base)+len(extra))
	for key, value := range base {
		out[key] = value
	}
	for key, value := range extra {
		out[key] = value
	}
	return out
}

func (h *PublicationHandler) loadValidationAccountsWithDB(ctx context.Context, db bun.IDB, accountIDs []string) (map[string]models.SocialAccount, error) {
	uniqueIDs := uniqueNonEmpty(accountIDs)
	if len(uniqueIDs) == 0 {
		return map[string]models.SocialAccount{}, nil
	}
	var accounts []models.SocialAccount
	if err := db.NewSelect().
		Model(&accounts).
		Where("id IN (?)", bun.List(uniqueIDs)).
		Where("is_active = ?", true).
		Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to load social account scopes")
	}
	out := make(map[string]models.SocialAccount, len(accounts))
	for _, account := range accounts {
		out[account.ID] = account
	}
	return out, nil
}

func renditionScopeIssues(rendition models.Rendition, account models.SocialAccount) []capabilities.ValidationIssue {
	granted := splitScopes(account.GrantedScopes)
	capability, found := capabilities.FindOutput(account.Platform, rendition.OutputProfile)
	if !found {
		capability, found = capabilities.Find(account.Platform, rendition.Profile)
	}
	if !found {
		return nil
	}
	settings := map[string]any{}
	if err := json.Unmarshal([]byte(rendition.SettingsJSON), &settings); err != nil {
		return []capabilities.ValidationIssue{{
			Severity: "error", Code: "provider_policy_invalid",
			Message:  "Destination provider policy settings are invalid.",
			Provider: rendition.Platform, Profile: rendition.Profile, Field: "settings",
		}}
	}
	policyMode := providerreadiness.PublicationPolicyMode(account, capability, settings)
	missing := missingScopes(providerreadiness.RequiredScopesForSubject(providerreadiness.Subject{
		Provider: account.Platform, AccountKind: providerreadiness.AccountKind(account),
		OutputProfile: capability.OutputProfile, Operation: providerreadiness.OperationPublishImmediate,
		PolicyMode: policyMode,
	}), granted)
	if len(missing) == 0 {
		return nil
	}
	return []capabilities.ValidationIssue{{
		Severity: "error",
		Code:     "missing_scope",
		Message:  "Connected account is missing required publishing scopes: " + strings.Join(missing, ", "),
		Provider: rendition.Platform,
		Profile:  rendition.Profile,
		Field:    "granted_scopes",
	}}
}

func renditionProcessingIssues(rendition models.Rendition) []capabilities.ValidationIssue {
	if rendition.Status != models.RenditionStatusFailed || strings.TrimSpace(rendition.ErrorMessage) == "" {
		return nil
	}
	return []capabilities.ValidationIssue{{
		Severity: "error",
		Code:     "native_processing_failed",
		Message:  rendition.ErrorMessage,
		Provider: rendition.Platform,
		Profile:  rendition.Profile,
		Field:    "status",
	}}
}

func (h *PublicationHandler) requirePublicationReadiness(
	ctx context.Context,
	publicationID string,
	operation providerreadiness.Operation,
	intent providerreadiness.ExecutionIntent,
) error {
	if h == nil || h.readiness == nil {
		return &providerreadiness.NotReadyError{Decision: providerreadiness.UnavailableDecision(operation)}
	}
	var publication models.Publication
	if err := h.db.NewSelect().Model(&publication).Where("id = ?", publicationID).Scan(ctx); err != nil {
		return err
	}
	return h.requirePublicationReadinessWithDB(ctx, h.db, &publication, operation, intent, false)
}

func (h *PublicationHandler) requirePublicationReadinessWithDB(
	ctx context.Context,
	db bun.IDB,
	publication *models.Publication,
	operation providerreadiness.Operation,
	intent providerreadiness.ExecutionIntent,
	lock bool,
) error {
	if h == nil || db == nil || publication == nil {
		return &providerreadiness.NotReadyError{Decision: providerreadiness.UnavailableDecision(operation)}
	}
	var renditions []models.Rendition
	renditionsQuery := db.NewSelect().Model(&renditions).
		Where("publication_id = ?", publication.ID).
		OrderExpr("id ASC")
	if lock && primaryPublicationQueueUsesRowLock(db.Dialect().Name()) {
		renditionsQuery = renditionsQuery.For("UPDATE")
	}
	if err := renditionsQuery.Scan(ctx); err != nil {
		return err
	}
	accountIDs := make([]string, 0, len(renditions))
	for _, rendition := range renditions {
		accountIDs = append(accountIDs, rendition.SocialAccountID)
	}
	accounts, err := loadReadinessAccountsWithDB(ctx, db, publication.WorkspaceID, accountIDs, lock)
	if err != nil {
		return err
	}
	for _, rendition := range renditions {
		if err := h.requireRenditionReadinessWithDB(ctx, db, accounts[rendition.SocialAccountID], rendition, operation, intent); err != nil {
			return err
		}
	}
	return nil
}

func (h *PublicationHandler) requireRenditionReadinessWithDB(
	ctx context.Context,
	db bun.IDB,
	account models.SocialAccount,
	rendition models.Rendition,
	operation providerreadiness.Operation,
	intent providerreadiness.ExecutionIntent,
) error {
	connectorCapabilities, connectorBacked, err := h.connectorCapabilitiesWithDB(ctx, db, account)
	if err != nil {
		return err
	}
	if connectorBacked {
		if !supportsRendition(connectorCapabilities, rendition) {
			return fmt.Errorf("connector does not support output profile %q", rendition.OutputProfile)
		}
		return nil
	}
	if h.readiness == nil {
		return &providerreadiness.NotReadyError{Decision: providerreadiness.UnavailableDecision(operation)}
	}
	capability := renditionCapability(account, rendition)
	settings := map[string]any{}
	if err := json.Unmarshal([]byte(rendition.SettingsJSON), &settings); err != nil {
		return fmt.Errorf("decode rendition provider policy settings: %w", err)
	}
	readiness := h.readiness.WithLedger(providerreadiness.NewRepository(db))
	decision := readiness.DecideAccountPublication(
		ctx,
		account,
		capability,
		operation,
		intent,
		providerreadiness.PublicationPolicyMode(account, capability, settings),
	)
	if !decision.Publishable {
		return &providerreadiness.NotReadyError{Decision: decision}
	}
	return nil
}

func supportsRendition(catalog []capabilities.Capability, rendition models.Rendition) bool {
	for _, capability := range catalog {
		if capability.OutputProfile == rendition.OutputProfile ||
			(rendition.OutputProfile == "" && capability.Profile == rendition.Profile) {
			return true
		}
	}
	return false
}

func renditionCapability(account models.SocialAccount, rendition models.Rendition) capabilities.Capability {
	if capability, found := capabilities.FindOutput(account.Platform, rendition.OutputProfile); found {
		return capability
	}
	if capability, found := capabilities.Find(account.Platform, rendition.Profile); found {
		return capability
	}
	return capabilities.Capability{
		Provider: account.Platform, Profile: rendition.Profile, OutputProfile: rendition.OutputProfile,
	}
}

func loadReadinessAccountsWithDB(
	ctx context.Context,
	db bun.IDB,
	workspaceID string,
	accountIDs []string,
	lock bool,
) (map[string]models.SocialAccount, error) {
	uniqueIDs := uniqueNonEmpty(accountIDs)
	if len(uniqueIDs) == 0 {
		return map[string]models.SocialAccount{}, nil
	}
	var accounts []models.SocialAccount
	query := db.NewSelect().Model(&accounts).
		Where("workspace_id = ?", workspaceID).
		Where("is_active = ?", true).
		Where("id IN (?)", bun.List(uniqueIDs)).
		Order("id ASC")
	if lock && primaryPublicationQueueUsesRowLock(db.Dialect().Name()) {
		query = query.For("UPDATE")
	}
	if err := query.Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to validate social accounts")
	}
	if len(accounts) != len(uniqueIDs) {
		return nil, huma.Error400BadRequest("one or more social accounts are invalid, disconnected, or outside this workspace")
	}
	result := make(map[string]models.SocialAccount, len(accounts))
	for _, account := range accounts {
		result[account.ID] = account
	}
	return result, nil
}

func (h *PublicationHandler) validateRepostOverride(ctx context.Context, workspaceID, userID string, input repostservice.Override) (repostservice.Override, error) {
	if h.reposts == nil {
		return repostservice.NormalizeOverride(input)
	}
	return h.reposts.ValidateOverride(ctx, workspaceID, userID, repostRequestCredential(ctx), input)
}

// All enqueue callers retain the same actionable validation details, including
// workers that cannot make a separate interactive validation request.
func publicationValidationError(issues []capabilities.ValidationIssue) error {
	var messages []string
	for _, issue := range issues {
		if issue.Severity != "error" {
			continue
		}
		message := issue.FallbackMessage
		if message == "" {
			message = issue.Message
		}
		if issue.Provider != "" {
			message = issue.Provider + ": " + message
		}
		if !slices.Contains(messages, message) {
			messages = append(messages, message)
		}
	}
	if len(messages) == 0 {
		return nil
	}
	return fmt.Errorf("%w: %s", errPublicationValidationBlocked, strings.Join(messages, "; "))
}

func hasBlockingIssues(issues []capabilities.ValidationIssue) bool {
	for _, issue := range issues {
		if issue.Severity == "error" {
			return true
		}
	}
	return false
}
