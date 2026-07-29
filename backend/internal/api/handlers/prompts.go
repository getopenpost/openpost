package handlers

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

// Built-in prompts seeded on first request.
type PromptHandler struct {
	db             *bun.DB
	auth           middleware.Authenticator
	seedMu         sync.Mutex
	seeded         bool
	builtinPrompts []models.Prompt
}

func NewPromptHandler(db *bun.DB, authenticator middleware.Authenticator) *PromptHandler {
	return &PromptHandler{
		db:   db,
		auth: authenticator,
		builtinPrompts: []models.Prompt{
			// Bold & Provoking
			{ID: "builtin-001", Text: "Share a bold, slightly extreme take on something you genuinely believe. Controversial opinions spark the best conversations — don't water it down.", Category: promptCategoryBoldProvoking, IsBuiltIn: true},
			{ID: "builtin-002", Text: "What's a widely accepted 'best practice' in your field that you think is actually wrong?", Category: promptCategoryBoldProvoking, IsBuiltIn: true},
			{ID: "builtin-003", Text: "What's something almost everyone in your industry does that you quietly think is a waste of time?", Category: promptCategoryBoldProvoking, IsBuiltIn: true},
			{ID: "builtin-004", Text: "Finish this: 'Everyone talks about X, but nobody wants to admit that...'", Category: promptCategoryBoldProvoking, IsBuiltIn: true},

			// Storytelling
			{ID: "builtin-005", Text: "Tell the story of how you got into what you do. Skip the LinkedIn version — make it honest.", Category: promptCategoryStorytelling, IsBuiltIn: true},
			{ID: "builtin-006", Text: "Tell a story about a failure that ultimately led to your biggest win. What did you actually learn?", Category: promptCategoryStorytelling, IsBuiltIn: true},
			{ID: "builtin-007", Text: "Describe a moment where everything clicked. What changed after that?", Category: promptCategoryStorytelling, IsBuiltIn: true},
			{ID: "builtin-008", Text: "What's a decision you almost didn't make that completely changed your trajectory?", Category: promptCategoryStorytelling, IsBuiltIn: true},

			// Repurpose & FAQ
			{ID: "builtin-009", Text: "What's a question you get asked over and over? Answer it properly, once and for all.", Category: promptCategoryRepurposeFAQ, IsBuiltIn: true},
			{ID: "builtin-010", Text: "What do people always misunderstand about what you do? Set the record straight.", Category: promptCategoryRepurposeFAQ, IsBuiltIn: true},
			{ID: "builtin-011", Text: "Turn your most common question into content. If people keep asking, others are wondering too.", Category: promptCategoryRepurposeFAQ, IsBuiltIn: true},
			{ID: "builtin-012", Text: "What's the advice you keep giving privately that you've never posted publicly?", Category: promptCategoryRepurposeFAQ, IsBuiltIn: true},

			// Daily Updates
			{ID: "builtin-013", Text: "What are you working on today? Share what's on your plate — then ask your audience what's on theirs.", Category: promptCategoryDailyUpdates, IsBuiltIn: true},
			{ID: "builtin-014", Text: "What's your plan for the weekend? Share yours and ask your followers what they've got going on.", Category: promptCategoryDailyUpdates, IsBuiltIn: true},
			{ID: "builtin-015", Text: "What are your top 3 priorities this week? Saying them out loud makes them real.", Category: promptCategoryDailyUpdates, IsBuiltIn: true},
			{ID: "builtin-016", Text: "Walk through your morning routine. The boring parts too — those are often the most relatable.", Category: promptCategoryDailyUpdates, IsBuiltIn: true},

			// How-To & Educational
			{ID: "builtin-017", Text: "Teach something you know well. Break it into steps small enough that a beginner could follow along.", Category: promptCategoryHowTo, IsBuiltIn: true},
			{ID: "builtin-018", Text: "What took you years to figure out that you could explain to someone in 5 minutes today?", Category: promptCategoryHowTo, IsBuiltIn: true},
			{ID: "builtin-019", Text: "Share a shortcut, trick, or habit that quietly saves you hours every week.", Category: promptCategoryHowTo, IsBuiltIn: true},
			{ID: "builtin-020", Text: "Write a 'what not to do' guide for someone just starting out in your field. Be specific.", Category: promptCategoryHowTo, IsBuiltIn: true},

			// Reflection & Growth
			{ID: "builtin-021", Text: "What's something you learned this week that genuinely surprised you?", Category: promptCategoryReflection, IsBuiltIn: true},
			{ID: "builtin-022", Text: "What's a mistake you made recently, and what would you do differently now?", Category: promptCategoryReflection, IsBuiltIn: true},
			{ID: "builtin-023", Text: "What would you tell yourself from a year ago? Be specific — not just 'believe in yourself'.", Category: promptCategoryReflection, IsBuiltIn: true},
			{ID: "builtin-024", Text: "What's something you're currently struggling with? Sharing the hard parts builds real connection.", Category: promptCategoryReflection, IsBuiltIn: true},

			// Engagement & Community
			{ID: "builtin-025", Text: "Ask your followers: what's one thing you wish you'd learned much earlier in your career?", Category: promptCategoryEngagement, IsBuiltIn: true},
			{ID: "builtin-026", Text: "Drop a hot take. Something you actually believe, not something safe. Then defend it.", Category: promptCategoryEngagement, IsBuiltIn: true},
			{ID: "builtin-027", Text: "Fill in the blank: 'The one thing I wish more people understood about _____ is _____.'", Category: promptCategoryEngagement, IsBuiltIn: true},
			{ID: "builtin-028", Text: "Ask your audience: What should I write about next? Let them shape your content.", Category: promptCategoryEngagement, IsBuiltIn: true},

			// Tools & Workflow
			{ID: "builtin-029", Text: "What's one tool you'd recommend to anyone in your field, and why does it actually matter?", Category: promptCategoryToolsWorkflow, IsBuiltIn: true},
			{ID: "builtin-030", Text: "What's a workflow or process change that made you noticeably more productive?", Category: promptCategoryToolsWorkflow, IsBuiltIn: true},
			{ID: "builtin-031", Text: "What's an automation you set up recently that you're quietly proud of? Walk people through it.", Category: promptCategoryToolsWorkflow, IsBuiltIn: true},
			{ID: "builtin-032", Text: "What does your actual workspace look like right now? Share the setup — messy or not.", Category: promptCategoryToolsWorkflow, IsBuiltIn: true},

			// Behind the Scenes
			{ID: "builtin-033", Text: "What would people be surprised to learn about what your work actually looks like day-to-day?", Category: promptCategoryBehindScenes, IsBuiltIn: true},
			{ID: "builtin-034", Text: "Share something from a project you're in the middle of — before it's polished or done.", Category: promptCategoryBehindScenes, IsBuiltIn: true},
			{ID: "builtin-035", Text: "Show the messy draft, the half-finished thing, the work in progress. People love seeing the real process.", Category: promptCategoryBehindScenes, IsBuiltIn: true},
			{ID: "builtin-036", Text: "How do you actually go from a blank page (or blank file) to a finished thing? Walk us through it.", Category: promptCategoryBehindScenes, IsBuiltIn: true},

			// Wins & Milestones
			{ID: "builtin-037", Text: "Share a win — recent or long overdue. Don't downplay it. You earned it.", Category: promptCategoryWins, IsBuiltIn: true},
			{ID: "builtin-038", Text: "What's something small you got done today that you're actually proud of?", Category: promptCategoryWins, IsBuiltIn: true},
			{ID: "builtin-039", Text: "Shout out someone who's been doing great work lately. Public recognition goes a long way.", Category: promptCategoryWins, IsBuiltIn: true},
			{ID: "builtin-040", Text: "What's a small win that felt way bigger than it looked from the outside?", Category: promptCategoryWins, IsBuiltIn: true},

			// Curated Lists
			{ID: "builtin-041", Text: "Share 3 resources — articles, books, tools, videos — that genuinely changed how you work.", Category: promptCategoryCuratedLists, IsBuiltIn: true},
			{ID: "builtin-042", Text: "What are the 5 tools you actually use every day? Not the ones you recommend — the ones you depend on.", Category: promptCategoryCuratedLists, IsBuiltIn: true},
			{ID: "builtin-043", Text: "If someone asked you where to start in your field, what would you tell them to read, watch, or do first?", Category: promptCategoryCuratedLists, IsBuiltIn: true},
			{ID: "builtin-044", Text: "Who are 3 people in your space worth following? Tell people why, not just who.", Category: promptCategoryCuratedLists, IsBuiltIn: true},

			// Predictions & Future
			{ID: "builtin-045", Text: "Where do you honestly think your industry is headed in the next 5 years? Make a real prediction.", Category: promptCategoryPredictions, IsBuiltIn: true},
			{ID: "builtin-046", Text: "What's a trend you've been watching closely? What does it tell you about where things are going?", Category: promptCategoryPredictions, IsBuiltIn: true},
			{ID: "builtin-047", Text: "What emerging technology or shift excites you most right now — and what do you think it'll actually change?", Category: promptCategoryPredictions, IsBuiltIn: true},
			{ID: "builtin-048", Text: "What's something in your field that you think will be completely obsolete in 10 years?", Category: promptCategoryPredictions, IsBuiltIn: true},

			// Quick & Easy
			{ID: "builtin-049", Text: "Share a screenshot of something you're working on right now. No context needed.", Category: promptCategoryQuickEasy, IsBuiltIn: true},
			{ID: "builtin-050", Text: "What's one thing on your desk or in your space that has a story behind it?", Category: promptCategoryQuickEasy, IsBuiltIn: true},
			{ID: "builtin-051", Text: "Share a quote that's been stuck in your head lately — and why it landed.", Category: promptCategoryQuickEasy, IsBuiltIn: true},
			{ID: "builtin-052", Text: "What's the last tab you had open that wasn't work? Be honest.", Category: promptCategoryQuickEasy, IsBuiltIn: true},

			// Developer
			{ID: "builtin-053", Text: "What's a piece of code you wrote that you're genuinely proud of? Share what makes it good.", Category: promptCategoryDeveloper, IsBuiltIn: true},
			{ID: "builtin-054", Text: "What's a bug that took you way too long to find? Walk through the moment you finally figured it out.", Category: promptCategoryDeveloper, IsBuiltIn: true},
			{ID: "builtin-055", Text: "What's your current stack, and what would you change if you were starting fresh today?", Category: promptCategoryDeveloper, IsBuiltIn: true},
			{ID: "builtin-056", Text: "What's a library, framework, or tool you've changed your mind about — positively or negatively?", Category: promptCategoryDeveloper, IsBuiltIn: true},
			{ID: "builtin-057", Text: "What's something you built just for yourself that turned out to be genuinely useful?", Category: promptCategoryDeveloper, IsBuiltIn: true},
			{ID: "builtin-058", Text: "How do you approach learning a new technology? Share your actual process, not the idealized version.", Category: promptCategoryDeveloper, IsBuiltIn: true},
			{ID: "builtin-059", Text: "What's a concept that took you a long time to really understand — and what finally made it click?", Category: promptCategoryDeveloper, IsBuiltIn: true},
			{ID: "builtin-060", Text: "Open source, side projects, freelance, or full-time — what's your current mix, and how did you get there?", Category: promptCategoryDeveloper, IsBuiltIn: true},
		},
	}
}

func (h *PromptHandler) seedBuiltInPrompts(ctx context.Context) error {
	h.seedMu.Lock()
	defer h.seedMu.Unlock()

	if h.seeded {
		return nil
	}

	now := time.Now().UTC()
	prompts := make([]models.Prompt, len(h.builtinPrompts))
	copy(prompts, h.builtinPrompts)
	for index := range prompts {
		prompts[index].CreatedAt = now
	}
	if len(prompts) > 0 {
		if _, err := h.db.NewInsert().
			Model(&prompts).
			On("CONFLICT (id) DO NOTHING").
			Exec(ctx); err != nil {
			return err
		}
	}

	h.seeded = true
	return nil
}

func (h *PromptHandler) checkWorkspaceAccess(ctx context.Context, workspaceID, userID string) error {
	allowed, err := middleware.CheckWorkspaceAccess(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if !allowed {
		return huma.Error403Forbidden(errWorkspaceAccessDenied)
	}
	return nil
}

func (h *PromptHandler) checkWorkspaceEditAccess(ctx context.Context, workspaceID, userID string) error {
	allowed, err := middleware.CheckWorkspaceEditAccess(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if !allowed {
		return huma.Error403Forbidden("workspace editor role required")
	}
	return nil
}

type PromptResponse struct {
	ID          string `json:"id" doc:"Prompt ID"`
	WorkspaceID string `json:"workspace_id,omitempty" doc:"Workspace ID (if custom)"`
	UserID      string `json:"user_id,omitempty" doc:"User ID (if custom)"`
	Text        string `json:"text" doc:"Prompt text"`
	Category    string `json:"category" doc:"Prompt category"`
	IsBuiltIn   bool   `json:"is_built_in" doc:"Whether this is a built-in prompt"`
	CreatedAt   string `json:"created_at" doc:"Creation time (ISO 8601)"`
}

type ListPromptsInput struct {
	WorkspaceID string `query:"workspace_id" doc:"Filter by workspace ID"`
	Category    string `query:"category" doc:"Filter by category"`
}

type ListPromptsOutput struct {
	Body []PromptResponse
}

func (h *PromptHandler) ListPrompts(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-prompts",
		Method:      http.MethodGet,
		Path:        "/prompts",
		Summary:     "List writing prompts",
		Tags:        []string{tagPrompts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *ListPromptsInput) (*ListPromptsOutput, error) {
		userID := middleware.GetUserID(ctx)

		// Seed built-in prompts on first request
		if err := h.seedBuiltInPrompts(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to seed prompts")
		}

		var prompts []models.Prompt
		query := h.db.NewSelect().Model(&prompts)

		// Get built-in prompts plus user/workspace custom prompts
		if input.WorkspaceID != "" {
			if err := h.checkWorkspaceAccess(ctx, input.WorkspaceID, userID); err != nil {
				return nil, err
			}

			query = query.Where("is_built_in = ? OR workspace_id = ?", true, input.WorkspaceID)
		} else if workspaceID := middleware.GetWorkspaceID(ctx); workspaceID != "" {
			query = query.Where("is_built_in = ? OR workspace_id = ?", true, workspaceID)
		} else {
			// Get built-in prompts plus user's custom prompts
			query = query.Where("is_built_in = ? OR user_id = ?", true, userID)
		}

		if input.Category != "" {
			query = query.Where("category = ?", input.Category)
		}

		query = query.Order("is_built_in DESC", "category ASC", "created_at DESC")

		if err := query.Scan(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to fetch prompts")
		}

		resp := make([]PromptResponse, len(prompts))
		for i, p := range prompts {
			resp[i] = PromptResponse{
				ID:          p.ID,
				WorkspaceID: p.WorkspaceID,
				UserID:      p.UserID,
				Text:        p.Text,
				Category:    p.Category,
				IsBuiltIn:   p.IsBuiltIn,
				CreatedAt:   p.CreatedAt.Format(time.RFC3339),
			}
		}

		return &ListPromptsOutput{Body: resp}, nil
	})
}

type CreatePromptInput struct {
	Body struct {
		WorkspaceID string `json:"workspace_id,omitempty" doc:"Workspace ID (for workspace prompt)"`
		Text        string `json:"text" minLength:"1" maxLength:"500" doc:"Prompt text"`
		Category    string `json:"category" minLength:"1" maxLength:"50" doc:"Prompt category"`
	}
}

type CreatePromptOutput struct {
	Body PromptResponse
}

func (h *PromptHandler) CreatePrompt(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "create-prompt",
		Method:      http.MethodPost,
		Path:        "/prompts",
		Summary:     "Create a custom writing prompt",
		Tags:        []string{tagPrompts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403},
	}, func(ctx context.Context, input *CreatePromptInput) (*CreatePromptOutput, error) {
		userID := middleware.GetUserID(ctx)

		// Verify workspace access if provided
		if input.Body.WorkspaceID != "" {
			if err := h.checkWorkspaceEditAccess(ctx, input.Body.WorkspaceID, userID); err != nil {
				return nil, err
			}
		} else if middleware.GetWorkspaceID(ctx) != "" {
			return nil, huma.Error403Forbidden(errWorkspaceAccessDenied)
		}

		prompt := &models.Prompt{
			ID:          uuid.New().String(),
			WorkspaceID: input.Body.WorkspaceID,
			UserID:      userID,
			Text:        input.Body.Text,
			Category:    input.Body.Category,
			IsBuiltIn:   false,
			CreatedAt:   time.Now().UTC(),
		}

		if _, err := h.db.NewInsert().Model(prompt).Exec(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to create prompt")
		}

		return &CreatePromptOutput{Body: PromptResponse{
			ID:          prompt.ID,
			WorkspaceID: prompt.WorkspaceID,
			UserID:      prompt.UserID,
			Text:        prompt.Text,
			Category:    prompt.Category,
			IsBuiltIn:   prompt.IsBuiltIn,
			CreatedAt:   prompt.CreatedAt.Format(time.RFC3339),
		}}, nil
	})
}

type DeletePromptInput struct {
	PathID string `path:"id" doc:"Prompt ID"`
}

type DeletePromptOutput struct {
	Body struct {
		Message string `json:"message" doc:"Success message"`
	}
}

func (h *PromptHandler) DeletePrompt(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "delete-prompt",
		Method:      http.MethodDelete,
		Path:        "/prompts/{id}",
		Summary:     "Delete a custom prompt",
		Tags:        []string{tagPrompts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404},
	}, func(ctx context.Context, input *DeletePromptInput) (*DeletePromptOutput, error) {
		userID := middleware.GetUserID(ctx)

		var prompt models.Prompt
		err := h.db.NewSelect().
			Model(&prompt).
			Where("id = ?", input.PathID).
			Scan(ctx)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, huma.Error404NotFound("prompt not found")
			}
			return nil, huma.Error500InternalServerError("failed to fetch prompt")
		}

		// Cannot delete built-in prompts
		if prompt.IsBuiltIn {
			return nil, huma.Error400BadRequest("cannot delete built-in prompts")
		}
		if prompt.WorkspaceID == "" && middleware.GetWorkspaceID(ctx) != "" {
			return nil, huma.Error403Forbidden("you do not have permission to delete this prompt")
		}
		if prompt.WorkspaceID != "" {
			if err := h.checkWorkspaceEditAccess(ctx, prompt.WorkspaceID, userID); err != nil {
				return nil, err
			}
		}

		// Verify ownership
		if prompt.UserID != userID {
			// Check if workspace admin
			if prompt.WorkspaceID != "" {
				var member models.WorkspaceMember
				err := h.db.NewSelect().
					Model(&member).
					Where("workspace_id = ? AND user_id = ?", prompt.WorkspaceID, userID).
					Scan(ctx)
				if err != nil || member.Role != models.WorkspaceRoleAdmin {
					return nil, huma.Error403Forbidden("you do not have permission to delete this prompt")
				}
			} else {
				return nil, huma.Error403Forbidden("you do not have permission to delete this prompt")
			}
		}

		if _, err := h.db.NewDelete().Model(&prompt).Where("id = ?", input.PathID).Exec(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to delete prompt")
		}

		return &DeletePromptOutput{Body: struct {
			Message string `json:"message" doc:"Success message"`
		}{Message: "prompt deleted successfully"}}, nil
	})
}

type GetRandomPromptInput struct {
	WorkspaceID string `query:"workspace_id" doc:"Filter by workspace ID"`
	Category    string `query:"category" doc:"Filter by category"`
}

type GetRandomPromptOutput struct {
	Body *PromptResponse
}

func (h *PromptHandler) GetRandomPrompt(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-random-prompt",
		Method:      http.MethodGet,
		Path:        "/prompts/random",
		Summary:     "Get a random writing prompt",
		Tags:        []string{tagPrompts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *GetRandomPromptInput) (*GetRandomPromptOutput, error) {
		userID := middleware.GetUserID(ctx)

		// Seed built-in prompts on first request
		if err := h.seedBuiltInPrompts(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to seed prompts")
		}

		var prompt models.Prompt
		query := h.db.NewSelect().
			Model(&prompt).
			OrderExpr("RANDOM()")

		// Get built-in prompts plus user/workspace custom prompts
		if input.WorkspaceID != "" {
			if err := h.checkWorkspaceAccess(ctx, input.WorkspaceID, userID); err != nil {
				return nil, err
			}

			query = query.Where("is_built_in = ? OR workspace_id = ?", true, input.WorkspaceID)
		} else if workspaceID := middleware.GetWorkspaceID(ctx); workspaceID != "" {
			query = query.Where("is_built_in = ? OR workspace_id = ?", true, workspaceID)
		} else {
			query = query.Where("is_built_in = ? OR user_id = ?", true, userID)
		}

		if input.Category != "" {
			query = query.Where("category = ?", input.Category)
		}

		if err := query.Limit(1).Scan(ctx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return &GetRandomPromptOutput{Body: nil}, nil
			}
			return nil, huma.Error500InternalServerError("failed to fetch prompt")
		}

		return &GetRandomPromptOutput{Body: &PromptResponse{
			ID:          prompt.ID,
			WorkspaceID: prompt.WorkspaceID,
			UserID:      prompt.UserID,
			Text:        prompt.Text,
			Category:    prompt.Category,
			IsBuiltIn:   prompt.IsBuiltIn,
			CreatedAt:   prompt.CreatedAt.Format(time.RFC3339),
		}}, nil
	})
}

type GetPromptCategoriesOutput struct {
	Body struct {
		Categories []string `json:"categories" doc:"Available prompt categories"`
	}
}

func (h *PromptHandler) GetCategories(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-prompt-categories",
		Method:      http.MethodGet,
		Path:        "/prompts/categories",
		Summary:     "Get available prompt categories",
		Tags:        []string{tagPrompts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, _ *struct{}) (*GetPromptCategoriesOutput, error) {
		// Seed built-in prompts on first request
		if err := h.seedBuiltInPrompts(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to seed prompts")
		}

		var categories []string
		err := h.db.NewSelect().
			Model((*models.Prompt)(nil)).
			ColumnExpr("DISTINCT category AS category").
			Where("is_built_in = ?", true).
			Scan(ctx, &categories)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to fetch categories")
		}

		return &GetPromptCategoriesOutput{Body: struct {
			Categories []string `json:"categories" doc:"Available prompt categories"`
		}{Categories: categories}}, nil
	})
}
