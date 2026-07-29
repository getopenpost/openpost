---
name: huma
description: Huma - Go REST/RPC API Framework. Use with Echo adapter (humaecho) for OpenAPI 3.1 generation.
version: 1.0.0
user-invocable: false
argument-hint: ""
---

# Huma - Go REST/RPC API Framework

Huma generates OpenAPI 3.1 from Go types with zero annotations beyond struct tags. Use the Echo adapter (`humaecho`) for this project.

## Core Pattern

```go
import (
    "github.com/danielgtaylor/huma/v2"
    "github.com/danielgtaylor/huma/v2/adapters/humaecho"
)

// Setup in main.go
apiGroup := e.Group("/api/v1")
api := humaecho.NewWithGroup(e, apiGroup, huma.DefaultConfig("API", "1.0.0"))

// Handler registration - auto-generates OpenAPI
huma.Register(api, huma.Operation{
    OperationID: "get-user",
    Method:      http.MethodGet,
    Path:        "/users/{id}",
    Summary:     "Get a user",
    Tags:        []string{"Users"},
    Errors:      []int{404},
}, func(ctx context.Context, input *GetUserInput) (*GetUserOutput, error) {
    // handler logic
})
```

## Input/Output Structs

Input structs use tags for path, query, header, body parameters. Output structs define response shape. Always wrap outputs in explicit `Body` field to avoid Huma interpreting fields as headers.

```go
type GetUserInput struct {
    ID    string `path:"id" doc:"User ID"`
    Verbose bool `query:"verbose" doc:"Include extra details"`
    // Body is optional for GET
}

type GetUserOutput struct {
    Body struct {
        ID   string `json:"id"`
        Name string `json:"name"`
    }
}
```

**IMPORTANT**: Fields named `Status` on output structs must use `Body` wrapper, otherwise Huma interprets them as HTTP status codes (must be int). Same for `CreatedAt` which gets treated as response headers.

## Validation Tags

```go
type CreateInput struct {
    Body struct {
        Name     string `json:"name" minLength:"1" maxLength:"100"`
        Email    string `json:"email" format:"email"`
        Age      int    `json:"age" minimum:"0" maximum:"150"`
        Role     string `json:"role" enum:"admin,user,guest"`
        Tags     []string `json:"tags" minItems:"1" uniqueItems:"true"`
    }
}
```

## Error Handling

```go
return nil, huma.Error404NotFound("not found")
return nil, huma.Error400BadRequest("bad request", &huma.ErrorDetail{...})
return nil, huma.Error401Unauthorized("unauthorized")
return nil, huma.Error500InternalServerError("internal error")
```

## Middleware

Huma middleware signature: `func(ctx huma.Context, next func(huma.Context))`

```go
// Per-operation middleware
huma.Register(api, huma.Operation{
    Middlewares: huma.Middlewares{authMiddleware},
}, handler)

// Global middleware
api.UseMiddleware(loggingMiddleware)

// Context values
ctx = huma.WithValue(ctx, key, value)
val := ctx.Context().Value(key)
```

## Echo Adapter Notes

- `humaecho.New(echo, config)` - creates API from Echo instance
- `humaecho.NewWithGroup(echo, group, config)` - creates API for a group path
- Path conversion: Huma `{param}` → Echo `:param` (automatic)
- Error writing requires API reference: pass `api` to middleware factory

## OpenAPI Spec

The spec is auto-generated. Access via `api.OpenAPI()` and serve as JSON:
```go
e.GET("/openapi.json", func(c echo.Context) error {
    data, _ := json.Marshal(api.OpenAPI())
    return c.Blob(http.StatusOK, "application/json", data)
})
```

## Convenience Methods

```go
huma.Get(api, "/items", handler)    // auto-generates operation ID
huma.Post(api, "/items", handler)
huma.Put(api, "/items/{id}", handler)
huma.Delete(api, "/items/{id}", handler)
```

## Gotchas

1. Don't return `*models.Model` directly if it has fields named `Status`, `CreatedAt` etc. — use explicit output structs with `Body` wrapper
2. Handler methods should take `api huma.API` and call `huma.Register` internally (method-as-registrar pattern)
3. `huma.WriteErr(api, ctx, status, msg)` needs the API reference — pass it via closure in middleware factories
4. `huma.WithValue` takes 3 args: `(ctx, key, value)`, not `(ctx, context.Context)`
