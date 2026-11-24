package handlers

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func mcpCallToolResult(t *testing.T, srv *mcpTestServer, id, name string, args map[string]any) map[string]any {
	t.Helper()
	resp := srv.request(t, "web-token", map[string]any{
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

func mcpRequireToolSuccess(t *testing.T, srv *mcpTestServer, id, name string, args map[string]any) map[string]any {
	t.Helper()
	out := mcpCallToolResult(t, srv, id, name, args)
	require.Nil(t, out["error"], "tool %s must succeed: %v", name, out["error"])
	result, ok := out["result"].(map[string]any)
	require.True(t, ok, "tool %s must return a result", name)
	return result
}

func TestMCPPostVariantAliasEndToEnd(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)

	structured := func(result map[string]any) map[string]any {
		t.Helper()
		structured, ok := result["structuredContent"].(map[string]any)
		require.True(t, ok)
		return structured
	}
	publicationOf := func(result map[string]any) map[string]any {
		t.Helper()
		publication, ok := structured(result)["publication"].(map[string]any)
		require.True(t, ok, "structured output keeps the publication key")
		return publication
	}

	// Create through the retired operation and argument names.
	created := mcpRequireToolSuccess(t, srv, "alias-create", "create_publication", map[string]any{
		"workspace_id": "ws-1", "content_profile": "short_text",
		"source_text": "Alias compatibility draft", "social_account_ids": []string{"account-1"},
		"renditions": []any{map[string]any{"social_account_id": "account-1", "body": "Alias compatibility draft"}},
	})
	post := publicationOf(created)
	postID, ok := post["id"].(string)
	require.True(t, ok && postID != "")
	require.Equal(t, float64(1), post["revision"])

	// The audit log records the canonical operation name.
	var auditCreate struct {
		ToolName string `bun:"tool_name"`
	}
	require.NoError(t, srv.db.NewSelect().TableExpr("mcp_tool_calls").Column("tool_name").
		Where("tool_name = ?", "create_post").Scan(t.Context(), &auditCreate))
	require.Equal(t, "create_post", auditCreate.ToolName)

	listed := mcpRequireToolSuccess(t, srv, "alias-list", "list_publications", map[string]any{
		"workspace_id": "ws-1",
	})
	items := structured(listed)["publications"].([]any)
	require.NotEmpty(t, items)
	found := false
	for _, item := range items {
		entry := item.(map[string]any)
		if entry["id"] != postID {
			continue
		}
		found = true
		require.Contains(t, entry, "failed_variant_count")
		require.NotContains(t, entry, "failed_rendition_count")
	}
	require.True(t, found, "retired list_publications must return the created post")

	loaded := mcpRequireToolSuccess(t, srv, "alias-get", "get_publication", map[string]any{
		"publication_id": postID,
	})
	require.Equal(t, postID, publicationOf(loaded)["id"])
	require.Contains(t, publicationOf(loaded), "revision")
	require.NotContains(t, publicationOf(loaded), "renditions")
	require.Equal(t, "", structured(loaded)["job_id"])

	updated := mcpRequireToolSuccess(t, srv, "alias-update", "update_publication", map[string]any{
		"publication_id": postID, "expected_revision": float64(1),
		"title":        "Alias title",
		"scheduled_at": time.Now().UTC().Add(2 * time.Hour).Format(time.RFC3339),
	})
	revision := int(publicationOf(updated)["revision"].(float64))
	require.Greater(t, revision, 1)

	replaced := mcpRequireToolSuccess(t, srv, "alias-set", "set_publication_renditions", map[string]any{
		"publication_id": postID, "expected_revision": revision,
		"renditions": []any{map[string]any{"social_account_id": "account-1", "body": "Alias variant body"}},
	})
	revision = int(publicationOf(replaced)["revision"].(float64))

	validated := mcpRequireToolSuccess(t, srv, "alias-validate", "validate_publication", map[string]any{
		"publication_id": postID,
	})
	require.Contains(t, structured(validated), "valid")

	scheduled := mcpRequireToolSuccess(t, srv, "alias-schedule", "schedule_publication", map[string]any{
		"publication_id": postID, "expected_revision": revision,
	})
	scheduledPost := publicationOf(scheduled)
	require.Equal(t, "scheduled", scheduledPost["status"])
	require.NotEmpty(t, structured(scheduled)["job_id"])
	revision = int(scheduledPost["revision"].(float64))

	cancelled := mcpRequireToolSuccess(t, srv, "alias-cancel", "cancel_publication", map[string]any{
		"publication_id": postID, "expected_revision": revision,
	})
	revision = int(publicationOf(cancelled)["revision"].(float64))

	queued := mcpRequireToolSuccess(t, srv, "alias-publish", "publish_publication_now", map[string]any{
		"publication_id": postID, "expected_revision": revision, "confirm": true,
	})
	require.NotEmpty(t, structured(queued)["job_id"])

	events := mcpRequireToolSuccess(t, srv, "alias-events", "list_publication_events", map[string]any{
		"publication_id": postID,
	})
	require.NotEmpty(t, structured(events)["events"])

	// Variant-scoped aliases route to the domain handlers instead of failing
	// as unknown operations.
	reply := mcpCallToolResult(t, srv, "alias-reply", "reply_to_variant", map[string]any{
		"variant_id": "missing-variant", "body": "hello",
	})
	require.Equal(t, "variant not found", reply["error"].(map[string]any)["message"])

	comments := mcpCallToolResult(t, srv, "alias-comments", "list_variant_comments", map[string]any{
		"variant_id": "missing-variant",
	})
	require.Equal(t, "variant not found", comments["error"].(map[string]any)["message"])

	legacyReply := mcpCallToolResult(t, srv, "alias-legacy-reply", "reply_to_rendition", map[string]any{
		"rendition_id": "missing-variant", "body": "hello",
	})
	require.Equal(t, "variant not found", legacyReply["error"].(map[string]any)["message"])
	legacyComments := mcpCallToolResult(t, srv, "alias-legacy-comments", "list_rendition_comments", map[string]any{
		"rendition_id": "missing-variant",
	})
	require.Equal(t, "variant not found", legacyComments["error"].(map[string]any)["message"])

	// The delegated path accepts retired operation names and argument keys.
	delegatedCreate := mcpRequireToolSuccess(t, srv, "alias-delegated-create", mcpToolExecute, map[string]any{
		"operation": "create_publication",
		"arguments": map[string]any{
			"workspace_id": "ws-1", "content_profile": "short_text",
			"source_text": "Delegated alias draft",
		},
	})
	require.Contains(t, publicationOf(delegatedCreate)["source_text"], "Delegated alias draft")

	delegatedList := mcpRequireToolSuccess(t, srv, "alias-delegated-list", mcpToolQuery, map[string]any{
		"operation": "list_publications",
		"arguments": map[string]any{"workspace_id": "ws-1"},
	})
	require.NotEmpty(t, structured(delegatedList)["publications"])

	// The retired prompt name resolves and accepts the retired argument key.
	promptResp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "alias-prompt",
		"method":  "prompts/get",
		"params": map[string]any{
			"name":      "adapt_platform_renditions",
			"arguments": map[string]any{"workspace_id": "ws-1", "publication_id": postID},
		},
	})
	require.Equal(t, http.StatusOK, promptResp.Code)
	var promptOut map[string]any
	require.NoError(t, json.Unmarshal(promptResp.Body.Bytes(), &promptOut))
	require.Nil(t, promptOut["error"])
	messages := promptOut["result"].(map[string]any)["messages"].([]any)
	require.NotEmpty(t, messages)
	text := messages[0].(map[string]any)["content"].(map[string]any)["text"].(string)
	require.Contains(t, text, "set_post_variants")
	require.Contains(t, text, postID)

	// The variants widget view renders variant data.
	rendered := mcpRequireToolSuccess(t, srv, "alias-widget", mcpToolRenderWidget, map[string]any{
		"view": "variants",
		"data": map[string]any{"variants": []any{map[string]any{"id": "variant-1"}}},
	})
	require.Equal(t, "variants", structured(rendered)["view"])
}
