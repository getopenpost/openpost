package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/uptrace/bun"
)

const socialSetsPath = "/social-sets"

type SocialSetHandler struct {
	db       *bun.DB
	auth     middleware.Authenticator
	resolver *CapabilityResolverHandler
}

func NewSocialSetHandler(db *bun.DB, authenticator middleware.Authenticator) *SocialSetHandler {
	return &SocialSetHandler{db: db, auth: authenticator, resolver: NewCapabilityResolverHandler(db, authenticator, nil, nil)}
}

func (h *SocialSetHandler) SetCapabilityResolver(resolver *CapabilityResolverHandler) {
	h.resolver = resolver
}

type ResolveSocialSetSettingsInput struct {
	Body struct {
		SocialAccountID      string         `json:"social_account_id" doc:"Connected social account ID"`
		DefaultOutputProfile string         `json:"default_output_profile" doc:"Selected provider-qualified format"`
		Settings             map[string]any `json:"settings,omitempty" doc:"Current destination and post preset values for account-specific options"`
		Locale               string         `json:"locale,omitempty" doc:"BCP 47 locale for option labels"`
		Region               string         `json:"region,omitempty" doc:"ISO 3166-1 alpha-2 region"`
	}
}

type ResolveSocialSetSettingsOutput struct {
	Body struct {
		AccountID     string                           `json:"account_id"`
		OutputProfile string                           `json:"output_profile"`
		Settings      []capabilities.SettingDefinition `json:"settings"`
	}
}

type SocialSetAccountInput struct {
	SocialAccountID        string         `json:"social_account_id" doc:"Connected social account ID"`
	DefaultOutputProfile   string         `json:"default_output_profile,omitempty" doc:"Optional provider-qualified default format"`
	DefaultSettings        map[string]any `json:"default_settings,omitempty" doc:"Destination settings copied into new renditions"`
	DefaultSegmentSettings map[string]any `json:"default_segment_settings,omitempty" doc:"Post settings copied into new rendition segments"`
}

type SocialSetAccountResponse struct {
	SocialAccountID        string         `json:"social_account_id"`
	Platform               string         `json:"platform"`
	AccountUsername        string         `json:"account_username,omitempty"`
	AccountAvatarURL       string         `json:"account_avatar_url,omitempty"`
	DisplayOrder           int            `json:"display_order"`
	DefaultOutputProfile   string         `json:"default_output_profile,omitempty"`
	DefaultSettings        map[string]any `json:"default_settings,omitempty"`
	DefaultSegmentSettings map[string]any `json:"default_segment_settings,omitempty"`
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
		Locale      string                  `json:"locale,omitempty" doc:"BCP 47 locale for account settings validation"`
		Region      string                  `json:"region,omitempty" doc:"ISO 3166-1 alpha-2 region for account settings validation"`
		Accounts    []SocialSetAccountInput `json:"accounts" doc:"Ordered connected accounts"`
	}
}

type UpdateSocialSetInput struct {
	PathID string `path:"id" doc:"Social Set ID"`
	Body   struct {
		Name      string                  `json:"name" minLength:"1" maxLength:"80" doc:"Social Set name"`
		IsDefault bool                    `json:"is_default" doc:"Use this set when the composer opens"`
		Locale    string                  `json:"locale,omitempty" doc:"BCP 47 locale for account settings validation"`
		Region    string                  `json:"region,omitempty" doc:"ISO 3166-1 alpha-2 region for account settings validation"`
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
	SocialSetID                string `bun:"social_set_id"`
	SocialAccountID            string `bun:"social_account_id"`
	Platform                   string `bun:"platform"`
	AccountUsername            string `bun:"account_username"`
	AccountAvatarURL           string `bun:"account_avatar_url"`
	DisplayOrder               int    `bun:"display_order"`
	DefaultOutputProfile       string `bun:"default_output_profile"`
	DefaultSettingsJSON        string `bun:"default_settings_json"`
	DefaultSegmentSettingsJSON string `bun:"default_segment_settings_json"`
}

func (h *SocialSetHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "resolve-social-set-settings", Method: http.MethodPost, Path: socialSetsPath + "/resolve-settings",
		Summary: "Resolve reusable settings for a Social Set account and format", Tags: []string{tagSocialSets},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}, Errors: []int{400, 403, 502},
		MaxBodyBytes: 32 * 1024,
	}, h.resolveSettings)
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
	accounts, err := h.validateSocialSetAccounts(ctx, input.Body.WorkspaceID, input.Body.Accounts, input.Body.Locale, input.Body.Region, nil)
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
	unchanged, err := h.unchangedSocialSetAccounts(ctx, set, input.Body.Accounts)
	if err != nil {
		return nil, err
	}
	accounts, err := h.validateSocialSetAccounts(ctx, set.WorkspaceID, input.Body.Accounts, input.Body.Locale, input.Body.Region, unchanged)
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

func (h *SocialSetHandler) resolveSettings(ctx context.Context, input *ResolveSocialSetSettingsInput) (*ResolveSocialSetSettingsOutput, error) {
	var account models.SocialAccount
	err := h.db.NewSelect().Model(&account).
		Where("id = ? AND is_active = ?", strings.TrimSpace(input.Body.SocialAccountID), true).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error400BadRequest("Social Set account is disconnected or unavailable")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load Social Set account")
	}
	if err := requireSocialSetWorkspaceAccess(ctx, h.db, account.WorkspaceID, middleware.GetUserID(ctx), false); err != nil {
		return nil, err
	}
	resolved, err := h.resolvePresetCapability(ctx, account, input.Body.DefaultOutputProfile, input.Body.Settings, input.Body.Locale, input.Body.Region)
	if err != nil {
		return nil, err
	}
	if err := verifySocialSetPresetResolution(resolved); err != nil {
		return nil, err
	}
	output := &ResolveSocialSetSettingsOutput{}
	output.Body.AccountID = account.ID
	output.Body.OutputProfile = resolved.OutputProfile
	output.Body.Settings = resolved.Settings
	return output, nil
}

func (h *SocialSetHandler) resolvePresetCapability(
	ctx context.Context, account models.SocialAccount, profile string, settings map[string]any, locale, region string,
) (capabilities.ResolvedCapability, error) {
	profile = strings.TrimSpace(profile)
	if profile == "" {
		return capabilities.ResolvedCapability{}, huma.Error400BadRequest("choose a format before setting Social Set defaults")
	}
	resolved, _, err := h.resolver.resolveAccountCapability(ctx, account, locale, region, capabilities.ResolveInput{
		RequestedOutputProfile: profile,
		Context:                capabilities.ResolveContextSocialSetDefaults,
		Settings:               settings,
	})
	if err != nil {
		return capabilities.ResolvedCapability{}, huma.Error502BadGateway("account capability resolution failed")
	}
	if resolved.OutputProfile != profile {
		return capabilities.ResolvedCapability{}, huma.Error400BadRequest("default_output_profile is not supported by its account")
	}
	return resolved, nil
}

func verifySocialSetPresetResolution(resolved capabilities.ResolvedCapability) error {
	for _, issue := range resolved.Issues {
		if issue.Code == "dynamic_options_unavailable" || issue.Code == "required_dynamic_options_unavailable" {
			return huma.Error502BadGateway("account settings could not be verified")
		}
	}
	return nil
}

func sameSocialSetDefaults(previous, current SocialSetAccountInput) bool {
	return strings.TrimSpace(previous.DefaultOutputProfile) == strings.TrimSpace(current.DefaultOutputProfile) &&
		canonicalSocialSetSettings(previous.DefaultSettings) == canonicalSocialSetSettings(current.DefaultSettings) &&
		canonicalSocialSetSettings(previous.DefaultSegmentSettings) == canonicalSocialSetSettings(current.DefaultSegmentSettings)
}

func (h *SocialSetHandler) unchangedSocialSetAccounts(ctx context.Context, set *models.SocialSet, inputs []SocialSetAccountInput) (map[string]bool, error) {
	stored, err := loadSocialSetSnapshot(ctx, h.db, set.WorkspaceID, set.ID)
	if err != nil {
		return nil, err
	}
	previousByAccount := make(map[string]SocialSetAccountInput, len(stored))
	for _, previous := range stored {
		previousByAccount[previous.SocialAccountID] = previous
	}
	unchanged := map[string]bool{}
	for _, current := range inputs {
		previous, exists := previousByAccount[current.SocialAccountID]
		if exists && sameSocialSetDefaults(previous, current) {
			unchanged[current.SocialAccountID] = true
		}
	}
	return unchanged, nil
}

func canonicalSocialSetSettings(settings map[string]any) string {
	if len(settings) == 0 {
		return "{}"
	}
	return mustJSON(settings)
}

func (h *SocialSetHandler) validateSocialSetAccounts(ctx context.Context, workspaceID string, inputs []SocialSetAccountInput, locale, region string, unchanged map[string]bool) (map[string]models.SocialAccount, error) {
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
	if err := h.db.NewSelect().Model(&rows).
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
		if unchanged[input.SocialAccountID] {
			continue
		}
		if err := h.validateSocialSetAccountDefaults(ctx, accounts[input.SocialAccountID], input, locale, region); err != nil {
			return nil, err
		}
	}
	return accounts, nil
}

func (h *SocialSetHandler) validateSocialSetAccountDefaults(ctx context.Context, account models.SocialAccount, input SocialSetAccountInput, locale, region string) error {
	context := make(map[string]any, len(input.DefaultSettings)+len(input.DefaultSegmentSettings))
	for key, value := range input.DefaultSettings {
		context[key] = value
	}
	for key, value := range input.DefaultSegmentSettings {
		context[key] = value
	}
	profile := strings.TrimSpace(input.DefaultOutputProfile)
	if profile == "" {
		if len(context) > 0 {
			return huma.Error400BadRequest("choose a format before setting Social Set defaults")
		}
		return nil
	}
	resolved, err := h.resolvePresetCapability(ctx, account, profile, context, locale, region)
	if err != nil {
		return err
	}
	if len(context) > 0 {
		if err := verifySocialSetPresetResolution(resolved); err != nil {
			return err
		}
	}
	if err := validateSocialSetDefaultSettings(resolved.Capability, input.DefaultSettings, context, capabilities.SettingScopeDestination); err != nil {
		return err
	}
	if account.Platform == capabilities.ProviderDiscord {
		if err := platform.ValidateDiscordEmbedPreset(input.DefaultSettings["embed"]); err != nil {
			return huma.Error400BadRequest("Social Set embed is invalid: " + err.Error())
		}
	}
	if err := validateSocialSetDefaultSettings(resolved.Capability, input.DefaultSegmentSettings, context, capabilities.SettingScopeSegment); err != nil {
		return err
	}
	return validateSocialSetCompleteOptions(resolved, context)
}

func validateSocialSetCompleteOptions(resolved capabilities.ResolvedCapability, values map[string]any) error {
	for _, field := range resolved.Settings {
		if field.OptionsSource == "" || !slices.Contains(resolved.CompleteOptionSources, field.OptionsSource) {
			continue
		}
		raw, exists := values[field.Key]
		if !exists || raw == nil {
			continue
		}
		value := strings.TrimSpace(fmt.Sprint(raw))
		if value == "" {
			continue
		}
		valid := false
		for _, option := range resolved.DynamicOptions[field.OptionsSource] {
			if option.Value == value {
				valid = true
				break
			}
		}
		if !valid {
			return huma.Error400BadRequest(field.Label + " is not an available choice for this account")
		}
	}
	return nil
}

func validateSocialSetDefaultSettings(capability capabilities.Capability, values, context map[string]any, scope string) error {
	encoded, err := json.Marshal(values)
	if err != nil || len(encoded) > 16*1024 {
		return huma.Error400BadRequest("Social Set default settings are invalid or too large")
	}
	if issues := capabilities.ValidateDefaultSettings(capability, scope, values, context); len(issues) > 0 {
		return huma.Error400BadRequest(issues[0].Message)
	}
	return nil
}

func decodeSocialSetDefaults(raw string) (map[string]any, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var values map[string]any
	err := json.Unmarshal([]byte(raw), &values)
	return values, err
}

func insertSocialSetAccounts(ctx context.Context, tx bun.Tx, setID string, inputs []SocialSetAccountInput, accounts map[string]models.SocialAccount) error {
	for position, input := range inputs {
		if _, ok := accounts[input.SocialAccountID]; !ok {
			return huma.Error400BadRequest("one or more Social Set accounts are invalid")
		}
		row := &models.SocialSetAccount{
			SocialSetID: setID, SocialAccountID: input.SocialAccountID,
			DisplayOrder: position, DefaultOutputProfile: strings.TrimSpace(input.DefaultOutputProfile),
			DefaultSettingsJSON:        mustJSON(input.DefaultSettings),
			DefaultSegmentSettingsJSON: mustJSON(input.DefaultSegmentSettings),
			CreatedAt:                  time.Now().UTC(),
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
		ColumnExpr("membership.social_set_id, membership.social_account_id, membership.display_order, membership.default_output_profile, membership.default_settings_json, membership.default_segment_settings_json").
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
		defaultSettings, err := decodeSocialSetDefaults(row.DefaultSettingsJSON)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to decode Social Set settings")
		}
		defaultSegmentSettings, err := decodeSocialSetDefaults(row.DefaultSegmentSettingsJSON)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to decode Social Set post settings")
		}
		bySet[row.SocialSetID] = append(bySet[row.SocialSetID], SocialSetAccountResponse{
			SocialAccountID: row.SocialAccountID, Platform: row.Platform,
			AccountUsername: row.AccountUsername, AccountAvatarURL: row.AccountAvatarURL,
			DisplayOrder: row.DisplayOrder, DefaultOutputProfile: row.DefaultOutputProfile,
			DefaultSettings: defaultSettings, DefaultSegmentSettings: defaultSegmentSettings,
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
		defaultSettings, err := decodeSocialSetDefaults(row.DefaultSettingsJSON)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to decode Social Set settings")
		}
		defaultSegmentSettings, err := decodeSocialSetDefaults(row.DefaultSegmentSettingsJSON)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to decode Social Set post settings")
		}
		inputs = append(inputs, SocialSetAccountInput{
			SocialAccountID: row.SocialAccountID, DefaultOutputProfile: row.DefaultOutputProfile,
			DefaultSettings: defaultSettings, DefaultSegmentSettings: defaultSegmentSettings,
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
