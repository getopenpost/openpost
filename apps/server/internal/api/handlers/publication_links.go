package handlers

import (
	"context"
	"encoding/json"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/publicationlink"
	"github.com/openpost/backend/internal/services/publicationpoll"
	"github.com/openpost/backend/internal/services/publicationsource"
	"github.com/uptrace/bun"
)

func refreshPublicationLinks(ctx context.Context, db bun.IDB, publicationID string, previous []models.PublicationSegment) error {
	var canonical []models.PublicationSegment
	if err := db.NewSelect().Model(&canonical).Where("publication_id = ?", publicationID).Order("position ASC").Scan(ctx); err != nil {
		return err
	}
	previousSettings := map[string]map[string]any{}
	for _, source := range previous {
		var values map[string]any
		_ = json.Unmarshal([]byte(source.SettingsJSON), &values)
		previousSettings[source.ID] = values
	}
	byID := map[string]models.PublicationSegment{}
	for _, source := range canonical {
		byID[source.ID] = source
	}
	var renditions []models.Rendition
	if err := db.NewSelect().Model(&renditions).Where("publication_id = ?", publicationID).Scan(ctx); err != nil {
		return err
	}
	for _, rendition := range renditions {
		if err := refreshRenditionLinks(ctx, db, rendition, canonical, byID, previousSettings); err != nil {
			return err
		}
	}
	return nil
}

func refreshRenditionLinks(ctx context.Context, db bun.IDB, rendition models.Rendition, canonical []models.PublicationSegment, byID map[string]models.PublicationSegment, previousSettings map[string]map[string]any) error {
	var destinationSettings map[string]any
	_ = json.Unmarshal([]byte(rendition.SettingsJSON), &destinationSettings)
	var segments []models.RenditionSegment
	if err := db.NewSelect().Model(&segments).Where("rendition_id = ?", rendition.ID).Order("position ASC").Scan(ctx); err != nil {
		return err
	}
	for _, segment := range segments {
		source, found := byID[segment.PublicationSegmentID]
		if !found {
			continue
		}
		var sourceSettings, settings map[string]any
		_ = json.Unmarshal([]byte(source.SettingsJSON), &sourceSettings)
		_ = json.Unmarshal([]byte(segment.SettingsJSON), &settings)
		if sourceSettings[publicationlink.SettingsKey] == nil {
			before := previousSettings[source.ID]
			if before[publicationlink.SettingsKey] == nil {
				continue
			}
			settings = publicationlink.AuthoredDestinationSettings(before, rendition.SocialAccountID, settings)
		}
		body := authoredLinkBody(source, canonical, segment, len(segments))
		mediaCount, err := db.NewSelect().Model((*models.RenditionSegmentMedia)(nil)).Where("rendition_segment_id = ?", segment.ID).Count(ctx)
		if err != nil {
			return err
		}
		projectedBody, projectedSettings, _ := publicationpoll.Resolve(sourceSettings, rendition.SocialAccountID, rendition.Platform, rendition.OutputProfile, body, settings)
		if len(segments) == 1 && len(canonical) > 1 {
			projectedBody, projectedSettings, _ = publicationpoll.ResolveJoined(publicationPollSources(canonical), rendition.SocialAccountID, rendition.Platform, rendition.OutputProfile, body, settings)
		}
		segment.Body = projectedBody
		values, _ := publicationlink.ResolveEffective(sourceSettings, rendition.SocialAccountID, rendition.Platform, body, destinationSettings, projectedSettings, mediaCount)
		segment.SettingsJSON = mustJSON(values)
		if _, err := db.NewUpdate().Model(&segment).Column("body", "settings_json").Where("id = ?", segment.ID).Exec(ctx); err != nil {
			return err
		}
		if segment.Position == 0 {
			if _, err := db.NewUpdate().Model((*models.Rendition)(nil)).Set("body = ?", segment.Body).Where("id = ?", rendition.ID).Exec(ctx); err != nil {
				return err
			}
		}
	}
	return nil
}

func authoredLinkBody(source models.PublicationSegment, canonical []models.PublicationSegment, segment models.RenditionSegment, outputCount int) string {
	return publicationsource.AuthoredBody(source, canonical, segment.SourceOverridesJSON, segment.BodyOverride, outputCount == 1 && len(canonical) > 1)
}

func validatePublicationLink(rendition models.Rendition, segment RenditionSegmentResponse, canonical []models.PublicationSegment, outputCount int) []capabilities.ValidationIssue {
	for _, source := range canonical {
		if source.ID != segment.PublicationSegmentID {
			continue
		}
		var values map[string]any
		_ = json.Unmarshal([]byte(source.SettingsJSON), &values)
		body := publicationsource.AuthoredBody(source, canonical, mustJSON(segment.SourceOverrides), segment.BodyOverride, outputCount == 1 && len(canonical) > 1)
		var destination map[string]any
		_ = json.Unmarshal([]byte(rendition.SettingsJSON), &destination)
		_, err := publicationlink.ResolveEffective(values, rendition.SocialAccountID, rendition.Platform, body, destination, segment.Settings, len(segment.Media))
		if err != nil {
			return []capabilities.ValidationIssue{{Code: "link_choice_invalid", Message: err.Error(), Severity: "error", Provider: rendition.Platform, Field: "url", SegmentID: segment.ID, Scope: capabilities.SettingScopeSegment, ScopeID: segment.ID}}
		}
	}
	return nil
}
