package handlers

import (
	"encoding/json"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/models"
	publicationservice "github.com/openpost/backend/internal/services/publications"
)

func readRenditionSourceOverrides(value string) []publicationservice.RenditionSourceOverride {
	var sources []publicationservice.RenditionSourceOverride
	_ = json.Unmarshal([]byte(value), &sources)
	return sources
}

func normalizeJoinedSourceOverrides(input RenditionSegmentInput, canonical []models.PublicationSegment, canonicalInputs []PublicationSegmentInput) (RenditionSegmentInput, error) {
	if len(canonical) < 2 {
		return input, huma.Error400BadRequest("source overrides require a joined publication")
	}
	overrides := make(map[string]publicationservice.RenditionSourceOverride, len(input.SourceOverrides))
	for i, source := range input.SourceOverrides {
		matched := canonicalPublicationSegment(-1, source.PublicationSegmentID, canonical, canonicalInputs)
		if matched.ID == "" {
			return input, huma.Error400BadRequest("source override does not match a canonical publication segment")
		}
		if _, exists := overrides[matched.ID]; exists {
			return input, huma.Error400BadRequest("each joined source may appear only once")
		}
		source.PublicationSegmentID = matched.ID
		if source.MediaInherited {
			source.Media = nil
		}
		input.SourceOverrides[i] = source
		overrides[matched.ID] = source
	}
	var bodies []string
	var media []PublicationMediaInput
	inherited := true
	for i, source := range canonical {
		body := source.Body
		override, found := overrides[source.ID]
		if found && override.BodyOverride != nil {
			body = *override.BodyOverride
		}
		if body = strings.TrimSpace(body); body != "" {
			bodies = append(bodies, body)
		}
		if found && !override.MediaInherited {
			inherited = false
			media = append(media, override.Media...)
		} else if i < len(canonicalInputs) {
			media = append(media, canonicalInputs[i].Media...)
		}
	}
	body := strings.Join(bodies, "\n\n")
	input.Body = body
	input.BodyOverride = &body
	input.Media = media
	input.MediaInherited = &inherited
	return input, nil
}
