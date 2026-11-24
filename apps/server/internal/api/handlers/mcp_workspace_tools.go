package handlers

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/openpost/backend/internal/models"
)

type mcpWorkspace struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Role      string `json:"role"`
	CreatedAt string `json:"created_at"`
}

func (h *MCPHandler) listWorkspaces(ctx context.Context, userID string) (any, *mcpError) {
	var rows []struct {
		models.Workspace `bun:",extend"`
		Role             string `bun:"role"`
	}
	query := h.db.NewSelect().
		Model(&rows).
		ColumnExpr("workspace.*").
		ColumnExpr("wm.role").
		Join("JOIN workspace_members AS wm ON wm.workspace_id = workspace.id").
		Where("wm.user_id = ? AND wm.status = ?", userID, models.WorkspaceMemberStatusActive)
	if workspaceID := mcpWorkspaceScopeFromContext(ctx); workspaceID != "" {
		query = query.Where("workspace.id = ?", workspaceID)
	}
	err := query.OrderExpr("workspace.created_at ASC").Scan(ctx)
	if err != nil && err != sql.ErrNoRows {
		return nil, &mcpError{Code: -32603, Message: "failed to list workspaces"}
	}

	workspaces := make([]mcpWorkspace, 0, len(rows))
	names := make([]string, 0, len(rows))
	for _, row := range rows {
		allowed, accessErr := workspaceReadAllowed(ctx, h.db, row.ID, userID)
		if accessErr != nil {
			return nil, &mcpError{Code: -32603, Message: "failed to check workspace access"}
		}
		if !allowed {
			continue
		}
		workspaces = append(workspaces, mcpWorkspace{
			ID:        row.ID,
			Name:      row.Name,
			Role:      row.Role,
			CreatedAt: row.CreatedAt.Format(time.RFC3339),
		})
		names = append(names, row.Name)
	}
	text := "No workspaces available."
	if len(names) > 0 {
		text = "Available workspaces: " + strings.Join(names, ", ")
	}

	return map[string]any{
		"content": []mcpContent{{
			Type: "text",
			Text: text,
		}},
		"structuredContent": map[string]any{
			"workspaces": workspaces,
		},
	}, nil
}

func (h *MCPHandler) listProviderCatalog(ctx context.Context) any {
	providers := applyProviderAvailabilityReadiness(
		ctx,
		h.readiness,
		providerAvailability(h.providerMapSnapshot(), h.dynamicMastodon),
	)
	available := make([]string, 0)
	needsConfiguration := make([]string, 0)
	planned := make([]string, 0)
	for _, provider := range providers {
		switch provider.Status {
		case providerStatusAvailable:
			available = append(available, provider.DisplayName)
		case providerStatusNeedsConfiguration:
			needsConfiguration = append(needsConfiguration, provider.DisplayName)
		case providerStatusPlanned:
			planned = append(planned, provider.DisplayName)
		default:
			needsConfiguration = append(needsConfiguration, provider.DisplayName+" ("+provider.Status+")")
		}
	}
	parts := []string{}
	if len(available) > 0 {
		parts = append(parts, "available: "+strings.Join(available, ", "))
	}
	if len(needsConfiguration) > 0 {
		parts = append(parts, "needs configuration: "+strings.Join(needsConfiguration, ", "))
	}
	if len(planned) > 0 {
		parts = append(parts, "planned: "+strings.Join(planned, ", "))
	}
	text := "Provider catalog is empty."
	if len(parts) > 0 {
		text = "Provider catalog: " + strings.Join(parts, "; ")
	}
	return map[string]any{
		"content": []mcpContent{{
			Type: "text",
			Text: text,
		}},
		"structuredContent": map[string]any{
			"providers": providers,
		},
	}
}

type mcpAccount struct {
	Alias           string `json:"alias,omitempty"`
	ID              string `json:"id"`
	Platform        string `json:"platform"`
	Slug            string `json:"slug"`
	AccountID       string `json:"account_id"`
	AccountUsername string `json:"account_username,omitempty"`
	InstanceURL     string `json:"instance_url,omitempty"`
}

func (h *MCPHandler) listAccounts(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		WorkspaceID string `json:"workspace_id"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid list_accounts arguments"}
	}
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, input.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}

	var rows []models.SocialAccount
	err := h.db.NewSelect().
		Model(&rows).
		Where("workspace_id = ?", input.WorkspaceID).
		Where("is_active = ?", true).
		OrderExpr("platform ASC, slug ASC").
		Scan(ctx)
	if err != nil && err != sql.ErrNoRows {
		return nil, &mcpError{Code: -32603, Message: "failed to list accounts"}
	}

	accounts := make([]mcpAccount, 0, len(rows))
	labels := make([]string, 0, len(rows))
	for _, row := range rows {
		accounts = append(accounts, mcpAccount{
			ID:              row.ID,
			Platform:        row.Platform,
			Slug:            row.Slug,
			Alias:           row.Alias,
			AccountID:       row.AccountID,
			AccountUsername: row.AccountUsername,
			InstanceURL:     row.InstanceURL,
		})
		labels = append(labels, row.Platform+":"+row.Slug)
	}

	text := "No active social accounts connected."
	if len(labels) > 0 {
		text = "Active social accounts: " + strings.Join(labels, ", ")
	}
	return map[string]any{
		"content": []mcpContent{{
			Type: "text",
			Text: text,
		}},
		"structuredContent": map[string]any{
			"accounts": accounts,
		},
	}, nil
}

func (h *MCPHandler) loadMCPWorkspace(ctx context.Context, workspaceID string) (models.Workspace, *mcpError) {
	var workspace models.Workspace
	err := h.db.NewSelect().
		Model(&workspace).
		Where("id = ?", workspaceID).
		Scan(ctx)
	if err != nil {
		if err == sql.ErrNoRows {
			return workspace, &mcpError{Code: -32602, Message: "workspace not found"}
		}
		return workspace, &mcpError{Code: -32603, Message: "failed to load workspace"}
	}
	return workspace, nil
}

type mcpSlotSuggestion struct {
	WorkspaceID string                   `json:"workspace_id"`
	Timezone    string                   `json:"timezone"`
	SlotTime    string                   `json:"slot_time,omitempty"`
	SlotTimeUTC string                   `json:"slot_time_utc,omitempty"`
	Slot        *PostingScheduleResponse `json:"slot,omitempty"`
	Message     string                   `json:"message"`
}

type mcpSuggestNextSlotInput struct {
	WorkspaceID string `json:"workspace_id"`
	After       string `json:"after"`
}

func (h *MCPHandler) suggestNextSlot(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input mcpSuggestNextSlotInput
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid suggest_next_slot arguments"}
	}
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, input.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	workspace, rpcErr := h.loadMCPWorkspace(ctx, input.WorkspaceID)
	if rpcErr != nil {
		return nil, rpcErr
	}

	loc, err := time.LoadLocation(workspace.Timezone)
	if err != nil {
		loc = time.UTC
		workspace.Timezone = "UTC"
	}
	now := time.Now().In(loc)
	if strings.TrimSpace(input.After) != "" {
		after, err := time.Parse(time.RFC3339, input.After)
		if err != nil {
			return nil, &mcpError{Code: -32602, Message: "after must be an RFC3339 timestamp"}
		}
		now = after.In(loc)
	}

	var schedules []models.PostingSchedule
	query := h.db.NewSelect().
		Model(&schedules).
		Where("workspace_id = ?", input.WorkspaceID).
		Where("is_active = ?", true)
	if err := query.Scan(ctx); err != nil && err != sql.ErrNoRows {
		return nil, &mcpError{Code: -32603, Message: "failed to load posting schedules"}
	}

	if len(schedules) == 0 {
		suggestion := mcpSlotSuggestion{
			WorkspaceID: input.WorkspaceID,
			Timezone:    workspace.Timezone,
			Message:     "No posting schedules configured for this workspace.",
		}
		return mcpSlotToolResult(suggestion), nil
	}

	var scheduledPublications []models.Publication
	publicationQuery := h.db.NewSelect().
		Model(&scheduledPublications).
		Where("workspace_id = ?", input.WorkspaceID).
		Where("status = ?", models.PublicationStatusScheduled).
		Where("scheduled_at >= ?", now.UTC().Add(-24*time.Hour)).
		Order("scheduled_at ASC")
	if err := publicationQuery.Scan(ctx); err != nil && err != sql.ErrNoRows {
		return nil, &mcpError{Code: -32603, Message: "failed to load scheduled posts"}
	}

	nextSlot, nextSlotTime := findNextConfiguredScheduleSlotTime(now, loc, schedules, scheduledPublications, workspace.RandomDelayMinutes)
	suggestion := mcpSlotSuggestion{
		WorkspaceID: input.WorkspaceID,
		Timezone:    workspace.Timezone,
		Message:     "No available slots found in the next month.",
	}
	if !nextSlotTime.IsZero() {
		suggestion.SlotTime = nextSlotTime.Format(time.RFC3339)
		suggestion.SlotTimeUTC = nextSlotTime.UTC().Format(time.RFC3339)
		suggestion.Message = "Next available slot found."
		if nextSlot != nil {
			slot := postingScheduleResponseForWorkspace(nextSlotTime, loc, *nextSlot)
			suggestion.Slot = &slot
		}
	}
	return mcpSlotToolResult(suggestion), nil
}

func (h *MCPHandler) providerReadiness(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		WorkspaceID string `json:"workspace_id"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid get_provider_readiness arguments"}
	}
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, input.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	handler := &ProviderReadinessHandler{db: h.db, providers: h.providerMapSnapshot(), readiness: h.readiness}
	accounts, err := handler.loadReadinessAccounts(ctx, input.WorkspaceID)
	if err != nil {
		return nil, &mcpError{Code: -32603, Message: "failed to load connected accounts"}
	}
	providers := make([]ProviderReadinessItem, 0, len(readinessProviders()))
	for _, provider := range readinessProviders() {
		providers = append(providers, handler.buildProviderReadiness(ctx, provider, accounts[provider]))
	}
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: fmt.Sprintf("Loaded provider readiness for %d providers.", len(providers))}},
		"structuredContent": map[string]any{
			"providers": providers,
		},
	}, nil
}

// dashboardLink builds a dashboard URL agents can hand to users so people see
// visualizations themselves. It is a pure URL builder from the configured app
// origin: the only state it reads is the workspace access check.
func (h *MCPHandler) dashboardLink(ctx context.Context, userID string, args map[string]any) (any, *mcpError) {
	var input struct {
		WorkspaceID string `json:"workspace_id"`
		Kind        string `json:"kind"`
		ID          string `json:"id"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid get_dashboard_link arguments"}
	}
	if rpcErr := h.ensureWorkspaceAccess(ctx, userID, input.WorkspaceID); rpcErr != nil {
		return nil, rpcErr
	}
	origin := strings.TrimRight(strings.TrimSpace(h.publicURL), "/")
	if origin == "" {
		return nil, &mcpError{Code: -32603, Message: "dashboard links require a configured app origin"}
	}
	var path string
	switch kind := strings.TrimSpace(input.Kind); kind {
	case "post":
		id := strings.TrimSpace(input.ID)
		if id == "" {
			return nil, &mcpError{Code: -32602, Message: "id is required for post dashboard links"}
		}
		path = "/publications/" + url.PathEscape(id)
	case "media":
		path = "/media"
	case "account":
		path = "/settings?tab=accounts"
	case "calendar":
		path = "/calendar"
	default:
		return nil, &mcpError{Code: -32602, Message: "kind must be one of post, media, account, or calendar"}
	}
	link := origin + path
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: fmt.Sprintf("Dashboard link for %s: %s", strings.TrimSpace(input.Kind), link)}},
		"structuredContent": map[string]any{
			"url":          link,
			"kind":         strings.TrimSpace(input.Kind),
			"workspace_id": strings.TrimSpace(input.WorkspaceID),
		},
	}, nil
}

type mcpDocEntry struct {
	Title    string
	Path     string
	Snippet  string
	Keywords string
}

// mcpDocRegistry is a curated offline index over the public docs and
// assistant skill pages. It stays static so search_docs never touches the
// network; paths resolve under /docs on the app origin.
var mcpDocRegistry = []mcpDocEntry{
	{Title: "Connect AI assistants (MCP)", Path: "/docs/mcp", Snippet: "Setup entry point for connecting ChatGPT, Claude, and other assistants to OpenPost.", Keywords: "mcp setup connect assistant install"},
	{Title: "Endpoints and tools", Path: "/docs/mcp/mcp-guide/endpoints-and-tools", Snippet: "Direct versus compact MCP endpoints, tool modes, and the full operation list.", Keywords: "mcp endpoints tools direct compact code mode operations"},
	{Title: "Permissions and safety", Path: "/docs/mcp/mcp-guide/permissions-and-safety", Snippet: "MCP scopes, approvals, destructive actions, and workspace boundaries.", Keywords: "mcp scopes permissions safety approval mcp:read mcp:full destructive"},
	{Title: "MCP use cases", Path: "/docs/mcp/mcp-guide/use-cases", Snippet: "Example assistant workflows for drafting, scheduling, and reviewing content.", Keywords: "mcp use cases workflows examples draft schedule"},
	{Title: "Self-hosted and local MCP", Path: "/docs/mcp/mcp-guide/self-hosted-and-local", Snippet: "Run the MCP server self-hosted and connect local clients and the stdio proxy.", Keywords: "mcp self-hosted local stdio proxy openpost-mcp"},
	{Title: "MCP media guide", Path: "/docs/mcp/mcp-guide/media", Snippet: "Upload and attach media through MCP, including local file picks.", Keywords: "mcp media upload image video local picker"},
	{Title: "Assistant skills", Path: "/docs/mcp/skills", Snippet: "Installable skills that teach assistants OpenPost workflows.", Keywords: "skills install assistant capabilities"},
	{Title: "Assistant skill use cases", Path: "/docs/mcp/skills/use-cases", Snippet: "When each assistant skill helps and what it automates.", Keywords: "skills use cases when workflows"},
	{Title: "Install assistant skills", Path: "/docs/mcp/skills/install", Snippet: "How to install OpenPost skills into a compatible assistant.", Keywords: "skills install setup howto"},
	{Title: "OpenPost CLI skill", Path: "/docs/mcp/skills/openpost-cli", Snippet: "Operate OpenPost from the terminal through the openpost CLI.", Keywords: "skills cli terminal command openpost-cli"},
	{Title: "ChatGPT setup", Path: "/docs/mcp/chatgpt", Snippet: "Connect ChatGPT to OpenPost with the scheduler widget and deep research.", Keywords: "chatgpt setup openai apps widget connector"},
	{Title: "Claude setup", Path: "/docs/mcp/claude", Snippet: "Connect Claude to OpenPost over MCP.", Keywords: "claude setup anthropic connector"},
	{Title: "Claude Code setup", Path: "/docs/mcp/claude-code", Snippet: "Use OpenPost from Claude Code sessions.", Keywords: "claude code cli setup terminal"},
	{Title: "Claude Desktop setup", Path: "/docs/mcp/claude-desktop", Snippet: "Add OpenPost to Claude Desktop's MCP servers.", Keywords: "claude desktop mcp server config"},
	{Title: "Codex setup", Path: "/docs/mcp/codex", Snippet: "Use OpenPost from Codex.", Keywords: "codex setup openai cli"},
	{Title: "Cursor setup", Path: "/docs/mcp/cursor", Snippet: "Add OpenPost to Cursor's MCP configuration.", Keywords: "cursor setup ide mcp config"},
	{Title: "Gemini CLI setup", Path: "/docs/mcp/gemini-cli", Snippet: "Use OpenPost from Gemini CLI.", Keywords: "gemini cli setup google terminal"},
	{Title: "OpenCode setup", Path: "/docs/mcp/opencode", Snippet: "Use OpenPost from OpenCode.", Keywords: "opencode setup terminal agent"},
	{Title: "VS Code setup", Path: "/docs/mcp/vs-code", Snippet: "Add OpenPost to VS Code's MCP support.", Keywords: "vs code vscode setup ide github copilot"},
	{Title: "GitHub Copilot setup", Path: "/docs/mcp/github-copilot", Snippet: "Use OpenPost from GitHub Copilot.", Keywords: "github copilot setup ide"},
	{Title: "Perplexity setup", Path: "/docs/mcp/perplexity", Snippet: "Use OpenPost from Perplexity.", Keywords: "perplexity setup search assistant"},
	{Title: "Choose an agent connection", Path: "/docs/mcp/choose-an-agent-connection", Snippet: "Compare MCP, CLI, API, and n8n automation surfaces.", Keywords: "choose compare mcp cli api n8n automation which"},
	{Title: "Quickstart", Path: "/docs/guides/quickstart", Snippet: "Create a workspace, connect an account, and publish a first post.", Keywords: "quickstart start first post publish begin onboard"},
	{Title: "Publishing guide", Path: "/docs/guides/publishing", Snippet: "Draft, validate, schedule, and publish posts across destinations.", Keywords: "publishing publish schedule draft validate destinations"},
	{Title: "Scheduling guide", Path: "/docs/guides/scheduling", Snippet: "Posting schedules, calendar windows, and the best time to publish.", Keywords: "scheduling schedule calendar slots timing queue"},
	{Title: "Analytics guide", Path: "/docs/guides/analytics", Snippet: "Read followers, engagement, views, and per-post performance.", Keywords: "analytics metrics engagement views followers reach impressions performance"},
	{Title: "Media guide", Path: "/docs/guides/media", Snippet: "Upload, organize, and attach media to posts.", Keywords: "media upload image video library attach"},
	{Title: "Accounts guide", Path: "/docs/guides/accounts", Snippet: "Connect and manage social accounts and destinations.", Keywords: "accounts connect social destinations platforms oauth"},
	{Title: "Inbox guide", Path: "/docs/guides/inbox", Snippet: "Read and reply to comments and messages from connected accounts.", Keywords: "inbox comments replies messages moderation engagement"},
	{Title: "Troubleshooting", Path: "/docs/guides/troubleshooting", Snippet: "Fix failed posts, disconnected accounts, and validation errors.", Keywords: "troubleshooting failed error fix retry validation disconnect"},
	{Title: "Workspaces guide", Path: "/docs/guides/workspaces", Snippet: "Organize teams, roles, and workspaces.", Keywords: "workspaces teams roles members organization"},
	{Title: "Automation overview", Path: "/docs/automate", Snippet: "Compare API, CLI, SDK, and n8n automation options.", Keywords: "automate automation api cli sdk n8n webhooks program"},
	{Title: "API overview", Path: "/docs/automate/api", Snippet: "Authenticate and call the OpenPost REST API.", Keywords: "api rest openapi tokens authentication reference"},
	{Title: "CLI overview", Path: "/docs/automate/cli", Snippet: "Script OpenPost from the terminal with the openpost CLI.", Keywords: "cli terminal scripts command line"},
	{Title: "n8n overview", Path: "/docs/automate/n8n", Snippet: "Automate OpenPost with n8n workflows.", Keywords: "n8n workflow automation nodes zapier"},
	{Title: "Self-hosting overview", Path: "/docs/self-hosting", Snippet: "Run OpenPost on your own infrastructure with Docker or a binary.", Keywords: "self-hosting self host docker deploy server homelab"},
	{Title: "Self-hosting configuration", Path: "/docs/self-hosting/configuration", Snippet: "Environment variables and runtime configuration for self-hosted OpenPost.", Keywords: "self-hosting configuration env environment variables config"},
}

type mcpDocHit struct {
	index int
	score int
}

func (h *MCPHandler) searchDocs(args map[string]any) (any, *mcpError) {
	var input struct {
		Query string `json:"query"`
		Limit int    `json:"limit"`
	}
	if err := decodeMCPArguments(args, &input); err != nil {
		return nil, &mcpError{Code: -32602, Message: "invalid search_docs arguments"}
	}
	input.Query = strings.TrimSpace(input.Query)
	if input.Query == "" {
		return nil, &mcpError{Code: -32602, Message: "query is required"}
	}
	limit := input.Limit
	if limit == 0 {
		limit = 5
	}
	if limit < 1 || limit > 10 {
		return nil, &mcpError{Code: -32602, Message: "limit must be between 1 and 10"}
	}
	terms := mcpSearchTerms(strings.ToLower(input.Query))
	hits := make([]mcpDocHit, 0, limit)
	for index, entry := range mcpDocRegistry {
		score := mcpDocScore(terms, entry)
		if score > 0 {
			hits = append(hits, mcpDocHit{index: index, score: score})
		}
	}
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].score == hits[j].score {
			return hits[i].index < hits[j].index
		}
		return hits[i].score > hits[j].score
	})
	if len(hits) > limit {
		hits = hits[:limit]
	}
	results := make([]map[string]any, 0, len(hits))
	for _, hit := range hits {
		entry := mcpDocRegistry[hit.index]
		results = append(results, map[string]any{
			"title": entry.Title, "path": entry.Path, "snippet": entry.Snippet,
		})
	}
	message := fmt.Sprintf("Found %d doc(s) for %q. Resolve paths under /docs on the app origin.", len(results), input.Query)
	if len(results) == 0 {
		message = fmt.Sprintf("No docs matched %q. Try a broader topic such as 'schedule', 'accounts', or 'self-hosting'.", input.Query)
	}
	return map[string]any{
		"content": []mcpContent{{Type: "text", Text: message}},
		"structuredContent": map[string]any{
			"results": results,
		},
	}, nil
}

func mcpDocScore(terms []string, entry mcpDocEntry) int {
	title := strings.ToLower(entry.Title)
	path := strings.ToLower(entry.Path)
	snippet := strings.ToLower(entry.Snippet)
	keywords := strings.ToLower(entry.Keywords)
	score := 0
	for _, term := range terms {
		switch {
		case strings.Contains(title, term):
			score += 3
		case strings.Contains(keywords, term):
			score += 2
		case strings.Contains(snippet, term), strings.Contains(path, term):
			score++
		}
	}
	return score
}

func mcpSlotToolResult(suggestion mcpSlotSuggestion) map[string]any {
	return map[string]any{
		"content": []mcpContent{{
			Type: "text",
			Text: suggestion.Message,
		}},
		"structuredContent": map[string]any{
			"suggestion": suggestion,
		},
	}
}
