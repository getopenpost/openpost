package handlers

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// The MCP operation surface uses post/variant naming. Retired
// publication/rendition names remain callable through mcpOperationAliases but
// are never advertised.
var mcpPostVariantCanonicalNames = []string{
	"create_post",
	"list_posts",
	"get_post",
	"update_post",
	"set_post_variants",
	"reply_to_variant",
	"validate_post",
	"schedule_post",
	"cancel_post",
	"publish_post_now",
	"list_post_events",
	"list_variant_comments",
}

var mcpPostVariantRetiredNames = []string{
	"create_publication",
	"list_publications",
	"get_publication",
	"update_publication",
	"set_publication_renditions",
	"reply_to_rendition",
	"validate_publication",
	"schedule_publication",
	"cancel_publication",
	"publish_publication_now",
	"list_publication_events",
	"list_rendition_comments",
}

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

func TestMCPPostVariantCanonicalNamesAdvertised(t *testing.T) {
	t.Parallel()

	srv := newMCPTestServer(t)
	listNames := func() []string {
		t.Helper()
		resp := srv.request(t, "web-token", map[string]any{
			"jsonrpc": "2.0",
			"id":      "advertised",
			"method":  "tools/list",
		})
		require.Equal(t, http.StatusOK, resp.Code)
		var out map[string]any
		require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
		tools := out["result"].(map[string]any)["tools"].([]any)
		names := make([]string, 0, len(tools))
		for _, item := range tools {
			names = append(names, item.(map[string]any)["name"].(string))
		}
		return names
	}

	direct := listNames()
	for _, name := range mcpPostVariantCanonicalNames {
		require.Contains(t, direct, name)
	}
	for _, retired := range mcpPostVariantRetiredNames {
		require.NotContains(t, direct, retired)
	}

	srv.handler.SetToolMode("search")
	searched := listNames()
	for _, retired := range mcpPostVariantRetiredNames {
		require.NotContains(t, searched, retired)
	}

	resp := srv.request(t, "web-token", map[string]any{
		"jsonrpc": "2.0",
		"id":      "prompts",
		"method":  "prompts/list",
	})
	require.Equal(t, http.StatusOK, resp.Code)
	var promptOut map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &promptOut))
	prompts := promptOut["result"].(map[string]any)["prompts"].([]any)
	promptNames := make([]string, 0, len(prompts))
	for _, item := range prompts {
		promptNames = append(promptNames, item.(map[string]any)["name"].(string))
	}
	require.Contains(t, promptNames, "adapt_post_variants")
	require.NotContains(t, promptNames, "adapt_platform_renditions")

	require.Contains(t, mcpSchedulerWidgetViews(), "variants")
	require.True(t, mcpValidSchedulerWidgetView("variants"))

	result, rpcErr := searchMCPOperations(map[string]any{"query": "create a video post"})
	require.Nil(t, rpcErr)
	operations := result.(map[string]any)["structuredContent"].(map[string]any)["operations"].([]map[string]any)
	require.NotEmpty(t, operations)
	for _, operation := range operations {
		require.NotContains(t, mcpPostVariantRetiredNames, operation["name"])
	}
}

func TestMCPOperationAliasResolution(t *testing.T) {
	t.Parallel()

	require.Len(t, mcpOperationAliases, len(mcpPostVariantRetiredNames))
	for _, retired := range mcpPostVariantRetiredNames {
		canonical, ok := mcpOperationAliases[retired]
		require.True(t, ok, "retired operation %q must have an alias entry", retired)
		require.Contains(t, mcpPostVariantCanonicalNames, canonical)
		require.Equal(t, canonical, normalizeMCPOperationName(retired))
		require.Equal(t, canonical, normalizeMCPOperationName("  "+retired+"  "))
		require.Equal(t, canonical, canonicalMCPToolName(retired))
		operation, ok := mcpOperationByName(retired)
		require.True(t, ok, "retired operation %q must resolve", retired)
		require.Equal(t, canonical, operation.Descriptor["name"])
		canonicalOperation, ok := mcpOperationByName(canonical)
		require.True(t, ok)
		require.Equal(t, canonicalOperation.Mode, operation.Mode)
		require.Equal(t, canonicalOperation.Descriptor["title"], operation.Descriptor["title"])
	}
	require.Equal(t, "adapt_post_variants", mcpPromptAliases["adapt_platform_renditions"])
	require.Equal(t, mcpToolSearch, canonicalMCPToolName(mcpLegacyToolSearch))
	require.Equal(t, mcpToolQuery, canonicalMCPToolName(mcpLegacyToolQuery))
	require.Equal(t, mcpToolExecute, canonicalMCPToolName(mcpLegacyToolExecute))
}

func TestMCPPostVariantArgumentAliases(t *testing.T) {
	t.Parallel()

	decode := func(args map[string]any) map[string]any {
		t.Helper()
		normalized := make(map[string]any, len(args))
		for key, value := range args {
			normalized[key] = value
		}
		require.NoError(t, decodeMCPArguments(normalized, &struct {
			PostID    string `json:"post_id"`
			VariantID string `json:"variant_id"`
			Variants  []any  `json:"variants"`
			Failed    int    `json:"failed_variant_count"`
		}{}))
		return normalized
	}

	renamed := decode(map[string]any{"publication_id": "post-1", "rendition_id": "variant-1"})
	require.Equal(t, "post-1", renamed["post_id"])
	require.Equal(t, "variant-1", renamed["variant_id"])
	require.NotContains(t, renamed, "publication_id")
	require.NotContains(t, renamed, "rendition_id")

	// When both forms are present the canonical key wins.
	conflicted := decode(map[string]any{
		"publication_id": "post-old", "post_id": "post-new",
		"renditions": []any{"old"}, "variants": []any{"new"},
		"failed_rendition_count": 1, "failed_variant_count": 2,
	})
	require.Equal(t, "post-new", conflicted["post_id"])
	require.Equal(t, []any{"new"}, conflicted["variants"])
	require.Equal(t, 2, conflicted["failed_variant_count"])
	require.NotContains(t, conflicted, "publication_id")
	require.NotContains(t, conflicted, "renditions")
	require.NotContains(t, conflicted, "failed_rendition_count")
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

func TestMCPPostVariantAnnotations(t *testing.T) {
	t.Parallel()

	for _, operation := range mcpOperationCatalog() {
		name, _ := operation.Descriptor["name"].(string)
		annotations, ok := operation.Descriptor["annotations"].(map[string]any)
		require.True(t, ok, "operation %s must carry annotations", name)
		idempotent, ok := annotations["idempotentHint"].(bool)
		require.True(t, ok, "operation %s must carry idempotentHint", name)
		if operation.Mode == mcpOperationQuery {
			require.True(t, idempotent, "read-only operation %s must be idempotent", name)
		} else {
			require.False(t, idempotent, "mutation operation %s must not be idempotent", name)
		}
	}
	for _, tool := range mcpAdvertisedTools() {
		name, _ := tool["name"].(string)
		annotations, ok := tool["annotations"].(map[string]any)
		require.True(t, ok, "tool %s must carry annotations", name)
		_, ok = annotations["idempotentHint"].(bool)
		require.True(t, ok, "tool %s must carry idempotentHint", name)
	}
}

func TestMCPExplicitVariantFormatRoundTrip(t *testing.T) {
	t.Parallel()
	srv := newMCPTestServer(t)
	created := mcpRequireToolSuccess(t, srv, "locked-create", "create_post", map[string]any{
		"workspace_id": "ws-1", "content_profile": "short_text", "source_text": "Explicit format",
		"variants": []any{map[string]any{
			"social_account_id": "account-1", "profile": "short_text", "output_profile": "x.post", "format_locked": true,
		}},
	})
	post := created["structuredContent"].(map[string]any)["publication"].(map[string]any)
	loaded := mcpRequireToolSuccess(t, srv, "locked-get", "get_post", map[string]any{"post_id": post["id"], "detail": "full"})
	post = loaded["structuredContent"].(map[string]any)["publication"].(map[string]any)
	variants := post["renditions"].([]any)
	require.Equal(t, true, variants[0].(map[string]any)["format_locked"])
	updated := mcpRequireToolSuccess(t, srv, "locked-update", "set_post_variants", map[string]any{
		"post_id": post["id"], "expected_revision": post["revision"],
		"variants": []any{map[string]any{
			"social_account_id": "account-1", "profile": "short_text", "output_profile": "x.post", "format_locked": false,
		}},
	})
	post = updated["structuredContent"].(map[string]any)["publication"].(map[string]any)
	loaded = mcpRequireToolSuccess(t, srv, "unlocked-get", "get_post", map[string]any{"post_id": post["id"], "detail": "full"})
	post = loaded["structuredContent"].(map[string]any)["publication"].(map[string]any)
	require.Equal(t, false, post["renditions"].([]any)[0].(map[string]any)["format_locked"])
}
