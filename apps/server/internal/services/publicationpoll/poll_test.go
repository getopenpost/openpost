package publicationpoll_test

import (
	"testing"

	"github.com/openpost/backend/internal/services/publicationpoll"
	"github.com/stretchr/testify/require"
)

func TestJoinedPollsRequireExplicitTextOrOmission(t *testing.T) {
	for _, test := range []struct {
		mode, body string
		rejected   bool
	}{
		{"text", "First post.\n\nSecond post.\n\nNext?\n1. Yes, please\n2. No", false},
		{"omit", "First post.\n\nSecond post.", false},
		{"native", "", true},
		{"custom", "", true},
		{"legacy", "", true},
		{"", "", true},
	} {
		t.Run(test.mode, func(t *testing.T) {
			draft := publicationpoll.Draft{Content: publicationpoll.Content{Question: "Next?", Options: []publicationpoll.Option{{ID: "yes", Text: "Yes, please"}, {ID: "no", Text: "No"}}, DurationSeconds: 86400}, Destinations: map[string]publicationpoll.Destination{"account": {Mode: publicationpoll.Mode(test.mode)}}}
			body, settings, err := publicationpoll.ResolveJoined([]map[string]any{{}, {"poll": draft}}, "account", "linkedin", "linkedin.post", "First post.\n\nSecond post.", map[string]any{"visibility": "PUBLIC"})
			if test.rejected {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.Equal(t, test.body, body)
			require.Equal(t, map[string]any{"visibility": "PUBLIC"}, settings)
		})
	}
}
