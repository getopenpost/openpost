package handlers

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/uptrace/bun"
)

type ProviderReadinessAdminHandler struct {
	db        *bun.DB
	auth      middleware.Authenticator
	readiness *providerreadiness.Service
}

func NewProviderReadinessAdminHandler(
	db *bun.DB,
	auth middleware.Authenticator,
	readiness *providerreadiness.Service,
) *ProviderReadinessAdminHandler {
	return &ProviderReadinessAdminHandler{db: db, auth: auth, readiness: readiness}
}

type AppendProviderApprovalReviewInput struct {
	Body struct {
		Provider            string                                `json:"provider" required:"true"`
		AppFingerprint      string                                `json:"app_fingerprint" required:"true"`
		ProviderEnvironment providerreadiness.ProviderEnvironment `json:"provider_environment" enum:"development,sandbox,production"`
		InstanceFingerprint string                                `json:"instance_fingerprint,omitempty"`
		State               providerreadiness.ApprovalState       `json:"state" enum:"unknown,not_required,pending,trial,approved,restricted,revoked"`
		Tier                string                                `json:"tier" required:"true"`
		SourceURL           string                                `json:"source_url" format:"uri" required:"true"`
		ReviewedAt          time.Time                             `json:"reviewed_at" required:"true"`
		ExpiresAt           time.Time                             `json:"expires_at" required:"true"`
	}
}

type AppendProviderRuntimeControlInput struct {
	Body struct {
		Selector   providerreadiness.RuntimeControlSelector `json:"selector"`
		State      providerreadiness.RuntimeControlState    `json:"state" enum:"enabled,degraded,disabled"`
		ReasonCode string                                   `json:"reason_code" required:"true"`
		StartsAt   time.Time                                `json:"starts_at" required:"true"`
		ExpiresAt  time.Time                                `json:"expires_at,omitempty"`
	}
}

type AppendProviderCertificationInput struct {
	Body struct {
		ApprovalReviewID string                          `json:"approval_review_id" required:"true"`
		WorkspaceID      string                          `json:"workspace_id" required:"true"`
		SocialAccountID  string                          `json:"social_account_id" required:"true"`
		OutputProfile    string                          `json:"output_profile" required:"true"`
		Operation        providerreadiness.Operation     `json:"operation" enum:"publish_immediate,publish_scheduled"`
		PolicySettings   map[string]any                  `json:"policy_settings,omitempty"`
		PolicyMode       string                          `json:"policy_mode,omitempty" doc:"Optional asserted normalized policy mode; the server derives and verifies it"`
		Kind             providerreadiness.EvidenceKind  `json:"kind" enum:"local,live"`
		TestedAt         time.Time                       `json:"tested_at" required:"true"`
		ExpiresAt        time.Time                       `json:"expires_at" required:"true"`
		Checks           []providerreadiness.CheckResult `json:"checks" minItems:"1"`
	}
}

type ProviderReadinessLedgerAppendOutput struct {
	Body struct {
		ID string `json:"id"`
	}
}

func (h *ProviderReadinessAdminHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "append-provider-approval-review",
		Method:      http.MethodPost,
		Path:        "/admin/provider-readiness/approval-reviews",
		Summary:     "Append a provider approval review",
		Tags:        []string{tagProviderReadiness},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 401, 403, 409, 500},
	}, h.appendApprovalReview)

	huma.Register(api, huma.Operation{
		OperationID: "append-provider-runtime-control",
		Method:      http.MethodPost,
		Path:        "/admin/provider-readiness/runtime-controls",
		Summary:     "Append a provider runtime control",
		Tags:        []string{tagProviderReadiness},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 401, 403, 409, 500},
	}, h.appendRuntimeControl)

	huma.Register(api, huma.Operation{
		OperationID: "append-provider-certification",
		Method:      http.MethodPost,
		Path:        "/admin/provider-readiness/certifications",
		Summary:     "Append normalized provider certification evidence",
		Tags:        []string{tagProviderReadiness},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 401, 403, 409, 500},
	}, h.appendCertification)
}

func (h *ProviderReadinessAdminHandler) appendApprovalReview(
	ctx context.Context,
	input *AppendProviderApprovalReviewInput,
) (*ProviderReadinessLedgerAppendOutput, error) {
	if err := h.requireAdmin(ctx); err != nil {
		return nil, err
	}
	id := uuid.NewString()
	err := h.readiness.AppendApprovalReview(ctx, providerreadiness.ApprovalReview{
		ID: id, Provider: input.Body.Provider, AppFingerprint: input.Body.AppFingerprint,
		ProviderEnvironment: input.Body.ProviderEnvironment, InstanceFingerprint: input.Body.InstanceFingerprint,
		Evidence: providerreadiness.ApprovalEvidence{
			State: input.Body.State, Tier: input.Body.Tier, SourceURL: input.Body.SourceURL,
			ReviewedAt: input.Body.ReviewedAt, ExpiresAt: input.Body.ExpiresAt,
		},
		OperatorRef: operatorReference(middleware.GetUserID(ctx)), CreatedAt: time.Now().UTC(),
	})
	return providerReadinessAppendResult(id, err)
}

func (h *ProviderReadinessAdminHandler) appendRuntimeControl(
	ctx context.Context,
	input *AppendProviderRuntimeControlInput,
) (*ProviderReadinessLedgerAppendOutput, error) {
	if err := h.requireAdmin(ctx); err != nil {
		return nil, err
	}
	id := uuid.NewString()
	err := h.readiness.AppendRuntimeControl(ctx, providerreadiness.RuntimeControlEvent{
		ID: id, Selector: input.Body.Selector,
		Control: providerreadiness.RuntimeControl{
			State: input.Body.State, ReasonCode: input.Body.ReasonCode, ExpiresAt: input.Body.ExpiresAt,
		},
		StartsAt: input.Body.StartsAt, OperatorRef: operatorReference(middleware.GetUserID(ctx)), CreatedAt: time.Now().UTC(),
	})
	return providerReadinessAppendResult(id, err)
}

func (h *ProviderReadinessAdminHandler) appendCertification(
	ctx context.Context,
	input *AppendProviderCertificationInput,
) (*ProviderReadinessLedgerAppendOutput, error) {
	if err := h.requireAdmin(ctx); err != nil {
		return nil, err
	}
	var account models.SocialAccount
	err := h.db.NewSelect().Model(&account).
		Where("id = ?", input.Body.SocialAccountID).
		Where("workspace_id = ?", input.Body.WorkspaceID).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error400BadRequest("provider certification account does not exist in the requested workspace")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("provider certification account could not be loaded")
	}
	if !account.IsActive {
		return nil, huma.Error400BadRequest("provider certification account must be active")
	}
	resolved, err := h.readiness.ResolveCertificationContext(
		ctx, account, input.Body.OutputProfile, input.Body.Operation,
		input.Body.PolicySettings, input.Body.PolicyMode,
	)
	if err != nil {
		return nil, huma.Error400BadRequest("provider certification account context was rejected")
	}
	review, err := h.readiness.ApprovalReviewByID(ctx, input.Body.ApprovalReviewID)
	if errors.Is(err, providerreadiness.ErrLedgerFactNotFound) {
		return nil, huma.Error409Conflict("provider readiness evidence dependency does not exist")
	}
	if err != nil {
		return nil, huma.Error400BadRequest("provider readiness evidence was rejected")
	}
	contractDigest, err := resolved.Contract.Digest()
	if err != nil {
		return nil, huma.Error500InternalServerError("provider certification contract could not be derived")
	}
	id := uuid.NewString()
	err = h.readiness.AppendCertification(ctx, input.Body.ApprovalReviewID, providerreadiness.CertificationEvidence{
		ID: id, Kind: input.Body.Kind, Subject: resolved.Subject,
		AccountReferenceHash: resolved.AccountReferenceHash,
		TestedRevision:       h.readiness.CurrentRevision(), ContractDigest: contractDigest,
		TestedAt: input.Body.TestedAt, ExpiresAt: input.Body.ExpiresAt,
		ApprovalStateAtTest: review.Evidence.State, ApprovalTierAtTest: review.Evidence.Tier,
		RequiredScopes: resolved.Contract.Requirements.RequiredScopes,
		GrantedScopes:  resolved.Authorization.GrantedScopes,
		Checks:         input.Body.Checks, OperatorRef: operatorReference(middleware.GetUserID(ctx)),
	})
	return providerReadinessAppendResult(id, err)
}

func (h *ProviderReadinessAdminHandler) requireAdmin(ctx context.Context) error {
	if h == nil || h.readiness == nil {
		return huma.Error500InternalServerError("provider readiness service is unavailable")
	}
	return requireBrowserSessionInstanceAdmin(ctx, h.db)
}

func providerReadinessAppendResult(id string, err error) (*ProviderReadinessLedgerAppendOutput, error) {
	if err != nil {
		if errors.Is(err, providerreadiness.ErrLedgerFactNotFound) {
			return nil, huma.Error409Conflict("provider readiness evidence dependency does not exist")
		}
		return nil, huma.Error400BadRequest("provider readiness evidence was rejected")
	}
	output := &ProviderReadinessLedgerAppendOutput{}
	output.Body.ID = id
	return output, nil
}

func operatorReference(userID string) string {
	sum := sha256.Sum256([]byte(userID))
	return "operator:sha256:" + hex.EncodeToString(sum[:])
}
