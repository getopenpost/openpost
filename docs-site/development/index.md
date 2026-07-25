# Developer Docs

Use these docs when you are changing OpenPost itself: backend routes, platform adapters, frontend components, generated clients, MCP tools, billing infrastructure, database migrations, tests, or release behavior.

Developer docs are separate from user-facing docs and self-hosting docs. They can assume repository access, local toolchains, and willingness to run checks.

## Start here

- [Development Setup](/development/setup) gets the repo, frontend, backend, and docs running locally.
- [Architecture](/development/architecture) explains the main boundaries.
- [Contributing](/development/contributing) covers contribution workflow.
- [Testing](/development/testing) covers local and CI checks.

## Backend and API

- [Backend](/development/backend) covers Go backend conventions.
- [API Reference](/development/api-reference) renders the generated OpenAPI spec.
- [Background Jobs](/development/background-jobs) covers durable job behavior.
- [Platform Adapters](/development/platform-adapters) covers provider integration rules.
- [Billing and Usage](/development/billing-and-usage) covers entitlements, usage counters, and hosted billing primitives.

## Frontend, MCP, and launch work

- [Frontend](/development/frontend) covers SvelteKit app conventions.
- [MCP and ChatGPT App](/development/mcp) covers tool-server and Apps SDK integration notes.
- [Production Readiness](/development/production-readiness) tracks the broader cloud-hosted roadmap.

## Adjacent docs

- If you are using OpenPost through the web app, CLI, or MCP client, start with [User Docs](/usage/).
- If you are deploying or operating an instance, start with [Self-Hosting Docs](/self-hosting/).
