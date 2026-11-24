package handlers

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/connectors"
	"github.com/openpost/backend/internal/idempotency"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/drafts"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/publicationcards"
	publicationservice "github.com/openpost/backend/internal/services/publications"
	"github.com/openpost/backend/internal/services/publicurl"
	repostservice "github.com/openpost/backend/internal/services/reposts"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/openpost/backend/internal/telemetry"
	"github.com/uptrace/bun"
)

const (
	publicationsPath      = "/publications"
	publicationPathByID   = "/publications/{id}"
	publicationPathValid  = "/publications/{id}/validate"
	publicationEventsPath = "/publications/{id}/events"
)

var (
	errPublicationScheduleConflict  = errors.New("scheduled_at and clear_schedule cannot be used together")
	errPublicationScheduleFuture    = errors.New("scheduled_at must be in the future")
	errPublicationNotEditable       = errors.New("publication is no longer editable")
	errPublicationNotFound          = errors.New("publication not found")
	errPublicationAlreadyProcessing = errors.New("publication is already being processed")
	errPublicationValidationBlocked = errors.New("publication has blocking validation errors")
	errPublicationScheduleRequired  = errors.New("scheduled_at is required before scheduling")
	errPublicationNotScheduled      = errors.New("publication is not scheduled")
)

type PublicationHandler struct {
	notifications *notifications.Service
	db            *bun.DB
	auth          middleware.Authenticator
	entitlement   entitlements.Service
	usage         *usage.Service
	providers     map[string]platform.Adapter
	providersMu   sync.RWMutex
	tokenSource   AccessTokenSource
	publicMedia   *publicurl.MediaVerifier
	reposts       *repostservice.Service
	readiness     *providerreadiness.Service
	connectors    *connectors.Registry
	telemetry     telemetry.Recorder
	textCards     *publicationcards.Service
	// beforeQueueTransaction is a deterministic concurrency seam for tests.
	// Production constructors leave it nil.
	beforeQueueTransaction func(context.Context) error
}

func (h *PublicationHandler) SetCapabilityDependencies(providers map[string]platform.Adapter, tokenSource AccessTokenSource) {
	h.providersMu.Lock()
	defer h.providersMu.Unlock()
	h.providers = cloneProviderAdapters(providers)
	h.tokenSource = tokenSource
}

func (h *PublicationHandler) SetProvider(name string, adapter platform.Adapter) {
	h.providersMu.Lock()
	defer h.providersMu.Unlock()
	if h.providers == nil {
		h.providers = map[string]platform.Adapter{}
	}
	h.providers[name] = adapter
}

func (h *PublicationHandler) SetConnectorRegistry(registry *connectors.Registry) {
	h.connectors = registry
}

func (h *PublicationHandler) SetPublicMediaVerifier(verifier *publicurl.MediaVerifier) {
	h.publicMedia = verifier
}

func (h *PublicationHandler) SetRepostService(service *repostservice.Service) {
	h.reposts = service
}

func (h *PublicationHandler) SetProviderReadiness(service *providerreadiness.Service) {
	h.readiness = service
}

func (h *PublicationHandler) SetTelemetry(recorder telemetry.Recorder) {
	h.telemetry = recorder
}

func NewPublicationHandler(db *bun.DB, authenticator middleware.Authenticator, entitlement entitlements.Service) *PublicationHandler {
	if entitlement == nil {
		entitlement = entitlements.NewSelfHostedService()
	}
	return &PublicationHandler{db: db, auth: authenticator, entitlement: entitlement, usage: usage.NewService(db)}
}

func (h *PublicationHandler) SetUsage(service *usage.Service) {
	if service != nil {
		h.usage = service
	}
}

type PublicationMediaInput = publicationservice.PublicationMediaInput

type PublicationSegmentInput = publicationservice.PublicationSegmentInput

type RenditionSegmentInput = publicationservice.RenditionSegmentInput

type RenditionInput = publicationservice.RenditionInput

type CreatePublicationBody = publicationservice.CreatePublicationBody

type CreatePublicationInput struct {
	IdempotencyKey string `header:"Idempotency-Key" maxLength:"200" doc:"Replay key scoped to the caller, Workspace, and operation"`
	Body           CreatePublicationBody
}

type PublicationUpdateBody = publicationservice.PublicationUpdateBody

type UpdatePublicationInput struct {
	IdempotencyKey string `header:"Idempotency-Key" maxLength:"200" doc:"Replay key scoped to the caller, Workspace, and operation"`
	PathID         string `path:"id" doc:"Publication ID"`
	Body           PublicationUpdateBody
}

type FailureDismissalInput struct {
	PathID string `path:"id" doc:"Publication ID"`
}

type FailureDismissalOutput struct {
	Body struct {
		ID          string `json:"id"`
		DismissedAt string `json:"dismissed_at,omitempty"`
	}
}

type UpsertRenditionsInput struct {
	IdempotencyKey string `header:"Idempotency-Key" maxLength:"200" doc:"Replay key scoped to the caller, Workspace, and operation"`
	PathID         string `path:"id" doc:"Publication ID"`
	Body           struct {
		ExpectedRevision int              `json:"expected_revision" minimum:"1" doc:"Revision loaded by the editor"`
		Renditions       []RenditionInput `json:"renditions" doc:"Renditions to replace or upsert"`
	}
}

type ListPublicationsInput = publicationservice.ListPublicationsInput

type GetPublicationInput struct {
	PathID string `path:"id" doc:"Publication ID"`
}

type DeletePublicationInput struct {
	PathID           string `path:"id" doc:"Publication ID"`
	Confirm          bool   `query:"confirm" doc:"Explicit confirmation that the publication may be permanently deleted"`
	ExpectedRevision int    `query:"expected_revision" minimum:"1" doc:"Revision loaded by the editor"`
}

type ListPublicationEventsInput struct {
	PathID string `path:"id" doc:"Publication ID"`
	Limit  int    `query:"limit" doc:"Limit, default 100"`
	Cursor string `query:"cursor" doc:"Opaque cursor for older lifecycle entries"`
}

type PublicationActionInput struct {
	PathID string `path:"id" doc:"Publication ID"`
}

type RetryRenditionInput struct {
	PathID    string `path:"id" doc:"Publication ID"`
	AccountID string `path:"account_id" doc:"Connected account ID"`
	TargetKey string `query:"target_key" doc:"Exact provider subdestination key; required when the account has multiple targets"`
}

type RetryFailedRenditionsInput struct {
	IdempotencyKey string `header:"Idempotency-Key" maxLength:"200" doc:"Replay key scoped to the caller, Workspace, and operation"`
	PathID         string `path:"id" doc:"Publication ID"`
}

type PublicationMutationActionInput struct {
	IdempotencyKey string `header:"Idempotency-Key" maxLength:"200" doc:"Replay key scoped to the caller, Workspace, and operation"`
	PathID         string `path:"id" doc:"Publication ID"`
	Body           struct {
		ExpectedRevision int    `json:"expected_revision" minimum:"1" doc:"Revision saved immediately before this action"`
		ExecutionIntent  string `json:"execution_intent,omitempty" enum:"production,certification_test" doc:"Typed readiness intent; certification_test requires an unscoped instance administrator"`
	}
}

type DeletePublicationRenditionInput struct {
	PathID           string `path:"id" doc:"Publication ID"`
	AccountID        string `path:"account_id" doc:"Connected account ID"`
	TargetKey        string `query:"target_key" doc:"Exact provider subdestination key; required when the account has multiple targets"`
	Confirm          bool   `query:"confirm" doc:"Explicit confirmation that saved destination settings may be deleted"`
	ExpectedRevision int    `query:"expected_revision" minimum:"1" doc:"Revision loaded by the editor"`
}

type ReplyInput struct {
	PathID string `path:"id" doc:"Rendition ID"`
	Body   struct {
		Body     string                  `json:"body" doc:"Reply body"`
		Settings map[string]interface{}  `json:"settings,omitempty" doc:"Provider-specific reply settings"`
		Media    []PublicationMediaInput `json:"media,omitempty" doc:"Reply media"`
		ParentID string                  `json:"parent_id,omitempty" doc:"External comment or post ID to reply to"`
		RunAt    *time.Time              `json:"run_at,omitempty" doc:"Optional scheduled reply time"`
	}
}

type PublicationOutput struct {
	Body PublicationResponse
}

type PublicationListOutput struct {
	TotalCount int    `header:"X-Total-Count"`
	Limit      int    `header:"X-Limit"`
	Offset     int    `header:"X-Offset"`
	NextOffset int    `header:"X-Next-Offset"`
	NextCursor string `header:"X-Next-Cursor"`
	HasMore    bool   `header:"X-Has-More"`
	Body       []PublicationResponse
}

type PublicationValidationOutput struct {
	Body struct {
		Valid  bool                           `json:"valid"`
		Issues []capabilities.ValidationIssue `json:"issues"`
	}
}

type PublicationEventsOutput struct {
	NextCursor string `header:"X-Next-Cursor"`
	HasMore    bool   `header:"X-Has-More"`
	Body       []PublicationLifecycleEventResponse
}

type ActionOutput struct {
	Body struct {
		Message                 string                   `json:"message"`
		JobID                   string                   `json:"job_id,omitempty"`
		Revision                int                      `json:"revision,omitempty"`
		PublicationID           string                   `json:"publication_id,omitempty"`
		Renditions              []RenditionActionOutcome `json:"renditions,omitempty" doc:"Exact destination outcomes after this action"`
		WorkspaceActivated      bool                     `json:"workspace_activated,omitempty"`
		ActivationPublicationID string                   `json:"activation_publication_id,omitempty"`
	}
}

type PublicationResponse = publicationservice.PublicationResponse

type PublicationSegmentResponse = publicationservice.PublicationSegmentResponse

type RenditionResponse = publicationservice.RenditionResponse

type RenditionAccountIdentity = publicationservice.RenditionAccountIdentity

type ProviderDeliveryResponse = publicationservice.ProviderDeliveryResponse

type RenditionActionOutcome = publicationservice.RenditionActionOutcome

type RenditionSegmentResponse = publicationservice.RenditionSegmentResponse

type MediaSummary = publicationservice.MediaSummary

type PublicationLifecycleEventResponse = publicationservice.PublicationLifecycleEventResponse

type PublicationLifecycleDestination = publicationservice.PublicationLifecycleDestination

type PublicationLifecycleActor = publicationservice.PublicationLifecycleActor

type PublicationLifecycleError = publicationservice.PublicationLifecycleError

func (h *PublicationHandler) RegisterRoutes(api huma.API) {
	h.registerPublicationReviews(api)
	h.registerBatchScheduling(api)
	h.previewTextCard(api)
	h.createPublication(api)
	h.listPublications(api)
	h.getPublication(api)
	h.listPublicationEvents(api)
	h.updatePublication(api)
	h.deletePublication(api)
	h.upsertRenditions(api)
	h.deleteRendition(api)
	h.validatePublication(api)
	h.schedulePublication(api)
	h.cancelPublication(api)
	h.publishNow(api)
	h.retryFailedRenditions(api)
	h.retryRendition(api)
	h.failureDismissal(api)
	h.replyToRendition(api)
}

//nolint:gocyclo
func (h *PublicationHandler) createPublication(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "create-publication",
		Method:      http.MethodPost,
		Path:        publicationsPath,
		Summary:     "Create a publication",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403},
	}, func(ctx context.Context, input *CreatePublicationInput) (*PublicationOutput, error) {
		if input.Body.ScheduledAt != nil {
			if err := requireExternalDelegatedScope(ctx, "publications:schedule"); err != nil {
				return nil, err
			}
		}
		userID := middleware.GetUserID(ctx)
		if strings.TrimSpace(input.IdempotencyKey) == "" {
			publication, err := h.publicationApplication().Create(ctx, userID, input.Body)
			if err != nil {
				return nil, publicationMutationHTTPError(err, "failed to create publication")
			}
			return &PublicationOutput{Body: publication}, nil
		}

		request, err := mutationIdempotencyRequest(ctx, input.Body.WorkspaceID, "create-publication", input.IdempotencyKey)
		if err != nil {
			return nil, err
		}
		publication, _, err := h.publicationApplication().CreateIdempotent(ctx, userID, input.Body, request)
		if err != nil {
			return nil, publicationMutationHTTPError(err, "failed to create publication")
		}

		return &PublicationOutput{Body: publication}, nil
	})
}

func mutationIdempotencyRequest(
	ctx context.Context,
	workspaceID string,
	operationID string,
	key string,
) (idempotency.Request, error) {
	principalID := strings.TrimSpace(middleware.GetTokenID(ctx))
	if principalID != "" {
		principalID = "token:" + principalID
	} else if sessionID := strings.TrimSpace(middleware.GetSessionID(ctx)); sessionID != "" {
		principalID = "session:" + sessionID
	} else if userID := strings.TrimSpace(middleware.GetUserID(ctx)); userID != "" {
		principalID = "user:" + userID
	}
	if principalID == "" {
		return idempotency.Request{}, huma.Error401Unauthorized("authenticated principal is required")
	}
	return idempotency.Request{
		PrincipalID: principalID,
		WorkspaceID: workspaceID,
		OperationID: operationID,
		Key:         key,
		HTTPStatus:  http.StatusOK,
		ExpiresAt:   time.Now().UTC().Add(24 * time.Hour),
	}, nil
}

func (h *PublicationHandler) listPublications(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-publications",
		Method:      http.MethodGet,
		Path:        publicationsPath,
		Summary:     "List publications",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *ListPublicationsInput) (*PublicationListOutput, error) {
		userID := middleware.GetUserID(ctx)
		page, err := h.publicationApplication().List(ctx, userID, *input)
		if err != nil {
			return nil, err
		}
		for index := range page.Publications {
			if err := h.filterExternalPublicationRenditions(ctx, &page.Publications[index]); err != nil {
				return nil, err
			}
		}
		return &PublicationListOutput{
			TotalCount: page.TotalCount, Limit: page.Limit, Offset: page.Offset,
			NextOffset: page.NextOffset, NextCursor: page.NextCursor, HasMore: page.HasMore,
			Body: page.Publications,
		}, nil
	})
}

func (h *PublicationHandler) getPublication(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-publication",
		Method:      http.MethodGet,
		Path:        publicationPathByID,
		Summary:     "Get a publication",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{404},
	}, func(ctx context.Context, input *GetPublicationInput) (*PublicationOutput, error) {
		resp, err := h.publicationApplication().Get(ctx, middleware.GetUserID(ctx), input.PathID)
		if err != nil {
			return nil, err
		}
		if err := h.filterExternalPublicationRenditions(ctx, &resp); err != nil {
			return nil, err
		}
		return &PublicationOutput{Body: resp}, nil
	})
}

func (h *PublicationHandler) deletePublication(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "delete-publication",
		Method:      http.MethodDelete,
		Path:        publicationPathByID,
		Summary:     "Delete a publication",
		Description: "Permanently removes a publication and its destinations from OpenPost. Published posts remain on the social networks. Publications with active delivery cannot be removed.",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 409},
	}, func(ctx context.Context, input *DeletePublicationInput) (*ActionOutput, error) {
		if !input.Confirm {
			return nil, huma.Error400BadRequest("confirm=true is required to delete a publication")
		}
		if err := drafts.RequireExpectedRevision(input.ExpectedRevision); err != nil {
			return nil, err
		}
		err := h.publicationApplication().Delete(
			ctx, middleware.GetUserID(ctx), input.PathID, input.ExpectedRevision,
		)
		if err != nil {
			return nil, publicationMutationHTTPError(err, "failed to delete publication")
		}
		return actionMessage("publication deleted", ""), nil
	})
}

func (h *PublicationHandler) listPublicationEvents(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-publication-events",
		Method:      http.MethodGet,
		Path:        publicationEventsPath,
		Summary:     "List publication lifecycle events",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{404},
	}, func(ctx context.Context, input *ListPublicationEventsInput) (*PublicationEventsOutput, error) {
		if err := h.requireExternalPublicationAccounts(ctx, input.PathID); err != nil {
			return nil, err
		}
		page, err := h.publicationApplication().History(
			ctx, middleware.GetUserID(ctx), input.PathID, input.Limit, input.Cursor,
		)
		if err != nil {
			if errors.Is(err, errInvalidHistoryCursor) {
				return nil, huma.Error400BadRequest("invalid publication history cursor")
			}
			return nil, huma.Error500InternalServerError("failed to load publication events")
		}
		return &PublicationEventsOutput{Body: page.Events, NextCursor: page.NextCursor, HasMore: page.HasMore}, nil
	})
}

func (h *PublicationHandler) updatePublication(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "update-publication",
		Method:      http.MethodPut,
		Path:        publicationPathByID,
		Summary:     "Update a publication",
		Tags:        []string{tagPublications},
		Middlewares: huma.Middlewares{middleware.RequestMetadataMiddleware(), middleware.AuthMiddleware(api, h.auth)},
	}, func(ctx context.Context, input *UpdatePublicationInput) (*PublicationOutput, error) {
		if err := h.requireExternalPublicationAccounts(ctx, input.PathID); err != nil {
			return nil, err
		}
		if err := drafts.RequireExpectedRevision(input.Body.ExpectedRevision); err != nil {
			return nil, err
		}
		if input.Body.ScheduledAt != nil {
			if err := requireExternalDelegatedScope(ctx, "publications:schedule"); err != nil {
				return nil, err
			}
		}
		if input.Body.ClearSchedule {
			if err := requireExternalDelegatedScope(ctx, "publications:cancel"); err != nil {
				return nil, err
			}
		}
		userID := middleware.GetUserID(ctx)
		if strings.TrimSpace(input.IdempotencyKey) != "" {
			request, err := mutationIdempotencyRequest(ctx, "", "update-publication", input.IdempotencyKey)
			if err != nil {
				return nil, err
			}
			resp, _, err := h.publicationApplication().UpdateIdempotent(ctx, userID, input.PathID, input.Body, request)
			if err != nil {
				return nil, publicationMutationHTTPError(err, "failed to update publication")
			}
			return &PublicationOutput{Body: resp}, nil
		}
		if err := h.publicationApplication().Update(ctx, userID, input.PathID, input.Body); err != nil {
			return nil, publicationMutationHTTPError(err, "failed to update publication")
		}
		resp, err := h.loadPublicationResponse(ctx, input.PathID, userID)
		if err != nil {
			return nil, err
		}
		return &PublicationOutput{Body: resp}, nil
	})
}

func applyPublicationScheduleUpdate(
	publication *models.Publication,
	scheduledAtInput *time.Time,
	clearSchedule bool,
	now time.Time,
) (bool, bool, error) {
	if scheduledAtInput != nil && clearSchedule {
		return false, false, errPublicationScheduleConflict
	}
	if scheduledAtInput == nil && !clearSchedule {
		// Any edit increments the publication revision. A queued publication
		// therefore needs a new job and receipt even when its time is unchanged.
		return false, publication.Status == models.PublicationStatusScheduled, nil
	}

	wasScheduled := publication.Status == models.PublicationStatusScheduled
	if clearSchedule {
		publication.ScheduledAt = time.Time{}
		publication.ActualRunAt = time.Time{}
		publication.RandomDelayMinutes = 0
		if wasScheduled {
			publication.Status = models.PublicationStatusDraft
		}
		return true, false, nil
	}

	if err := validateFuturePublicationSchedule(*scheduledAtInput, now); err != nil {
		return false, false, err
	}
	publication.ScheduledAt = *scheduledAtInput
	return false, wasScheduled, nil
}

func applyPublicationFieldUpdates(publication *models.Publication, input PublicationUpdateBody) {
	if input.Title != nil {
		publication.Title = *input.Title
	}
	if input.Intent != nil {
		publication.Intent = *input.Intent
	}
	if input.CreationPreset != nil {
		publication.CreationPreset = *input.CreationPreset
		publication.Intent = *input.CreationPreset
	}
	if input.SocialSetID != nil {
		publication.SocialSetID = *input.SocialSetID
	}
	if input.ContentProfile != nil {
		publication.ContentProfile = *input.ContentProfile
	}
	if input.SourceText != nil {
		publication.SourceText = *input.SourceText
		publication.SourceContent = *input.SourceText
	}
	if input.SourceURL != nil {
		publication.SourceURL = *input.SourceURL
	}
	if input.Goal != nil {
		publication.Goal = *input.Goal
	}
	if input.Audience != nil {
		publication.Audience = *input.Audience
	}
	if input.RandomDelayMinutes != nil {
		publication.RandomDelayMinutes = *input.RandomDelayMinutes
		publication.RandomDelayExplicit = true
	} else if input.InheritRandomDelay {
		publication.RandomDelayMinutes = 0
		publication.RandomDelayExplicit = false
	}
	if input.Metadata != nil {
		publication.MetadataJSON = mustJSON(input.Metadata)
		publication.ReleasePlanJSON = publication.MetadataJSON
	}
	if input.RepostOverride != nil {
		publication.RepostOverride, _ = repostservice.EncodeOverride(*input.RepostOverride)
	}
}

func (h *PublicationHandler) publicationRevisionConflict(
	ctx context.Context,
	db bun.IDB,
	publication *models.Publication,
	expectedRevision int,
) error {
	domains, err := drafts.ChangedDomainsSince(
		ctx,
		db,
		drafts.AggregatePublication,
		publication.ID,
		expectedRevision,
	)
	if err != nil {
		return err
	}
	if len(domains) == 0 {
		domains = []string{"draft"}
	}
	editorName, err := drafts.LatestEditorName(ctx, db, drafts.AggregatePublication, publication.ID, expectedRevision)
	if err != nil {
		return err
	}
	return drafts.NewConflictError(drafts.ConflictMetadata{
		AggregateType:    drafts.AggregatePublication,
		AggregateID:      publication.ID,
		ExpectedRevision: expectedRevision,
		CurrentRevision:  publication.Revision,
		Status:           publication.Status,
		Title:            publication.Title,
		UpdatedAt:        formatOptionalTime(publication.UpdatedAt),
		ChangedByName:    editorName,
		ChangedDomains:   domains,
	})
}

func validateFuturePublicationSchedule(scheduledAt, now time.Time) error {
	if !scheduledAt.After(now.UTC()) {
		return errPublicationScheduleFuture
	}
	return nil
}

func (h *PublicationHandler) SetNotificationService(service *notifications.Service) {
	h.notifications = service
}
