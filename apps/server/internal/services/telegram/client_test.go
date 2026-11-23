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
