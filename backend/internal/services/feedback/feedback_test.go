package feedback

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestSanitizeReportValidatesScreenshotMIMEAndDimensions(t *testing.T) {
	var encoded strings.Builder
	imageData := image.NewRGBA(image.Rect(0, 0, 2, 2))
	imageData.Set(0, 0, color.White)
	writer := base64.NewEncoder(base64.StdEncoding, &encoded)
	require.NoError(t, png.Encode(writer, imageData))
	require.NoError(t, writer.Close())

	report := Report{
		Category: "idea",
		Message:  "Add a clearer status.",
		Screenshot: &Screenshot{
			MIMEType: "image/png",
			Data:     encoded.String(),
		},
	}
	require.NoError(t, SanitizeReport(&report))

	report.Screenshot.MIMEType = "image/jpeg"
	require.ErrorContains(t, SanitizeReport(&report), "MIME type")

	report.Screenshot.MIMEType = "image/png"
	report.Screenshot.Data = base64.StdEncoding.EncodeToString(make([]byte, maxScreenshotBytes+1))
	require.ErrorContains(t, SanitizeReport(&report), "at most")
}

func TestServiceRejectsDisabledDestinationAndSanitizesAgainBeforeDelivery(t *testing.T) {
	disabled := NewService(nil, Config{}, nil)
	_, err := disabled.Enqueue(context.Background(), Report{Category: "bug", Message: "Broken"})
	require.ErrorContains(t, err, "not configured")

	destination := &recordingDestination{}
	service := NewService(nil, Config{
		Enabled:    true,
		Recipient:  "OpenPost team",
		AppVersion: "1.2.3",
	}, destination)
	report := Report{
		Category: "question",
		Message:  "How does this work?",
		UserID:   "user-1",
		Diagnostics: &Diagnostics{
			RoutePath: "https://localhost/settings?token=secret",
		},
	}
	payload, err := jsonMarshal(report)
	require.NoError(t, err)
	require.NoError(t, service.HandleDeliveryJob(context.Background(), payload))
	require.Equal(t, "/settings", destination.report.Diagnostics.RoutePath)
	require.Equal(t, "1.2.3", destination.report.AppVersion)
}

func TestDiscordDestinationDoesNotExposeFailureBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("private webhook response"))
	}))
	t.Cleanup(server.Close)
	destination := &DiscordDestination{webhookURL: server.URL, client: server.Client()}

	err := destination.Deliver(context.Background(), Report{
		Category:   "bug",
		Message:    "Save failed.",
		UserID:     "user-1",
		AppVersion: "1.2.3",
		CreatedAt:  "2026-07-24T12:00:00Z",
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "HTTP 502")
	require.NotContains(t, err.Error(), "private webhook response")
}

func jsonMarshal(value any) (string, error) {
	data, err := json.Marshal(value)
	return string(data), err
}
