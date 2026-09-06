package handlers

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

const socialSetsPath = "/social-sets"

type SocialSetHandler struct {
	db   *bun.DB
	auth middleware.Authenticator
}

func NewSocialSetHandler(db *bun.DB, authenticator middleware.Authenticator) *SocialSetHandler {
	return &SocialSetHandler{db: db, auth: authenticator}
}

type SocialSetAccountInput struct {
	SocialAccountID      string `json:"social_account_id" doc:"Connected social account ID"`
	DefaultOutputProfile string `json:"default_output_profile,omitempty" doc:"Optional provider-qualified default format"`
}

type SocialSetAccountResponse struct {
	SocialAccountID      string `json:"social_account_id"`
	Platform             string `json:"platform"`
	AccountUsername      string `json:"account_username,omitempty"`
	AccountAvatarURL     string `json:"account_avatar_url,omitempty"`
	DisplayOrder         int    `json:"display_order"`
	DefaultOutputProfile string `json:"default_output_profile,omitempty"`
}

type SocialSetResponse struct {
	ID          string                     `json:"id"`
	WorkspaceID string                     `json:"workspace_id"`
	Name        string                     `json:"name"`
	IsDefault   bool                       `json:"is_default"`
	Accounts    []SocialSetAccountResponse `json:"accounts"`
	CreatedAt   string                     `json:"created_at"`
	UpdatedAt   string                     `json:"updated_at"`
}

type CreateSocialSetInput struct {
	Body struct {
		WorkspaceID string                  `json:"workspace_id" doc:"Target workspace ID"`
		Name        string                  `json:"name" minLength:"1" maxLength:"80" doc:"Social Set name"`
		IsDefault   bool                    `json:"is_default,omitempty" doc:"Use this set when the composer opens"`
		Accounts    []SocialSetAccountInput `json:"accounts" doc:"Ordered connected accounts"`
	}
}

type UpdateSocialSetInput struct {
	PathID string `path:"id" doc:"Social Set ID"`
	Body   struct {
		Name      string                  `json:"name" minLength:"1" maxLength:"80" doc:"Social Set name"`
		IsDefault bool                    `json:"is_default" doc:"Use this set when the composer opens"`
		Accounts  []SocialSetAccountInput `json:"accounts" doc:"Replacement ordered membership"`
	}
}

type ListSocialSetsInput struct {
	WorkspaceID string `query:"workspace_id" required:"true" doc:"Workspace ID"`
}

type GetSocialSetInput struct {
	PathID string `path:"id" doc:"Social Set ID"`
}

type DeleteSocialSetInput struct {
	PathID  string `path:"id" doc:"Social Set ID"`
	Confirm bool   `query:"confirm" doc:"Explicit deletion confirmation"`
}

type SocialSetOutput struct {
	Body SocialSetResponse
}

type SocialSetListOutput struct {
	Body []SocialSetResponse
}

type socialSetAccountRow struct {
	SocialSetID          string `bun:"social_set_id"`
	SocialAccountID      string `bun:"social_account_id"`
	Platform             string `bun:"platform"`
	AccountUsername      string `bun:"account_username"`
	AccountAvatarURL     string `bun:"account_avatar_url"`
	DisplayOrder         int    `bun:"display_order"`
	DefaultOutputProfile string `bun:"default_output_profile"`
}

func (h *SocialSetHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-social-sets", Method: http.MethodGet, Path: socialSetsPath,
		Summary: "List Social Sets", Tags: []string{tagSocialSets},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.list)
	huma.Register(api, huma.Operation{
		OperationID: "create-social-set", Method: http.MethodPost, Path: socialSetsPath,
		Summary: "Create a Social Set", Tags: []string{tagSocialSets}, Errors: []int{400, 403, 409},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.create)
	huma.Register(api, huma.Operation{
		OperationID: "get-social-set", Method: http.MethodGet, Path: socialSetsPath + "/{id}",
		Summary: "Get a Social Set", Tags: []string{tagSocialSets}, Errors: []int{403, 404},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.get)
	huma.Register(api, huma.Operation{
		OperationID: "update-social-set", Method: http.MethodPut, Path: socialSetsPath + "/{id}",
		Summary: "Replace a Social Set", Tags: []string{tagSocialSets}, Errors: []int{400, 403, 404, 409},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.update)
	huma.Register(api, huma.Operation{
		OperationID: "delete-social-set", Method: http.MethodDelete, Path: socialSetsPath + "/{id}",
		Summary: "Delete a Social Set", Description: "Existing publications keep their snapshotted destinations.",
		Tags: []string{tagSocialSets}, Errors: []int{400, 403, 404},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.delete)
}

func (h *SocialSetHandler) list(ctx context.Context, input *ListSocialSetsInput) (*SocialSetListOutput, error) {
	if err := requireSocialSetWorkspaceAccess(ctx, h.db, input.WorkspaceID, middleware.GetUserID(ctx), false); err != nil {
		return nil, err
	}
	var sets []models.SocialSet
	if err := h.db.NewSelect().Model(&sets).
		Where("workspace_id = ?", input.WorkspaceID).
		OrderExpr("is_default DESC, name ASC, created_at ASC").
		Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error500InternalServerError("failed to list Social Sets")
	}
	responses, err := loadSocialSetResponses(ctx, h.db, sets)
	if err != nil {
		return nil, err
	}
	return &SocialSetListOutput{Body: responses}, nil
}

func (h *SocialSetHandler) create(ctx context.Context, input *CreateSocialSetInput) (*SocialSetOutput, error) {
	userID := middleware.GetUserID(ctx)
	if err := requireSocialSetWorkspaceAccess(ctx, h.db, input.Body.WorkspaceID, userID, true); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(input.Body.Name)
	if name == "" {
		return nil, huma.Error400BadRequest("Social Set name is required")
	}
	accounts, err := validateSocialSetAccounts(ctx, h.db, input.Body.WorkspaceID, input.Body.Accounts)
	if err != nil {
		return nil, err
	}
	if err := ensureSocialSetNameAvailable(ctx, h.db, input.Body.WorkspaceID, name, ""); err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	set := &models.SocialSet{
		ID: uuid.NewString(), WorkspaceID: input.Body.WorkspaceID, Name: name,
		IsDefault: input.Body.IsDefault, CreatedAt: now, UpdatedAt: now,
	}
	if err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if set.IsDefault {
			if err := clearSocialSetDefault(txCtx, tx, set.WorkspaceID); err != nil {
				return err
			}
		}
		if _, err := tx.NewInsert().Model(set).Exec(txCtx); err != nil {
			return err
		}
		return insertSocialSetAccounts(txCtx, tx, set.ID, input.Body.Accounts, accounts)
	}); err != nil {
		return nil, huma.Error500InternalServerError("failed to create Social Set")
	}
	return h.output(ctx, set.ID)
}

func (h *SocialSetHandler) get(ctx context.Context, input *GetSocialSetInput) (*SocialSetOutput, error) {
	set, err := loadSocialSet(ctx, h.db, input.PathID)
	if err != nil {
		return nil, err
	}
	if err := requireSocialSetWorkspaceAccess(ctx, h.db, set.WorkspaceID, middleware.GetUserID(ctx), false); err != nil {
		return nil, err
	}
	return h.output(ctx, set.ID)
}

func (h *SocialSetHandler) update(ctx context.Context, input *UpdateSocialSetInput) (*SocialSetOutput, error) {
	set, err := loadSocialSet(ctx, h.db, input.PathID)
	if err != nil {
		return nil, err
	}
	if err := requireSocialSetWorkspaceAccess(ctx, h.db, set.WorkspaceID, middleware.GetUserID(ctx), true); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(input.Body.Name)
	if name == "" {
		return nil, huma.Error400BadRequest("Social Set name is required")
	}
	accounts, err := validateSocialSetAccounts(ctx, h.db, set.WorkspaceID, input.Body.Accounts)
	if err != nil {
		return nil, err
	}
	if err := ensureSocialSetNameAvailable(ctx, h.db, set.WorkspaceID, name, set.ID); err != nil {
		return nil, err
	}
	set.Name = name
	set.IsDefault = input.Body.IsDefault
	set.UpdatedAt = time.Now().UTC()
	if err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if set.IsDefault {
			if err := clearSocialSetDefault(txCtx, tx, set.WorkspaceID); err != nil {
				return err
			}
		}
		if _, err := tx.NewUpdate().Model(set).Where("id = ?", set.ID).Exec(txCtx); err != nil {
			return err
		}
		if _, err := tx.NewDelete().Model((*models.SocialSetAccount)(nil)).Where("social_set_id = ?", set.ID).Exec(txCtx); err != nil {
			return err
		}
		return insertSocialSetAccounts(txCtx, tx, set.ID, input.Body.Accounts, accounts)
	}); err != nil {
		return nil, huma.Error500InternalServerError("failed to update Social Set")
	}
	return h.output(ctx, set.ID)
}

func (h *SocialSetHandler) delete(ctx context.Context, input *DeleteSocialSetInput) (*ActionOutput, error) {
	if !input.Confirm {
		return nil, huma.Error400BadRequest("confirm=true is required to delete a Social Set")
	}
	set, err := loadSocialSet(ctx, h.db, input.PathID)
	if err != nil {
		return nil, err
	}
	if err := requireSocialSetWorkspaceAccess(ctx, h.db, set.WorkspaceID, middleware.GetUserID(ctx), true); err != nil {
		return nil, err
	}
	if _, err := h.db.NewDelete().Model(set).Where("id = ?", set.ID).Exec(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to delete Social Set")
	}
	return actionMessage("Social Set deleted", ""), nil
}

func (h *SocialSetHandler) output(ctx context.Context, id string) (*SocialSetOutput, error) {
	set, err := loadSocialSet(ctx, h.db, id)
	if err != nil {
		return nil, err
	}
	responses, err := loadSocialSetResponses(ctx, h.db, []models.SocialSet{*set})
	if err != nil {
		return nil, err
	}
	return &SocialSetOutput{Body: responses[0]}, nil
}

func requireSocialSetWorkspaceAccess(ctx context.Context, db *bun.DB, workspaceID, userID string, edit bool) error {
	if workspaceID == "" {
		return huma.Error400BadRequest(errWorkspaceIDRequired)
	}
	if edit {
		allowed, err := workspaceEditAllowed(ctx, db, workspaceID, userID)
		if err != nil {
			return huma.Error500InternalServerError(errValidateWorkspaceAccess)
		}
		if !allowed {
			return huma.Error403Forbidden("workspace editor role required")
		}
		return nil
	}
	allowed, err := workspaceReadAllowed(ctx, db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if !allowed {
		return huma.Error403Forbidden(errWorkspaceAccessDenied)
	}
	return nil
}

func validateSocialSetAccounts(ctx context.Context, db bun.IDB, workspaceID string, inputs []SocialSetAccountInput) (map[string]models.SocialAccount, error) {
	ids := make([]string, 0, len(inputs))
	seen := map[string]struct{}{}
	for _, input := range inputs {
		id := strings.TrimSpace(input.SocialAccountID)
		if id == "" {
			return nil, huma.Error400BadRequest("social_account_id is required")
		}
		if _, exists := seen[id]; exists {
			return nil, huma.Error400BadRequest("a Social Set cannot contain the same account twice")
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	accounts := map[string]models.SocialAccount{}
	if len(ids) == 0 {
		return accounts, nil
	}
	var rows []models.SocialAccount
	if err := db.NewSelect().Model(&rows).
		Where("workspace_id = ?", workspaceID).
		Where("is_active = ?", true).
		Where("id IN (?)", bun.List(ids)).Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to validate Social Set accounts")
	}
	if len(rows) != len(ids) {
		return nil, huma.Error400BadRequest("one or more accounts are disconnected or outside this workspace")
	}
	for _, account := range rows {
		accounts[account.ID] = account
	}
	for _, input := range inputs {
		profile := strings.TrimSpace(input.DefaultOutputProfile)
		if profile == "" {
			continue
		}
		account := accounts[input.SocialAccountID]
		if _, ok := capabilities.FindOutput(account.Platform, profile); !ok {
			return nil, huma.Error400BadRequest("default_output_profile is not supported by its account")
		}
	}
	return accounts, nil
}

func insertSocialSetAccounts(ctx context.Context, tx bun.Tx, setID string, inputs []SocialSetAccountInput, accounts map[string]models.SocialAccount) error {
	for position, input := range inputs {
		if _, ok := accounts[input.SocialAccountID]; !ok {
			return huma.Error400BadRequest("one or more Social Set accounts are invalid")
		}
		row := &models.SocialSetAccount{
			SocialSetID: setID, SocialAccountID: input.SocialAccountID,
			DisplayOrder: position, DefaultOutputProfile: strings.TrimSpace(input.DefaultOutputProfile),
			CreatedAt: time.Now().UTC(),
		}
		if _, err := tx.NewInsert().Model(row).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func clearSocialSetDefault(ctx context.Context, db bun.IDB, workspaceID string) error {
	_, err := db.NewUpdate().Model((*models.SocialSet)(nil)).
		Set("is_default = ?", false).Where("workspace_id = ?", workspaceID).Exec(ctx)
	return err
}

func ensureSocialSetNameAvailable(ctx context.Context, db bun.IDB, workspaceID, name, exceptID string) error {
	query := db.NewSelect().Model((*models.SocialSet)(nil)).
		Where("workspace_id = ?", workspaceID).
		Where("LOWER(name) = LOWER(?)", name)
	if exceptID != "" {
		query = query.Where("id != ?", exceptID)
	}
	count, err := query.Count(ctx)
	if err != nil {
		return huma.Error500InternalServerError("failed to validate Social Set name")
	}
	if count > 0 {
		return huma.Error409Conflict("a Social Set with this name already exists")
	}
	return nil
}

func loadSocialSet(ctx context.Context, db bun.IDB, id string) (*models.SocialSet, error) {
	var set models.SocialSet
	if err := db.NewSelect().Model(&set).Where("id = ?", id).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error404NotFound("Social Set not found")
		}
		return nil, huma.Error500InternalServerError("failed to load Social Set")
	}
	return &set, nil
}

func loadSocialSetResponses(ctx context.Context, db bun.IDB, sets []models.SocialSet) ([]SocialSetResponse, error) {
	if len(sets) == 0 {
		return []SocialSetResponse{}, nil
	}
	ids := make([]string, 0, len(sets))
	for _, set := range sets {
		ids = append(ids, set.ID)
	}
	var rows []socialSetAccountRow
	if err := db.NewSelect().TableExpr("social_set_accounts AS membership").
		ColumnExpr("membership.social_set_id, membership.social_account_id, membership.display_order, membership.default_output_profile").
		ColumnExpr("account.platform, account.account_username, account.account_avatar_url").
		Join("JOIN social_accounts AS account ON account.id = membership.social_account_id").
		Where("membership.social_set_id IN (?)", bun.List(ids)).
		Where("account.is_active = ?", true).
		OrderExpr("membership.social_set_id ASC, membership.display_order ASC, membership.created_at ASC").
		Scan(ctx, &rows); err != nil {
		return nil, huma.Error500InternalServerError("failed to load Social Set accounts")
	}
	bySet := map[string][]SocialSetAccountResponse{}
	for _, row := range rows {
		bySet[row.SocialSetID] = append(bySet[row.SocialSetID], SocialSetAccountResponse{
			SocialAccountID: row.SocialAccountID, Platform: row.Platform,
			AccountUsername: row.AccountUsername, AccountAvatarURL: row.AccountAvatarURL,
			DisplayOrder: row.DisplayOrder, DefaultOutputProfile: row.DefaultOutputProfile,
		})
	}
	responses := make([]SocialSetResponse, 0, len(sets))
	for _, set := range sets {
		accounts := bySet[set.ID]
		if accounts == nil {
			accounts = []SocialSetAccountResponse{}
		}
		responses = append(responses, SocialSetResponse{
			ID: set.ID, WorkspaceID: set.WorkspaceID, Name: set.Name, IsDefault: set.IsDefault,
			Accounts: accounts, CreatedAt: set.CreatedAt.Format(time.RFC3339), UpdatedAt: set.UpdatedAt.Format(time.RFC3339),
		})
	}
	return responses, nil
}

func loadSocialSetSnapshot(ctx context.Context, db bun.IDB, workspaceID, setID string) ([]SocialSetAccountInput, error) {
	set, err := loadSocialSet(ctx, db, setID)
	if err != nil {
		return nil, err
	}
	if set.WorkspaceID != workspaceID {
		return nil, huma.Error400BadRequest("Social Set belongs to another workspace")
	}
	var rows []models.SocialSetAccount
	if err := db.NewSelect().Model(&rows).
		Where("social_set_id = ?", setID).
		Order("display_order ASC", "created_at ASC").Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to load Social Set accounts")
	}
	inputs := make([]SocialSetAccountInput, 0, len(rows))
	for _, row := range rows {
		inputs = append(inputs, SocialSetAccountInput{
			SocialAccountID: row.SocialAccountID, DefaultOutputProfile: row.DefaultOutputProfile,
		})
	}
	return inputs, nil
}

func socialSetRenditionInputs(accounts []SocialSetAccountInput) []RenditionInput {
	result := make([]RenditionInput, 0, len(accounts))
	for _, account := range accounts {
		result = append(result, RenditionInput{
			SocialAccountID: account.SocialAccountID,
			OutputProfile:   account.DefaultOutputProfile,
			FormatLocked:    account.DefaultOutputProfile != "",
		})
	}
	return result
}
