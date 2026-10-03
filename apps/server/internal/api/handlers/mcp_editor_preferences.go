package handlers

import (
	"context"
	"encoding/json"
	"reflect"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/services/editorpreferences"
)

// Inline Huma's schemas so HTTP and MCP share the saved-record contract.
func editorRecordSchema(value any) map[string]any {
	registry := huma.NewMapRegistry("#/components/schemas/", huma.DefaultSchemaNamer)
	data, _ := json.Marshal(registry.Schema(reflect.TypeOf(value), true, ""))
	var root map[string]any
	_ = json.Unmarshal(data, &root)
	var expand func(map[string]any) map[string]any
	expand = func(node map[string]any) map[string]any {
		if ref, ok := node["$ref"].(string); ok {
			data, _ := json.Marshal(registry.Map()[ref[len("#/components/schemas/"):]])
			_ = json.Unmarshal(data, &node)
			delete(node, "$ref")
		}
		for key, v := range node {
			switch child := v.(type) {
			case map[string]any:
				node[key] = expand(child)
			case []any:
				for i, item := range child {
					if nested, ok := item.(map[string]any); ok {
						child[i] = expand(nested)
					}
				}
			}
		}
		return node
	}
	return expand(root)
}
func editorPersonalizationOperation(name string) bool {
	switch name {
	case "preferences_get", "preferences_set", "preferences_remove", "style_list", "style_inspect", "style_save", "style_archive":
		return true
	}
	return false
}
func mcpEditorPersonalizationTool(name string) mcpOperationDefinition {
	fields := map[string]any{"project_id": map[string]any{"type": "string"}}
	mode := mcpOperationQuery
	description := "Read explicit personal Workspace rules, shared project rules, saved styles, favorite metadata and suggestions from deliberate choices. Disabled rules are returned for inspection, not application. Current instructions take priority."
	required := []string{}
	switch name {
	case "preferences_get", "style_list":
		fields["editor_kind"] = map[string]any{"type": "string", "enum": []string{"video", "image"}}
		fields["context"] = map[string]any{"type": "string", "maxLength": 100}
		required = append(required, "editor_kind")
	case "preferences_set":
		mode = mcpOperationExecute
		description = "Save or revise an explicit rule only when the user asks to remember or always use it. Empty preference.project_id is personal; a named project shares the rule with collaborators. Use the user's exact source_instruction. expected_revision=0 creates; updates require the inspected revision. Returns the saved record for inspection and undo."
		fields["preference"] = editorRecordSchema(editorpreferences.Preference{})
		fields["expected_revision"] = map[string]any{"type": "integer", "minimum": 0}
		required = []string{"preference", "expected_revision"}
	case "preferences_remove":
		mode = mcpOperationExecute
		description = "Forget an explicit rule by exact ID and revision only at the user's request. Retain the inspected rule if restoration is requested."
		fields["id"] = map[string]any{"type": "string", "minLength": 1}
		fields["expected_revision"] = map[string]any{"type": "integer", "minimum": 1}
		required = []string{"id", "expected_revision"}
	case "style_inspect":
		description = "Inspect a saved style at its exact immutable version. Version zero selects latest. Existing edits are independent copies; style updates never restyle a project."
		fields["id"] = map[string]any{"type": "string", "minLength": 1}
		fields["version"] = map[string]any{"type": "integer", "minimum": 0}
		required = []string{"id"}
	case "style_archive":
		mode = mcpOperationExecute
		description = "Remove or restore a saved style in the selector only at the user's request. Exact pinned versions remain readable for existing work."
		fields["id"] = map[string]any{"type": "string", "minLength": 1}
		fields["expected_version"] = map[string]any{"type": "integer", "minimum": 1}
		fields["archived"] = map[string]any{"type": "boolean"}
		required = []string{"id", "expected_version", "archived"}
	case "style_save":
		mode = mcpOperationExecute
		description = "Save a style or a new immutable version only at the user's explicit instruction. Use style_capture first. Exact authored choices and interpretations are separate. expected_version=0 creates; updates require latest inspected version. Never import reference media implicitly."
		fields["style"] = editorRecordSchema(editorpreferences.Style{})
		fields["expected_version"] = map[string]any{"type": "integer", "minimum": 0}
		required = []string{"style", "expected_version"}
	}
	return editorAgentTool(name, "Editor preferences and styles", description, mode, fields, required...)
}
func (h *MCPHandler) callEditorPersonalization(ctx context.Context, workspaceID, userID, operation string, args map[string]any) (any, *mcpError) {
	service := editorpreferences.NewService(h.db)
	str := func(key string) string { value, _ := args[key].(string); return value }
	number := func(key string) int { value, _ := args[key].(float64); return int(value) }
	var result any
	var err error
	switch operation {
	case "preferences_get", "style_list":
		result, err = service.Context(ctx, workspaceID, userID, str("project_id"), str("editor_kind"), str("context"))
	case "style_inspect":
		result, err = service.Style(ctx, workspaceID, userID, str("id"), number("version"))
	case "preferences_set":
		data, _ := json.Marshal(args["preference"])
		var preference editorpreferences.Preference
		if err = json.Unmarshal(data, &preference); err == nil {
			var previous *editorpreferences.Preference
			if number("expected_revision") > 0 {
				p, e := service.Preference(ctx, workspaceID, userID, preference.ProjectID, preference.ID)
				if e != nil {
					err = e
					break
				}
				previous = &p
			}
			saved, e := service.SavePreference(ctx, workspaceID, userID, preference, number("expected_revision"))
			err = e
			result = map[string]any{"saved": saved, "previous": previous}
		}
	case "preferences_remove":
		previous, e := service.Preference(ctx, workspaceID, userID, str("project_id"), str("id"))
		if e != nil {
			err = e
			break
		}
		err = service.RemovePreference(ctx, workspaceID, userID, str("project_id"), str("id"), number("expected_revision"))
		result = map[string]any{"removed": err == nil, "previous": previous}
	case "style_archive":
		archived, _ := args["archived"].(bool)
		err = service.ArchiveStyle(ctx, workspaceID, userID, str("id"), number("expected_version"), archived)
		result = map[string]bool{"archived": archived}
	case "style_save":
		data, _ := json.Marshal(args["style"])
		var style editorpreferences.Style
		if err = json.Unmarshal(data, &style); err == nil {
			result, err = service.SaveStyle(ctx, workspaceID, userID, style, number("expected_version"))
		}
	}
	if err != nil {
		return nil, &mcpError{Code: -32602, Message: err.Error()}
	}
	return editorAgentToolResult(map[string]any{"result": result}), nil
}
func mcpEditorLibraryTool(name string) mcpOperationDefinition {
	fields := editorAgentSessionField()
	mode := mcpOperationQuery
	description := "Search the connected editor's libraries and brand kit. Returns at most 30 relevant candidates with exact IDs, content versions, favorites, dependencies and compatibility. Device-local recipes are available only on this device. Favorites are candidates, never mandatory."
	required := []string{"session_id"}
	switch name {
	case "library_search":
		fields["query"] = map[string]any{"type": "string", "maxLength": 200}
		fields["favorites_only"] = map[string]any{"type": "boolean"}
	case "library_inspect":
		description = "Inspect an exact library record, recipe, explicit slots and dependencies before applying. Never infer placeholders. Readable text and source meaning take precedence over template fit."
		fields["entry_id"] = map[string]any{"type": "string", "minLength": 1}
		required = append(required, "entry_id")
	case "style_capture":
		description = "Capture observed typography and palette from the authored project, including its source revision. Exact choices and interpretation are separate. Does not save or restyle."
	case "library_apply", "library_save", "style_preview":
		mode = mcpOperationExecute
		fields["project_id"] = map[string]any{"type": "string", "minLength": 1}
		fields["expected_revision"] = map[string]any{"type": "string", "minLength": 1}
		fields["request_id"] = map[string]any{"type": "string", "minLength": 1, "maxLength": 160}
		required = append(required, "project_id", "expected_revision", "request_id")
		fields["target_ids"] = map[string]any{"type": "array", "maxItems": 20, "uniqueItems": true, "items": map[string]any{"type": "string", "minLength": 1}}
		switch name {
		case "library_apply":
			description = "Apply an inspected entry at its exact version through normal editor actions, creating an independent undoable instance. Exact target IDs select effects/styles; templates create a new image page or video block. Explicit slots require exact fills. Never substitute sources implicitly."
			fields["entry_id"] = map[string]any{"type": "string", "minLength": 1}
			fields["version"] = map[string]any{"type": "string", "minLength": 1}
			fields["frame"] = map[string]any{"type": "integer", "minimum": 0}
			fields["track_id"] = map[string]any{"type": "string", "minLength": 1}
			fields["fills"] = map[string]any{"type": "object", "maxProperties": 20, "additionalProperties": map[string]any{"type": "string", "maxLength": 2000}}
			required = append(required, "entry_id", "version")
		case "library_save":
			description = "Save the named video selection or image document to its existing library at the user's explicit instruction. Optional slots name exact text IDs and a maximum grapheme count. Never guess replaceable placeholders."
			fields["name"] = map[string]any{"type": "string", "minLength": 1, "maxLength": 100}
			fields["slots"] = map[string]any{"type": "array", "maxItems": 20, "items": map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{"name": map[string]any{"type": "string", "minLength": 1, "maxLength": 100}, "target_id": map[string]any{"type": "string", "minLength": 1}, "max_characters": map[string]any{"type": "integer", "minimum": 1, "maximum": 2000}}, "required": []string{"name", "target_id", "max_characters"}}}
			required = append(required, "name")
		default:
			description = "Render proposed typography on a separate copy of the current frame or page, without live edits. Exact selected IDs constrain the preview. Guidance-only styles require a proposed edit and cannot be mechanically previewed."
			fields["definition"] = editorRecordSchema(editorpreferences.StyleDefinition{})
			fields["frame"] = map[string]any{"type": "integer", "minimum": 0}
			required = append(required, "definition")
		}
	}
	return editorAgentTool(name, "Editor library and style", description, mode, fields, required...)
}
