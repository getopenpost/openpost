package feedback

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

type recordingDestination struct {
	report Report
	err    error
}

func (d *recordingDestination) Deliver(_ context.Context, report Report) error {
	d.report = report
	return d.err
}

func TestSanitizeReportKeepsOnlyAllowlistedDiagnostics(t *testing.T) {
	report := Report{
		Category: "BUG",
		Message:  "The save button stopped at https://10.0.0.2/post?access_token=secret with Authorization: Bearer abc in /Users/alice/openpost.",
		UserID:   "user-1",
		Diagnostics: &Diagnostics{
			RoutePath: "https://private.example.local/activity?token=secret",
			Component: "/activity",
			Browser:   "Firefox 142.0",
			Navigation: []string{
				"https://10.0.0.2/posts?oauth=secret",
				"/activity?tab=failed",
			},
			FailedRequests: []FailedAPIRequest{
				{Method: "POST", Path: "https://localhost/api/v1/posts?token=secret", Status: 500},
				{Method: "GET", Path: "https://third-party.test/data", Status: 500},
			},
			Errors: []ClientError{{
				Name:    "Error",
				Message: "Bearer secret-token failed at https://10.0.0.2/private for user@example.com",
			}},
		},
	}

	require.NoError(t, SanitizeReport(&report))
	require.Equal(t, "bug", report.Category)
	require.NotContains(t, report.Message, "10.0.0.2")
	require.NotContains(t, report.Message, "Bearer abc")
	require.NotContains(t, report.Message, "/Users/alice")
	require.Equal(t, "/activity", report.Diagnostics.RoutePath)
	require.Equal(t, "/activity", report.Diagnostics.Component)
	require.Equal(t, "Firefox 142.0", report.Diagnostics.Browser)
	require.Equal(t, []string{"/posts", "/activity"}, report.Diagnostics.Navigation)
	require.Len(t, report.Diagnostics.FailedRequests, 1)
	require.Equal(t, "/api/v1/posts", report.Diagnostics.FailedRequests[0].Path)
	serialized := report.Diagnostics.Errors[0].Message
	require.NotContains(t, serialized, "secret-token")
	require.NotContains(t, serialized, "10.0.0.2")
	require.NotContains(t, serialized, "user@example.com")
	require.Equal(t, "Client operation failed", serialized)
}

func jsonMarshal(value any) (string, error) {
	data, err := json.Marshal(value)
	return string(data), err
}
