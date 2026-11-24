package handlers

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"unicode"
)

func mcpAdvertisedTools() []map[string]any {
	return []map[string]any{
		mcpSearchTool(),
		mcpQueryTool(),
		mcpExecuteTool(),
		mcpRenderSchedulerWidgetTool(),
		mcpRenderLocalUploadTool(),
		mcpCreateLocalUploadTicketTool(),
	}
}

// mcpSearchToolsForScope is the progressive-discovery surface: the
// search/query/execute trio plus the scheduler widget. It is the full
// listing in search mode and is appended to the direct listing in both mode.
func mcpSearchToolsForScope(scope string) []map[string]any {
	tools := mcpAdvertisedTools()
	if !mcpScopeIsReadOnly(scope) {
		return tools
	}
	readOnlyTools := make([]map[string]any, 0, len(tools)-1)
	for _, tool := range tools {
		if tool["name"] != mcpToolExecute && tool["name"] != mcpToolCreateTicket {
			readOnlyTools = append(readOnlyTools, tool)
		}
	}
	return readOnlyTools
}

// mcpDirectToolsForScope exposes the operation catalog itself: every
// operation is callable directly with its own arguments. Read-only scopes
// see only query-mode operations; enforcement for direct calls is identical
// to the delegated path.
func mcpDirectToolsForScope(scope string) []map[string]any {
	readOnly := mcpScopeIsReadOnly(scope)
	catalog := mcpOperationCatalog()
	tools := make([]map[string]any, 0, len(catalog)+1)
	for _, operation := range catalog {
		if readOnly && operation.Mode != mcpOperationQuery {
			continue
		}
		tools = append(tools, operation.Descriptor)
	}
	tools = append(tools, mcpRenderSchedulerWidgetTool())
	// render_local_media_upload changes no state and stays visible to
	// read-only connections; the ticket tool mints the upload credential.
	tools = append(tools, mcpRenderLocalUploadTool())
	if !readOnly {
		tools = append(tools, mcpCreateLocalUploadTicketTool())
	}
	return tools
}

func (h *MCPHandler) mcpAdvertisedToolsForScope(scope string, mode mcpToolMode) []map[string]any {
	switch mode {
	case mcpToolModeSearch:
		return mcpSearchToolsForScope(scope)
	case mcpToolModeBoth:
		tools := mcpDirectToolsForScope(scope)
		for _, tool := range mcpSearchToolsForScope(scope) {
			if tool["name"] == mcpToolRenderWidget || tool["name"] == mcpToolRenderUpload || tool["name"] == mcpToolCreateTicket {
				continue
			}
			tools = append(tools, tool)
		}
		return tools
	default:
		return mcpDirectToolsForScope(scope)
	}
}

func mcpSearchTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":  mcpToolSearch,
		"title": "Search OpenPost operations",
		"description": "Search the OpenPost capability catalog before a task when the exact operation or arguments are unknown. " +
			"Returns matching operation names, input and output schemas, safety annotations, and the required query_operation or execute_operation tool.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query": map[string]any{
					"type":        "string",
					"description": "Plain-language capability or operation name to find, such as 'create and schedule a video post' or 'list connected accounts'.",
				},
				"limit": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"maximum":     10,
					"description": "Maximum matching operation definitions to return. Defaults to 5.",
				},
			},
			"required":             []string{"query"},
			"additionalProperties": false,
		},
	}, mcpToolSafety{ReadOnly: true, Idempotent: true})
}

func mcpQueryTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolQuery,
		"title":       "Query OpenPost",
		"description": "Run one guaranteed read-only operation returned by search_operations; use it to inspect OpenPost without changing state. Returns that operation's structured result and rejects every mutation.",
		"inputSchema": mcpDelegatedOperationInputSchema(
			"Exact read-only operation name returned by search_operations.",
			"Arguments matching the read-only operation input schema returned by search_operations.",
		),
	}, mcpToolSafety{ReadOnly: true, OpenWorld: true, Idempotent: true})
}

func mcpExecuteTool() map[string]any {
	return mcpToolDescriptor(map[string]any{
		"name":        mcpToolExecute,
		"title":       "Execute OpenPost mutation",
		"description": "Run one state-changing or external-action operation returned by search_operations; use it only after mutation approval. Returns that operation's structured result and rejects every read-only operation.",
		"inputSchema": mcpDelegatedOperationInputSchema(
			"Exact state-changing operation name returned by search_operations.",
			"Arguments matching the mutation input schema returned by search_operations.",
		),
	}, mcpToolSafety{Destructive: true, OpenWorld: true})
}

func mcpDelegatedOperationInputSchema(operationDescription, argumentsDescription string) map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"operation": map[string]any{
				"type":        "string",
				"description": operationDescription,
			},
			"arguments": map[string]any{
				"type":                 "object",
				"description":          argumentsDescription,
				"properties":           map[string]any{},
				"additionalProperties": true,
			},
		},
		"required":             []string{"operation", "arguments"},
		"additionalProperties": false,
	}
}

func mcpPrepareInputSchema(schema map[string]any) {
	if schema["type"] != "object" {
		return
	}
	properties, hasProperties := schema["properties"].(map[string]any)
	if !hasProperties {
		return
	}
	if _, ok := schema["required"]; !ok {
		schema["required"] = []string{}
	}
	if _, ok := schema["additionalProperties"]; !ok {
		schema["additionalProperties"] = false
	}
	for name, rawProperty := range properties {
		property, ok := rawProperty.(map[string]any)
		if !ok {
			continue
		}
		mcpPrepareNestedInputSchema(property)
		if _, ok := property["examples"]; !ok {
			if example, ok := mcpInputExample(name, property); ok {
				property["examples"] = []any{example}
			}
		}
	}
}

func mcpPrepareNestedInputSchema(schema map[string]any) {
	switch schema["type"] {
	case "object":
		mcpPrepareInputSchema(schema)
	case "array":
		if items, ok := schema["items"].(map[string]any); ok {
			mcpPrepareNestedInputSchema(items)
		}
	}
}

func mcpInputExample(name string, schema map[string]any) (any, bool) {
	if value, ok := mcpEnumInputExample(schema); ok {
		return value, true
	}
	switch schema["type"] {
	case "string":
		return mcpStringInputExample(name, schema), true
	case "integer":
		return mcpIntegerInputExample(name), true
	case "boolean":
		return true, true
	case "array":
		return mcpArrayInputExample(name, schema)
	case "object":
		return mcpObjectInputExample(name, schema), true
	}
	return nil, false
}

func mcpEnumInputExample(schema map[string]any) (any, bool) {
	if values, ok := schema["enum"].([]string); ok && len(values) > 0 {
		return values[0], true
	}
	if values, ok := schema["enum"].([]any); ok && len(values) > 0 {
		return values[0], true
	}
	return nil, false
}

func mcpIntegerInputExample(name string) int {
	examples := map[string]int{
		"limit": 20, "thumbnail_timestamp_ms": 1500, "random_delay_minutes": 10,
	}
	if example, ok := examples[name]; ok {
		return example
	}
	return 1
}

func mcpArrayInputExample(name string, schema map[string]any) (any, bool) {
	items, ok := schema["items"].(map[string]any)
	if !ok {
		return nil, false
	}
	example, ok := mcpInputExample(strings.TrimSuffix(name, "s"), items)
	if !ok {
		return nil, false
	}
	return []any{example}, true
}

func mcpObjectInputExample(name string, schema map[string]any) map[string]any {
	properties, ok := schema["properties"].(map[string]any)
	if !ok {
		return mcpOpenObjectInputExample(name)
	}
	required := map[string]bool{}
	if names, ok := schema["required"].([]string); ok {
		for _, requiredName := range names {
			required[requiredName] = true
		}
	}
	example := map[string]any{}
	for propertyName, rawProperty := range properties {
		if len(required) > 0 && !required[propertyName] {
			continue
		}
		property, ok := rawProperty.(map[string]any)
		if !ok {
			continue
		}
		if value, ok := mcpInputExample(propertyName, property); ok {
			example[propertyName] = value
		}
	}
	return example
}

func mcpOpenObjectInputExample(name string) map[string]any {
	examples := map[string]map[string]any{
		"arguments": {"workspace_id": "2f4aa6c2-3c8f-4e1f-91ac-43de2c2b67b1"},
		"data":      {"publications": []any{}},
		"metadata":  {"campaign": "spring-launch"},
	}
	if example, ok := examples[name]; ok {
		return example
	}
	return map[string]any{"privacy": "public"}
}

func mcpStringInputExample(name string, schema map[string]any) string {
	if example, ok := mcpStringInputExamples[name]; ok {
		return example
	}
	if schema["format"] == "date-time" {
		return "2026-08-01T09:30:00Z"
	}
	if schema["format"] == "uri" {
		return "https://example.com/resource"
	}
	return "example"
}

var mcpStringInputExamples = map[string]string{
	"workspace_id":      "2f4aa6c2-3c8f-4e1f-91ac-43de2c2b67b1",
	"social_account_id": "7a763db0-7c0f-4a81-b4aa-c4d5b44e786c",
	"post_id":           "c66d7139-0549-4666-9374-124e988f97e7",
	"variant_id":        "08ac072f-f39f-4583-8202-53f5ddf47eb6",
	"media_id":          "30454fbe-246c-4d9d-9289-13e2c8df7f1e",
	"comment_id":        "eyJyZW5kaXRpb25faWQiOiAiMDhhYzA3MmYtZjM5Zi00NTgzLTgyMDItNTNmNWRkZjQ3ZWI2IiwgInByb3ZpZGVyX2NvbW1lbnRfaWQiOiAicHJvdmlkZXItY29tbWVudC0xMjMifQ",
	"operation":         mcpToolAccounts,
	"query":             "list connected social accounts",
	"content":           "A concise product update for our community.",
	"source_text":       "A concise product update for our community.",
	"body":              "A concise product update for our community.",
	"title":             "Spring launch",
	"description":       "Full product launch details.",
	"goal":              "Increase qualified sign-ups",
	"audience":          "Independent creators",
	"alt_text":          "Product dashboard showing the weekly publishing calendar",
	"filename":          "launch-demo.mp4",
	"role":              "attachment",
	"parent_id":         "provider-comment-123",
	"view":              "publications",
	"profile":           "short_text",
	"content_profile":   "short_text",
	"status":            "draft",
	"filter":            "all",
	"source_url":        "https://example.com/launch",
	"url":               "https://example.com/launch",
	"scheduled_at":      "2026-08-01T09:30:00Z",
	"run_at":            "2026-08-01T09:30:00Z",
	"after":             "2026-08-01T09:30:00Z",
	"from":              "2026-08-01T09:30:00Z",
	"to":                "2026-08-01T09:30:00Z",
}

type mcpOperationMatch struct {
	index int
	score int
	doc   map[string]any
}

func searchMCPOperations(args map[string]any, allowedModes ...mcpOperationMode) (any, *mcpError) {
	var input struct {
		Query string `json:"query"`
		Limit int    `json:"limit"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid search arguments"}
	}
	input.Query = strings.TrimSpace(input.Query)
	if input.Query == "" {
		return nil, &mcpError{Code: -32602, Message: "query is required"}
	}
	if input.Limit == 0 {
		input.Limit = 5
	}
	if input.Limit < 1 || input.Limit > 10 {
		return nil, &mcpError{Code: -32602, Message: "limit must be between 1 and 10"}
	}

	query := strings.ToLower(input.Query)
	terms := mcpSearchTerms(query)
	matches := make([]mcpOperationMatch, 0, input.Limit)
	for index, operation := range mcpOperationCatalog() {
		if !mcpOperationModeAllowed(operation.Mode, allowedModes) {
			continue
		}
		doc := mcpOperationDocument(operation)
		name, _ := doc["name"].(string)
		title, _ := doc["title"].(string)
		description, _ := doc["description"].(string)
		schema, _ := json.Marshal(map[string]any{
			"input":  doc["inputSchema"],
			"output": doc["outputSchema"],
		})
		score := mcpOperationSearchScore(query, terms, strings.ToLower(name), strings.ToLower(title), strings.ToLower(description), strings.ToLower(string(schema)))
		if score > 0 {
			matches = append(matches, mcpOperationMatch{index: index, score: score, doc: doc})
		}
	}
	sort.SliceStable(matches, func(i, j int) bool {
		if matches[i].score == matches[j].score {
			return matches[i].index < matches[j].index
		}
		return matches[i].score > matches[j].score
	})
	if len(matches) > input.Limit {
		matches = matches[:input.Limit]
	}
	operations := make([]map[string]any, 0, len(matches))
	for _, match := range matches {
		operations = append(operations, match.doc)
	}
	message := fmt.Sprintf("Found %d OpenPost operation(s) for %q.", len(operations), input.Query)
	if len(operations) == 0 {
		message = "No matching OpenPost operations found. Try a focused capability phrase such as 'draft', 'scheduled post', 'media', or 'connected accounts'."
	}
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: message}},
		"structuredContent": map[string]any{
			"operations": operations,
		},
	}, nil
}

func mcpOperationModeAllowed(mode mcpOperationMode, allowed []mcpOperationMode) bool {
	if len(allowed) == 0 {
		return true
	}
	for _, candidate := range allowed {
		if mode == candidate {
			return true
		}
	}
	return false
}

func mcpOperationDocument(operation mcpOperationDefinition) map[string]any {
	tool := operation.Descriptor
	return map[string]any{
		"name":          tool["name"],
		"title":         tool["title"],
		"description":   tool["description"],
		"inputSchema":   tool["inputSchema"],
		"outputSchema":  tool["outputSchema"],
		"annotations":   tool["annotations"],
		"executionTool": string(operation.Mode),
	}
}

func mcpSearchTerms(query string) []string {
	stopWords := map[string]bool{
		"a": true, "an": true, "and": true, "for": true, "in": true, "my": true,
		"of": true, "openpost": true, "or": true, "the": true, "to": true, "with": true,
		"all": true, "any": true, "are": true, "be": true, "by": true, "can": true,
		"could": true, "from": true, "is": true, "it": true, "its": true, "me": true,
		"need": true, "on": true, "please": true, "that": true, "this": true,
		"want": true, "would": true,
	}
	parts := strings.FieldsFunc(query, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '_'
	})
	terms := make([]string, 0, len(parts))
	for _, part := range parts {
		if !stopWords[part] {
			terms = append(terms, part)
		}
	}
	if len(terms) == 0 {
		return parts
	}
	return terms
}

func mcpOperationSearchScore(query string, terms []string, name, title, description, schema string) int {
	if query == name {
		return 1000
	}
	if !mcpOperationSearchRelevant(terms, name, title, description, schema) {
		return 0
	}
	score := 0
	if strings.Contains(name, query) {
		score += 200
	}
	if strings.Contains(title, query) {
		score += 100
	}
	if strings.Contains(description, query) {
		score += 50
	}
	for _, term := range terms {
		switch {
		case strings.Contains(name, term):
			score += 20
		case strings.Contains(title, term):
			score += 10
		case strings.Contains(description, term):
			score += 5
		case strings.Contains(schema, term):
			score++
		}
	}
	return score
}

func mcpOperationSearchRelevant(terms []string, name, title, description, schema string) bool {
	queryActions := make(map[string]bool)
	meaningfulTerms := make([]string, 0, len(terms))
	for _, term := range terms {
		if action := mcpSearchAction(term); action != "" {
			queryActions[action] = true
			continue
		}
		if !mcpSearchGenericTerm(term) {
			meaningfulTerms = append(meaningfulTerms, term)
		}
	}

	operationAction := mcpSearchAction(strings.SplitN(name, "_", 2)[0])
	if len(queryActions) > 0 && !queryActions[operationAction] {
		return false
	}
	// A bare action such as "delete" does not identify an OpenPost object. Refusing
	// it is safer than guessing a state-changing operation from the verb alone.
	if len(meaningfulTerms) == 0 {
		return false
	}

	document := name + " " + title + " " + description + " " + schema
	matched := 0
	for _, term := range meaningfulTerms {
		if strings.Contains(document, term) {
			matched++
		}
	}
	requiredMatches := len(meaningfulTerms)
	if requiredMatches >= 3 {
		requiredMatches = (requiredMatches*2 + 2) / 3
	}
	return matched >= requiredMatches
}

func mcpSearchAction(term string) string {
	switch term {
	case "find", "get", "inspect", "list", "read", "review", "search", "show":
		return "read"
	case "create", "make":
		return "create"
	case "edit", "set", "update":
		return "update"
	case "remove", "delete":
		return "delete"
	case "respond", "reply":
		return "reply"
	case "check", "validate":
		return "validate"
	case "recommend", "suggest":
		return "suggest"
	case "cancel", "hide", "publish", "render", "schedule", "upload":
		return term
	default:
		return ""
	}
}

func mcpSearchGenericTerm(term string) bool {
	switch term {
	case "data", "detail", "details", "id", "info", "information", "item", "items",
		"operation", "operations", "result", "results", "status", "tool", "tools":
		return true
	default:
		return false
	}
}
