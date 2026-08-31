package publicationbuilder

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestBuildInputAllowsExplicitlyPublishableTextContext(t *testing.T) {
	t.Parallel()

	err := validateBuildInput(BuildInput{
		Idea: "A product update",
		Sources: []SourceMaterial{{
			ID: "context:notes", Kind: "text", Label: "Additional context",
			Text: "The launch moved to Tuesday.", Publishable: true,
		}},
		Destinations: []Destination{{
			AccountID: "account-1", Platform: "x",
			AllowedOutputProfiles: []OutputProfile{{Key: "x.short_text", TextLimit: 280, MaxSegments: 1}},
		}},
	})

	require.NoError(t, err)
}
