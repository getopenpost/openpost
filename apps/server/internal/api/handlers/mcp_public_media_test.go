package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/mediasigner"
	"github.com/openpost/backend/internal/services/publicurl"
	"github.com/stretchr/testify/require"
)

func TestMCPFacebookCarouselPublicMediaValidation(t *testing.T) {
	t.Parallel()

	for _, status := range []int{http.StatusOK, http.StatusNotFound} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			t.Parallel()
			srv := newMCPTestServer(t)
			srv.handler.auth = mcpScopeAuthenticator{
				"mcp-token": {UserID: "user-1", Scope: "mcp:full", WorkspaceID: "ws-1"},
			}
			signer := mediasigner.New("carousel-test-signing-key")
			var requests atomic.Int32
			mediaServer := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				mediaID := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/media/"), ".jpg")
				expiresAt, _ := strconv.ParseInt(r.URL.Query().Get("exp"), 10, 64)
				if r.Method != http.MethodHead || !signer.Verify(mediaID, r.URL.Query().Get("sig"), expiresAt) {
					w.WriteHeader(http.StatusForbidden)
					return
				}
				requests.Add(1)
				w.WriteHeader(status)
			}))
			t.Cleanup(mediaServer.Close)
			verifier := publicurl.NewMediaVerifier(mediaServer.URL+"/media", srv.handler.mediaStorage, signer)
			verifier.SetVerifier(publicurl.HTTPVerifier{Client: mediaServer.Client()})
			srv.handler.SetPublicMediaVerifier(verifier)

			_, err := srv.db.NewInsert().Model(&models.SocialAccount{
				ID: "facebook-page", WorkspaceID: "ws-1", Platform: "facebook", AccountID: "page-1",
				Slug: "facebook-page", AccessTokenEnc: []byte("token"),
				GrantedScopes: "pages_manage_posts,pages_read_engagement", IsActive: true,
			}).Exec(t.Context())
			require.NoError(t, err)
			ensurePermissiveProviderReadinessFixture(t, srv.db)
			srv.handler.SetProviderReadiness(permissiveProviderReadiness(t))
			media := []models.MediaAttachment{
				{ID: "image-1", WorkspaceID: "ws-1", MimeType: "image/jpeg", Size: 1024, Width: 1080, Height: 1080, FilePath: "image-1.jpg", OriginalFilename: "image-1.jpg", ProcessingStatus: "ready"},
				{ID: "image-2", WorkspaceID: "ws-1", MimeType: "image/jpeg", Size: 1024, Width: 1080, Height: 1080, FilePath: "image-2.jpg", OriginalFilename: "image-2.jpg", ProcessingStatus: "ready"},
			}
			_, err = srv.db.NewInsert().Model(&media).Exec(t.Context())
			require.NoError(t, err)

			call := func(tool, operation string, args map[string]any) map[string]any {
				t.Helper()
				response := srv.requestPath(t, "/mcp/code", "mcp-token", map[string]any{
					"jsonrpc": "2.0", "id": operation, "method": "tools/call",
					"params": map[string]any{"name": tool, "arguments": map[string]any{"operation": operation, "arguments": args}},
				})
				require.Equal(t, http.StatusOK, response.Code, response.Body.String())
				var out map[string]any
				require.NoError(t, json.Unmarshal(response.Body.Bytes(), &out))
				return out
			}
			created := mcpStructuredContent(t, call("execute_operation", "create_post", map[string]any{
				"workspace_id": "ws-1", "content_profile": "carousel", "source_text": "Launch photos",
				"social_account_ids": []string{"facebook-page"}, "media_ids": []string{"image-1", "image-2"},
				"scheduled_at": time.Now().UTC().Add(2 * time.Hour).Format(time.RFC3339),
			}))
			post := created["publication"].(map[string]any)
			postID := post["id"].(string)
			validated := mcpStructuredContent(t, call("query_operation", "validate_post", map[string]any{"post_id": postID}))
			ready := status == http.StatusOK
			require.Equal(t, ready, validated["valid"], "validation issues: %v", validated["issues"])
			require.EqualValues(t, 2, requests.Load(), "validation must check both signed public media URLs")
			if !ready {
				issues := validated["issues"].([]any)
				codes := make([]string, 0, len(issues))
				for _, issue := range issues {
					codes = append(codes, issue.(map[string]any)["code"].(string))
				}
				require.Contains(t, codes, "public_url_unreachable")
			}
			for _, id := range []string{"image-1", "image-2"} {
				var persisted models.MediaAttachment
				require.NoError(t, srv.db.NewSelect().Model(&persisted).Where("id = ?", id).Scan(t.Context()))
				require.Equal(t, ready, persisted.PublicURLReady)
				require.False(t, persisted.PublicURLCheckedAt.IsZero())
				require.Equal(t, status, persisted.PublicURLStatus)
			}
			scheduled := call("execute_operation", "schedule_post", map[string]any{"post_id": postID, "expected_revision": post["revision"]})
			if ready {
				result := mcpStructuredContent(t, scheduled)
				require.Equal(t, "scheduled", result["publication"].(map[string]any)["status"])
				require.NotEmpty(t, result["job_id"])
			} else {
				require.Contains(t, mcpErrorMessage(t, scheduled), "validation")
				jobs, err := srv.db.NewSelect().Model((*models.Job)(nil)).Where("scope_id = ?", postID).Count(t.Context())
				require.NoError(t, err)
				require.Zero(t, jobs)
			}
		})
	}
}
