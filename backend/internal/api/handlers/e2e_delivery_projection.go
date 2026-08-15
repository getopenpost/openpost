//go:build dev

package handlers

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/lifecycle"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/uptrace/bun"
)

// E2EDeliveryProjectionHandler is registered only when the dedicated app E2E
// flag is enabled. It lets browser tests persist normalized provider outcomes
// through an authenticated, Workspace-scoped boundary without intercepting
// OpenPost reads or writes in the browser.
type E2EDeliveryProjectionHandler struct {
	db   *bun.DB
	auth middleware.Authenticator
}

func NewE2EDeliveryProjectionHandler(db *bun.DB, auth middleware.Authenticator) *E2EDeliveryProjectionHandler {
	return &E2EDeliveryProjectionHandler{db: db, auth: auth}
}

func (h *E2EDeliveryProjectionHandler) RegisterRoutes(e *echo.Echo) {
	e.POST(
		"/api/v1/e2e/publications/:id/delivery",
		h.project,
		middleware.BearerMiddleware(h.auth),
	)
}

type e2eDeliveryProjectionInput struct {
	State         string `json:"state"`
	AttemptNumber int    `json:"attempt_number"`
}

type e2eDeliveryProjectionShape struct {
	publicationStatus string
	renditionStatus   string
	attemptStatus     string
	submissionState   string
	providerState     string
	providerReference string
	retrySafety       string
	errorKind         string
	errorCode         string
	errorHTTPStatus   int
	errorRetryable    bool
	errorAction       string
	eventType         string
	eventStatus       string
}

func (h *E2EDeliveryProjectionHandler) project(c echo.Context) error {
	var input e2eDeliveryProjectionInput
	if err := c.Bind(&input); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid delivery projection"})
	}
	input.State = strings.TrimSpace(input.State)
	shape, ok := e2eDeliveryShape(input.State)
	if !ok || input.AttemptNumber < 1 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "unsupported delivery projection"})
	}

	ctx := c.Request().Context()
	publication, rendition, authorization, status, message := h.loadProjectionScope(
		ctx,
		c.Param("id"),
		middleware.GetUserID(ctx),
	)
	if status != 0 {
		return c.JSON(status, map[string]string{"error": message})
	}

	now := time.Now().UTC().Add(time.Duration(input.AttemptNumber) * time.Second)
	attemptID := "e2e-" + uuid.NewString()
	attempt := &models.ProviderWriteAttempt{
		ID: attemptID, OperationID: "e2e-projection-" + uuid.NewString(),
		AttemptNumber: input.AttemptNumber, AuthorizationID: authorization.ID,
		WorkspaceID: publication.WorkspaceID, PublicationID: publication.ID,
		RenditionID: rendition.ID, SocialAccountID: rendition.SocialAccountID,
		TargetKey: rendition.TargetKey, Provider: rendition.Platform, Operation: "publish",
		PayloadFingerprint: "sha256:e2e-delivery-projection", Status: shape.attemptStatus,
		SubmissionState: shape.submissionState, ProviderState: shape.providerState,
		ProviderReference: shape.providerReference, RetrySafety: shape.retrySafety,
		SafeErrorClass: shape.errorKind, SafeErrorCode: shape.errorCode,
		ErrorHTTPStatus: shape.errorHTTPStatus, CreatedAt: now, UpdatedAt: now,
	}
	if input.State == providerwrite.DeliveryProcessing || input.State == providerwrite.DeliveryAmbiguous {
		attempt.ReconcileAfter = now.Add(time.Minute)
	}
	delivery := &models.ProviderDelivery{
		ID:                      uuid.NewString(),
		WorkspaceID:             publication.WorkspaceID,
		PublicationID:           publication.ID,
		RenditionID:             rendition.ID,
		SocialAccountID:         rendition.SocialAccountID,
		TargetKey:               rendition.TargetKey,
		Provider:                rendition.Platform,
		State:                   input.State,
		CurrentAttemptID:        attemptID,
		CurrentAttemptNumber:    input.AttemptNumber,
		CurrentAttemptCreatedAt: now,
		RetrySafety:             shape.retrySafety,
		SafeErrorClass:          shape.errorKind,
		SafeErrorCode:           shape.errorCode,
		ErrorHTTPStatus:         shape.errorHTTPStatus,
		CreatedAt:               now,
		UpdatedAt:               now,
	}
	if input.State == providerwrite.DeliveryProcessing || input.State == providerwrite.DeliveryAmbiguous {
		delivery.NextReconciliationAt = now.Add(time.Minute)
	}

	return h.persistProjection(c, publication, rendition, attempt, delivery, shape, now)
}

func (h *E2EDeliveryProjectionHandler) loadProjectionScope(
	ctx context.Context,
	publicationID string,
	userID string,
) (*models.Publication, *models.Rendition, *models.PublicationAuthorization, int, string) {
	publication := new(models.Publication)
	if err := h.db.NewSelect().Model(publication).Where("id = ?", publicationID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil, nil, http.StatusNotFound, "publication not found"
		}
		return nil, nil, nil, http.StatusInternalServerError, "failed to load publication"
	}
	allowed, err := middleware.CheckWorkspaceEditAccess(ctx, h.db, publication.WorkspaceID, userID)
	if err != nil {
		return nil, nil, nil, http.StatusInternalServerError, "failed to check workspace access"
	}
	if !allowed {
		return nil, nil, nil, http.StatusForbidden, "workspace edit access denied"
	}

	rendition := new(models.Rendition)
	if err := h.db.NewSelect().Model(rendition).
		Where("publication_id = ?", publication.ID).
		Order("created_at ASC", "id ASC").
		Limit(1).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil, nil, http.StatusConflict, "publication has no rendition"
		}
		return nil, nil, nil, http.StatusInternalServerError, "failed to load rendition"
	}
	authorization := new(models.PublicationAuthorization)
	if err := h.db.NewSelect().Model(authorization).
		Where("publication_id = ? AND rendition_id = ? AND social_account_id = ? AND target_key = ?", publication.ID, rendition.ID, rendition.SocialAccountID, rendition.TargetKey).
		Order("created_at DESC", "id DESC").
		Limit(1).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil, nil, http.StatusConflict, "publication has no delivery authorization"
		}
		return nil, nil, nil, http.StatusInternalServerError, "failed to load delivery authorization"
	}
	return publication, rendition, authorization, 0, ""
}

func (h *E2EDeliveryProjectionHandler) persistProjection(
	c echo.Context,
	publication *models.Publication,
	rendition *models.Rendition,
	attempt *models.ProviderWriteAttempt,
	delivery *models.ProviderDelivery,
	shape e2eDeliveryProjectionShape,
	now time.Time,
) error {
	ctx := c.Request().Context()
	err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewUpdate().Model((*models.ProviderWriteAttempt)(nil)).
			Set("status = ?", providerwrite.StatusDefiniteFailure).
			Set("submission_state = ?", "rejected").
			Set("retry_safety = ?", "safe").
			Set("completed_at = ?", now).
			Set("updated_at = ?", now).
			Where("publication_id = ?", publication.ID).
			Where("operation_id LIKE ?", "e2e-projection-%").
			Where("status IN (?)", bun.List([]string{providerwrite.StatusPrepared, providerwrite.StatusSending})).
			Exec(txCtx); err != nil {
			return err
		}
		if _, err := tx.NewInsert().Model(attempt).Exec(txCtx); err != nil {
			return err
		}
		if _, err := tx.NewDelete().Model((*models.ProviderDelivery)(nil)).
			Where("rendition_id = ? AND target_key = ?", rendition.ID, rendition.TargetKey).
			Exec(txCtx); err != nil {
			return err
		}
		if _, err := tx.NewInsert().Model(delivery).Exec(txCtx); err != nil {
			return err
		}
		if _, err := tx.NewUpdate().Model((*models.Rendition)(nil)).
			Set("status = ?", shape.renditionStatus).
			Set("error_kind = ?", shape.errorKind).
			Set("error_code = ?", shape.errorCode).
			Set("error_http_status = ?", shape.errorHTTPStatus).
			Set("error_retryable = ?", shape.errorRetryable).
			Set("error_action = ?", shape.errorAction).
			Set("updated_at = ?", now).
			Where("id = ?", rendition.ID).
			Exec(txCtx); err != nil {
			return err
		}
		if _, err := tx.NewUpdate().Model((*models.Publication)(nil)).
			Set("status = ?", shape.publicationStatus).
			Set("updated_at = ?", now).
			Where("id = ?", publication.ID).
			Exec(txCtx); err != nil {
			return err
		}
		event := &models.PublicationLifecycleEvent{
			ID: uuid.NewString(), WorkspaceID: publication.WorkspaceID,
			PublicationID: publication.ID, RenditionID: rendition.ID,
			Type: shape.eventType, Status: shape.eventStatus,
			Message:      "E2E provider boundary projected " + delivery.State,
			MetadataJSON: "{}", IdempotencyKey: "e2e-delivery:" + publication.ID + ":" + delivery.State,
			CreatedAt: now,
		}
		_, err := tx.NewInsert().Model(event).Exec(txCtx)
		return err
	})
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to persist delivery projection"})
	}
	return c.JSON(http.StatusOK, map[string]any{"state": delivery.State, "attempt_number": delivery.CurrentAttemptNumber})
}

func e2eDeliveryShape(state string) (e2eDeliveryProjectionShape, bool) {
	started := e2eDeliveryProjectionShape{
		publicationStatus: models.PublicationStatusScheduled,
		renditionStatus:   models.RenditionStatusScheduled,
		attemptStatus:     providerwrite.StatusPrepared,
		submissionState:   "not_sent",
		retrySafety:       "never",
		eventType:         lifecycle.EventProviderProcessing,
		eventStatus:       lifecycle.StatusStarted,
	}
	switch state {
	case providerwrite.DeliveryQueued:
		return started, true
	case providerwrite.DeliverySubmitted:
		started.renditionStatus = models.RenditionStatusPublishing
		started.attemptStatus = providerwrite.StatusSending
		started.submissionState = "unknown"
		return started, true
	case providerwrite.DeliveryProcessing:
		started.renditionStatus = models.RenditionStatusPublishing
		started.attemptStatus = providerwrite.StatusSending
		started.submissionState = "pending"
		started.retrySafety = "reconcile_only"
		return started, true
	case providerwrite.DeliveryProviderScheduled:
		started.attemptStatus = providerwrite.StatusAccepted
		started.submissionState = "accepted"
		started.providerState = "scheduled"
		return started, true
	case providerwrite.DeliveryLive:
		started.publicationStatus = models.PublicationStatusPublished
		started.renditionStatus = models.RenditionStatusPublished
		started.attemptStatus = providerwrite.StatusAccepted
		started.submissionState = "accepted"
		started.eventType = lifecycle.EventPublished
		started.eventStatus = lifecycle.StatusSucceeded
		return started, true
	case providerwrite.DeliveryRejected:
		return e2eDeliveryProjectionShape{
			publicationStatus: models.PublicationStatusFailed,
			renditionStatus:   models.RenditionStatusFailed,
			attemptStatus:     providerwrite.StatusDefiniteFailure,
			submissionState:   "rejected",
			retrySafety:       "safe", errorKind: "provider_rejected", errorCode: "rate_limited",
			errorHTTPStatus: http.StatusTooManyRequests, errorRetryable: true, errorAction: "retry",
			eventType: lifecycle.EventFailed, eventStatus: lifecycle.StatusFailed,
		}, true
	case providerwrite.DeliveryAmbiguous:
		return e2eDeliveryProjectionShape{
			publicationStatus: models.PublicationStatusFailed,
			renditionStatus:   models.RenditionStatusFailed,
			attemptStatus:     providerwrite.StatusAmbiguous,
			submissionState:   "unknown",
			providerReference: "e2e-provider-reference",
			retrySafety:       "reconcile_only", errorKind: "provider_ambiguous", errorCode: "outcome_unknown",
			eventType: lifecycle.EventFailed, eventStatus: lifecycle.StatusFailed,
		}, true
	case providerwrite.DeliveryManualResolution:
		return e2eDeliveryProjectionShape{
			publicationStatus: models.PublicationStatusFailed,
			renditionStatus:   models.RenditionStatusFailed,
			attemptStatus:     providerwrite.StatusAmbiguous,
			submissionState:   "unknown",
			retrySafety:       "never", errorKind: "provider_ambiguous", errorCode: "manual_resolution",
			errorAction: "open_provider", eventType: lifecycle.EventFailed, eventStatus: lifecycle.StatusFailed,
		}, true
	default:
		return e2eDeliveryProjectionShape{}, false
	}
}
