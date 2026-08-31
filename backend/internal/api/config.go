package api

import (
	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/automationcatalog"
)

const bearerSecurityScheme = "bearerAuth"

var publicOperationIDs = map[string]struct{}{
	"begin-login-passkey":                {},
	"confirm-email-verification":         {},
	"consume-user-impersonation-link":    {},
	"create-purchase-choice":             {},
	"discover-oidc-provider":             {},
	"exchange-native-oidc-handoff":       {},
	"finish-login-passkey":               {},
	"get-auth-configuration":             {},
	"get-public-profile":                 {},
	"get-running-version":                {},
	"get-telemetry-config":               {},
	"health-check":                       {},
	"list-capabilities":                  {},
	"list-image-editor-presets":          {},
	"list-login-oidc-providers":          {},
	"list-public-image-editor-templates": {},
	"list-stock-media-providers":         {},
	"login":                              {},
	"poll-cli-auth":                      {},
	"readiness-check":                    {},
	"register":                           {},
	"request-password-reset":             {},
	"resend-email-verification":          {},
	"reset-password":                     {},
	"search-stock-media":                 {},
	"select-stock-media":                 {},
	"start-cli-auth":                     {},
	"verify-login-recovery-code":         {},
	"verify-login-totp":                  {},
}

func configureAutomationContract(config *huma.Config) {
	if config.Components.SecuritySchemes == nil {
		config.Components.SecuritySchemes = make(map[string]*huma.SecurityScheme)
	}
	config.Components.SecuritySchemes[bearerSecurityScheme] = &huma.SecurityScheme{
		Type:         "http",
		Scheme:       "bearer",
		BearerFormat: "OpenPost API token or session JWT",
	}
	config.Security = []map[string][]string{{bearerSecurityScheme: {}}}
	config.OnAddOperation = append(config.OnAddOperation, configureOperationContract)
}

func configureOperationContract(_ *huma.OpenAPI, operation *huma.Operation) {
	if _, public := publicOperationIDs[operation.OperationID]; public {
		operation.Security = []map[string][]string{}
	}
	automation, ok := automationcatalog.Lookup(operation.OperationID)
	if !ok {
		return
	}
	if operation.Extensions == nil {
		operation.Extensions = make(map[string]any)
	}
	operation.Extensions["x-openpost-automation"] = automation.Metadata()
}
