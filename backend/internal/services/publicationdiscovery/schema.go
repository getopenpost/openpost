package publicationdiscovery

import "github.com/openpost/backend/internal/ai"

func discoveryResponseSchema(input Input) *ai.JSONSchema {
	return &ai.JSONSchema{
		Name:        "publication_opportunities",
		Description: "Current evidence-led publication opportunities for the selected platforms.",
		Schema: map[string]any{
			"type":                 "object",
			"additionalProperties": false,
			"required":             []string{"opportunities"},
			"properties": map[string]any{
				"opportunities": map[string]any{
					"type": "array", "minItems": 1, "maxItems": input.Limit,
					"items": discoveryOpportunitySchema(input.Platforms),
				},
			},
		},
	}
}

func discoveryOpportunitySchema(platforms []string) map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"required": []string{
			"title", "why_it_fits", "why_now", "signal_date", "hook",
			"angles", "sources", "platform_treatments",
		},
		"properties": map[string]any{
			"title":       boundedDiscoveryString(maxOpportunityTitle),
			"why_it_fits": boundedDiscoveryString(maxOpportunityReason),
			"why_now":     boundedDiscoveryString(maxOpportunityReason),
			"signal_date": boundedDiscoveryString(len("YYYY-MM-DD")),
			"hook":        boundedDiscoveryString(maxHookCharacters),
			"angles": map[string]any{
				"type": "array", "minItems": minAngles, "maxItems": maxAngles,
				"items": map[string]any{
					"type":                 "object",
					"additionalProperties": false,
					"required":             []string{"label", "thesis", "approach"},
					"properties": map[string]any{
						"label": boundedDiscoveryString(maxAngleLabel), "thesis": boundedDiscoveryString(maxAngleText),
						"approach": boundedDiscoveryString(maxAngleText),
					},
				},
			},
			"sources": map[string]any{
				"type": "array", "minItems": 1, "maxItems": maxSources,
				"items": map[string]any{
					"type":                 "object",
					"additionalProperties": false,
					"required":             []string{"title", "url", "publisher", "published_at", "supports", "primary"},
					"properties": map[string]any{
						"title": boundedDiscoveryString(maxSourceTitle), "url": boundedDiscoveryString(maxSourceURL),
						"publisher": boundedDiscoveryString(maxSourcePublisher), "published_at": boundedDiscoveryString(len("YYYY-MM-DD")),
						"supports": boundedDiscoveryString(maxSourceSupport), "primary": map[string]any{"type": "boolean"},
					},
				},
			},
			"platform_treatments": map[string]any{
				"type": "array", "minItems": len(platforms), "maxItems": len(platforms),
				"items": map[string]any{
					"type":                 "object",
					"additionalProperties": false,
					"required":             []string{"platform", "objective", "format", "rationale", "media"},
					"properties": map[string]any{
						"platform":  map[string]any{"type": "string", "enum": platforms},
						"objective": boundedDiscoveryString(maxTreatmentText), "format": boundedDiscoveryString(maxTreatmentText),
						"rationale": boundedDiscoveryString(maxTreatmentText), "media": boundedDiscoveryString(maxTreatmentText),
					},
				},
			},
		},
	}
}

func boundedDiscoveryString(maxLength int) map[string]any {
	return map[string]any{"type": "string", "minLength": 1, "maxLength": maxLength}
}
