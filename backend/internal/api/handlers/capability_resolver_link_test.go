package handlers

import (
	"testing"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/stretchr/testify/require"
)

func TestSatisfyCanonicalURLRequirement(t *testing.T) {
	tests := []struct {
		name       string
		sourceURL  string
		segmentURL string
	}{
		{name: "source URL", sourceURL: "https://example.com"},
		{name: "segment URL", segmentURL: "https://example.com"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			segments := []capabilities.ResolveSegment{{
				ID:   "segment-1",
				Body: "A link post",
				URL:  tt.segmentURL,
			}}
			resolved := capabilities.Resolve(capabilities.ProviderX, capabilities.ResolveInput{
				Intent:    capabilities.IntentPost,
				SourceURL: tt.sourceURL,
				Segments:  segments,
			})

			require.Equal(t, capabilities.MediaShapeLink, resolved.ActiveConstraints["media_shape"])
			require.True(t, hasCapabilityIssue(resolved.Issues, "setting_required", "url"))
			require.False(t, resolved.Compatible)

			satisfyCanonicalURLRequirement(&resolved, tt.sourceURL, segments)

			require.False(t, hasCapabilityIssue(resolved.Issues, "setting_required", "url"))
			require.True(t, resolved.Compatible)
		})
	}
}

func TestSatisfyCanonicalURLRequirementNeedsCanonicalURL(t *testing.T) {
	resolved := capabilities.ResolvedCapability{
		Compatible: false,
		ActiveConstraints: map[string]any{
			"media_shape": capabilities.MediaShapeLink,
		},
		Issues: []capabilities.ValidationIssue{{
			Severity: "error",
			Code:     "setting_required",
			Field:    "url",
		}},
	}

	satisfyCanonicalURLRequirement(&resolved, "", nil)

	require.True(t, hasCapabilityIssue(resolved.Issues, "setting_required", "url"))
	require.False(t, resolved.Compatible)
}

func TestSatisfyCanonicalURLRequirementKeepsOtherErrors(t *testing.T) {
	resolved := capabilities.ResolvedCapability{
		Compatible: false,
		ActiveConstraints: map[string]any{
			"media_shape": capabilities.MediaShapeLink,
		},
		Issues: []capabilities.ValidationIssue{
			{
				Severity: "error",
				Code:     "setting_required",
				Field:    "link_url",
			},
			{
				Severity: "error",
				Code:     "other_error",
				Field:    "body",
			},
		},
	}

	satisfyCanonicalURLRequirement(&resolved, "https://example.com", nil)

	require.False(t, hasCapabilityIssue(resolved.Issues, "setting_required", "link_url"))
	require.True(t, hasCapabilityIssue(resolved.Issues, "other_error", "body"))
	require.False(t, resolved.Compatible)
}

func hasCapabilityIssue(issues []capabilities.ValidationIssue, code string, field string) bool {
	for _, issue := range issues {
		if issue.Code == code && issue.Field == field {
			return true
		}
	}
	return false
}
