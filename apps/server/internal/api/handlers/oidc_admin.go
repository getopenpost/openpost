package handlers

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/identity"
)

type OIDCOrganizationInput struct {
	OrganizationID string `path:"organization_id"`
}

type OIDCProviderAdminResponse struct {
	ID                   string    `json:"id"`
	OrganizationID       string    `json:"organization_id"`
	Name                 string    `json:"name"`
	Issuer               string    `json:"issuer"`
	ClientID             string    `json:"client_id"`
	HasClientSecret      bool      `json:"has_client_secret"`
	Scopes               []string  `json:"scopes"`
	EmailClaim           string    `json:"email_claim"`
	NameClaim            string    `json:"name_claim"`
	PictureClaim         string    `json:"picture_claim"`
	UseUserInfo          bool      `json:"use_userinfo"`
	RequireVerifiedEmail bool      `json:"require_verified_email"`
	JITEnabled           bool      `json:"jit_enabled"`
	IsActive             bool      `json:"is_active"`
	HealthStatus         string    `json:"health_status"`
	HealthMessage        string    `json:"health_message,omitempty"`
	LastCheckedAt        time.Time `json:"last_checked_at,omitempty"`
	CallbackURL          string    `json:"callback_url"`
	BackchannelLogoutURL string    `json:"backchannel_logout_url"`
	CreatedAt            time.Time `json:"created_at"`
	UpdatedAt            time.Time `json:"updated_at"`
}

type OIDCProviderAdminListOutput struct {
	Body []OIDCProviderAdminResponse
}

type OIDCProviderAdminInput struct {
	OrganizationID string `path:"organization_id"`
	Body           struct {
		ID                   string   `json:"id,omitempty"`
		Name                 string   `json:"name" minLength:"1"`
		Issuer               string   `json:"issuer" format:"uri"`
		ClientID             string   `json:"client_id" minLength:"1"`
		ClientSecret         *string  `json:"client_secret,omitempty"`
		Scopes               []string `json:"scopes,omitempty"`
		EmailClaim           string   `json:"email_claim,omitempty"`
		NameClaim            string   `json:"name_claim,omitempty"`
		PictureClaim         string   `json:"picture_claim,omitempty"`
		UseUserInfo          bool     `json:"use_userinfo,omitempty"`
		RequireVerifiedEmail bool     `json:"require_verified_email"`
		JITEnabled           bool     `json:"jit_enabled,omitempty"`
		IsActive             bool     `json:"is_active"`
	}
}

type OIDCProviderAdminOutput struct {
	Body OIDCProviderAdminResponse
}

type OIDCProviderActiveInput struct {
	OrganizationID string `path:"organization_id"`
	ProviderID     string `path:"provider_id"`
	Body           struct {
		Active bool `json:"active"`
	}
}

type OIDCProviderActiveOutput struct {
	Body struct {
		Active          bool  `json:"active"`
		RevokedSessions int64 `json:"revoked_sessions"`
	}
}

type OIDCPolicyOutput struct {
	Body identity.Policy
}

type OIDCPolicyInput struct {
	OrganizationID string `path:"organization_id"`
	Body           struct {
		Mode                    string   `json:"mode" enum:"disabled,optional,required"`
		ProviderIDs             []string `json:"provider_ids"`
		AssuranceMaxAgeSeconds  int      `json:"assurance_max_age_seconds" minimum:"300"`
		PasswordLoginAllowed    bool     `json:"password_login_allowed"`
		APITokenMode            string   `json:"api_token_mode" enum:"scoped,deny"`
		MaxTokenLifetimeSeconds int      `json:"max_token_lifetime_seconds" minimum:"300"`
		RequireTokenReauth      bool     `json:"require_token_reauth"`
	}
}

type OIDCDomainListOutput struct {
	Body []models.IdentityProviderDomain
}

type OIDCDomainCreateInput struct {
	OrganizationID string `path:"organization_id"`
	Body           struct {
		ProviderID string `json:"provider_id" minLength:"1"`
		Domain     string `json:"domain" minLength:"3"`
	}
}

type OIDCDomainCreateOutput struct {
	Body struct {
		Domain   models.IdentityProviderDomain `json:"domain"`
		DNSName  string                        `json:"dns_name"`
		DNSValue string                        `json:"dns_value"`
	}
}

type OIDCDomainVerifyInput struct {
	OrganizationID string `path:"organization_id"`
	DomainID       string `path:"domain_id"`
}

type OIDCDomainVerifyOutput struct {
	Body struct {
		Verified bool `json:"verified"`
	}
}

type OIDCAuditInput struct {
	OrganizationID string `path:"organization_id"`
	Limit          int    `query:"limit" minimum:"1" maximum:"200" default:"50"`
}

type OIDCAuditOutput struct {
	Body []models.IdentityAuditEvent
}

func (h *OIDCHandler) registerAdministrationRoutes(api huma.API) {
	authMiddleware := middleware.AuthMiddleware(api, h.authenticator)
	adminMiddleware := func(ctx huma.Context, next func(huma.Context)) {
		organizationID := ctx.Param("organization_id")
		decision, err := identity.EvaluateOrganizationAccess(
			ctx.Context(),
			h.auth.db,
			organizationID,
			middleware.GetUserID(ctx.Context()),
			middleware.GetSessionID(ctx.Context()),
			middleware.GetTokenID(ctx.Context()),
		)
		if err != nil {
			_ = huma.WriteErr(api, ctx, http.StatusInternalServerError, "failed to evaluate organization SSO access")
			return
		}
		if !decision.Allowed {
			_ = huma.WriteErr(api, ctx, http.StatusForbidden, "organization SSO authentication is required")
			return
		}
		if err := identity.RequireOrganizationAdmin(
			ctx.Context(),
			h.auth.db,
			organizationID,
			middleware.GetUserID(ctx.Context()),
		); err != nil {
			_ = huma.WriteErr(api, ctx, http.StatusForbidden, "organization administrator access is required")
			return
		}
		next(ctx)
	}
	protected := huma.Middlewares{authMiddleware, adminMiddleware}

	huma.Register(api, huma.Operation{
		OperationID: "list-organization-oidc-providers",
		Method:      http.MethodGet,
		Path:        "/organizations/{organization_id}/identity-providers",
		Summary:     "List organization identity providers",
		Tags:        []string{tagAuth},
		Middlewares: protected,
	}, func(ctx context.Context, input *OIDCOrganizationInput) (*OIDCProviderAdminListOutput, error) {
		providers, err := h.identity.ListOrganizationProviders(ctx, input.OrganizationID)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to list identity providers")
		}
		out := &OIDCProviderAdminListOutput{Body: make([]OIDCProviderAdminResponse, 0, len(providers))}
		for _, provider := range providers {
			out.Body = append(out.Body, h.providerAdminResponse(provider))
		}
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID:   "save-organization-oidc-provider",
		Method:        http.MethodPost,
		Path:          "/organizations/{organization_id}/identity-providers",
		Summary:       "Create or update an organization identity provider",
		Tags:          []string{tagAuth},
		DefaultStatus: http.StatusCreated,
		Middlewares:   protected,
		Errors:        []int{400, 403},
	}, func(ctx context.Context, input *OIDCProviderAdminInput) (*OIDCProviderAdminOutput, error) {
		provider, err := h.identity.UpsertProvider(ctx, identity.ProviderUpsertInput{
			ID:                   input.Body.ID,
			OrganizationID:       input.OrganizationID,
			Name:                 input.Body.Name,
			Issuer:               input.Body.Issuer,
			ClientID:             input.Body.ClientID,
			ClientSecret:         input.Body.ClientSecret,
			Scopes:               input.Body.Scopes,
			EmailClaim:           input.Body.EmailClaim,
			NameClaim:            input.Body.NameClaim,
			PictureClaim:         input.Body.PictureClaim,
			UseUserInfo:          input.Body.UseUserInfo,
			RequireVerifiedEmail: input.Body.RequireVerifiedEmail,
			JITEnabled:           input.Body.JITEnabled,
			IsActive:             input.Body.IsActive,
			ActorUserID:          middleware.GetUserID(ctx),
		})
		if err != nil {
			return nil, oidcAdminError(err)
		}
		return &OIDCProviderAdminOutput{Body: h.providerAdminResponse(*provider)}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "set-organization-oidc-provider-active",
		Method:      http.MethodPatch,
		Path:        "/organizations/{organization_id}/identity-providers/{provider_id}",
		Summary:     "Enable or disable an organization identity provider",
		Tags:        []string{tagAuth},
		Middlewares: protected,
		Errors:      []int{403, 404},
	}, func(ctx context.Context, input *OIDCProviderActiveInput) (*OIDCProviderActiveOutput, error) {
		revoked, err := h.identity.SetProviderActive(
			ctx,
			input.OrganizationID,
			input.ProviderID,
			middleware.GetUserID(ctx),
			input.Body.Active,
		)
		if err != nil {
			return nil, oidcAdminError(err)
		}
		out := &OIDCProviderActiveOutput{}
		out.Body.Active = input.Body.Active
		out.Body.RevokedSessions = revoked
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-organization-sso-policy",
		Method:      http.MethodGet,
		Path:        "/organizations/{organization_id}/sso-policy",
		Summary:     "Get an organization SSO policy",
		Tags:        []string{tagAuth},
		Middlewares: protected,
	}, func(ctx context.Context, input *OIDCOrganizationInput) (*OIDCPolicyOutput, error) {
		policy, err := h.identity.GetPolicy(ctx, input.OrganizationID)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load SSO policy")
		}
		return &OIDCPolicyOutput{Body: policy}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "save-organization-sso-policy",
		Method:      http.MethodPut,
		Path:        "/organizations/{organization_id}/sso-policy",
		Summary:     "Save an organization SSO policy",
		Tags:        []string{tagAuth},
		Middlewares: protected,
		Errors:      []int{400, 403},
	}, func(ctx context.Context, input *OIDCPolicyInput) (*OIDCPolicyOutput, error) {
		policy, err := h.identity.SavePolicy(ctx, identity.Policy{
			OrganizationID:          input.OrganizationID,
			Mode:                    input.Body.Mode,
			ProviderIDs:             input.Body.ProviderIDs,
			AssuranceMaxAgeSeconds:  input.Body.AssuranceMaxAgeSeconds,
			PasswordLoginAllowed:    input.Body.PasswordLoginAllowed,
			APITokenMode:            input.Body.APITokenMode,
			MaxTokenLifetimeSeconds: input.Body.MaxTokenLifetimeSeconds,
			RequireTokenReauth:      input.Body.RequireTokenReauth,
		}, middleware.GetUserID(ctx))
		if err != nil {
			return nil, oidcAdminError(err)
		}
		return &OIDCPolicyOutput{Body: policy}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "list-organization-sso-domains",
		Method:      http.MethodGet,
		Path:        "/organizations/{organization_id}/sso-domains",
		Summary:     "List organization SSO discovery domains",
		Tags:        []string{tagAuth},
		Middlewares: protected,
	}, func(ctx context.Context, input *OIDCOrganizationInput) (*OIDCDomainListOutput, error) {
		domains, err := h.identity.ListDomains(ctx, input.OrganizationID)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to list SSO domains")
		}
		return &OIDCDomainListOutput{Body: domains}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID:   "create-organization-sso-domain",
		Method:        http.MethodPost,
		Path:          "/organizations/{organization_id}/sso-domains",
		Summary:       "Create an organization SSO discovery domain",
		Tags:          []string{tagAuth},
		DefaultStatus: http.StatusCreated,
		Middlewares:   protected,
		Errors:        []int{400, 403},
	}, func(ctx context.Context, input *OIDCDomainCreateInput) (*OIDCDomainCreateOutput, error) {
		result, err := h.identity.CreateDomain(
			ctx,
			input.OrganizationID,
			input.Body.ProviderID,
			input.Body.Domain,
			middleware.GetUserID(ctx),
		)
		if err != nil {
			return nil, oidcAdminError(err)
		}
		out := &OIDCDomainCreateOutput{}
		out.Body.Domain = result.Domain
		out.Body.DNSName = result.DNSName
		out.Body.DNSValue = result.DNSValue
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "verify-organization-sso-domain",
		Method:      http.MethodPost,
		Path:        "/organizations/{organization_id}/sso-domains/{domain_id}/verify",
		Summary:     "Verify an organization SSO discovery domain",
		Tags:        []string{tagAuth},
		Middlewares: protected,
		Errors:      []int{400, 403},
	}, func(ctx context.Context, input *OIDCDomainVerifyInput) (*OIDCDomainVerifyOutput, error) {
		if err := h.identity.VerifyDomain(
			ctx,
			input.OrganizationID,
			input.DomainID,
			middleware.GetUserID(ctx),
		); err != nil {
			return nil, oidcAdminError(err)
		}
		return &OIDCDomainVerifyOutput{Body: struct {
			Verified bool `json:"verified"`
		}{Verified: true}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "list-organization-identity-audit-events",
		Method:      http.MethodGet,
		Path:        "/organizations/{organization_id}/identity-audit-events",
		Summary:     "List organization identity audit events",
		Tags:        []string{tagAuth},
		Middlewares: protected,
	}, func(ctx context.Context, input *OIDCAuditInput) (*OIDCAuditOutput, error) {
		events, err := h.identity.ListAudit(ctx, input.OrganizationID, input.Limit)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to list identity audit events")
		}
		return &OIDCAuditOutput{Body: events}, nil
	})
}

func (h *OIDCHandler) providerAdminResponse(provider models.IdentityProvider) OIDCProviderAdminResponse {
	base := strings.TrimRight(h.identity.PublicURL(), "/")
	return OIDCProviderAdminResponse{
		ID: provider.ID, OrganizationID: provider.OrganizationID, Name: provider.Name,
		Issuer: provider.Issuer, ClientID: provider.ClientID, HasClientSecret: len(provider.ClientSecretEnc) > 0,
		Scopes: strings.Fields(provider.Scopes), EmailClaim: provider.EmailClaim, NameClaim: provider.NameClaim,
		PictureClaim: provider.PictureClaim, UseUserInfo: provider.UseUserInfo,
		RequireVerifiedEmail: provider.RequireVerifiedEmail, JITEnabled: provider.JITEnabled,
		IsActive: provider.IsActive, HealthStatus: provider.HealthStatus, HealthMessage: provider.HealthMessage,
		LastCheckedAt:        provider.LastCheckedAt,
		CallbackURL:          base + "/api/v1/auth/oidc/" + provider.ID + "/callback",
		BackchannelLogoutURL: base + "/api/v1/auth/oidc/" + provider.ID + "/backchannel-logout",
		CreatedAt:            provider.CreatedAt, UpdatedAt: provider.UpdatedAt,
	}
}

func oidcAdminError(err error) error {
	switch {
	case errors.Is(err, identity.ErrOrganizationPermission):
		return huma.Error403Forbidden("organization administrator access is required")
	case errors.Is(err, identity.ErrProviderNotFound):
		return huma.Error404NotFound("identity provider not found")
	case errors.Is(err, identity.ErrDomainVerification):
		return huma.Error400BadRequest("the DNS verification record was not found")
	default:
		return huma.Error400BadRequest(err.Error())
	}
}
