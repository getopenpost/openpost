package api

import "github.com/danielgtaylor/huma/v2"

const openAPIDescription = "OpenPost HTTP API for workspace-scoped social publishing. Use it to inspect accounts and provider readiness, manage media and publications, schedule work, and read publishing results. Every operation still follows token scopes, workspace roles, plan limits, provider capabilities, and destination validation."

// OpenAPIConfig returns the shared public contract metadata used by the server and generator.
func OpenAPIConfig(version string) huma.Config {
	config := huma.DefaultConfig("OpenPost API", version)
	configureAutomationContract(&config)
	config.Info.Description = openAPIDescription
	config.Info.TermsOfService = "https://openpost.social/terms"
	config.Info.Contact = &huma.Contact{
		Name:  "OpenPost support",
		URL:   "https://openpost.social/contact",
		Email: "openpost@rgo.pt",
	}
	config.Info.License = &huma.License{
		Name:       "AGPL-3.0-only",
		Identifier: "AGPL-3.0-only",
	}
	return config
}

// FinalizeOpenAPIContract adds connectivity metadata after routes and schemas are registered.
// Delaying this avoids binding generated schema example URLs to the Hosted service origin.
func FinalizeOpenAPIContract(api huma.API) {
	api.OpenAPI().Servers = []*huma.Server{
		{
			URL:         "https://app.openpost.social/api/v1",
			Description: "OpenPost Hosted service",
		},
		{
			URL:         "/api/v1",
			Description: "The OpenPost instance serving this contract",
		},
	}
}
