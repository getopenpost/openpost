package handlers

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/services/organizationownership"
)

type OrganizationOwnershipHandler struct {
	service *organizationownership.Service
	auth    middleware.Authenticator
}

func NewOrganizationOwnershipHandler(service *organizationownership.Service, auth middleware.Authenticator) *OrganizationOwnershipHandler {
	return &OrganizationOwnershipHandler{service: service, auth: auth}
}

type OwnershipTransferResponse struct {
	ID               string `json:"id"`
	OrganizationID   string `json:"organization_id"`
	OrganizationName string `json:"organization_name"`
	PriorOwnerUserID string `json:"prior_owner_user_id"`
	PriorOwnerEmail  string `json:"prior_owner_email"`
	NomineeUserID    string `json:"nominee_user_id"`
	NomineeEmail     string `json:"nominee_email"`
	Status           string `json:"status" enum:"pending,accepted,declined,revoked,expired"`
	ExpiresAt        string `json:"expires_at"`
}

type OwnershipTransferOutput struct{ Body OwnershipTransferResponse }
type PendingOwnershipTransferResponse struct {
	Pending  bool                       `json:"pending" doc:"Whether an ownership transfer is pending"`
	Transfer *OwnershipTransferResponse `json:"transfer,omitempty" doc:"Pending transfer when one exists"`
}
type PendingOwnershipTransferOutput struct {
	Body PendingOwnershipTransferResponse
}
type OwnershipTransferOrganizationInput struct {
	PathID string `path:"id" doc:"Organization ID"`
}
type InitiateOwnershipTransferInput struct {
	PathID string `path:"id" doc:"Organization ID"`
	Body   struct {
		NomineeUserID           string `json:"nominee_user_id" minLength:"1" doc:"Eligible Organization member user ID"`
		ConfirmOrganizationName string `json:"confirm_organization_name" minLength:"1" doc:"Exact Organization name as explicit confirmation"`
		ReauthGrant             string `json:"reauth_grant" minLength:"1" doc:"One-time grant for organization.ownership.transfer"`
	}
}
type OwnershipTransferIDInput struct {
	ID string `query:"id" minLength:"1" doc:"Ownership transfer ID"`
}
type CompleteOwnershipTransferInput struct {
	Body struct {
		ID string `json:"id" minLength:"1" doc:"Ownership transfer ID"`
	}
}

func (h *OrganizationOwnershipHandler) RegisterRoutes(api huma.API) {
	auth := middleware.AuthMiddleware(api, h.auth)
	huma.Register(api, huma.Operation{OperationID: "get-organization-ownership-transfer", Method: http.MethodGet, Path: "/organizations/{id}/ownership-transfer", Summary: "Get the pending Organization ownership transfer", Description: "Returns pending false when the Organization has no pending ownership transfer.", Tags: []string{tagWorkspaces}, Middlewares: huma.Middlewares{auth}, Errors: []int{403}}, h.getForOrganization)
	huma.Register(api, huma.Operation{OperationID: "initiate-organization-ownership-transfer", Method: http.MethodPost, Path: "/organizations/{id}/ownership-transfer", Summary: "Nominate a successor Organization Owner", Description: "Requires the current Owner, an unscoped browser session, exact Organization-name confirmation, and recent reauthentication. Authority changes only after acceptance.", Tags: []string{tagWorkspaces}, Middlewares: huma.Middlewares{auth}, Errors: []int{400, 401, 403, 404, 409, 503}}, h.initiate)
	huma.Register(api, huma.Operation{OperationID: "revoke-organization-ownership-transfer", Method: http.MethodDelete, Path: "/organizations/{id}/ownership-transfer", Summary: "Revoke a pending Organization ownership transfer", Tags: []string{tagWorkspaces}, Middlewares: huma.Middlewares{auth}, Errors: []int{403, 404, 409}}, h.revoke)
	huma.Register(api, huma.Operation{OperationID: "resolve-organization-ownership-transfer", Method: http.MethodGet, Path: "/organization-ownership-transfers/resolve", Summary: "Review an Organization ownership nomination", Tags: []string{tagWorkspaces}, Middlewares: huma.Middlewares{auth}, Errors: []int{400, 403, 404, 409}}, h.resolve)
	huma.Register(api, huma.Operation{OperationID: "accept-organization-ownership-transfer", Method: http.MethodPost, Path: "/organization-ownership-transfers/accept", Summary: "Accept an Organization ownership nomination", Tags: []string{tagWorkspaces}, Middlewares: huma.Middlewares{auth}, Errors: []int{400, 403, 404, 409}}, h.accept)
	huma.Register(api, huma.Operation{OperationID: "decline-organization-ownership-transfer", Method: http.MethodPost, Path: "/organization-ownership-transfers/decline", Summary: "Decline an Organization ownership nomination", Tags: []string{tagWorkspaces}, Middlewares: huma.Middlewares{auth}, Errors: []int{400, 403, 404, 409}}, h.decline)
}

func ownershipCredential(ctx context.Context) organizationownership.Credential {
	return organizationownership.Credential{
		UserID:      middleware.GetUserID(ctx),
		SessionID:   middleware.GetSessionID(ctx),
		TokenID:     middleware.GetTokenID(ctx),
		WorkspaceID: middleware.GetWorkspaceID(ctx),
	}
}

func (h *OrganizationOwnershipHandler) getForOrganization(ctx context.Context, input *OwnershipTransferOrganizationInput) (*PendingOwnershipTransferOutput, error) {
	transfer, err := h.service.GetForOrganization(ctx, input.PathID, ownershipCredential(ctx))
	if err != nil {
		if errors.Is(err, organizationownership.ErrNotFound) {
			return &PendingOwnershipTransferOutput{Body: PendingOwnershipTransferResponse{}}, nil
		}
		return nil, ownershipTransferHTTPError(err)
	}
	response := ownershipTransferResponse(transfer)
	return &PendingOwnershipTransferOutput{Body: PendingOwnershipTransferResponse{Pending: true, Transfer: &response}}, nil
}

func (h *OrganizationOwnershipHandler) initiate(ctx context.Context, input *InitiateOwnershipTransferInput) (*OwnershipTransferOutput, error) {
	serviceInput := organizationownership.InitiateInput{OrganizationID: input.PathID, ActorUserID: middleware.GetUserID(ctx), ActorSessionID: middleware.GetSessionID(ctx), ActorTokenID: middleware.GetTokenID(ctx), ActorWorkspaceID: middleware.GetWorkspaceID(ctx), ReauthGrant: input.Body.ReauthGrant, NomineeUserID: input.Body.NomineeUserID, ConfirmOrganizationName: input.Body.ConfirmOrganizationName}
	transfer, err := h.service.Initiate(ctx, serviceInput)
	if err != nil {
		return nil, ownershipTransferHTTPError(err)
	}
	return ownershipTransferOutput(transfer), nil
}

func (h *OrganizationOwnershipHandler) revoke(ctx context.Context, input *OwnershipTransferOrganizationInput) (*struct {
	Body struct {
		Revoked bool `json:"revoked"`
	}
}, error) {
	if err := h.service.Revoke(ctx, input.PathID, ownershipCredential(ctx)); err != nil {
		return nil, ownershipTransferHTTPError(err)
	}
	out := &struct {
		Body struct {
			Revoked bool `json:"revoked"`
		}
	}{}
	out.Body.Revoked = true
	return out, nil
}

func (h *OrganizationOwnershipHandler) resolve(ctx context.Context, input *OwnershipTransferIDInput) (*OwnershipTransferOutput, error) {
	transfer, err := h.service.Resolve(ctx, input.ID, ownershipCredential(ctx))
	if err != nil {
		return nil, ownershipTransferHTTPError(err)
	}
	return ownershipTransferOutput(transfer), nil
}
func (h *OrganizationOwnershipHandler) accept(ctx context.Context, input *CompleteOwnershipTransferInput) (*OwnershipTransferOutput, error) {
	transfer, err := h.service.Accept(ctx, input.Body.ID, ownershipCredential(ctx))
	if err != nil {
		return nil, ownershipTransferHTTPError(err)
	}
	return ownershipTransferOutput(transfer), nil
}
func (h *OrganizationOwnershipHandler) decline(ctx context.Context, input *CompleteOwnershipTransferInput) (*OwnershipTransferOutput, error) {
	transfer, err := h.service.Decline(ctx, input.Body.ID, ownershipCredential(ctx))
	if err != nil {
		return nil, ownershipTransferHTTPError(err)
	}
	return ownershipTransferOutput(transfer), nil
}

func ownershipTransferOutput(transfer organizationownership.Transfer) *OwnershipTransferOutput {
	return &OwnershipTransferOutput{Body: ownershipTransferResponse(transfer)}
}

func ownershipTransferResponse(transfer organizationownership.Transfer) OwnershipTransferResponse {
	return OwnershipTransferResponse{ID: transfer.ID, OrganizationID: transfer.OrganizationID, OrganizationName: transfer.OrganizationName, PriorOwnerUserID: transfer.PriorOwnerUserID, PriorOwnerEmail: transfer.PriorOwnerEmail, NomineeUserID: transfer.NomineeUserID, NomineeEmail: transfer.NomineeEmail, Status: transfer.Status, ExpiresAt: transfer.ExpiresAt.UTC().Format("2006-01-02T15:04:05Z07:00")}
}

func ownershipTransferHTTPError(err error) error {
	switch {
	case errors.Is(err, organizationownership.ErrOwnerRequired), errors.Is(err, organizationownership.ErrNomineeRequired), errors.Is(err, organizationownership.ErrIdentityAssurance), errors.Is(err, organizationownership.ErrBrowserRequired):
		return huma.Error403Forbidden(err.Error())
	case errors.Is(err, organizationownership.ErrReauthRequired):
		return huma.Error401Unauthorized(err.Error())
	case errors.Is(err, organizationownership.ErrReauthUnavailable):
		return huma.Error503ServiceUnavailable(err.Error())
	case errors.Is(err, organizationownership.ErrNotFound):
		return huma.Error404NotFound("ownership transfer not found")
	case errors.Is(err, organizationownership.ErrNomineeIneligible), errors.Is(err, organizationownership.ErrConfirmation):
		return huma.Error400BadRequest(err.Error())
	case errors.Is(err, organizationownership.ErrPendingExists), errors.Is(err, organizationownership.ErrNotPending), errors.Is(err, organizationownership.ErrExpired):
		return huma.Error409Conflict(err.Error())
	default:
		return huma.Error500InternalServerError("ownership transfer could not be completed")
	}
}
