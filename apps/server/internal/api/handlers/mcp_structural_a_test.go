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

func mcpCreateDraftPost(t *testing.T, srv *mcpTestServer, id, sourceText string, extra map[string]any) (string, int) {
	t.Helper()
	args := map[string]any{
		"workspace_id": "ws-1", "content_profile": "short_text",
		"source_text": sourceText, "social_account_ids": []string{"account-1"},
	}
	for key, value := range extra {
		args[key] = value
	}
	structured := mcpStructuredContent(t, mcpCallOperation(t, srv, "web-token", id, mcpToolCreatePub, args))
	post := structured["publication"].(map[string]any)
	postID, _ := post["id"].(string)
	require.NotEmpty(t, postID)
	revision := int(post["revision"].(float64))
	require.Contains(t, structured, "job_id")
	return postID, revision
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
	require.Equal(t, 2, count)
}

func TestMCPDeletePostConfirmGate(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	postID, revision := mcpCreateDraftPost(t, srv, "delete-setup", "Delete gate draft", nil)

	missing := mcpCallOperation(t, srv, "web-token", "delete-missing-confirm", mcpToolDeletePub, map[string]any{
		"post_id": postID, "expected_revision": revision,
	})
	require.Contains(t, mcpErrorMessage(t, missing), "confirm")

	explicit := mcpCallOperation(t, srv, "web-token", "delete-false-confirm", mcpToolDeletePub, map[string]any{
		"post_id": postID, "expected_revision": revision, "confirm": false,
	})
	require.Contains(t, mcpErrorMessage(t, explicit), "confirm=true")

	stale := mcpCallOperation(t, srv, "web-token", "delete-stale", mcpToolDeletePub, map[string]any{
		"post_id": postID, "expected_revision": revision + 5, "confirm": true,
	})
	require.Contains(t, mcpErrorMessage(t, stale), "Reload")

	deleted := mcpStructuredContent(t, mcpCallOperation(t, srv, "web-token", "delete-ok", mcpToolDeletePub, map[string]any{
		"post_id": postID, "expected_revision": revision, "confirm": true,
	}))
	require.Equal(t, postID, deleted["post_id"])
	require.Contains(t, deleted["message"], "deleted")

	after := mcpCallOperation(t, srv, "web-token", "delete-gone", mcpToolGetPub, map[string]any{"post_id": postID})
	require.Contains(t, mcpErrorMessage(t, after), "not found")
}

func TestMCPPublishRequiresConfirm(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	postID, revision := mcpCreateDraftPost(t, srv, "publish-gate-setup", "Publish gate draft", nil)

	gated := mcpCallOperation(t, srv, "web-token", "publish-gated", mcpToolPublishPubNow, map[string]any{
		"post_id": postID, "expected_revision": revision,
	})
	require.Contains(t, mcpErrorMessage(t, gated), "confirm=true")
}

func TestMCPDeleteCommentRequiresConfirm(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	ctx := t.Context()
	_, err := srv.db.NewInsert().Model(&models.Publication{
		ID: "publication-comment-gate", WorkspaceID: "ws-1", CreatedByID: "user-1",
		Title: "Gate", ContentProfile: models.ContentProfileShortText,
		SourceText: "Gate", SourceContent: "Gate", Status: models.PublicationStatusPublished,
		MetadataJSON: "{}", ReleasePlanJSON: "{}",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.Rendition{
		ID: "rendition-comment-gate", PublicationID: "publication-comment-gate",
		SocialAccountID: "account-1", Platform: "x", Profile: models.ContentProfileShortText,
		Body: "Gate", SettingsJSON: "{}", Status: models.RenditionStatusPublished,
		ExternalID: "external-1",
	}).Exec(ctx)
	require.NoError(t, err)
	commentID, err := encodeCommentReference(commentReference{
		RenditionID: "rendition-comment-gate", ProviderCommentID: "provider-comment-1",
	})
	require.NoError(t, err)
	gated := mcpCallOperation(t, srv, "web-token", "delete-comment-gated", mcpToolDeleteComment, map[string]any{
		"comment_id": commentID,
	})
	require.Contains(t, mcpErrorMessage(t, gated), "confirm")
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
	if usageCount, ok := item["usage_count"]; ok {
		require.Equal(t, float64(0), usageCount)
	}
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

	deleted := mcpStructuredContent(t, mcpCallOperation(t, srv, "web-token", "media-delete", mcpToolDeleteMedia, map[string]any{
		"media_id": "media-lifecycle-1", "confirm": true,
	}))
	require.Equal(t, "media-lifecycle-1", deleted["media_id"])
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

func TestMCPScheduleDryRunEnqueuesNothing(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	ctx := t.Context()
	scheduledAt := time.Now().UTC().Add(2 * time.Hour).Truncate(time.Second)
	postID, revision := mcpCreateDraftPost(t, srv, "dry-run-setup", "Dry run draft", map[string]any{
		"scheduled_at": scheduledAt.Format(time.RFC3339),
	})

	validated := mcpStructuredContent(t, mcpCallOperation(t, srv, "web-token", "schedule-dry", mcpToolSchedulePub, map[string]any{
		"post_id": postID, "expected_revision": revision, "dry_run": true,
	}))
	require.Equal(t, "", validated["job_id"])
	require.Equal(t, "draft", validated["publication"].(map[string]any)["status"])

	jobs, err := srv.db.NewSelect().Model((*models.Job)(nil)).Where("scope_id = ?", postID).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, jobs)

	scheduled := mcpStructuredContent(t, mcpCallOperation(t, srv, "web-token", "schedule-real", mcpToolSchedulePub, map[string]any{
		"post_id": postID, "expected_revision": revision,
	}))
	require.NotEmpty(t, scheduled["job_id"])
	require.Equal(t, "scheduled", scheduled["publication"].(map[string]any)["status"])
}

func TestMCPPostDetailFullReturnsVariants(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	postID, _ := mcpCreateDraftPost(t, srv, "detail-setup", "Detail shape draft", nil)

	summary := mcpStructuredContent(t, mcpCallOperation(t, srv, "web-token", "detail-summary", mcpToolGetPub, map[string]any{
		"post_id": postID,
	}))
	summaryPost := summary["publication"].(map[string]any)
	require.Contains(t, summaryPost, "revision")
	require.NotContains(t, summaryPost, "renditions")
	require.Equal(t, "", summary["job_id"])

	full := mcpStructuredContent(t, mcpCallOperation(t, srv, "web-token", "detail-full", mcpToolGetPub, map[string]any{
		"post_id": postID, "detail": "full",
	}))
	require.Contains(t, full["publication"].(map[string]any), "renditions")
}

func TestMCPAnnotationsSafetySplit(t *testing.T) {
	t.Parallel()

	external := map[string]bool{
		mcpToolReplyRendition: true,
		mcpToolSchedulePub:    true,
		mcpToolCancelPub:      true,
		mcpToolPublishPubNow:  true,
		mcpToolRetryFailed:    true,
		mcpToolRetryOne:       true,
		mcpToolComments:       true,
		mcpToolReplyComment:   true,
		mcpToolHideComment:    true,
		mcpToolDeleteComment:  true,
		mcpToolUploadURL:      true,
	}
	for _, operation := range mcpOperationCatalog() {
		name, _ := operation.Descriptor["name"].(string)
		annotations := operation.Descriptor["annotations"].(map[string]any)
		if operation.Mode == mcpOperationExecute {
			require.Equal(t, true, annotations["destructiveHint"], "mutation %s must be destructive", name)
			require.Equal(t, false, annotations["readOnlyHint"], "mutation %s must not be read-only", name)
			require.Equal(t, external[name], annotations["openWorldHint"], "mutation %s open-world mismatch", name)
			require.Equal(t, false, annotations["idempotentHint"], "mutation %s must not claim idempotence", name)
		} else {
			require.Equal(t, true, annotations["readOnlyHint"], "read %s must be read-only", name)
			require.Equal(t, true, annotations["idempotentHint"], "read %s must be idempotent", name)
			require.Equal(t, false, annotations["destructiveHint"], "read %s must not be destructive", name)
		}
	}
}

func TestMCPReadScopeSeesRenderUpload(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	srv.handler.auth = mcpScopeAuthenticator{
		"read-token": {UserID: "user-1", Email: "user@example.com", Scope: "mcp:read", WorkspaceID: "ws-1"},
	}
	resp := srv.request(t, "read-token", map[string]any{
		"jsonrpc": "2.0", "id": "read-scope-tools", "method": "tools/list",
	})
	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	tools := out["result"].(map[string]any)["tools"].([]any)
	names := make([]string, 0, len(tools))
	for _, item := range tools {
		names = append(names, item.(map[string]any)["name"].(string))
	}
	require.Contains(t, names, mcpToolRenderUpload)
	require.NotContains(t, names, mcpToolCreateTicket)
	require.NotContains(t, names, mcpToolDeletePub)
	require.NotContains(t, names, mcpToolDeleteMedia)

	rendered := mcpStructuredContent(t, mcpCallOperation(t, srv, "read-token", "read-render", mcpToolRenderUpload, map[string]any{
		"workspace_id": "ws-1",
	}))
	require.Equal(t, "ws-1", rendered["workspace_id"])
}
