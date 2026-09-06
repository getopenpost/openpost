package handlers

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/publicationbuilder"
	"github.com/openpost/backend/internal/services/ratelimit"
	"github.com/openpost/backend/internal/services/voiceprofiles"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

const (
	publicationBuildsPath              = "/publication-builds"
	publicationBuildsTag               = "Publication Builds"
	maxPublicationBuildIdeaCharacters  = 20_000
	maxPublicationBuildAccounts        = 20
	maxPublicationBuildReferences      = 10
	maxPublicationBuildURLCharacters   = 8_192
	maxPublicationBuildIDCharacters    = 128
	maxPublicationBuildThreadSegments  = 10
	maxPublicationBuildOutcome         = publicationbuilder.MaxDirectionOutcomeCharacters
	maxPublicationBuildAudience        = publicationbuilder.MaxDirectionAudienceCharacters
	maxPublicationBuildAngle           = publicationbuilder.MaxDirectionAngleCharacters
	maxPublicationBuildTone            = publicationbuilder.MaxDirectionToneCharacters
	maxPublicationBuildMediaPreference = publicationbuilder.MaxDirectionMediaPreferenceCharacters
	publicationBuildRequestsPerMinute  = 12
)

type publicationBuildApplication interface {
	Enqueue(context.Context, publicationbuilder.CreateBuildRequest) (publicationbuilder.Build, bool, error)
	Get(context.Context, string, string) (publicationbuilder.Build, error)
	Retry(context.Context, string, string) (publicationbuilder.Build, error)
	Cancel(context.Context, string, string) (publicationbuilder.Build, error)
	Commit(context.Context, string, string, publicationbuilder.PublicationApplication) (publicationbuilder.Build, error)
	ResolvePlanningInput(context.Context, string, publicationbuilder.BuildInput, []string, []publicationbuilder.BuildAsset) (publicationbuilder.BuildInput, error)
}

type PublicationBuildHandler struct {
	db                 *bun.DB
	auth               middleware.Authenticator
	application        publicationBuildApplication
	planner            *publicationbuilder.Service
	publications       publicationbuilder.PublicationApplication
	capabilityResolver *CapabilityResolverHandler
	voices             *voiceprofiles.Service
	limiter            *ratelimit.Limiter
	now                func() time.Time
}

func (h *PublicationBuildHandler) SetPublicationApplication(application publicationbuilder.PublicationApplication) {
	h.publications = application
}

func (h *PublicationBuildHandler) SetCapabilityResolver(resolver *CapabilityResolverHandler) {
	h.capabilityResolver = resolver
}

func (h *PublicationBuildHandler) SetPlanner(planner *publicationbuilder.Service) {
	h.planner = planner
}

func NewPublicationBuildHandler(
	db *bun.DB,
	authenticator middleware.Authenticator,
	application *publicationbuilder.Application,
) *PublicationBuildHandler {
	handler := &PublicationBuildHandler{
		db: db, auth: authenticator,
		voices: voiceprofiles.New(db), limiter: ratelimit.New(), now: func() time.Time { return time.Now().UTC() },
	}
	if application != nil {
		handler.application = application
	}
	return handler
}

type CreatePublicationBuildBody struct {
	WorkspaceID       string                               `json:"workspace_id" doc:"Workspace that owns the source material and destinations"`
	Idea              string                               `json:"idea,omitempty" maxLength:"20000" doc:"Idea, note, update, or Markdown source text"`
	AccountIDs        []string                             `json:"account_ids,omitempty" maxItems:"20" uniqueItems:"true" doc:"Candidate connected account IDs"`
	SocialSetID       string                               `json:"social_set_id,omitempty" doc:"Optional Social Set candidate snapshot"`
	VoiceProfileID    string                               `json:"voice_profile_id,omitempty" doc:"Optional build-level Voice Profile override"`
	ContextURLs       []string                             `json:"context_urls,omitempty" maxItems:"10" uniqueItems:"true" doc:"Public HTTP or HTTPS sources loaded by the guarded background worker"`
	ContextNotes      string                               `json:"context_notes,omitempty" maxLength:"10000" doc:"Private planning notes supplied as untrusted source material"`
	ContextMayPublish bool                                 `json:"context_may_publish,omitempty" doc:"Allow text from context notes to appear in generated drafts"`
	Assets            []publicationbuilder.BuildAsset      `json:"assets,omitempty" maxItems:"10" doc:"Stored Workspace media used as source evidence"`
	Direction         publicationbuilder.DirectionInput    `json:"direction,omitempty" doc:"Optional outcome, audience, angle, tone, and media direction"`
	DestinationPolicy publicationbuilder.DestinationPolicy `json:"destination_policy,omitempty" enum:"recommend,require_all" doc:"Allow the director to skip weak destinations or require every candidate"`
}

type CreatePublicationBuildInput struct {
	IdempotencyKey string `header:"Idempotency-Key" required:"true" minLength:"8" maxLength:"160" doc:"Stable key for one logical build request"`
	Body           CreatePublicationBuildBody
}

type PublicationBuildPathInput struct {
	PathID string `path:"id" doc:"Publication build ID"`
}

type PublicationBuildOutput struct {
	Body publicationbuilder.Build
}

type PlanPublicationAnglesInput struct {
	Body CreatePublicationBuildBody
}

type PlanPublicationAnglesOutput struct {
	Body struct {
		Angles []publicationbuilder.AngleOption `json:"angles"`
	}
}

type CommitPublicationBuildOutput struct {
	Body struct {
		PublicationID string `json:"publication_id" doc:"Draft Publication created from the approved build"`
		Href          string `json:"href" doc:"Composer path for review and editing"`
	}
}

func (h *PublicationBuildHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "plan-publication-angles", Method: http.MethodPost, Path: publicationBuildsPath + "/angles",
		Summary: "Plan creative directions", Tags: []string{publicationBuildsTag},
		Errors:      []int{400, 403, 429, 503},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.planAngles)
	huma.Register(api, huma.Operation{
		OperationID: "create-publication-build", Method: http.MethodPost, Path: publicationBuildsPath,
		Summary: "Build destination-native posts", Tags: []string{publicationBuildsTag},
		Errors:      []int{400, 403, 409, 429, 503},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.create)
	huma.Register(api, huma.Operation{
		OperationID: "get-publication-build", Method: http.MethodGet, Path: publicationBuildsPath + "/{id}",
		Summary: "Get a publication build", Tags: []string{publicationBuildsTag}, Errors: []int{403, 404, 503},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.get)
	huma.Register(api, huma.Operation{
		OperationID: "retry-publication-build", Method: http.MethodPost, Path: publicationBuildsPath + "/{id}/retry",
		Summary: "Retry a failed publication build", Tags: []string{publicationBuildsTag}, Errors: []int{403, 404, 409, 429, 503},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.retry)
	huma.Register(api, huma.Operation{
		OperationID: "cancel-publication-build", Method: http.MethodPost, Path: publicationBuildsPath + "/{id}/cancel",
		Summary: "Cancel a publication build", Tags: []string{publicationBuildsTag}, Errors: []int{403, 404, 503},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.cancel)
	huma.Register(api, huma.Operation{
		OperationID: "commit-publication-build", Method: http.MethodPost, Path: publicationBuildsPath + "/{id}/commit",
		Summary: "Send a ready build to the composer", Tags: []string{publicationBuildsTag}, Errors: []int{403, 404, 409, 503},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, h.commit)
}

func (h *PublicationBuildHandler) planAngles(
	ctx context.Context,
	input *PlanPublicationAnglesInput,
) (*PlanPublicationAnglesOutput, error) {
	if h.planner == nil {
		return nil, huma.Error503ServiceUnavailable("AI direction planning is not configured")
	}
	userID := strings.TrimSpace(middleware.GetUserID(ctx))
	if h.limiter == nil || !h.limiter.Allow("publication-build:angles:"+userID, publicationBuildRequestsPerMinute, time.Minute) {
		return nil, huma.Error429TooManyRequests("AI direction planning limit reached; try again in one minute")
	}
	prepared, err := h.preparePublicationBuildRequest(ctx, &CreatePublicationBuildInput{
		IdempotencyKey: "angle-plan",
		Body:           input.Body,
	})
	if err != nil {
		return nil, err
	}
	if len(prepared.ContextURLs) > 0 || len(prepared.Assets) > 0 {
		if h.application == nil {
			return nil, huma.Error503ServiceUnavailable("AI source loading is not configured")
		}
		prepared.Input, err = h.application.ResolvePlanningInput(
			ctx,
			prepared.WorkspaceID,
			prepared.Input,
			prepared.ContextURLs,
			prepared.Assets,
		)
		if err != nil {
			return nil, huma.Error400BadRequest("One of the selected sources could not be read")
		}
	}
	voice := publicationbuilder.VoiceSnapshot{}
	if len(prepared.Input.Destinations) > 0 {
		voice = prepared.Input.Destinations[0].Voice
	}
	angles, err := h.planner.PlanAngles(ctx, publicationbuilder.AngleInput{
		Idea:         prepared.Input.Idea,
		Sources:      prepared.Input.Sources,
		Destinations: prepared.Input.Destinations,
		Voice:        voice,
		Parts:        prepared.Input.Parts,
		Images:       prepared.Input.Images,
		Files:        prepared.Input.Files,
		Audio:        prepared.Input.Audio,
		Videos:       prepared.Input.Videos,
	})
	if err != nil {
		return nil, huma.Error503ServiceUnavailable("AI directions could not be created")
	}
	output := &PlanPublicationAnglesOutput{}
	output.Body.Angles = angles
	return output, nil
}

func (h *PublicationBuildHandler) create(
	ctx context.Context,
	input *CreatePublicationBuildInput,
) (*PublicationBuildOutput, error) {
	if err := h.requireRuntime(); err != nil {
		return nil, err
	}
	userID := strings.TrimSpace(middleware.GetUserID(ctx))
	if h.limiter == nil || !h.limiter.Allow("publication-build:create:"+userID, publicationBuildRequestsPerMinute, time.Minute) {
		return nil, huma.Error429TooManyRequests("Publication build limit reached; try again in one minute")
	}
	request, err := h.preparePublicationBuildRequest(ctx, input)
	if err != nil {
		return nil, err
	}
	build, _, err := h.application.Enqueue(ctx, request)
	if err != nil {
		return nil, publicationBuildError(err)
	}
	return &PublicationBuildOutput{Body: build}, nil
}

func (h *PublicationBuildHandler) preparePublicationBuildRequest(
	ctx context.Context,
	input *CreatePublicationBuildInput,
) (publicationbuilder.CreateBuildRequest, error) {
	userID := strings.TrimSpace(middleware.GetUserID(ctx))
	if userID == "" {
		return publicationbuilder.CreateBuildRequest{}, huma.Error401Unauthorized("authentication required")
	}
	workspaceID, err := boundedBuildID(input.Body.WorkspaceID, "workspace_id")
	if err != nil {
		return publicationbuilder.CreateBuildRequest{}, err
	}
	decision, err := workspaceaccess.NewAuthorizer(h.db).Authorize(
		ctx,
		workspaceID,
		workspaceActor(ctx, userID),
		workspaceaccess.LevelEdit,
	)
	if err != nil {
		return publicationbuilder.CreateBuildRequest{}, huma.Error503ServiceUnavailable("Workspace access could not be checked")
	}
	if !decision.Allowed {
		return publicationbuilder.CreateBuildRequest{}, huma.Error403Forbidden("workspace editor role required")
	}

	idempotencyKey := strings.TrimSpace(input.IdempotencyKey)
	if len(idempotencyKey) < 8 || len(idempotencyKey) > 160 || containsControl(idempotencyKey, false) {
		return publicationbuilder.CreateBuildRequest{}, huma.Error400BadRequest("Idempotency-Key must contain 8 to 160 safe characters")
	}
	source, err := h.preparePublicationBuildSource(ctx, workspaceID, input.Body)
	if err != nil {
		return publicationbuilder.CreateBuildRequest{}, err
	}
	destinations, err := h.preparePublicationBuildDestinations(ctx, workspaceID, input.Body)
	if err != nil {
		return publicationbuilder.CreateBuildRequest{}, err
	}
	policy, err := publicationBuildDestinationPolicy(input.Body.DestinationPolicy)
	if err != nil {
		return publicationbuilder.CreateBuildRequest{}, err
	}
	return publicationbuilder.CreateBuildRequest{
		WorkspaceID: workspaceID, CreatedByID: userID, IdempotencyKey: idempotencyKey,
		Authority: workspaceaccess.StoredAuthority{
			UserID: userID, WorkspaceID: workspaceID, OrganizationID: decision.OrganizationID,
			IdentityProviderID: decision.ProviderID, AssuredAt: h.now().UTC(),
		},
		Input: publicationbuilder.BuildInput{
			Idea: source.idea, Sources: source.sources, Destinations: destinations,
			Direction: source.direction, DestinationPolicy: policy,
		},
		ContextURLs:    source.contextURLs,
		Assets:         source.assets,
		SocialSetID:    strings.TrimSpace(input.Body.SocialSetID),
		VoiceProfileID: strings.TrimSpace(input.Body.VoiceProfileID),
	}, nil
}

type preparedPublicationBuildSource struct {
	idea        string
	sources     []publicationbuilder.SourceMaterial
	contextURLs []string
	assets      []publicationbuilder.BuildAsset
	direction   publicationbuilder.DirectionInput
}

func (h *PublicationBuildHandler) preparePublicationBuildSource(
	ctx context.Context,
	workspaceID string,
	body CreatePublicationBuildBody,
) (preparedPublicationBuildSource, error) {
	idea, err := boundedBuildText(body.Idea, maxPublicationBuildIdeaCharacters, true, "idea")
	if err != nil {
		return preparedPublicationBuildSource{}, err
	}
	direction, err := normalizePublicationBuildDirection(body.Direction)
	if err != nil {
		return preparedPublicationBuildSource{}, err
	}
	contextURLs, err := normalizePublicationBuildURLs(body.ContextURLs)
	if err != nil {
		return preparedPublicationBuildSource{}, err
	}
	assets, err := h.normalizePublicationBuildAssets(ctx, workspaceID, body.Assets)
	if err != nil {
		return preparedPublicationBuildSource{}, err
	}
	contextNotes, err := boundedBuildText(body.ContextNotes, publicationbuilder.MaxContextNotesCharacters, true, "context_notes")
	if err != nil {
		return preparedPublicationBuildSource{}, err
	}
	if len(contextURLs)+len(assets) > maxPublicationBuildReferences {
		return preparedPublicationBuildSource{}, huma.Error400BadRequest("A publication build can use at most 10 URL and media references")
	}
	if idea == "" && contextNotes == "" && len(contextURLs) == 0 && len(assets) == 0 {
		return preparedPublicationBuildSource{}, huma.Error400BadRequest("Add an idea, public URL, or Workspace media source")
	}
	sources := []publicationbuilder.SourceMaterial{}
	if contextNotes != "" {
		sources = append(sources, publicationbuilder.SourceMaterial{
			ID: "context:notes", Kind: "text", Label: "Additional context", Text: contextNotes,
			Publishable: body.ContextMayPublish,
		})
	}
	return preparedPublicationBuildSource{
		idea: idea, sources: sources, contextURLs: contextURLs,
		assets: assets, direction: direction,
	}, nil
}

func (h *PublicationBuildHandler) preparePublicationBuildDestinations(
	ctx context.Context,
	workspaceID string,
	body CreatePublicationBuildBody,
) ([]publicationbuilder.Destination, error) {
	snapshot, err := h.resolvePublicationBuildCandidates(
		ctx,
		workspaceID,
		body.AccountIDs,
		body.SocialSetID,
	)
	if err != nil {
		return nil, err
	}
	accounts, err := h.loadPublicationBuildAccounts(ctx, workspaceID, snapshot.AccountIDs)
	if err != nil {
		return nil, err
	}
	effectiveVoices, err := h.voices.Resolve(ctx, voiceprofiles.ResolveInput{
		WorkspaceID: workspaceID, AccountIDs: snapshot.AccountIDs,
		PublicationVoiceProfileID: strings.TrimSpace(body.VoiceProfileID),
	})
	if err != nil {
		return nil, publicationBuildVoiceError(err)
	}
	voiceByAccount := make(map[string]voiceprofiles.Profile, len(effectiveVoices))
	for _, effective := range effectiveVoices {
		voiceByAccount[effective.AccountID] = effective.Profile
	}

	destinations := make([]publicationbuilder.Destination, 0, len(snapshot.AccountIDs))
	for _, accountID := range snapshot.AccountIDs {
		account := accounts[accountID]
		profiles := h.publicationBuildOutputProfiles(ctx, account, snapshot.DefaultOutputProfiles[accountID])
		if len(profiles) == 0 {
			return nil, huma.Error400BadRequest("One or more selected accounts has no usable Builder output format")
		}
		voice, ok := voiceByAccount[accountID]
		if !ok {
			return nil, huma.Error503ServiceUnavailable("The effective Voice Profile could not be resolved")
		}
		destinations = append(destinations, publicationbuilder.Destination{
			AccountID: account.ID, Platform: account.Platform, Label: publicationBuildAccountLabel(account),
			AllowedOutputProfiles: profiles, Voice: publicationBuildVoiceSnapshot(voice),
		})
	}
	return destinations, nil
}

func publicationBuildDestinationPolicy(
	policy publicationbuilder.DestinationPolicy,
) (publicationbuilder.DestinationPolicy, error) {
	if policy == "" {
		return publicationbuilder.DestinationPolicyRecommend, nil
	}
	if policy != publicationbuilder.DestinationPolicyRecommend && policy != publicationbuilder.DestinationPolicyRequireAll {
		return "", huma.Error400BadRequest("destination_policy must be recommend or require_all")
	}
	return policy, nil
}

func (h *PublicationBuildHandler) get(
	ctx context.Context,
	input *PublicationBuildPathInput,
) (*PublicationBuildOutput, error) {
	build, err := h.loadAuthorizedBuild(ctx, input.PathID, workspaceaccess.LevelRead)
	if err != nil {
		return nil, err
	}
	return &PublicationBuildOutput{Body: build}, nil
}

func (h *PublicationBuildHandler) retry(
	ctx context.Context,
	input *PublicationBuildPathInput,
) (*PublicationBuildOutput, error) {
	if _, err := h.loadAuthorizedBuild(ctx, input.PathID, workspaceaccess.LevelEdit); err != nil {
		return nil, err
	}
	build, err := h.application.Retry(ctx, middleware.GetUserID(ctx), strings.TrimSpace(input.PathID))
	if err != nil {
		return nil, publicationBuildError(err)
	}
	return &PublicationBuildOutput{Body: build}, nil
}

func (h *PublicationBuildHandler) cancel(
	ctx context.Context,
	input *PublicationBuildPathInput,
) (*PublicationBuildOutput, error) {
	if _, err := h.loadAuthorizedBuild(ctx, input.PathID, workspaceaccess.LevelEdit); err != nil {
		return nil, err
	}
	build, err := h.application.Cancel(ctx, middleware.GetUserID(ctx), strings.TrimSpace(input.PathID))
	if err != nil {
		return nil, publicationBuildError(err)
	}
	return &PublicationBuildOutput{Body: build}, nil
}

func (h *PublicationBuildHandler) commit(
	ctx context.Context,
	input *PublicationBuildPathInput,
) (*CommitPublicationBuildOutput, error) {
	if h == nil || h.publications == nil {
		return nil, huma.Error503ServiceUnavailable("Publication Builder handoff is unavailable")
	}
	if _, err := h.loadAuthorizedBuild(ctx, input.PathID, workspaceaccess.LevelEdit); err != nil {
		return nil, err
	}
	build, err := h.application.Commit(
		ctx,
		strings.TrimSpace(middleware.GetUserID(ctx)),
		strings.TrimSpace(input.PathID),
		h.publications,
	)
	if err != nil {
		return nil, publicationBuildError(err)
	}
	if strings.TrimSpace(build.PublicationID) == "" {
		return nil, huma.Error503ServiceUnavailable("Publication Builder handoff did not return a Publication")
	}
	output := &CommitPublicationBuildOutput{}
	output.Body.PublicationID = build.PublicationID
	output.Body.Href = "/publications/" + build.PublicationID
	return output, nil
}

func (h *PublicationBuildHandler) loadAuthorizedBuild(
	ctx context.Context,
	buildID string,
	level workspaceaccess.Level,
) (publicationbuilder.Build, error) {
	if err := h.requireRuntime(); err != nil {
		return publicationbuilder.Build{}, err
	}
	userID := strings.TrimSpace(middleware.GetUserID(ctx))
	if userID == "" {
		return publicationbuilder.Build{}, huma.Error401Unauthorized("authentication required")
	}
	buildID, err := boundedBuildID(buildID, "publication build id")
	if err != nil {
		return publicationbuilder.Build{}, err
	}
	build, err := h.application.Get(ctx, userID, buildID)
	if err != nil {
		return publicationbuilder.Build{}, publicationBuildError(err)
	}
	decision, err := workspaceaccess.NewAuthorizer(h.db).Authorize(
		ctx,
		build.WorkspaceID,
		workspaceActor(ctx, userID),
		level,
	)
	if err != nil {
		return publicationbuilder.Build{}, huma.Error503ServiceUnavailable("Workspace access could not be checked")
	}
	if !decision.Allowed {
		return publicationbuilder.Build{}, huma.Error403Forbidden("workspace access denied")
	}
	return build, nil
}

func (h *PublicationBuildHandler) requireRuntime() error {
	if h == nil || h.db == nil || h.application == nil || h.voices == nil || h.now == nil {
		return huma.Error503ServiceUnavailable("Publication Builder is unavailable")
	}
	return nil
}

type publicationBuildCandidateSnapshot struct {
	AccountIDs            []string
	DefaultOutputProfiles map[string]string
}

func (h *PublicationBuildHandler) resolvePublicationBuildCandidates(
	ctx context.Context,
	workspaceID string,
	rawAccountIDs []string,
	rawSocialSetID string,
) (publicationBuildCandidateSnapshot, error) {
	accountIDs, err := normalizePublicationBuildIDs(rawAccountIDs, "account_ids", maxPublicationBuildAccounts)
	if err != nil {
		return publicationBuildCandidateSnapshot{}, err
	}
	socialSetID := strings.TrimSpace(rawSocialSetID)
	if socialSetID == "" {
		return directPublicationBuildCandidates(accountIDs)
	}
	if _, err := boundedBuildID(socialSetID, "social_set_id"); err != nil {
		return publicationBuildCandidateSnapshot{}, err
	}
	return h.loadPublicationBuildSocialSetCandidates(ctx, workspaceID, socialSetID, accountIDs)
}

func directPublicationBuildCandidates(accountIDs []string) (publicationBuildCandidateSnapshot, error) {
	if len(accountIDs) == 0 {
		return publicationBuildCandidateSnapshot{}, huma.Error400BadRequest("Select at least one destination")
	}
	return publicationBuildCandidateSnapshot{
		AccountIDs: accountIDs, DefaultOutputProfiles: map[string]string{},
	}, nil
}

func (h *PublicationBuildHandler) loadPublicationBuildSocialSetCandidates(
	ctx context.Context,
	workspaceID string,
	socialSetID string,
	selectedAccountIDs []string,
) (publicationBuildCandidateSnapshot, error) {
	var set models.SocialSet
	if err := h.db.NewSelect().Model(&set).
		Where("id = ? AND workspace_id = ?", socialSetID, workspaceID).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return publicationBuildCandidateSnapshot{}, huma.Error400BadRequest("Social Set is unavailable in this Workspace")
		}
		return publicationBuildCandidateSnapshot{}, huma.Error503ServiceUnavailable("Social Set could not be loaded")
	}
	var rows []models.SocialSetAccount
	if err := h.db.NewSelect().Model(&rows).
		Where("social_set_id = ?", set.ID).
		OrderExpr("display_order ASC, created_at ASC").
		Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return publicationBuildCandidateSnapshot{}, huma.Error503ServiceUnavailable("Social Set destinations could not be loaded")
	}
	if len(rows) == 0 {
		return publicationBuildCandidateSnapshot{}, huma.Error400BadRequest("The selected Social Set has no destinations")
	}
	return filterPublicationBuildSocialSet(rows, selectedAccountIDs)
}

func filterPublicationBuildSocialSet(
	rows []models.SocialSetAccount,
	selectedAccountIDs []string,
) (publicationBuildCandidateSnapshot, error) {
	membership := make(map[string]models.SocialSetAccount, len(rows))
	for _, row := range rows {
		membership[row.SocialAccountID] = row
	}
	selected := make(map[string]struct{}, len(selectedAccountIDs))
	for _, accountID := range selectedAccountIDs {
		if _, ok := membership[accountID]; !ok {
			return publicationBuildCandidateSnapshot{}, huma.Error400BadRequest("account_ids must be a subset of the selected Social Set")
		}
		selected[accountID] = struct{}{}
	}
	useAll := len(selected) == 0
	snapshot := publicationBuildCandidateSnapshot{DefaultOutputProfiles: map[string]string{}}
	for _, row := range rows {
		if !useAll {
			if _, ok := selected[row.SocialAccountID]; !ok {
				continue
			}
		}
		snapshot.AccountIDs = append(snapshot.AccountIDs, row.SocialAccountID)
		snapshot.DefaultOutputProfiles[row.SocialAccountID] = strings.TrimSpace(row.DefaultOutputProfile)
	}
	if len(snapshot.AccountIDs) == 0 || len(snapshot.AccountIDs) > maxPublicationBuildAccounts {
		return publicationBuildCandidateSnapshot{}, huma.Error400BadRequest("A publication build requires 1 to 20 Social Set destinations")
	}
	return snapshot, nil
}

func (h *PublicationBuildHandler) loadPublicationBuildAccounts(
	ctx context.Context,
	workspaceID string,
	accountIDs []string,
) (map[string]models.SocialAccount, error) {
	var rows []models.SocialAccount
	if err := h.db.NewSelect().Model(&rows).
		Where("workspace_id = ? AND is_active = ?", workspaceID, true).
		Where("id IN (?)", bun.List(accountIDs)).
		Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error503ServiceUnavailable("Selected destinations could not be loaded")
	}
	if len(rows) != len(accountIDs) {
		return nil, huma.Error400BadRequest("One or more destinations is disconnected or outside this Workspace")
	}
	accounts := make(map[string]models.SocialAccount, len(rows))
	for _, account := range rows {
		account.Platform = strings.ToLower(strings.TrimSpace(account.Platform))
		accounts[account.ID] = account
	}
	return accounts, nil
}

func (h *PublicationBuildHandler) normalizePublicationBuildAssets(
	ctx context.Context,
	workspaceID string,
	input []publicationbuilder.BuildAsset,
) ([]publicationbuilder.BuildAsset, error) {
	if len(input) > maxPublicationBuildReferences {
		return nil, huma.Error400BadRequest("A publication build can use at most 10 media references")
	}
	assets := make([]publicationbuilder.BuildAsset, 0, len(input))
	mediaIDs := make([]string, 0, len(input))
	seen := make(map[string]struct{}, len(input))
	for _, asset := range input {
		mediaID, err := boundedBuildID(asset.MediaID, "assets.media_id")
		if err != nil {
			return nil, err
		}
		if _, exists := seen[mediaID]; exists {
			return nil, huma.Error400BadRequest("A media source can appear only once")
		}
		seen[mediaID] = struct{}{}
		role := strings.ToLower(strings.TrimSpace(asset.Role))
		if role == "" {
			role = "context"
		}
		if !slices.Contains([]string{"context", "evidence", "artifact"}, role) {
			return nil, huma.Error400BadRequest("assets.role must be context, evidence, or artifact")
		}
		assets = append(assets, publicationbuilder.BuildAsset{
			MediaID: mediaID, Role: role, MayPublish: asset.MayPublish,
		})
		mediaIDs = append(mediaIDs, mediaID)
	}
	if len(mediaIDs) == 0 {
		return assets, nil
	}
	count, err := h.db.NewSelect().Model((*models.MediaAttachment)(nil)).
		Where("workspace_id = ?", workspaceID).
		Where("processing_status = ?", "ready").
		Where("trashed_at IS NULL").
		Where("id IN (?)", bun.List(mediaIDs)).
		Count(ctx)
	if err != nil {
		return nil, huma.Error503ServiceUnavailable("Selected media sources could not be checked")
	}
	if count != len(mediaIDs) {
		return nil, huma.Error400BadRequest("One or more media sources is unavailable in this Workspace")
	}
	return assets, nil
}

//nolint:gocyclo // Provider capability combinations are normalized at this API snapshot boundary.
func (h *PublicationBuildHandler) publicationBuildOutputProfiles(
	ctx context.Context,
	account models.SocialAccount,
	preferred string,
) []publicationbuilder.OutputProfile {
	profiles := make([]publicationbuilder.OutputProfile, 0)
	seen := map[string]struct{}{}
	accountConstraints := map[string]any(nil)
	for _, capability := range capabilities.All() {
		if capability.Provider != account.Platform || !capability.OpenPostQueued || capability.UnavailableReason != "" {
			continue
		}
		if _, exists := seen[capability.OutputProfile]; exists || capability.OutputProfile == "" {
			continue
		}
		seen[capability.OutputProfile] = struct{}{}
		maxSegments := 1
		if capability.Profile == models.ContentProfileThread {
			maxSegments = maxPublicationBuildThreadSegments
		}
		resolved := capabilities.ResolvedCapability{Capability: capability}
		if h.capabilityResolver != nil {
			if accountConstraints == nil {
				accountConstraints = h.capabilityResolver.publicationBuildAccountConstraints(ctx, account, capability.OutputProfile)
			}
			capabilities.ApplyAccountConstraints(&resolved, nil, accountConstraints)
		} else if account.Platform == capabilities.ProviderX {
			accountCapabilities := standardXPublishingCapabilities()
			if accountLimitProfile(account) == "x-premium" {
				accountCapabilities = platform.XPublishingCapabilities(platform.XSubscriptionTypePremium)
			}
			capabilities.ApplyAccountConstraints(&resolved, nil, accountCapabilities.Constraints)
		}
		profiles = append(profiles, publicationbuilder.OutputProfile{
			Key: capability.OutputProfile, TextLimit: resolved.TextLimit, MaxSegments: maxSegments,
			MediaMaxCount: resolved.Media.MaxCount, AllowedMIMEs: slices.Clone(resolved.Media.AllowedMIMEs),
		})
	}
	preferred = strings.TrimSpace(preferred)
	if preferred == "" {
		return profiles
	}
	preferredIndex := -1
	for index, profile := range profiles {
		if profile.Key == preferred {
			preferredIndex = index
			break
		}
	}
	if preferredIndex < 0 {
		return nil
	}
	profiles[0], profiles[preferredIndex] = profiles[preferredIndex], profiles[0]
	return profiles
}

func publicationBuildVoiceSnapshot(profile voiceprofiles.Profile) publicationbuilder.VoiceSnapshot {
	definition := profile.Definition
	guidance := make([]string, 0, 12)
	appendVoiceList := func(label string, values []string) {
		if len(values) > 0 {
			guidance = append(guidance, label+": "+strings.Join(values, "; "))
		}
	}
	appendVoiceList("Traits", definition.Traits)
	appendVoiceList("Vocabulary", definition.Vocabulary)
	appendVoiceList("Recurring expressions", definition.RecurringExpressions)
	appendVoiceList("Expertise", definition.Expertise)
	appendVoiceList("Established opinions", definition.Opinions)
	if definition.Humor != "" {
		guidance = append(guidance, "Humor: "+definition.Humor)
	}
	if definition.Formality != "" {
		guidance = append(guidance, "Formality: "+definition.Formality)
	}
	appendVoiceList("Boundaries", definition.Boundaries)
	appendVoiceList("Patterns to avoid", definition.DislikedPatterns)
	for _, correction := range definition.Corrections {
		line := fmt.Sprintf("Prefer %q instead of %q", correction.Preferred, correction.Original)
		if correction.Lesson != "" {
			line += ": " + correction.Lesson
		}
		guidance = append(guidance, line)
	}
	for _, answer := range definition.InterviewAnswers {
		guidance = append(guidance, "Interview answer to "+answer.Question+": "+answer.Answer)
	}
	examples := make([]publicationbuilder.VoiceExample, 0, len(definition.Examples))
	for _, example := range definition.Examples {
		examples = append(examples, publicationbuilder.VoiceExample{
			Platform: example.Platform,
			Body:     example.Text,
		})
	}
	avoidances := append([]string(nil), definition.ForbiddenPhrases...)
	avoidances = append(avoidances, definition.DislikedPatterns...)
	return publicationbuilder.VoiceSnapshot{
		ID: profile.ID, Name: profile.Name, Revision: profile.Revision,
		Definition: publicationbuilder.VoiceDefinition{
			Identity: definition.IdentitySummary, Guidance: strings.Join(guidance, "\n"), Language: definition.PreferredLanguage,
			Avoidances: avoidances, Examples: examples,
		},
	}
}

func publicationBuildAccountLabel(account models.SocialAccount) string {
	for _, value := range []string{account.AccountUsername, account.Slug, account.Platform} {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return account.ID
}

func normalizePublicationBuildDirection(
	input publicationbuilder.DirectionInput,
) (publicationbuilder.DirectionInput, error) {
	fields := []struct {
		value *string
		max   int
		name  string
	}{
		{&input.Outcome, maxPublicationBuildOutcome, "direction.outcome"},
		{&input.Audience, maxPublicationBuildAudience, "direction.audience"},
		{&input.Angle, maxPublicationBuildAngle, "direction.angle"},
		{&input.ToneAdjustment, maxPublicationBuildTone, "direction.tone_adjustment"},
		{&input.MediaPreference, maxPublicationBuildMediaPreference, "direction.media_preference"},
	}
	for _, field := range fields {
		value, err := boundedBuildText(*field.value, field.max, false, field.name)
		if err != nil {
			return publicationbuilder.DirectionInput{}, err
		}
		*field.value = value
	}
	return input, nil
}

func normalizePublicationBuildURLs(values []string) ([]string, error) {
	if len(values) > maxPublicationBuildReferences {
		return nil, huma.Error400BadRequest("A publication build can use at most 10 public URLs")
	}
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || utf8.RuneCountInString(value) > maxPublicationBuildURLCharacters || containsControl(value, false) {
			return nil, huma.Error400BadRequest("Every context URL must be a safe absolute HTTP or HTTPS URL")
		}
		remote, err := url.Parse(value)
		if err != nil || !remote.IsAbs() || remote.Opaque != "" || remote.Hostname() == "" || remote.User != nil {
			return nil, huma.Error400BadRequest("Every context URL must be a safe absolute HTTP or HTTPS URL")
		}
		remote.Scheme = strings.ToLower(remote.Scheme)
		if remote.Scheme != "http" && remote.Scheme != "https" {
			return nil, huma.Error400BadRequest("Context URLs must use HTTP or HTTPS")
		}
		remote.Fragment = ""
		normalized := remote.String()
		if _, duplicate := seen[normalized]; duplicate {
			return nil, huma.Error400BadRequest("A context URL can appear only once")
		}
		seen[normalized] = struct{}{}
		result = append(result, normalized)
	}
	return result, nil
}

func normalizePublicationBuildIDs(values []string, field string, maximum int) ([]string, error) {
	if len(values) > maximum {
		return nil, huma.Error400BadRequest(fmt.Sprintf("%s may contain at most %d IDs", field, maximum))
	}
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		normalized, err := boundedBuildID(value, field)
		if err != nil {
			return nil, err
		}
		if _, duplicate := seen[normalized]; duplicate {
			return nil, huma.Error400BadRequest(field + " must contain unique IDs")
		}
		seen[normalized] = struct{}{}
		result = append(result, normalized)
	}
	return result, nil
}

func boundedBuildID(value, field string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || utf8.RuneCountInString(value) > maxPublicationBuildIDCharacters || containsControl(value, false) {
		return "", huma.Error400BadRequest(field + " is required and must be a safe identifier")
	}
	return value, nil
}

func boundedBuildText(value string, maximum int, multiline bool, field string) (string, error) {
	if !utf8.ValidString(value) {
		return "", huma.Error400BadRequest(field + " must use valid UTF-8")
	}
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) > maximum || containsControl(value, multiline) {
		return "", huma.Error400BadRequest(fmt.Sprintf("%s exceeds its safe text limit", field))
	}
	return value, nil
}

func containsControl(value string, multiline bool) bool {
	for _, character := range value {
		if multiline && (character == '\n' || character == '\t') {
			continue
		}
		if unicode.IsControl(character) {
			return true
		}
	}
	return false
}

func publicationBuildVoiceError(err error) error {
	switch {
	case errors.Is(err, voiceprofiles.ErrInvalidInput):
		return huma.Error400BadRequest("Voice Profile selection is invalid")
	case errors.Is(err, voiceprofiles.ErrNotFound):
		return huma.Error400BadRequest("Voice Profile is unavailable in this Workspace")
	default:
		return huma.Error503ServiceUnavailable("Effective Voice Profiles could not be resolved")
	}
}

func publicationBuildError(err error) error {
	switch {
	case errors.Is(err, publicationbuilder.ErrBuildNotFound):
		return huma.Error404NotFound("Publication build not found")
	case errors.Is(err, publicationbuilder.ErrIdempotencyConflict):
		return huma.Error409Conflict("Idempotency-Key was already used for a different build request")
	case errors.Is(err, publicationbuilder.ErrBuildNotRetryable):
		return huma.Error409Conflict("Only failed publication builds can be retried")
	case errors.Is(err, publicationbuilder.ErrTooManyActiveBuilds):
		return huma.Error429TooManyRequests("Finish or cancel an active publication build before starting another")
	case errors.Is(err, publicationbuilder.ErrBuildNotReady):
		return huma.Error409Conflict("Only ready publication builds can be sent to the composer")
	case errors.Is(err, publicationbuilder.ErrBuildSourceUnavailable):
		return huma.Error409Conflict("A selected source is no longer available. Restore it or rebuild the post")
	default:
		return huma.Error503ServiceUnavailable("Publication Builder could not complete this request")
	}
}
