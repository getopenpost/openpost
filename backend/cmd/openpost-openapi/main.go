package main

import (
	"encoding/json"
	"log"
	"os"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	apiroutes "github.com/openpost/backend/internal/api"
)

func main() {
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("OpenPost API", "1.0.0"))
	apiroutes.RegisterHumaRoutes(api, apiroutes.RouteDeps{})

	out, err := json.MarshalIndent(api.OpenAPI(), "", "\t")
	if err != nil {
		log.Fatalf("failed to marshal OpenAPI spec: %v", err)
	}
	if _, err := os.Stdout.Write(append(out, '\n')); err != nil {
		log.Fatalf("failed to write OpenAPI spec: %v", err)
	}
}
