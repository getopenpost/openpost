package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func mcpCallOperation(t *testing.T, srv *mcpTestServer, token, id, name string, args map[string]any) map[string]any {
	t.Helper()
	resp := srv.request(t, token, map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"method":  "tools/call",
		"params": map[string]any{
			"name":      name,
			"arguments": args,
		},
	})
	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	return out
}

func mcpStructuredContent(t *testing.T, out map[string]any) map[string]any {
	t.Helper()
	require.Nil(t, out["error"], "expected success, got error: %v", out["error"])
	result, ok := out["result"].(map[string]any)
	require.True(t, ok)
	structured, ok := result["structuredContent"].(map[string]any)
	require.True(t, ok)
	return structured
}

func mcpErrorMessage(t *testing.T, out map[string]any) string {
	t.Helper()
	require.NotNil(t, out["error"], "expected an error, got success: %v", out["result"])
	return out["error"].(map[string]any)["message"].(string)
}

func TestMCPCreatePostIdempotencyReplays(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	createIdempotencyRecordTable(t, srv.db)
	ctx := t.Context()

	call := func(id, key, sourceText string) map[string]any {
		t.Helper()
		return mcpCallOperation(t, srv, "web-token", id, mcpToolCreatePub, map[string]any{
			"workspace_id": "ws-1", "content_profile": "short_text",
			"source_text": sourceText, "idempotency_key": key,
		})
	}

	first := mcpStructuredContent(t, call("idem-first", "upstream-event-1", "Idempotent draft"))
	firstID := first["publication"].(map[string]any)["id"].(string)
	require.NotEmpty(t, firstID)

	replay := mcpStructuredContent(t, call("idem-replay", "upstream-event-1", "Idempotent draft"))
	require.Equal(t, firstID, replay["publication"].(map[string]any)["id"])

	conflict := call("idem-conflict", "upstream-event-1", "Different body")
	require.Contains(t, mcpErrorMessage(t, conflict), "already used with a different request")

	other := mcpStructuredContent(t, call("idem-other-key", "upstream-event-2", "Idempotent draft"))
	require.NotEqual(t, firstID, other["publication"].(map[string]any)["id"])

	count, err := srv.db.NewSelect().Model((*models.Publication)(nil)).Count(ctx)
	require.NoError(t, err)
	require.EqualValues(t, 2, count)
}

func TestMCPListPostsRejectsUnknownEnumFilters(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)

	statusTypo := mcpCallOperation(t, srv, "web-token", "list-bad-status", mcpToolListPubs, map[string]any{
		"workspace_id": "ws-1", "status": "drfat",
	})
	require.Contains(t, mcpErrorMessage(t, statusTypo), "status")

	profileTypo := mcpCallOperation(t, srv, "web-token", "list-bad-profile", mcpToolListPubs, map[string]any{
		"workspace_id": "ws-1", "content_profile": "novel",
	})
	require.Contains(t, mcpErrorMessage(t, profileTypo), "content_profile")

	valid := mcpStructuredContent(t, mcpCallOperation(t, srv, "web-token", "list-valid-status", mcpToolListPubs, map[string]any{
		"workspace_id": "ws-1", "status": "draft",
	}))
	require.Contains(t, valid, "publications")
}

func TestMCPMediaLifecycle(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	ctx := t.Context()
	for _, model := range []any{
		(*models.DesignRevision)(nil),
		(*models.DesignRevisionMediaReference)(nil),
		(*models.VideoProject)(nil),
		(*models.ProjectAsset)(nil),
		(*models.PublicationAsset)(nil),
		(*models.RenditionMediaDelivery)(nil),
		(*models.RenditionMediaDeliveryRelation)(nil),
	} {
		_, err := srv.db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	_, err := srv.db.NewInsert().Model(&models.MediaAttachment{
		ID: "media-lifecycle-1", WorkspaceID: "ws-1", FilePath: "ws-1/media-lifecycle-1.jpg",
		MimeType: "image/jpeg", Size: 1024, OriginalFilename: "lifecycle.jpg",
		CreatedAt: time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)

	loaded := mcpStructuredContent(t, mcpCallOperation(t, srv, "web-token", "media-get", mcpToolGetMedia, map[string]any{
		"media_id": "media-lifecycle-1",
	}))
	item := loaded["media"].(map[string]any)
	require.Equal(t, "media-lifecycle-1", item["id"])
	// Zero usage is omitted by the public MCP media projection.
	require.NotContains(t, item, "usage_count")
	require.Equal(t, true, item["can_delete"])

	missing := mcpCallOperation(t, srv, "web-token", "media-missing", mcpToolGetMedia, map[string]any{
		"media_id": "media-does-not-exist",
	})
	require.Contains(t, mcpErrorMessage(t, missing), "not found")

	updated := mcpStructuredContent(t, mcpCallOperation(t, srv, "web-token", "media-update", mcpToolUpdateMedia, map[string]any{
		"media_id": "media-lifecycle-1", "alt_text": "A lifecycle test image", "favorite": true,
	}))
	updatedItem := updated["media"].(map[string]any)
	require.Equal(t, "A lifecycle test image", updatedItem["alt_text"])
	require.Equal(t, true, updatedItem["is_favorite"])

	gated := mcpCallOperation(t, srv, "web-token", "media-delete-gated", mcpToolDeleteMedia, map[string]any{
		"media_id": "media-lifecycle-1",
	})
	require.Contains(t, mcpErrorMessage(t, gated), "confirm")

	denied := mcpCallOperation(t, srv, "web-token", "media-delete-false", mcpToolDeleteMedia, map[string]any{
		"media_id": "media-lifecycle-1", "confirm": false,
	})
	require.Equal(t, "delete_media is irreversible; repeat the call with confirm=true to proceed", mcpErrorMessage(t, denied))
	var beforeDelete models.MediaAttachment
	require.NoError(t, srv.db.NewSelect().Model(&beforeDelete).Where("id = ?", "media-lifecycle-1").Scan(ctx))
	require.True(t, beforeDelete.TrashedAt.IsZero())
	require.True(t, beforeDelete.PurgeAfter.IsZero())

	deleted := mcpStructuredContent(t, mcpCallOperation(t, srv, "web-token", "media-delete", mcpToolDeleteMedia, map[string]any{
		"media_id": "media-lifecycle-1", "confirm": true,
	}))
	require.Equal(t, "media-lifecycle-1", deleted["media_id"])
	var stored models.MediaAttachment
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", "media-lifecycle-1").Scan(ctx))
	require.False(t, stored.TrashedAt.IsZero())
	require.False(t, stored.PurgeAfter.IsZero())
	require.Equal(t, "manual", stored.TrashReason)
	remaining, err := srv.db.NewSelect().Model((*models.MediaAttachment)(nil)).Where("id = ?", "media-lifecycle-1").Count(ctx)
	require.NoError(t, err)
	require.EqualValues(t, 1, remaining)
}

func TestMCPRetryOpsValidateBeforeDispatch(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	ctx := context.Background()
	_, err := srv.db.NewCreateTable().Model((*models.ProviderDelivery)(nil)).IfNotExists().Exec(ctx)
	require.NoError(t, err)

	postID, revision := func() (string, int) {
		t.Helper()
		structured := mcpStructuredContent(t, mcpCallOperation(t, srv, "web-token", "retry-setup", mcpToolCreatePub, map[string]any{
			"workspace_id": "ws-1", "content_profile": "short_text",
			"source_text": "Retry dispatch draft",
		}))
		post := structured["publication"].(map[string]any)
		return post["id"].(string), int(post["revision"].(float64))
	}()

	stale := mcpCallOperation(t, srv, "web-token", "retry-stale", mcpToolRetryFailed, map[string]any{
		"post_id": postID, "expected_revision": revision + 5,
	})
	require.Contains(t, mcpErrorMessage(t, stale), "revision")

	empty := mcpCallOperation(t, srv, "web-token", "retry-empty", mcpToolRetryFailed, map[string]any{
		"post_id": postID, "expected_revision": revision,
	})
	require.Contains(t, mcpErrorMessage(t, empty), "no retryable failed destinations")

	_, err = srv.db.NewInsert().Model(&models.Rendition{
		ID: "rendition-retry-1", PublicationID: postID, SocialAccountID: "account-1",
		Platform: "x", Profile: models.ContentProfileShortText, Body: "Retry me",
		SettingsJSON: "{}", Status: models.RenditionStatusFailed,
	}).Exec(ctx)
	require.NoError(t, err)

	unknown := mcpCallOperation(t, srv, "web-token", "retry-unknown", mcpToolRetryOne, map[string]any{
		"post_id": postID, "variant_id": "variant-does-not-exist", "expected_revision": revision,
	})
	require.Contains(t, mcpErrorMessage(t, unknown), "variant not found")

	unsafe := mcpCallOperation(t, srv, "web-token", "retry-unsafe", mcpToolRetryOne, map[string]any{
		"post_id": postID, "variant_id": "rendition-retry-1", "expected_revision": revision,
	})
	require.Contains(t, mcpErrorMessage(t, unsafe), "safe delivery outcome")
}
