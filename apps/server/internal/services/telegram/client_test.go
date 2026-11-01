package telegram

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSetWebhookAcceptsTelegramBooleanResult(t *testing.T) {
	for _, tc := range []struct {
		name     string
		body     string
		accepted bool
	}{
		{name: "registered", body: `{"ok":true,"result":true}`, accepted: true},
		{name: "not registered", body: `{"ok":true,"result":false}`},
		{name: "rejected", body: `{"ok":false,"description":"Bad Request"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := SetWebhookRequest{
				URL:            "https://openpost.example/api/v1/webhooks/telegram",
				SecretToken:    "test-webhook-secret",
				AllowedUpdates: []string{"message", "channel_post", "my_chat_member", "message_reaction_count"},
			}
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				require.Equal(t, http.MethodPost, r.Method)
				require.Equal(t, "/botlocal-test-token/setWebhook", r.URL.Path)
				var received SetWebhookRequest
				require.NoError(t, json.NewDecoder(r.Body).Decode(&received))
				require.Equal(t, request, received)
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, tc.body)
			}))
			defer provider.Close()
			api := NewHTTPBotAPI("local-test-token", provider.Client())
			api.baseURL = provider.URL
			err := api.SetWebhook(t.Context(), request)
			if tc.accepted {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
		})
	}
}

func TestSendVideoIncludesSizeFields(t *testing.T) {
	for _, tc := range []struct {
		name   string
		kind   string
		method string
		media  OutboundMedia
		want   map[string]string
		absent []string
	}{
		{
			name: "video with analysis results", kind: "video", method: "sendVideo",
			media: OutboundMedia{Type: "video", Filename: "short.mp4", Width: 1080, Height: 1920, DurationMS: 46863},
			want:  map[string]string{"width": "1080", "height": "1920", "duration": "47"},
		},
		{
			name: "video without analysis results", kind: "video", method: "sendVideo",
			media:  OutboundMedia{Type: "video", Filename: "short.mp4"},
			absent: []string{"width", "height", "duration"},
		},
		{
			name: "photo keeps the existing request", kind: "photo", method: "sendPhoto",
			media:  OutboundMedia{Type: "photo", Filename: "launch.png", Width: 1080, Height: 1920},
			absent: []string{"width", "height", "duration"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				require.Equal(t, "/botlocal-test-token/"+tc.method, r.URL.Path)
				require.NoError(t, r.ParseMultipartForm(1<<20))
				for name, value := range tc.want {
					require.Equal(t, value, r.FormValue(name), name)
				}
				for _, name := range tc.absent {
					require.NotContains(t, r.MultipartForm.Value, name)
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, `{"ok":true,"result":{"message_id":42}}`)
			}))
			defer provider.Close()
			api := NewHTTPBotAPI("local-test-token", provider.Client())
			api.baseURL = provider.URL
			tc.media.Reader = strings.NewReader("media-bytes")

			messages, err := api.Send(t.Context(), OutboundRequest{Kind: tc.kind, ChatID: "-100123", Media: []OutboundMedia{tc.media}})

			require.NoError(t, err)
			require.Len(t, messages, 1)
		})
	}
}

func TestSendMediaGroupIncludesVideoSizeFields(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/botlocal-test-token/sendMediaGroup", r.URL.Path)
		require.NoError(t, r.ParseMultipartForm(1<<20))
		var items []map[string]any
		require.NoError(t, json.Unmarshal([]byte(r.FormValue("media")), &items))
		require.Len(t, items, 2)
		require.Equal(t, float64(1080), items[0]["width"])
		require.Equal(t, float64(1920), items[0]["height"])
		require.Equal(t, float64(47), items[0]["duration"])
		require.NotContains(t, items[1], "width")
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"ok":true,"result":[{"message_id":42},{"message_id":43}]}`)
	}))
	defer provider.Close()
	api := NewHTTPBotAPI("local-test-token", provider.Client())
	api.baseURL = provider.URL

	messages, err := api.Send(t.Context(), OutboundRequest{Kind: "media_group", ChatID: "-100123", Media: []OutboundMedia{
		{Type: "video", Filename: "short.mp4", Reader: strings.NewReader("video-bytes"), Width: 1080, Height: 1920, DurationMS: 46863},
		{Type: "photo", Filename: "launch.png", Reader: strings.NewReader("image-bytes")},
	}})

	require.NoError(t, err)
	require.Len(t, messages, 2)
}
