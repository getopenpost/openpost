package publicationsource

import (
	"encoding/json"
	"strings"

	"github.com/openpost/backend/internal/models"
)

func HasSourceOverrides(value string) bool {
	var overrides []RenditionSourceOverride
	return json.Unmarshal([]byte(value), &overrides) == nil && len(overrides) > 0
}

// AuthoredBody excludes generated poll blocks and retains per-source decisions.
func AuthoredBody(source models.PublicationSegment, canonical []models.PublicationSegment, overridesJSON string, override *string, joined bool) string {
	if joined || HasSourceOverrides(overridesJSON) {
		return JoinedSourceBody(canonical, overridesJSON, override)
	}
	if override != nil {
		return *override
	}
	return source.Body
}

// JoinedSourceBody projects canonical source bodies without turning inherited text into authorship.
func JoinedSourceBody(canonical []models.PublicationSegment, overridesJSON string, fallback *string) string {
	var overrides []RenditionSourceOverride
	_ = json.Unmarshal([]byte(overridesJSON), &overrides)
	if len(overrides) == 0 && fallback != nil {
		return *fallback
	}
	byID := make(map[string]*string, len(overrides))
	for _, override := range overrides {
		byID[override.PublicationSegmentID] = override.BodyOverride
	}
	var bodies []string
	for _, source := range canonical {
		body := source.Body
		if override := byID[source.ID]; override != nil {
			body = *override
		}
		if body = strings.TrimSpace(body); body != "" {
			bodies = append(bodies, body)
		}
	}
	return strings.Join(bodies, "\n\n")
}

type PublicationMediaInput struct {
	MediaID              string                 `json:"media_id" doc:"Media attachment ID"`
	Role                 string                 `json:"role,omitempty" doc:"Media role: attachment, cover, thumbnail"`
	AltText              string                 `json:"alt_text,omitempty" doc:"Alt text override"`
	ThumbnailTimestampMS int                    `json:"thumbnail_timestamp_ms,omitempty" doc:"Video thumbnail timestamp"`
	Settings             map[string]interface{} `json:"settings,omitempty" doc:"Media-item settings"`
}

// RenditionSourceOverride retains source authorship inside one joined destination output.
// A nil body inherits; an empty body is an explicit omission.
type RenditionSourceOverride struct {
	PublicationSegmentID string                  `json:"publication_segment_id" doc:"Canonical source segment ID, or matching client reference in the same request"`
	BodyOverride         *string                 `json:"body_override,omitempty" doc:"Explicit source body; omit or null to inherit"`
	MediaInherited       bool                    `json:"media_inherited" doc:"Whether this source contributes its canonical media"`
	Media                []PublicationMediaInput `json:"media,omitempty" doc:"Independent source media, including an explicit empty list"`
}
