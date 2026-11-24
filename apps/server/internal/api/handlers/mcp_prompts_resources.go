package handlers

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

func mcpPromptsForScope(scope string) []map[string]any {
	if mcpScopeIsReadOnly(scope) {
		return []map[string]any{mcpReviewSchedulePrompt()}
	}
	return []map[string]any{
		mcpPlanSocialPostPrompt(),
		mcpAdaptPlatformRenditionsPrompt(),
		mcpReviewSchedulePrompt(),
	}
}

func mcpPlanSocialPostPrompt() map[string]any {
	return map[string]any{
		"name":        mcpPromptPlanPost,
		"title":       "Plan a post",
		"description": "Turn an idea into a workspace-aware OpenPost Post draft.",
		"arguments": []map[string]any{
			{"name": "idea", "description": "The source idea, note, link, or rough content to develop.", "required": true},
			{"name": "workspace_id", "description": "Optional workspace ID if already known.", "required": false},
			{"name": "platforms", "description": "Optional comma-separated destination platforms to consider.", "required": false},
		},
	}
}

func mcpAdaptPlatformRenditionsPrompt() map[string]any {
	return map[string]any{
		"name":        mcpPromptRenditions,
		"title":       "Adapt post variants",
		"description": "Rewrite a Post in draft or scheduled state into platform-native destination copy.",
		"arguments": []map[string]any{
			{"name": "workspace_id", "description": "Workspace ID that owns the Post.", "required": true},
			{"name": "post_id", "description": "Draft or scheduled Post ID to adapt.", "required": true},
			{"name": "goal", "description": "Optional campaign goal, audience, or tone guidance.", "required": false},
		},
	}
}

func mcpReviewSchedulePrompt() map[string]any {
	return map[string]any{
		"name":        mcpPromptReviewQueue,
		"title":       "Review publishing queue",
		"description": "Inspect upcoming scheduled Posts and recommend useful next actions.",
		"arguments": []map[string]any{
			{"name": "workspace_id", "description": "Workspace ID to inspect.", "required": true},
			{"name": "window", "description": "Optional time window, such as today, this week, or next 14 days.", "required": false},
		},
	}
}

func mcpGetPrompt(raw json.RawMessage, readOnly ...bool) (any, *mcpError) {
	var params struct {
		Name      string            `json:"name"`
		Arguments map[string]string `json:"arguments"`
	}
	if err := json.Unmarshal(raw, &params); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid prompt params"}
	}
	params.Name = strings.TrimSpace(params.Name)
	if canonical, ok := mcpPromptAliases[params.Name]; ok {
		params.Name = canonical
	}
	if params.Arguments != nil {
		normalized := make(map[string]string, len(params.Arguments))
		for key, value := range params.Arguments {
			normalized[key] = value
		}
		if _, ok := normalized["post_id"]; !ok {
			if legacy, ok := normalized["publication_id"]; ok {
				normalized["post_id"] = legacy
			}
		}
		delete(normalized, "publication_id")
		params.Arguments = normalized
	}
	if len(readOnly) > 0 && readOnly[0] && params.Name != mcpPromptReviewQueue {
		return nil, &mcpError{Code: -32602, Message: "this prompt requires mcp:full because it creates or changes OpenPost data"}
	}
	switch params.Name {
	case mcpPromptPlanPost:
		return mcpPromptResult("Plan an OpenPost Post draft from an idea.", mcpPlanPostPromptText(params.Arguments)), nil
	case mcpPromptRenditions:
		return mcpPromptResult("Adapt a Post into platform-native variants.", mcpRenditionsPromptText(params.Arguments)), nil
	case mcpPromptReviewQueue:
		return mcpPromptResult("Review the scheduled publishing queue.", mcpReviewQueuePromptText(params.Arguments)), nil
	default:
		return nil, &mcpError{Code: -32602, Message: "unknown prompt"}
	}
}

func (h *MCPHandler) listMCPResources() any {
	return map[string]any{
		"resources": []map[string]any{{
			"uri":         mcpAppWidgetURI,
			"name":        "openpost_scheduler",
			"title":       "OpenPost Scheduler",
			"description": "Renders OpenPost workspaces, accounts, media, Posts, Variants, schedules, and provider status in ChatGPT.",
			"mimeType":    mcpAppWidgetMimeType,
			"_meta":       h.mcpAppWidgetResourceMeta(),
		}, {
			"uri":         mcpUploadWidgetURI,
			"name":        "openpost_local_media_upload",
			"title":       "OpenPost local media upload",
			"description": "Lets a person choose a local image or video and add it to an OpenPost workspace without exposing the upload credential to the model.",
			"mimeType":    mcpAppWidgetMimeType,
			"_meta":       h.mcpUploadWidgetResourceMeta(),
		}},
	}
}

func (h *MCPHandler) readMCPResource(raw json.RawMessage) (any, *mcpError) {
	var params struct {
		URI string `json:"uri"`
	}
	if err := json.Unmarshal(raw, &params); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid resource params"}
	}
	switch params.URI {
	case mcpAppWidgetURI:
		return map[string]any{
			"contents": []map[string]any{{
				"uri":      mcpAppWidgetURI,
				"mimeType": mcpAppWidgetMimeType,
				"text":     mcpAppWidgetHTML(),
				"_meta":    h.mcpAppWidgetResourceMeta(),
			}},
		}, nil
	case mcpUploadWidgetURI:
		return map[string]any{
			"contents": []map[string]any{{
				"uri":      mcpUploadWidgetURI,
				"mimeType": mcpAppWidgetMimeType,
				"text":     mcpUploadWidgetHTML(),
				"_meta":    h.mcpUploadWidgetResourceMeta(),
			}},
		}, nil
	default:
		return nil, &mcpError{Code: -32602, Message: "unknown resource"}
	}
}

func (h *MCPHandler) mcpUploadWidgetResourceMeta() map[string]any {
	domain := mcpWidgetDomain(h.publicURL)
	connectDomains := []string{}
	if domain != "" {
		connectDomains = append(connectDomains, domain)
	}
	standardCSP := map[string]any{"connectDomains": connectDomains, "resourceDomains": []string{}}
	legacyCSP := map[string]any{"connect_domains": connectDomains, "resource_domains": []string{}}
	ui := map[string]any{"prefersBorder": true, "csp": standardCSP}
	meta := map[string]any{
		"ui":                         ui,
		"openai/widgetDescription":   "Choose a local file and upload it to the selected OpenPost workspace.",
		"openai/widgetPrefersBorder": true,
		"openai/widgetCSP":           legacyCSP,
	}
	if domain != "" {
		meta["openai/widgetDomain"] = domain
		ui["domain"] = domain
	}
	return meta
}

func (h *MCPHandler) mcpAppWidgetResourceMeta() map[string]any {
	standardCSP, legacyCSP := mcpAppWidgetCSP()
	ui := map[string]any{
		"prefersBorder": true,
		"csp":           standardCSP,
	}
	meta := map[string]any{
		"ui":                         ui,
		"openai/widgetDescription":   "OpenPost scheduler view for workspaces, accounts, media, Posts, Variants, schedules, and provider status.",
		"openai/widgetPrefersBorder": true,
		"openai/widgetCSP":           legacyCSP,
	}
	if domain := mcpWidgetDomain(h.publicURL); domain != "" {
		meta["openai/widgetDomain"] = domain
		ui["domain"] = domain
	}
	return meta
}

func mcpAppWidgetCSP() (map[string]any, map[string]any) {
	return map[string]any{
		"connectDomains":  []string{},
		"resourceDomains": []string{},
	}, map[string]any{
		"connect_domains":  []string{},
		"resource_domains": []string{},
	}
}

func mcpWidgetDomain(publicURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(publicURL))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return ""
	}
	return parsed.Scheme + "://" + parsed.Host
}

func mcpAppWidgetHTML() string {
	return strings.Replace(mcpAppWidgetTemplate, "/*MCP_UI_STYLES*/", mcpUIStyles, 1)
}

func mcpUploadWidgetHTML() string {
	html := strings.Replace(mcpUploadWidgetTemplate, "/*MCP_UI_STYLES*/", mcpUIStyles, 1)
	return strings.Replace(html, "/*MCP_UPLOAD_TOOL_NAMES*/", mcpUploadWidgetToolNames(), 1)
}

// mcpUploadWidgetToolNames injects the bare MCP tool names into the upload
// widget script so the widget's gateway prefix recovery and the tool
// descriptors share one source of truth instead of a duplicated literal.
func mcpUploadWidgetToolNames() string {
	return "var renderTool=" + fmt.Sprintf("%q", mcpToolRenderUpload) + ",ticketToolDefault=" + fmt.Sprintf("%q", mcpToolCreateTicket) + ";"
}

func mcpPromptResult(description, text string) map[string]any {
	return map[string]any{
		"description": description,
		"messages": []map[string]any{{
			"role": "user",
			"content": map[string]string{
				"type": "text",
				"text": text,
			},
		}},
	}
}

func mcpPlanPostPromptText(args map[string]string) string {
	return strings.TrimSpace(fmt.Sprintf(`
Use OpenPost as an agentic social media scheduler.

Source idea:
%s

Workflow:
1. Call search_operations to load the schemas for list_workspaces, list_provider_catalog, list_accounts, list_media, upload_media_from_url, and create_post as needed.
2. If workspace_id is missing, call query_operation with list_workspaces and ask which workspace to use.
3. Call query_operation with list_provider_catalog and list_accounts to choose available destinations matching these platform hints: %s.
4. Call query_operation with list_media if the idea needs existing media, or call execute_operation with upload_media_from_url for a public media URL or upload_media_base64 for a local file up to 8 MiB when the client cannot show a file picker.
5. Call execute_operation with create_post to create one concise draft and relevant media_ids. Do not schedule it until the user approves timing and destinations.
6. Explain what you created and suggest the next scheduling step.

workspace_id: %s
`, promptArg(args, "idea", "(missing idea)"), promptArg(args, "platforms", "any connected platforms"), promptArg(args, "workspace_id", "(choose with list_workspaces)")))
}

func mcpRenditionsPromptText(args map[string]string) string {
	return strings.TrimSpace(fmt.Sprintf(`
Adapt an existing OpenPost Post into platform-native variants.

workspace_id: %s
post_id: %s
goal: %s

Workflow:
1. Call search_operations to load the get_post and set_post_variants schemas.
2. Call query_operation with get_post to inspect destinations and current state.
3. Write concise, platform-native copy for each destination account.
4. Call execute_operation with set_post_variants and one variant per destination account.
5. Summarize what changed and mention any platforms that need media, hashtags, or shorter copy.
`, promptArg(args, "workspace_id", "(required)"), promptArg(args, "post_id", "(required)"), promptArg(args, "goal", "match the source Post and audience")))
}

func mcpReviewQueuePromptText(args map[string]string) string {
	return strings.TrimSpace(fmt.Sprintf(`
Review the OpenPost publishing queue and recommend useful next actions.

workspace_id: %s
window: %s

Workflow:
1. Call search_operations to load the list_posts and suggest_next_slot schemas.
2. Call query_operation with list_posts for the workspace and requested window. Prefer narrow windows of 7 to 14 days with activity_bucket scheduled; keep the default limit and repeat the request with the returned next_cursor while has_more is true, repeating all other filters unchanged. Calendar windows are limited to one page, so narrow the window instead of widening it when results do not fit.
3. Look for collisions, empty stretches, missing platform coverage, and Posts that need destination-specific Variants. Failed destinations are summarized per Post as failed_variant_count with a curated error_kind, error_action, and error_message; call get_post for full delivery detail and retry_failed_variants to retry safely retryable failures when a failure needs action.
4. Call query_operation with suggest_next_slot if a useful new slot is needed.
5. Recommend concrete actions without canceling or scheduling anything unless the user explicitly asks.
`, promptArg(args, "workspace_id", "(required)"), promptArg(args, "window", "upcoming queue")))
}

func promptArg(args map[string]string, name, fallback string) string {
	if args == nil {
		return fallback
	}
	value := strings.TrimSpace(args[name])
	if value == "" {
		return fallback
	}
	return value
}
