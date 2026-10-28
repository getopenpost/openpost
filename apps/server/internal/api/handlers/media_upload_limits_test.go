package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/stretchr/testify/require"
)

// TestUploadSessionAdmissionAgreesWithAdvertisedLimits proves the advertised
// limits are the enforced ones: a session at the advertised limit is accepted
// and one byte over is rejected, for every published kind.
func TestUploadSessionAdmissionAgreesWithAdvertisedLimits(t *testing.T) {
	storage := newFakeDirectUploadStorage()
	srv := newMediaDirectUploadTestServer(t, storage, entitlements.NewSelfHostedService())

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/media/storage?workspace_id=ws-1", nil)
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	srv.echo.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var advertised struct {
		LimitBytes   int64 `json:"limit_bytes"`
		UploadLimits struct {
			DefaultBytes   int64 `json:"default_bytes"`
			VideoBytes     int64 `json:"video_bytes"`
			BrandFontBytes int64 `json:"brand_font_bytes"`
		} `json:"upload_limits"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &advertised))
	require.Zero(t, advertised.LimitBytes, "limit_bytes keeps its meaning: zero exposes no fixed storage quota")

	cases := []struct {
		name          string
		limit         int64
		wantLimit     int64
		wantRejected  string
		wantStreaming bool
		filename      string
		mimeType      string
		assetKind     string
	}{
		{
			name:         "default",
			limit:        advertised.UploadLimits.DefaultBytes,
			wantLimit:    50 * 1024 * 1024,
			wantRejected: "50MB",
			filename:     "photo.jpg",
			mimeType:     "image/jpeg",
			assetKind:    "library",
		},
		{
			name:          "video",
			limit:         advertised.UploadLimits.VideoBytes,
			wantLimit:     16 * 1024 * 1024 * 1024,
			wantRejected:  "16 GiB",
			wantStreaming: true,
			filename:      "clip.mp4",
			mimeType:      "video/mp4",
			assetKind:     "library",
		},
		{
			name:      "brand_font",
			limit:     advertised.UploadLimits.BrandFontBytes,
			wantLimit: 10 * 1024 * 1024,
			filename:  "font.woff2",
			mimeType:  "font/woff2",
			assetKind: "brand_font",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.wantLimit, tc.limit, "the advertised ceiling must be the published contract, not a restatement of the helper")
			require.Positive(t, tc.limit, "advertised limit must be served before admission can agree with it")
			accepted := srv.postJSON(t, "/api/v1/media/upload-session", map[string]any{
				"workspace_id": "ws-1",
				"filename":     tc.filename,
				"mime_type":    tc.mimeType,
				"size":         tc.limit,
				"asset_kind":   tc.assetKind,
			})
			require.Equal(t, http.StatusOK, accepted.Code, accepted.Body.String())
			if tc.wantStreaming {
				var session struct {
					MediaID string `json:"media_id"`
					Upload  struct {
						URL string `json:"url"`
					} `json:"upload"`
				}
				require.NoError(t, json.Unmarshal(accepted.Body.Bytes(), &session))
				require.Equal(
					t,
					"/api/v1/media/upload-session/"+session.MediaID+"/content",
					session.Upload.URL,
					"a video past the direct-upload ceiling streams through the local content target",
				)
			}
			rejected := srv.postJSON(t, "/api/v1/media/upload-session", map[string]any{
				"workspace_id": "ws-1",
				"filename":     tc.filename,
				"mime_type":    tc.mimeType,
				"size":         tc.limit + 1,
				"asset_kind":   tc.assetKind,
			})
			require.Equal(t, http.StatusBadRequest, rejected.Code, rejected.Body.String())
			if tc.wantRejected != "" {
				require.Contains(t, rejected.Body.String(), tc.wantRejected, "the rejection names the enforced ceiling")
			}
		})
	}
}
