package publisher

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"strings"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/connectors"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/posttext"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/publicationauth"
	"github.com/openpost/backend/internal/services/publicationlink"
	"github.com/openpost/backend/internal/services/publicationpoll"
	"github.com/openpost/backend/internal/services/publicationsource"
	"github.com/openpost/backend/internal/textutil"
	"github.com/uptrace/bun"
)

// deliveryTarget is one destination's resolved account, provider, credential
// and readiness evidence. Publishes and replies share it.
type deliveryTarget struct {
	publication   *models.Publication
	rendition     *models.Rendition
	authorization *models.PublicationAuthorization
	account       *models.SocialAccount
	provider      platform.Publisher
	providerKey   string
	// refreshable is false for connector-backed and instance-credential
	// providers, which do not use the account's OAuth token.
	refreshable bool
	token       string
	readiness   writeReadiness
}

func (t *deliveryTarget) writeScope(subject, operation string) providerWriteScope {
	scope := publicationWriteScope(t.authorization, subject, operation)
	readiness := t.readiness
	scope.readiness = &readiness
	return scope
}

// deliveryPlan is a rendition whose every unpublished output has passed all
// local and provider-side validation. Execution starts only from a complete
// plan, so a thread never stops half-published on a predictable failure.
type deliveryPlan struct {
	*deliveryTarget
	// baseSettings are the destination settings without the native projection.
	baseSettings map[string]any
	segments     []preparedSegment
	// legacy marks a rendition without normalized segments. It is delivered as
	// one synthetic segment whose provider-write subject is the rendition ID.
	legacy bool
}

// preparedSegment is one output's final delivery input. Each segment owns its
// body, description and settings; no segment's resolution leaks into another.
type preparedSegment struct {
	id            string
	row           *models.RenditionSegment
	body          string
	title         string
	description   string
	settings      map[string]any
	media         []models.MediaAttachment
	altTexts      []string
	mediaSettings []map[string]any
}

func (p *preparedSegment) published() bool {
	return p.row != nil && p.row.Status == models.RenditionStatusPublished
}

// connectorTarget is a connector-backed account's publisher and the
// capability its installation declares for the rendition output.
type connectorTarget struct {
	publisher      platform.Publisher
	installationID string
	capability     capabilities.Capability
}

func (s *Service) connectorForAccount(ctx context.Context, account *models.SocialAccount, outputProfile, profile string) (*connectorTarget, error) {
	if s.connectorStore == nil || s.connectorRegistry == nil {
		return nil, nil
	}
	binding, err := s.connectorStore.BindingForAccount(ctx, account.WorkspaceID, account.ID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	client, entry, err := s.connectorRegistry.ClientForWorkspace(binding.InstallationID, account.WorkspaceID)
	if err != nil {
		return nil, err
	}
	if binding.CapabilityRevision != entry.Manifest.CapabilityRevision {
		return nil, fmt.Errorf("connector capabilities changed; reconnect account before publishing")
	}
	for _, capability := range entry.Capabilities() {
		if (outputProfile != "" && capability.OutputProfile == outputProfile) ||
			(outputProfile == "" && capability.Profile == profile) {
			return &connectorTarget{
				publisher:      connectors.NewPublisher(client, binding.ConnectionRef, binding.CapabilityRevision),
				installationID: binding.InstallationID,
				capability:     capability,
			}, nil
		}
	}
	return nil, fmt.Errorf("connector installation %q does not support output profile %q", binding.InstallationID, outputProfile)
}

func (s *Service) nativeProvider(account *models.SocialAccount) (platform.Publisher, string, error) {
	providerKey := platform.AccountProviderKey(account.Platform, account.InstanceURL, account.CapabilityState)
	s.providerMu.RLock()
	provider, ok := s.providers[providerKey]
	s.providerMu.RUnlock()
	if !ok {
		return nil, providerKey, fmt.Errorf("unsupported platform: %s (instance: %s)", account.Platform, account.InstanceURL)
	}
	return provider, providerKey, nil
}

func publisherRenditionCapability(account *models.SocialAccount, rendition *models.Rendition) capabilities.Capability {
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

// renditionReadiness resolves the readiness evidence from the rendition's
// stored settings, the same source the authorization snapshot hashed.
func (s *Service) renditionReadiness(
	ctx context.Context,
	account *models.SocialAccount,
	rendition *models.Rendition,
	authorization *models.PublicationAuthorization,
	intent providerreadiness.ExecutionIntent,
	connector *connectorTarget,
) (writeReadiness, error) {
	readiness := writeReadiness{
		connectorBacked: connector != nil,
		capability:      publisherRenditionCapability(account, rendition),
		operation:       providerreadiness.OperationPublishImmediate,
		intent:          intent,
	}
	settingsKind := "provider policy"
	if connector != nil {
		readiness.capability = connector.capability
		settingsKind = "connector"
	} else if s.readiness == nil {
		return writeReadiness{}, &providerreadiness.NotReadyError{
			Decision: providerreadiness.UnavailableDecision(providerreadiness.OperationPublishImmediate),
		}
	}
	if authorization != nil && authorization.PolicyMode == publicationauth.PolicyScheduled {
		readiness.operation = providerreadiness.OperationPublishScheduled
	}
	settings := map[string]any{}
	if err := json.Unmarshal([]byte(rendition.SettingsJSON), &settings); err != nil {
		return writeReadiness{}, fmt.Errorf("decode rendition %s settings: %w", settingsKind, err)
	}
	readiness.policyMode = providerreadiness.PublicationPolicyMode(*account, readiness.capability, settings)
	if authorization != nil && authorization.ProviderPolicyMode != readiness.policyMode {
		return writeReadiness{}, fmt.Errorf("publication authorization validation failed: provider policy mode changed")
	}
	if err := s.decideWriteReadiness(ctx, *account, readiness); err != nil {
		return writeReadiness{}, err
	}
	return readiness, nil
}

// resolveDeliveryTarget loads the destination account once and resolves its
// provider, readiness and credential before any provider call.
func (s *Service) resolveDeliveryTarget(
	ctx context.Context,
	publication *models.Publication,
	rendition *models.Rendition,
	authorization *models.PublicationAuthorization,
	intent providerreadiness.ExecutionIntent,
) (*deliveryTarget, error) {
	account := new(models.SocialAccount)
	if err := s.db.NewSelect().Model(account).Where("id = ?", rendition.SocialAccountID).Scan(ctx); err != nil {
		return nil, fmt.Errorf("account not found: %w", err)
	}
	connector, err := s.connectorForAccount(ctx, account, rendition.OutputProfile, rendition.Profile)
	if err != nil {
		return nil, err
	}
	readiness, err := s.renditionReadiness(ctx, account, rendition, authorization, intent, connector)
	if err != nil {
		return nil, err
	}
	target := &deliveryTarget{
		publication: publication, rendition: rendition, authorization: authorization,
		account: account, readiness: readiness,
	}
	if connector != nil {
		target.provider, target.providerKey = connector.publisher, connector.installationID
	} else {
		if target.provider, target.providerKey, err = s.nativeProvider(account); err != nil {
			return nil, err
		}
		_, usesInstanceCredential := target.provider.(platform.InstanceCredentialPublisher)
		target.refreshable = !usesInstanceCredential
	}
	if target.refreshable {
		if target.token, err = s.tm.GetValidAccessToken(ctx, account.ID); err != nil {
			return nil, &credentialError{operation: "auth error", cause: err}
		}
	}
	return target, nil
}

// buildDeliveryPlan resolves and validates every unpublished output of a
// rendition. Failures that belong to one segment are recorded on it.
func (s *Service) buildDeliveryPlan(
	ctx context.Context,
	publication *models.Publication,
	rendition *models.Rendition,
	authorization *models.PublicationAuthorization,
	intent providerreadiness.ExecutionIntent,
) (*deliveryPlan, error) {
	var rows []models.RenditionSegment
	if err := s.db.NewSelect().Model(&rows).Where("rendition_id = ?", rendition.ID).Order("position ASC").Scan(ctx); err != nil && !isMissingNormalizedSegmentTable(err) {
		return nil, fmt.Errorf("loading rendition segments: %w", err)
	}
	target, err := s.resolveDeliveryTarget(ctx, publication, rendition, authorization, intent)
	if err != nil {
		return nil, err
	}
	plan := &deliveryPlan{deliveryTarget: target, baseSettings: map[string]any{}, legacy: len(rows) == 0}
	_ = json.Unmarshal([]byte(rendition.SettingsJSON), &plan.baseSettings)
	if plan.baseSettings == nil {
		plan.baseSettings = map[string]any{}
	}
	delete(plan.baseSettings, posttext.NativeSettingsKey)
	if err := s.withFreshToken(ctx, target, func(token string, _ bool) error {
		return validatePublishingTarget(ctx, target.provider, token, target.account.AccountID, plan.baseSettings)
	}); err != nil {
		return nil, err
	}
	if plan.legacy {
		err = s.prepareLegacySegment(ctx, plan)
	} else {
		err = s.prepareSegments(ctx, plan, rows)
	}
	if err != nil {
		return nil, err
	}
	for i := range plan.segments {
		segment := &plan.segments[i]
		if segment.published() {
			continue
		}
		if err := s.validatePreparedSegment(ctx, plan, segment); err != nil {
			return nil, s.persistRenditionSegmentOutcome(ctx, segment.row, err)
		}
	}
	return plan, nil
}

func (s *Service) prepareLegacySegment(ctx context.Context, plan *deliveryPlan) error {
	media, altTexts, mediaSettings, err := s.loadRenditionMedia(ctx, plan.rendition.ID)
	if err != nil {
		return err
	}
	plan.segments = []preparedSegment{{
		id:            plan.rendition.ID,
		body:          plan.rendition.Body,
		title:         textutil.FirstNonEmptyRaw(plan.rendition.Title, plan.publication.Title),
		description:   plan.rendition.Description,
		settings:      maps.Clone(plan.baseSettings),
		media:         media,
		altTexts:      altTexts,
		mediaSettings: mediaSettings,
	}}
	return nil
}

// canonicalSource is a publication segment with its decoded settings.
type canonicalSource struct {
	models.PublicationSegment
	settings map[string]any
}

func (s *Service) prepareSegments(ctx context.Context, plan *deliveryPlan, rows []models.RenditionSegment) error {
	var canonical []models.PublicationSegment
	if err := s.db.NewSelect().Model(&canonical).Where("publication_id = ?", plan.publication.ID).Order("position ASC").Scan(ctx); err != nil {
		return err
	}
	sources := make(map[string]canonicalSource, len(canonical))
	sourceSettings := make([]map[string]any, 0, len(canonical))
	hasPoll := false
	for _, source := range canonical {
		var settings map[string]any
		_ = json.Unmarshal([]byte(source.SettingsJSON), &settings)
		hasPoll = hasPoll || settings[publicationpoll.SettingsKey] != nil
		sources[source.ID] = canonicalSource{PublicationSegment: source, settings: settings}
		sourceSettings = append(sourceSettings, settings)
	}
	// A single output that carries several sources joins them into one post.
	joinedSingle := len(rows) == 1 && len(canonical) > 1
	pending := make([]string, 0, len(rows))
	for _, row := range rows {
		if row.Status != models.RenditionStatusPublished {
			pending = append(pending, row.ID)
		}
	}
	media, err := s.loadSegmentMedia(ctx, pending)
	if err != nil {
		return err
	}
	plan.segments = make([]preparedSegment, len(rows))
	for i := range rows {
		row := &rows[i]
		segment := &plan.segments[i]
		*segment = preparedSegment{id: row.ID, row: row}
		if segment.published() {
			if row.ExternalID == "" {
				return fmt.Errorf("published rendition segment %s is missing its external id", row.ID)
			}
			continue
		}
		loaded := media[row.ID]
		segment.media, segment.altTexts, segment.mediaSettings = loaded.attachments, loaded.altTexts, loaded.settings
		if err := s.resolveSegmentText(plan, segment, canonical, sources, sourceSettings, hasPoll, joinedSingle); err != nil {
			return s.persistRenditionSegmentOutcome(ctx, segment.row, err)
		}
	}
	return nil
}

// resolveSegmentText resolves a segment's poll, link, mention and caption
// projections into its own delivery fields.
func (s *Service) resolveSegmentText(
	plan *deliveryPlan,
	segment *preparedSegment,
	canonical []models.PublicationSegment,
	sources map[string]canonicalSource,
	sourceSettings []map[string]any,
	hasPoll, joinedSingle bool,
) error {
	row, account, rendition := segment.row, plan.account, plan.rendition
	var settings map[string]any
	_ = json.Unmarshal([]byte(row.SettingsJSON), &settings)
	source, hasSource := sources[row.PublicationSegmentID]
	body, settings, err := resolveSegmentPoll(plan, row, canonical, source, hasSource, sourceSettings, hasPoll && joinedSingle, settings)
	if err != nil {
		return err
	}
	// URL inheritance resolves from authored text, never from a generated poll block.
	if hasSource && source.settings[publicationlink.SettingsKey] != nil {
		authored := publicationsource.AuthoredBody(source.PublicationSegment, canonical, row.SourceOverridesJSON, row.BodyOverride, joinedSingle)
		if settings, err = publicationlink.ResolveEffective(source.settings, account.ID, rendition.Platform, authored, plan.baseSettings, settings, len(segment.media)); err != nil {
			return fmt.Errorf("link validation: %w", err)
		}
	}
	if settings == nil {
		settings = map[string]any{}
	}
	delivered, projection, err := publicationsource.DeliveryText(canonical, row.PublicationSegmentID, row.SourceOverridesJSON, row.BodyOverride, settings, joinedSingle, body, rendition.Platform, account.InstanceURL)
	if err != nil {
		return fmt.Errorf("mention validation: %w", err)
	}
	// Descriptions mirroring the body follow its projection. The destination
	// settings are copied so one segment's caption never reaches another.
	destination := maps.Clone(plan.baseSettings)
	segmentDescription := posttext.ProjectEquivalentText(row.Description, body, delivered)
	renditionDescription := posttext.ProjectEquivalentText(rendition.Description, body, delivered)
	for _, values := range []map[string]any{settings, destination} {
		for _, key := range []string{"description", "video_description"} {
			if value, ok := values[key].(string); ok {
				values[key] = posttext.ProjectEquivalentText(value, body, delivered)
			}
		}
	}
	field, caption, err := publicationsource.DeliveryCaption(settings, rendition.Platform, account.InstanceURL)
	if err != nil {
		return fmt.Errorf("caption mention validation: %w", err)
	}
	if field != "" {
		segmentDescription, renditionDescription = caption, caption
		settings[field], destination[field] = caption, caption
	}
	delete(settings, posttext.NativeSettingsKey)
	if projection != nil {
		settings[posttext.NativeSettingsKey] = projection
	}
	merged, err := normalizedSettings(mergePublisherSettings(destination, settings))
	if err != nil {
		return err
	}
	segment.body = delivered
	segment.title = textutil.FirstNonEmptyRaw(row.Title, rendition.Title, plan.publication.Title)
	segment.description = textutil.FirstNonEmptyRaw(segmentDescription, renditionDescription)
	segment.settings = merged
	return nil
}

// resolveSegmentPoll applies the segment's poll choice. Joined outputs resolve
// every source's poll together; other outputs resolve their own source's poll.
func resolveSegmentPoll(
	plan *deliveryPlan,
	row *models.RenditionSegment,
	canonical []models.PublicationSegment,
	source canonicalSource,
	hasSource bool,
	sourceSettings []map[string]any,
	joinedPoll bool,
	settings map[string]any,
) (string, map[string]any, error) {
	account, rendition := plan.account, plan.rendition
	switch {
	case publicationsource.HasSourceOverrides(row.SourceOverridesJSON) || joinedPoll:
		body := publicationsource.JoinedSourceBody(canonical, row.SourceOverridesJSON, row.BodyOverride)
		return publicationpoll.ResolveJoined(sourceSettings, account.ID, rendition.Platform, rendition.OutputProfile, body, settings)
	case hasSource && source.settings[publicationpoll.SettingsKey] != nil:
		body := source.Body
		if row.BodyOverride != nil {
			body = *row.BodyOverride
		}
		return publicationpoll.Resolve(source.settings, account.ID, rendition.Platform, rendition.OutputProfile, body, settings)
	default:
		return row.Body, settings, nil
	}
}

// normalizedSettings gives resolved settings the JSON value types providers
// read from stored settings, such as float64 numbers and plain maps.
func normalizedSettings(settings map[string]any) (map[string]any, error) {
	data, err := json.Marshal(settings)
	if err != nil {
		return nil, fmt.Errorf("encode delivery settings: %w", err)
	}
	normalized := map[string]any{}
	if err := json.Unmarshal(data, &normalized); err != nil {
		return nil, fmt.Errorf("decode delivery settings: %w", err)
	}
	return normalized, nil
}

// validatePreparedSegment runs every remaining check that can reject an
// output before the first provider write of the rendition.
func (s *Service) validatePreparedSegment(ctx context.Context, plan *deliveryPlan, segment *preparedSegment) error {
	account := plan.account
	if validator, ok := plan.provider.(platform.MentionTargetValidator); ok && !plan.legacy {
		request := &platform.PublishRequest{Content: segment.body, Settings: segment.settings}
		if err := s.withFreshToken(ctx, plan.deliveryTarget, func(token string, _ bool) error {
			return validator.ValidateMentionTargets(ctx, token, request)
		}); err != nil {
			return fmt.Errorf("mention validation: %w", err)
		}
	}
	if !plan.legacy {
		required := make([]capabilities.MediaItem, 0, len(segment.media))
		for _, media := range segment.media {
			if media.TrashedAt.IsZero() && media.ProcessingStatus == "ready" {
				required = append(required, capabilities.MediaItem{ID: media.ID, MimeType: media.MimeType})
			}
		}
		if issues := capabilities.ValidateAttachmentRequirement(account.Platform, plan.rendition.OutputProfile, required, segment.settings); len(issues) > 0 {
			return fmt.Errorf("attachment validation: %s", issues[0].Message)
		}
	}
	// Bluesky inspects the stored objects; recovered metadata stays on the
	// prepared media used for the write.
	if strings.EqualFold(account.Platform, "bluesky") {
		if err := s.preflightBlueskyGalleryMedia(ctx, segment.media); err != nil {
			return fmt.Errorf("bluesky gallery preflight: %w", err)
		}
	}
	segment.settings = capabilities.NormalizeMediaTextLinkSettings(account.Platform, len(segment.media), segment.settings)
	if account.Platform == "x" {
		request := &platform.PublishRequest{MediaSettings: segment.mediaSettings}
		if err := s.withFreshToken(ctx, plan.deliveryTarget, func(token string, _ bool) error {
			return s.resolveRenditionTaggedUsers(ctx, plan.publication.WorkspaceID, plan.provider, token, request)
		}); err != nil {
			return err
		}
		segment.mediaSettings = request.MediaSettings
	}
	return nil
}

// segmentMedia is one segment's ordered media with its per-use descriptors.
type segmentMedia struct {
	attachments []models.MediaAttachment
	altTexts    []string
	settings    []map[string]any
}

// loadSegmentMedia loads the media of several segments in one query.
func (s *Service) loadSegmentMedia(ctx context.Context, segmentIDs []string) (map[string]segmentMedia, error) {
	loaded := make(map[string]segmentMedia, len(segmentIDs))
	if len(segmentIDs) == 0 {
		return loaded, nil
	}
	var rows []struct {
		SegmentID            string `bun:"context_segment_id"`
		AltText              string `bun:"context_alt_text"`
		ThumbnailTimestampMS int    `bun:"thumbnail_timestamp_ms"`
		SettingsJSON         string `bun:"settings_json"`
		models.MediaAttachment
	}
	if err := s.db.NewSelect().
		TableExpr("rendition_segment_media AS rsm").
		ColumnExpr("rsm.rendition_segment_id AS context_segment_id, rsm.alt_text AS context_alt_text, rsm.thumbnail_timestamp_ms, rsm.settings_json").
		ColumnExpr("ma.*").
		Join("JOIN media_attachments AS ma ON ma.id = rsm.media_id").
		Where("rsm.rendition_segment_id IN (?)", bun.List(segmentIDs)).
		Order("rsm.rendition_segment_id ASC", "rsm.display_order ASC").
		Scan(ctx, &rows); err != nil {
		return nil, fmt.Errorf("fetching rendition segment media: %w", err)
	}
	for _, row := range rows {
		item := loaded[row.SegmentID]
		item.attachments = append(item.attachments, row.MediaAttachment)
		item.altTexts = append(item.altTexts, textutil.FirstNonEmptyRaw(row.AltText, row.MediaAttachment.AltText))
		itemSettings := map[string]any{}
		_ = json.Unmarshal([]byte(row.SettingsJSON), &itemSettings)
		if itemSettings == nil {
			itemSettings = map[string]any{}
		}
		if row.ThumbnailTimestampMS > 0 {
			itemSettings["thumbnail_timestamp_ms"] = row.ThumbnailTimestampMS
		}
		item.settings = append(item.settings, itemSettings)
		loaded[row.SegmentID] = item
	}
	return loaded, nil
}

func (s *Service) loadRenditionMedia(ctx context.Context, renditionID string) ([]models.MediaAttachment, []string, []map[string]any, error) {
	var rows []struct {
		AltText              string `bun:"context_alt_text"`
		ThumbnailTimestampMS int    `bun:"thumbnail_timestamp_ms"`
		models.MediaAttachment
	}
	if err := s.db.NewSelect().
		TableExpr("rendition_media AS rm").
		ColumnExpr("rm.alt_text AS context_alt_text, rm.thumbnail_timestamp_ms").
		ColumnExpr("ma.*").
		Join("JOIN media_attachments AS ma ON ma.id = rm.media_id").
		Where("rm.rendition_id = ?", renditionID).
		Order("rm.display_order ASC").
		Scan(ctx, &rows); err != nil {
		return nil, nil, nil, fmt.Errorf("fetching rendition media: %w", err)
	}
	media := make([]models.MediaAttachment, 0, len(rows))
	altTexts := make([]string, 0, len(rows))
	settings := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		media = append(media, row.MediaAttachment)
		altTexts = append(altTexts, textutil.FirstNonEmptyRaw(row.AltText, row.MediaAttachment.AltText))
		itemSettings := map[string]any{}
		if row.ThumbnailTimestampMS > 0 {
			itemSettings["thumbnail_timestamp_ms"] = row.ThumbnailTimestampMS
		}
		settings = append(settings, itemSettings)
	}
	return media, altTexts, settings, nil
}

func isMissingNormalizedSegmentTable(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such table") ||
		(strings.Contains(message, "relation") && strings.Contains(message, "does not exist"))
}
