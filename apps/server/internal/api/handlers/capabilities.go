package handlers

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/capabilities"
)

type CapabilityHandler struct{}

func NewCapabilityHandler() *CapabilityHandler {
	return &CapabilityHandler{}
}

type CapabilitiesOutput struct {
	CacheControl string `header:"Cache-Control"`
	Body         struct {
		Profiles     []capabilities.Profile    `json:"profiles" doc:"Content profiles supported by OpenPost"`
		Capabilities []capabilities.Capability `json:"capabilities" doc:"Provider/profile capability matrix"`
	} `json:"body"`
}

func (h *CapabilityHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-capabilities",
		Method:      http.MethodGet,
		Path:        "/capabilities",
		Summary:     "List provider publishing capabilities",
		Tags:        []string{tagCapabilities},
	}, func(_ context.Context, _ *struct{}) (*CapabilitiesOutput, error) {
		resp := &CapabilitiesOutput{CacheControl: "public, max-age=300, stale-while-revalidate=60"}
		resp.Body.Profiles = capabilities.Profiles()
		resp.Body.Capabilities = capabilities.All()
		return resp, nil
	})
}
