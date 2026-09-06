package publicationbuilder

import "github.com/openpost/backend/internal/ai"

func directorResponseSchema(destinationCount int) *ai.JSONSchema {
	return &ai.JSONSchema{
		Name:        "openpost_publication_direction",
		Description: "A bounded factual direction and one decision for every candidate destination.",
		Schema: schemaObject(map[string]any{
			"canonical_text": schemaString(1, maxCanonicalCharacters),
			"factual_kernel": schemaStringArray(1, maxFactualKernelItems, maxKernelItemCharacters),
			"thesis":         schemaString(1, maxThesisCharacters),
			"outcome":        schemaString(1, maxOutcomeCharacters),
			"audience":       schemaString(1, maxAudienceCharacters),
			"angle":          schemaString(1, maxAngleCharacters),
			"route":          map[string]any{"type": "string", "enum": allowedDirectorRoutes},
			"claims":         schemaArray(claimSchema(), 0, maxClaims),
			"media":          mediaPlanSchema(),
			"destinations": schemaArray(schemaObject(map[string]any{
				"account_id": schemaString(1, 160),
				"include":    map[string]any{"type": "boolean"},
				"reason":     schemaString(1, maxDecisionCharacters),
			}, "account_id", "include", "reason"), destinationCount, destinationCount),
		}, "canonical_text", "factual_kernel", "thesis", "outcome", "audience", "angle", "route", "claims", "media", "destinations"),
	}
}

func adapterResponseSchema(destination Destination, policy platformPolicy) *ai.JSONSchema {
	profiles := make([]string, 0, len(destination.AllowedOutputProfiles))
	maxSegments := 1
	for _, profile := range destination.AllowedOutputProfiles {
		profiles = append(profiles, profile.Key)
		if profile.MaxSegments > maxSegments {
			maxSegments = profile.MaxSegments
		}
	}
	return &ai.JSONSchema{
		Name:        "openpost_destination_rendition",
		Description: "One bounded platform-native rendition for the selected destination.",
		Schema: schemaObject(map[string]any{
			"account_id":     map[string]any{"type": "string", "enum": []string{destination.AccountID}},
			"objective":      map[string]any{"type": "string", "enum": policy.Objectives},
			"archetype":      map[string]any{"type": "string", "enum": policy.Archetypes},
			"output_profile": map[string]any{"type": "string", "enum": profiles},
			"preview":        schemaString(1, maxPreviewCharacters),
			"segments":       schemaArray(segmentSchema(), 1, maxSegments),
			"media":          mediaPlanSchema(),
			"claims":         schemaArray(claimSchema(), 0, maxClaims),
			"warnings":       schemaStringArray(0, maxWarningsPerDestination, maxDecisionCharacters),
			"follow_up_notes": schemaStringArray(
				0,
				maxWarningsPerDestination,
				maxDecisionCharacters,
			),
		}, "account_id", "objective", "archetype", "output_profile", "preview", "segments", "media", "claims", "warnings", "follow_up_notes"),
	}
}

func reviewerResponseSchema() *ai.JSONSchema {
	flag := schemaObject(map[string]any{
		"account_id": schemaString(0, 160),
		"field":      schemaString(1, 120),
		"severity":   schemaString(1, 40),
		"message":    schemaString(1, maxDecisionCharacters),
	}, "account_id", "field", "severity", "message")
	replacement := schemaObject(map[string]any{
		"account_id": schemaString(1, 160),
		"preview":    schemaString(0, maxPreviewCharacters),
		"segments":   schemaArray(segmentSchema(), 1, 20),
	}, "account_id", "preview", "segments")
	return &ai.JSONSchema{
		Name:        "openpost_publication_review",
		Description: "A source-fidelity and platform-fit verdict with bounded repairs.",
		Schema: schemaObject(map[string]any{
			"approved":     map[string]any{"type": "boolean"},
			"flags":        schemaArray(flag, 0, maxClaims),
			"replacements": schemaArray(replacement, 0, 20),
		}, "approved", "flags", "replacements"),
	}
}

func claimSchema() map[string]any {
	return schemaObject(map[string]any{
		"text":        schemaString(1, maxKernelItemCharacters),
		"status":      map[string]any{"type": "string", "enum": allowedClaimStatuses},
		"source_refs": schemaStringArray(0, maxSourceCount+1, 160),
	}, "text", "status", "source_refs")
}

func mediaPlanSchema() map[string]any {
	return schemaObject(map[string]any{
		"treatment": map[string]any{"type": "string", "enum": allowedMediaTreatments},
		"role":      schemaString(1, 80),
		"brief":     schemaString(1, 800),
		"source_ref": schemaString(
			0,
			160,
		),
	}, "treatment", "role", "brief", "source_ref")
}

func segmentSchema() map[string]any {
	return schemaObject(map[string]any{
		"body":        schemaString(1, maxCanonicalCharacters),
		"title":       schemaString(0, 1_000),
		"description": schemaString(0, 2_000),
	}, "body", "title", "description")
}

func schemaString(minimum, maximum int) map[string]any {
	return map[string]any{"type": "string", "minLength": minimum, "maxLength": maximum}
}

func schemaStringArray(minimum, maximum, itemMaximum int) map[string]any {
	return schemaArray(schemaString(1, itemMaximum), minimum, maximum)
}

func schemaArray(items map[string]any, minimum, maximum int) map[string]any {
	return map[string]any{"type": "array", "minItems": minimum, "maxItems": maximum, "items": items}
}

func schemaObject(properties map[string]any, required ...string) map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties":           properties,
		"required":             required,
	}
}
