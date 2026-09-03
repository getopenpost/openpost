package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/themes"
	"github.com/uptrace/bun"
)

const (
	themesPath                = "/themes"
	themesTag                 = "Organization Themes"
	maxThemeAssetBase64Length = 7 * 1024 * 1024
)

type ThemeHandler struct {
	auth   middleware.Authenticator
	themes *themes.Service
}

func NewThemeHandler(db *bun.DB, auth middleware.Authenticator, storage mediastore.BlobStorage) *ThemeHandler {
	return &ThemeHandler{auth: auth, themes: themes.NewWithStorage(db, storage)}
}

type ThemeOrganizationListInput struct {
	OrganizationID string `query:"organization_id" required:"true" doc:"Organization ID"`
	Limit          int    `query:"limit" default:"20" minimum:"1" maximum:"100" doc:"Maximum summaries to return"`
	Cursor         string `query:"cursor" maxLength:"1024" doc:"Opaque cursor for stable name-ordered pagination"`
}

type ThemeAssetListInput struct {
	OrganizationID string `query:"organization_id" required:"true" doc:"Organization ID"`
	Limit          int    `query:"limit" default:"20" minimum:"1" maximum:"100" doc:"Maximum assets to return"`
	Cursor         string `query:"cursor" maxLength:"1024" doc:"Opaque cursor for stable newest-first pagination"`
}

type AvailableThemesInput struct {
	WorkspaceID string `query:"workspace_id" required:"true" doc:"Workspace ID"`
	Limit       int    `query:"limit" default:"20" minimum:"1" maximum:"100" doc:"Maximum summaries to return"`
	Cursor      string `query:"cursor" maxLength:"1024" doc:"Opaque cursor for stable built-in-first pagination"`
}

type AvailableThemeDetailInput struct {
	PathID      string `path:"id" doc:"Published custom theme ID"`
	WorkspaceID string `query:"workspace_id" required:"true" doc:"Workspace ID"`
	Revision    int    `query:"revision" required:"true" minimum:"1" doc:"Immutable published revision returned by the catalog summary"`
}

type ThemePathInput struct {
	PathID         string `path:"id" doc:"Organization theme ID"`
	OrganizationID string `query:"organization_id" required:"true" doc:"Organization ID"`
}

type CreateThemeInput struct {
	Body struct {
		OrganizationID     string                `json:"organization_id" doc:"Organization ID"`
		Name               string                `json:"name" minLength:"1" maxLength:"80" doc:"Theme family name"`
		Manifest           *themes.ThemeManifest `json:"manifest,omitempty" doc:"Complete family manifest with light and/or dark schemes; omit when duplicating a built-in"`
		DuplicateBuiltInID string                `json:"duplicate_built_in_id,omitempty" doc:"Built-in family to copy into an editable draft"`
	}
}

type UpdateThemeDraftInput struct {
	PathID string `path:"id" doc:"Organization theme ID"`
	Body   struct {
		OrganizationID   string               `json:"organization_id" doc:"Organization ID"`
		ExpectedRevision int                  `json:"expected_revision" minimum:"1" doc:"Draft revision loaded by the editor"`
		Name             string               `json:"name" minLength:"1" maxLength:"80" doc:"Theme family name"`
		Manifest         themes.ThemeManifest `json:"manifest" doc:"Complete replacement family manifest"`
	}
}

type PublishThemeInput struct {
	PathID string `path:"id" doc:"Organization theme ID"`
	Body   struct {
		OrganizationID            string `json:"organization_id" doc:"Organization ID"`
		ExpectedDraftRevision     int    `json:"expected_draft_revision" minimum:"1" doc:"Draft revision being published"`
		ExpectedPublishedRevision int    `json:"expected_published_revision" minimum:"0" doc:"Published head loaded by the editor; zero publishes the first revision"`
	}
}

type RollbackThemeInput struct {
	PathID string `path:"id" doc:"Organization theme ID"`
	Body   struct {
		OrganizationID            string `json:"organization_id" doc:"Organization ID"`
		SourceRevision            int    `json:"source_revision" minimum:"1" doc:"Prior published revision to copy into a new head revision"`
		ExpectedDraftRevision     int    `json:"expected_draft_revision" minimum:"1" doc:"Draft revision loaded before rollback"`
		ExpectedPublishedRevision int    `json:"expected_published_revision" minimum:"1" doc:"Published head loaded before rollback"`
	}
}

type ThemeRevisionListInput struct {
	PathID         string `path:"id" doc:"Organization theme ID"`
	OrganizationID string `query:"organization_id" required:"true" doc:"Organization ID"`
	Limit          int    `query:"limit" default:"20" minimum:"1" maximum:"100" doc:"Maximum revisions to return"`
	Cursor         string `query:"cursor" maxLength:"1024" doc:"Opaque cursor for stable newest-first pagination"`
}

type GetThemeRevisionInput struct {
	PathID         string `path:"id" doc:"Organization theme ID"`
	PathRevision   int    `path:"revision" minimum:"1" doc:"Immutable published revision"`
	OrganizationID string `query:"organization_id" required:"true" doc:"Organization ID"`
}

type DeleteThemeInput struct {
	PathID         string `path:"id" doc:"Organization theme ID"`
	OrganizationID string `query:"organization_id" required:"true" doc:"Organization ID"`
	Confirm        bool   `query:"confirm" required:"true" doc:"Explicit deletion confirmation"`
}

type ResolveThemeInput struct {
	WorkspaceID string             `query:"workspace_id" required:"true" doc:"Workspace ID"`
	Scheme      themes.ColorScheme `query:"scheme" required:"true" enum:"light,dark" doc:"Effective light or dark scheme already chosen from the user's system preference"`
	IfNoneMatch string             `header:"If-None-Match" doc:"Resolved theme cache identity"`
}

type ThemeSettingsInput struct {
	WorkspaceID string `query:"workspace_id" required:"true" doc:"Workspace ID"`
}

type UpdateOrganizationThemeSettingsInput struct {
	Body struct {
		OrganizationID    string                `json:"organization_id" doc:"Organization ID"`
		DefaultReference  themes.ThemeReference `json:"default_reference" doc:"Published Organization default"`
		AssignmentsLocked bool                  `json:"assignments_locked" doc:"Force every Workspace to inherit the Organization default"`
	}
}

type UpdateWorkspaceThemeAssignmentInput struct {
	PathWorkspaceID string `path:"workspace_id" doc:"Workspace ID"`
	Body            struct {
		Reference *themes.ThemeReference `json:"reference,omitempty" doc:"Published override; null restores Organization inheritance"`
	}
}

type ThemeOutput struct{ Body themes.Theme }
type ThemeListOutput struct {
	Body themes.ThemeSummaryPage
}
type AvailableThemeListOutput struct {
	Body themes.ThemeSummaryPage
}
type AvailableThemeDetailOutput struct {
	Body themes.PublishedThemeCatalogItem
}
type BuiltInThemeListOutput struct {
	Body []themes.BuiltInFamily `nullable:"false"`
}
type ThemeRevisionOutput struct{ Body themes.PublishedRevision }
type ThemeRevisionListOutput struct {
	Body themes.PublishedRevisionPage
}
type ThemeSettingsOutput struct{ Body themes.ThemeSettings }
type OrganizationThemeSettingsOutput struct {
	Body themes.OrganizationThemeSettings
}
type DeleteThemeOutput struct {
	Body struct {
		Deleted bool `json:"deleted"`
	}
}

type ResolvedThemeOutput struct {
	Status       int
	ETag         string `header:"ETag"`
	CacheControl string `header:"Cache-Control"`
	Vary         string `header:"Vary"`
	Body         themes.ResolvedTheme
}

type UploadThemeAssetInput struct {
	Body struct {
		OrganizationID      string                `json:"organization_id" doc:"Organization ID"`
		Kind                themes.ThemeAssetKind `json:"kind" enum:"font,background,texture,illustration" doc:"Theme asset role"`
		Name                string                `json:"name" minLength:"1" maxLength:"120" doc:"Asset label"`
		MediaType           string                `json:"media_type" enum:"font/woff2,image/png,image/jpeg,image/webp,image/avif" doc:"Static font/woff2 or supported raster image media type; variable fonts are rejected for mobile parity"`
		FontFamily          string                `json:"font_family,omitempty" doc:"Font family for a WOFF2 upload"`
		FontStyle           string                `json:"font_style,omitempty" enum:"normal,italic" doc:"Font style for a WOFF2 upload"`
		FontWeight          int                   `json:"font_weight,omitempty" minimum:"100" maximum:"900" doc:"100-step font weight for a WOFF2 upload"`
		LicenseAcknowledged bool                  `json:"license_acknowledged,omitempty" doc:"Confirms the Organization may use the uploaded font"`
		ContentBase64       string                `json:"content_base64" minLength:"1" doc:"Base64-encoded WOFF2 or raster file"`
	}
}

type DeleteThemeAssetInput struct {
	PathID         string `path:"id" doc:"Theme asset ID"`
	OrganizationID string `query:"organization_id" required:"true" doc:"Organization ID"`
	Confirm        bool   `query:"confirm" required:"true" doc:"Explicit deletion confirmation"`
}

type ThemeAssetOutput struct{ Body themes.ThemeAssetRecord }
type ThemeAssetListOutput struct {
	Body themes.ThemeAssetPage
}
type DeleteThemeAssetOutput struct {
	Body struct {
		Deleted bool `json:"deleted"`
	}
}

type GetThemeAssetContentInput struct {
	PathID         string `path:"id" doc:"Theme asset ID"`
	OrganizationID string `query:"organization_id,omitempty" doc:"Organization scope for library and editor previews"`
	WorkspaceID    string `query:"workspace_id,omitempty" doc:"Workspace scope for resolved runtime resources"`
	ThemeID        string `query:"theme_id,omitempty" doc:"Exact published theme ID for runtime staging or a Workspace administrator preview"`
	Revision       int    `query:"revision,omitempty" minimum:"1" doc:"Exact immutable published revision for runtime staging or a Workspace administrator preview"`
	Format         string `query:"format,omitempty" enum:"ttf,otf" doc:"Native SFNT derivative format for mobile; omit for the original WOFF2 or raster resource"`
	IfNoneMatch    string `header:"If-None-Match" doc:"Opaque asset checksum"`
}

type GetThemeAssetContentOutput struct {
	Status              int
	CacheControl        string `header:"Cache-Control"`
	ContentType         string `header:"Content-Type"`
	ContentLength       string `header:"Content-Length"`
	ETag                string `header:"ETag"`
	Vary                string `header:"Vary"`
	XContentTypeOptions string `header:"X-Content-Type-Options"`
	Body                []byte
}

func (h *ThemeHandler) RegisterRoutes(api huma.API) {
	auth := huma.Middlewares{middleware.AuthMiddleware(api, h.auth)}
	huma.Register(api, huma.Operation{OperationID: "list-built-in-themes", Method: http.MethodGet, Path: themesPath + "/built-ins", Summary: "List immutable built-in themes", Tags: []string{themesTag}, Middlewares: auth}, h.listBuiltIns)
	huma.Register(api, huma.Operation{OperationID: "list-organization-themes", Method: http.MethodGet, Path: themesPath, Summary: "List Organization theme summaries", Description: "Returns a bounded page of compact summaries. Fetch one theme by ID for draft and published manifests.", Tags: []string{themesTag}, Errors: []int{400, 403, 503}, Middlewares: auth}, h.list)
	huma.Register(api, huma.Operation{OperationID: "list-available-themes", Method: http.MethodGet, Path: themesPath + "/available", Summary: "List theme summaries available to a Workspace administrator", Description: "Returns a bounded page of built-ins and published Organization themes without exposing drafts, manifests, or asset inventory.", Tags: []string{themesTag}, Errors: []int{400, 403, 503}, Middlewares: auth}, h.available)
	huma.Register(api, huma.Operation{OperationID: "get-available-custom-theme", Method: http.MethodGet, Path: themesPath + "/available/{id}", Summary: "Get one published custom theme preview", Description: "Returns one immutable published manifest with authorized Workspace preview resource URLs. Built-in manifests are served by the static built-in catalog.", Tags: []string{themesTag}, Errors: []int{400, 403, 404, 503}, Middlewares: auth}, h.availableDetail)
	huma.Register(api, huma.Operation{OperationID: "create-organization-theme", Method: http.MethodPost, Path: themesPath, Summary: "Create an Organization theme draft", Tags: []string{themesTag}, Errors: []int{400, 403, 409, 503}, Middlewares: auth}, h.create)
	huma.Register(api, huma.Operation{OperationID: "resolve-theme", Method: http.MethodGet, Path: themesPath + "/resolved", Summary: "Resolve the complete Workspace theme", Description: "Returns one complete manifest. Missing, invalid, unpublished, deleted, inaccessible, or unsupported references fall back as a whole to Workshop.", Tags: []string{themesTag}, Errors: []int{400, 403, 503}, Middlewares: auth}, h.resolve)
	huma.Register(api, huma.Operation{OperationID: "get-organization-theme", Method: http.MethodGet, Path: themesPath + "/{id}", Summary: "Get an Organization theme and draft", Tags: []string{themesTag}, Errors: []int{400, 403, 404, 503}, Middlewares: auth}, h.get)
	huma.Register(api, huma.Operation{OperationID: "list-theme-revisions", Method: http.MethodGet, Path: themesPath + "/{id}/revisions", Summary: "List immutable published revisions", Tags: []string{themesTag}, Errors: []int{400, 403, 404, 503}, Middlewares: auth}, h.listRevisions)
	huma.Register(api, huma.Operation{OperationID: "get-theme-revision", Method: http.MethodGet, Path: themesPath + "/{id}/revisions/{revision}", Summary: "Get an immutable published revision", Tags: []string{themesTag}, Errors: []int{400, 403, 404, 503}, Middlewares: auth}, h.getRevision)
	huma.Register(api, huma.Operation{OperationID: "update-theme-draft", Method: http.MethodPut, Path: themesPath + "/{id}/draft", Summary: "Replace a theme draft", Tags: []string{themesTag}, Errors: []int{400, 403, 404, 409, 503}, Middlewares: auth}, h.updateDraft)
	huma.Register(api, huma.Operation{OperationID: "publish-theme", Method: http.MethodPost, Path: themesPath + "/{id}/publish", Summary: "Publish an immutable theme revision", Description: "Advances existing Organization and Workspace references for this theme family atomically.", Tags: []string{themesTag}, Errors: []int{400, 403, 404, 409, 503}, Middlewares: auth}, h.publish)
	huma.Register(api, huma.Operation{OperationID: "rollback-theme", Method: http.MethodPost, Path: themesPath + "/{id}/rollback", Summary: "Roll back as a new immutable revision", Tags: []string{themesTag}, Errors: []int{400, 403, 404, 409, 503}, Middlewares: auth}, h.rollback)
	huma.Register(api, huma.Operation{OperationID: "delete-organization-theme", Method: http.MethodDelete, Path: themesPath + "/{id}", Summary: "Delete an unused Organization theme", Tags: []string{themesTag}, Errors: []int{400, 403, 404, 409, 503}, Middlewares: auth}, h.delete)
	huma.Register(api, huma.Operation{OperationID: "get-theme-settings", Method: http.MethodGet, Path: "/theme-settings", Summary: "Get effective Workspace theme settings", Tags: []string{themesTag}, Errors: []int{400, 403, 503}, Middlewares: auth}, h.settings)
	huma.Register(api, huma.Operation{OperationID: "update-organization-theme-settings", Method: http.MethodPut, Path: "/theme-settings/organization", Summary: "Set Organization theme default and lock", Tags: []string{themesTag}, Errors: []int{400, 403, 404, 503}, Middlewares: auth}, h.updateOrganizationSettings)
	huma.Register(api, huma.Operation{OperationID: "update-workspace-theme-assignment", Method: http.MethodPut, Path: "/theme-assignments/{workspace_id}", Summary: "Set or clear a Workspace theme override", Tags: []string{themesTag}, Errors: []int{400, 403, 404, 409, 503}, Middlewares: auth}, h.updateWorkspaceAssignment)
	huma.Register(api, huma.Operation{OperationID: "list-theme-assets", Method: http.MethodGet, Path: "/theme-assets", Summary: "List Organization theme assets", Tags: []string{themesTag}, Errors: []int{400, 403, 503}, Middlewares: auth}, h.listAssets)
	huma.Register(api, huma.Operation{OperationID: "upload-theme-asset", Method: http.MethodPost, Path: "/theme-assets", Summary: "Upload a validated theme asset", Tags: []string{themesTag}, Errors: []int{400, 403, 503}, Middlewares: auth}, h.uploadAsset)
	huma.Register(api, huma.Operation{OperationID: "get-theme-asset-content", Method: http.MethodGet, Path: "/theme-assets/{id}/content", Summary: "Read an authorized theme asset", Tags: []string{themesTag}, Errors: []int{400, 404, 503}, Middlewares: auth}, h.getAssetContent)
	huma.Register(api, huma.Operation{OperationID: "delete-theme-asset", Method: http.MethodDelete, Path: "/theme-assets/{id}", Summary: "Delete an unused theme asset", Tags: []string{themesTag}, Errors: []int{400, 403, 404, 409, 503}, Middlewares: auth}, h.deleteAsset)
}

func (h *ThemeHandler) listBuiltIns(context.Context, *struct{}) (*BuiltInThemeListOutput, error) {
	return &BuiltInThemeListOutput{Body: h.themes.ListBuiltIns()}, nil
}

func (h *ThemeHandler) list(ctx context.Context, input *ThemeOrganizationListInput) (*ThemeListOutput, error) {
	items, err := h.themes.List(ctx, themeActor(ctx), input.OrganizationID, themes.PageOptions{Limit: input.Limit, Cursor: input.Cursor})
	if err != nil {
		return nil, themeError(err)
	}
	return &ThemeListOutput{Body: items}, nil
}

func (h *ThemeHandler) available(ctx context.Context, input *AvailableThemesInput) (*AvailableThemeListOutput, error) {
	items, err := h.themes.Available(ctx, themeActor(ctx), input.WorkspaceID, themes.PageOptions{Limit: input.Limit, Cursor: input.Cursor})
	if err != nil {
		return nil, themeError(err)
	}
	return &AvailableThemeListOutput{Body: items}, nil
}

func (h *ThemeHandler) availableDetail(ctx context.Context, input *AvailableThemeDetailInput) (*AvailableThemeDetailOutput, error) {
	item, err := h.themes.AvailableDetail(ctx, themeActor(ctx), input.WorkspaceID, input.PathID, input.Revision)
	if err != nil {
		return nil, themeError(err)
	}
	return &AvailableThemeDetailOutput{Body: item}, nil
}

func (h *ThemeHandler) create(ctx context.Context, input *CreateThemeInput) (*ThemeOutput, error) {
	manifest := themes.ThemeManifest{}
	if input.Body.Manifest != nil {
		manifest = *input.Body.Manifest
	}
	item, err := h.themes.Create(ctx, themeActor(ctx), themes.CreateInput{OrganizationID: input.Body.OrganizationID, Name: input.Body.Name, Manifest: manifest, DuplicateBuiltInID: input.Body.DuplicateBuiltInID})
	if err != nil {
		return nil, themeError(err)
	}
	return &ThemeOutput{Body: item}, nil
}

func (h *ThemeHandler) get(ctx context.Context, input *ThemePathInput) (*ThemeOutput, error) {
	item, err := h.themes.Get(ctx, themeActor(ctx), input.OrganizationID, input.PathID)
	if err != nil {
		return nil, themeError(err)
	}
	return &ThemeOutput{Body: item}, nil
}

func (h *ThemeHandler) listRevisions(ctx context.Context, input *ThemeRevisionListInput) (*ThemeRevisionListOutput, error) {
	page, err := h.themes.ListRevisions(ctx, themeActor(ctx), input.OrganizationID, input.PathID, themes.PageOptions{Limit: input.Limit, Cursor: input.Cursor})
	if err != nil {
		return nil, themeError(err)
	}
	return &ThemeRevisionListOutput{Body: page}, nil
}

func (h *ThemeHandler) getRevision(ctx context.Context, input *GetThemeRevisionInput) (*ThemeRevisionOutput, error) {
	item, err := h.themes.GetRevision(ctx, themeActor(ctx), input.OrganizationID, input.PathID, input.PathRevision)
	if err != nil {
		return nil, themeError(err)
	}
	return &ThemeRevisionOutput{Body: item}, nil
}

func (h *ThemeHandler) updateDraft(ctx context.Context, input *UpdateThemeDraftInput) (*ThemeOutput, error) {
	item, err := h.themes.UpdateDraft(ctx, themeActor(ctx), input.PathID, themes.UpdateDraftInput{OrganizationID: input.Body.OrganizationID, ExpectedRevision: input.Body.ExpectedRevision, Name: input.Body.Name, Manifest: input.Body.Manifest})
	if err != nil {
		return nil, themeError(err)
	}
	return &ThemeOutput{Body: item}, nil
}

func (h *ThemeHandler) publish(ctx context.Context, input *PublishThemeInput) (*ThemeRevisionOutput, error) {
	item, err := h.themes.Publish(ctx, themeActor(ctx), input.PathID, themes.PublishInput{
		OrganizationID:            input.Body.OrganizationID,
		ExpectedDraftRevision:     input.Body.ExpectedDraftRevision,
		ExpectedPublishedRevision: input.Body.ExpectedPublishedRevision,
	})
	if err != nil {
		return nil, themeError(err)
	}
	return &ThemeRevisionOutput{Body: item}, nil
}

func (h *ThemeHandler) rollback(ctx context.Context, input *RollbackThemeInput) (*ThemeRevisionOutput, error) {
	item, err := h.themes.Rollback(ctx, themeActor(ctx), input.PathID, themes.RollbackInput{
		OrganizationID:            input.Body.OrganizationID,
		SourceRevision:            input.Body.SourceRevision,
		ExpectedDraftRevision:     input.Body.ExpectedDraftRevision,
		ExpectedPublishedRevision: input.Body.ExpectedPublishedRevision,
	})
	if err != nil {
		return nil, themeError(err)
	}
	return &ThemeRevisionOutput{Body: item}, nil
}

func (h *ThemeHandler) delete(ctx context.Context, input *DeleteThemeInput) (*DeleteThemeOutput, error) {
	if !input.Confirm {
		return nil, huma.Error400BadRequest("confirm=true is required to delete an Organization theme")
	}
	if err := h.themes.Delete(ctx, themeActor(ctx), input.PathID, themes.DeleteInput{OrganizationID: input.OrganizationID}); err != nil {
		return nil, themeError(err)
	}
	output := &DeleteThemeOutput{}
	output.Body.Deleted = true
	return output, nil
}

func (h *ThemeHandler) resolve(ctx context.Context, input *ResolveThemeInput) (*ResolvedThemeOutput, error) {
	item, err := h.themes.Resolve(ctx, themeActor(ctx), themes.ResolveInput{WorkspaceID: input.WorkspaceID, Scheme: input.Scheme})
	if err != nil {
		return nil, themeError(err)
	}
	etag := fmt.Sprintf(`"%s"`, item.CacheIdentity)
	if strings.TrimSpace(input.IfNoneMatch) == etag {
		return &ResolvedThemeOutput{Status: http.StatusNotModified, ETag: etag, CacheControl: "private, no-cache", Vary: "Authorization, Cookie"}, nil
	}
	return &ResolvedThemeOutput{Status: http.StatusOK, ETag: etag, CacheControl: "private, no-cache", Vary: "Authorization, Cookie", Body: item}, nil
}

func (h *ThemeHandler) settings(ctx context.Context, input *ThemeSettingsInput) (*ThemeSettingsOutput, error) {
	item, err := h.themes.Settings(ctx, themeActor(ctx), input.WorkspaceID)
	if err != nil {
		return nil, themeError(err)
	}
	return &ThemeSettingsOutput{Body: item}, nil
}

func (h *ThemeHandler) updateOrganizationSettings(ctx context.Context, input *UpdateOrganizationThemeSettingsInput) (*OrganizationThemeSettingsOutput, error) {
	item, err := h.themes.SetOrganizationSettings(ctx, themeActor(ctx), themes.OrganizationSettingsInput{OrganizationID: input.Body.OrganizationID, DefaultReference: input.Body.DefaultReference, AssignmentsLocked: input.Body.AssignmentsLocked})
	if err != nil {
		return nil, themeError(err)
	}
	return &OrganizationThemeSettingsOutput{Body: item}, nil
}

func (h *ThemeHandler) updateWorkspaceAssignment(ctx context.Context, input *UpdateWorkspaceThemeAssignmentInput) (*ThemeSettingsOutput, error) {
	item, err := h.themes.AssignWorkspace(ctx, themeActor(ctx), themes.WorkspaceAssignmentInput{WorkspaceID: input.PathWorkspaceID, Reference: input.Body.Reference})
	if err != nil {
		return nil, themeError(err)
	}
	return &ThemeSettingsOutput{Body: item}, nil
}

func (h *ThemeHandler) listAssets(ctx context.Context, input *ThemeAssetListInput) (*ThemeAssetListOutput, error) {
	page, err := h.themes.ListAssets(ctx, themeActor(ctx), input.OrganizationID, themes.PageOptions{Limit: input.Limit, Cursor: input.Cursor})
	if err != nil {
		return nil, themeError(err)
	}
	return &ThemeAssetListOutput{Body: page}, nil
}

func (h *ThemeHandler) uploadAsset(ctx context.Context, input *UploadThemeAssetInput) (*ThemeAssetOutput, error) {
	if len(input.Body.ContentBase64) > maxThemeAssetBase64Length {
		return nil, huma.Error400BadRequest("content_base64 exceeds the theme asset limit")
	}
	content, err := base64.StdEncoding.DecodeString(strings.TrimSpace(input.Body.ContentBase64))
	if err != nil {
		return nil, huma.Error400BadRequest("content_base64 must be valid base64")
	}
	item, err := h.themes.UploadAsset(ctx, themeActor(ctx), themes.UploadAssetInput{OrganizationID: input.Body.OrganizationID, Kind: input.Body.Kind, Name: input.Body.Name, MediaType: input.Body.MediaType, FontFamily: input.Body.FontFamily, FontStyle: input.Body.FontStyle, FontWeight: input.Body.FontWeight, LicenseAcknowledged: input.Body.LicenseAcknowledged, Content: bytes.NewReader(content)})
	if err != nil {
		return nil, themeError(err)
	}
	return &ThemeAssetOutput{Body: item}, nil
}

func (h *ThemeHandler) deleteAsset(ctx context.Context, input *DeleteThemeAssetInput) (*DeleteThemeAssetOutput, error) {
	if !input.Confirm {
		return nil, huma.Error400BadRequest("confirm=true is required to delete a theme asset")
	}
	if err := h.themes.DeleteAsset(ctx, themeActor(ctx), input.OrganizationID, input.PathID); err != nil {
		return nil, themeError(err)
	}
	output := &DeleteThemeAssetOutput{}
	output.Body.Deleted = true
	return output, nil
}

func (h *ThemeHandler) getAssetContent(ctx context.Context, input *GetThemeAssetContentInput) (*GetThemeAssetContentOutput, error) {
	content, err := h.themes.OpenAsset(ctx, themeActor(ctx), input.PathID, themes.AssetAccessScope{
		OrganizationID: input.OrganizationID, WorkspaceID: input.WorkspaceID,
		ThemeID: input.ThemeID, Revision: input.Revision, Format: input.Format,
	})
	if err != nil {
		return nil, themeError(err)
	}
	defer content.Reader.Close()
	if strings.TrimSpace(input.IfNoneMatch) == content.ETag {
		return &GetThemeAssetContentOutput{Status: http.StatusNotModified, CacheControl: "private, no-cache", ETag: content.ETag, Vary: "Authorization, Cookie", XContentTypeOptions: "nosniff"}, nil
	}
	data, err := io.ReadAll(io.LimitReader(content.Reader, content.SizeBytes+1))
	if err != nil || int64(len(data)) != content.SizeBytes {
		return nil, huma.Error503ServiceUnavailable("theme asset content unavailable")
	}
	checksum := sha256.Sum256(data)
	if !strings.EqualFold(hex.EncodeToString(checksum[:]), content.ChecksumSHA256) {
		return nil, huma.Error503ServiceUnavailable("theme asset content unavailable")
	}
	return &GetThemeAssetContentOutput{Status: http.StatusOK, CacheControl: "private, no-cache", ContentType: content.MediaType, ContentLength: fmt.Sprintf("%d", content.SizeBytes), ETag: content.ETag, Vary: "Authorization, Cookie", XContentTypeOptions: "nosniff", Body: data}, nil
}

func themeActor(ctx context.Context) themes.Actor {
	return themes.Actor{UserID: middleware.GetUserID(ctx), SessionID: middleware.GetSessionID(ctx), TokenID: middleware.GetTokenID(ctx), ClientID: middleware.GetClientID(ctx), CredentialWorkspaceID: middleware.GetWorkspaceID(ctx)}
}

func themeError(err error) error {
	switch {
	case errors.Is(err, themes.ErrInvalidInput), errors.Is(err, themes.ErrInvalidManifest), errors.Is(err, themes.ErrInvalidAsset):
		return huma.Error400BadRequest(err.Error())
	case errors.Is(err, themes.ErrInaccessible):
		return huma.Error403Forbidden("theme access denied")
	case errors.Is(err, themes.ErrNotFound):
		return huma.Error404NotFound("theme resource not found")
	case errors.Is(err, themes.ErrConflict), errors.Is(err, themes.ErrRevisionConflict), errors.Is(err, themes.ErrAssignmentLocked), errors.Is(err, themes.ErrThemeInUse):
		return huma.Error409Conflict(err.Error())
	default:
		return huma.Error503ServiceUnavailable("theme service unavailable")
	}
}
