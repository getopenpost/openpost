---
description: Find the architecture, setup, API, frontend, backend, testing, contribution, and release documentation for OpenPost.
---

# Developer Docs

Use these docs when you are changing OpenPost itself: backend routes, platform adapters, frontend components, generated clients, MCP tools, billing infrastructure, database migrations, tests, or release behavior.

Developer docs are separate from user-facing docs and self-hosting docs. They can assume repository access, local toolchains, and willingness to run checks.

## Start here

- [Development Setup](setup.md) gets the repo, frontend, backend, and docs running locally.
- [Architecture](architecture.md) explains the main boundaries.
- [Contributing](contributing.md) covers contribution workflow.
- [Testing](testing.md) covers local and CI checks.
- [Releases and Versioning](releases.md) covers SemVer, production releases, and failure handling.

## Backend and API

- [Backend](backend.md) covers Go backend conventions.
- [API Reference](api-reference.md) renders the generated OpenAPI spec.
- [API Tokens](api-tokens.md) documents one-time secrets, expiry, scopes, workspace boundaries, and revocation.
- [External Applications](external-applications.md) documents delegated OAuth, workspace and account consent, rotating credentials, and signed webhooks.
- [Background Jobs](background-jobs.md) covers durable job behavior.
- [Platform Adapters](platform-adapters.md) covers provider integration rules.
- [Billing and Usage](billing-and-usage.md) covers entitlements, usage counters, and hosted billing primitives.

## Frontend, MCP, and launch work

- [Frontend](frontend.md) covers SvelteKit app conventions.
- [MCP and ChatGPT App](mcp.md) covers tool-server and Apps SDK integration notes.
- [Production Architecture](production-readiness.md) records shared hosted and self-hosted architecture, provider verification, and release checks.

## Adjacent docs

- If you are using OpenPost through the web app, CLI, or MCP client, start with [User Docs](https://docs.openpo.st/guides/quickstart).
- If you are deploying or operating an instance, start with [Self-Hosting Docs](https://docs.openpo.st/self-hosting/).
