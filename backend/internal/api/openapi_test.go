package api

import (
	"testing"

	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
)

func TestOpenAPIConfigDescribesHowToUseTheContract(t *testing.T) {
	config := OpenAPIConfig("1.2.3")

	if config.Info.Title != "OpenPost API" || config.Info.Version != "1.2.3" {
		t.Fatalf("unexpected API identity: %#v", config.Info)
	}
	if config.Info.Description == "" {
		t.Fatal("expected an API description")
	}
	if config.Info.Contact == nil || config.Info.Contact.URL != "https://openpost.social/contact" {
		t.Fatalf("unexpected contact metadata: %#v", config.Info.Contact)
	}
	if config.Info.License == nil || config.Info.License.Identifier != "AGPL-3.0-only" {
		t.Fatalf("unexpected license metadata: %#v", config.Info.License)
	}
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), config)
	FinalizeOpenAPIContract(api)
	if len(api.OpenAPI().Servers) != 2 {
		t.Fatalf("expected Hosted and current-instance servers, got %d", len(api.OpenAPI().Servers))
	}
	if api.OpenAPI().Servers[0].URL != "https://app.openpost.social/api/v1" {
		t.Fatalf("unexpected Hosted server: %#v", api.OpenAPI().Servers[0])
	}
	if api.OpenAPI().Servers[1].URL != "/api/v1" {
		t.Fatalf("unexpected current-instance server: %#v", api.OpenAPI().Servers[1])
	}
}
