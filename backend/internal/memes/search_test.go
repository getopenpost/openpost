package memes

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSearchTemplatesUsesSemanticMeaningAndTags(t *testing.T) {
	t.Parallel()

	template := Template{
		ID:   "choice",
		Name: "Two panels",
		Semantic: TemplateSemantic{
			Meaning: "Reject the weak option and prefer the stronger one.",
			Tags:    []string{"preference", "comparison"},
		},
	}
	template.SearchTerms, template.searchText = buildSearchMetadata(template)
	other := Template{
		ID:   "reaction",
		Name: "Shocked face",
		Semantic: TemplateSemantic{
			Meaning: "Express surprise at unexpected news.",
			Tags:    []string{"reaction", "surprise"},
		},
	}
	other.SearchTerms, other.searchText = buildSearchMetadata(other)
	corpus := []Template{template, other}

	byMeaning := searchTemplates(corpus, "stronger option", 10)
	require.Len(t, byMeaning, 1)
	require.Equal(t, template.ID, byMeaning[0].ID)

	byTag := searchTemplates(corpus, "preference", 10)
	require.Len(t, byTag, 1)
	require.Equal(t, template.ID, byTag[0].ID)

	require.Empty(t, searchTemplates(corpus, "tax filing deadline", 10))
}
