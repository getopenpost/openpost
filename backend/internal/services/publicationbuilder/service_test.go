package publicationbuilder

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDirectorValidationEnforcesLockedDirection(t *testing.T) {
	t.Parallel()
	plan := DirectorPlan{
		CanonicalText: "A canonical draft.", FactualKernel: []string{"A supplied fact."},
		Thesis: "The thesis.", Outcome: "authority", Audience: "founders", Angle: "show the proof",
		Route: "artifact_led", Media: MediaPlan{Treatment: "none", Role: "none", Brief: "No media."},
		Destinations: []DestinationDecision{{AccountID: "x-1", Include: true, Reason: "Strong native fit."}},
	}
	destinations := []Destination{{AccountID: "x-1", Platform: "x"}}
	locked := DirectionInput{Outcome: "discussion", Audience: "technical founders", Angle: "lead with the artifact"}
	require.ErrorContains(t, validateDirector(plan, destinations, sourceReferenceCatalog{}, locked, DestinationPolicyRecommend), "locked outcome")
	plan.Outcome = locked.Outcome
	require.ErrorContains(t, validateDirector(plan, destinations, sourceReferenceCatalog{}, locked, DestinationPolicyRecommend), "locked audience")
	plan.Audience = locked.Audience
	require.ErrorContains(t, validateDirector(plan, destinations, sourceReferenceCatalog{}, locked, DestinationPolicyRecommend), "locked angle")
	plan.Angle = locked.Angle
	require.NoError(t, validateDirector(plan, destinations, sourceReferenceCatalog{}, locked, DestinationPolicyRecommend))
}

func TestSupportedClaimsRequireKnownSourceReferences(t *testing.T) {
	t.Parallel()
	known := sourceReferenceCatalog{"source:1": {kind: "text"}}
	require.Error(t, validateClaims([]Claim{{Text: "A fact.", Status: "supported"}}, known))
	require.Error(t, validateClaims([]Claim{{Text: "A fact.", Status: "supported", SourceRefs: []string{"missing"}}}, known))
	require.NoError(t, validateClaims([]Claim{{Text: "A fact.", Status: "supported", SourceRefs: []string{"source:1"}}}, known))
}
