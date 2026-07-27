---
name: openapi-typescript
description: Type-safe OpenAPI consumption in TypeScript using openapi-typescript and openapi-fetch.
version: 1.0.0
user-invocable: false
argument-hint: ""
---

# openapi-typescript + openapi-fetch

Type-safe OpenAPI consumption in TypeScript. Generates runtime-free types from OpenAPI specs and provides a typed fetch client.

## Type Generation

```bash
# Generate types from local spec
npx openapi-typescript openapi.json -o src/lib/api/types.d.ts

# Generate from running server
npx openapi-typescript http://localhost:8080/openapi.json -o src/lib/api/types.d.ts

# Check if types are up-to-date (CI)
npx openapi-typescript openapi.json -o src/lib/api/types.d.ts --check
```

## openapi-fetch Client

```typescript
import createClient from "openapi-fetch";
import type { paths } from "./types";

const client = createClient<paths>({ baseUrl: "/api/v1" });

// GET with query params
const { data, error } = await client.GET("/posts", {
  params: { query: { workspace_id: "123" } },
});

// POST with body
const { data, error } = await client.POST("/posts", {
  body: { workspace_id: "123", content: "Hello", social_account_ids: [] },
});

// Path params
const { data } = await client.GET("/accounts/{platform}/auth-url", {
  params: {
    path: { platform: "x" },
    query: { workspace_id: "123" },
  },
});
```

## Auth Middleware

```typescript
import createClient, { type Middleware } from "openapi-fetch";

const client = createClient<paths>({ baseUrl: "/api/v1" });

client.use({
  async onRequest({ request }) {
    const token = localStorage.getItem("token");
    if (token) {
      request.headers.set("Authorization", `Bearer ${token}`);
    }
    return request;
  },
});
```

## Re-exporting Schema Types

```typescript
// In client.ts
import type { paths, components } from "./types";

export type User = components["schemas"]["UserProfile"];
export type Workspace = components["schemas"]["WorkspaceResp"];
export type Post = components["schemas"]["PostResponse"];
```

## Error Handling

Huma returns RFC 9457 Problem Details:

```typescript
const { data, error } = await client.POST("/auth/login", {
  body: { email, password },
});
if (error) {
  // error is typed based on response schemas
  console.error(error.detail); // human-readable message
  console.error(error.status); // HTTP status code
  console.error(error.errors); // validation details
}
```

## Svelte Integration

```svelte
<script lang="ts">
    import { client, type Workspace } from '$lib/api/client';

    let workspaces = $state<Workspace[]>([]);

    async function load() {
        const { data, error } = await client.GET('/workspaces');
        if (!error && data) {
            workspaces = data;
        }
    }
</script>
```

## Workflow

1. Backend defines types via Huma → auto-generates OpenAPI spec
2. Frontend fetches spec from `/openapi.json`
3. `openapi-typescript` generates `types.d.ts`
4. `openapi-fetch` provides fully typed client
5. Both sides stay in sync — type mismatches caught at compile time

## Scripts

```json
{
  "scripts": {
    "generate:types": "openapi-typescript openapi.json -o src/lib/api/types.d.ts"
  }
}
```

## Gotchas

1. Fields named `Status` in OpenAPI schemas get treated as HTTP status codes — avoid on response body structs
2. `$schema` field appears in generated types (Huma JSON Schema metadata) — ignore it in client code
3. `0001-01-01T00:00:00Z` is Go's zero time — handle in frontend date formatting
4. `openapi-typescript` requires OpenAPI 3.0 or 3.1 (Huma generates 3.1)
