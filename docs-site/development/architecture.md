# Architecture

This page is for contributors changing OpenPost's system boundaries.

## Frontend

- SvelteKit
- TailwindCSS
- Paraglide
- Vitest
- Bun

## Backend

- Go
- Echo
- Huma
- SQLite by default, Postgres for cloud deployments
- Bun ORM

HTTP routes are defined with Huma whenever they are part of the typed product API. Echo remains the transport adapter and owns the small number of routes that are not JSON API operations, such as multipart uploads, public media/avatar serving, OAuth/MCP protocol endpoints, and the embedded SPA.

Handlers authenticate and validate request boundaries, services own product rules and provider orchestration, and Bun-backed database packages own persistence. Provider API behavior stays in `internal/platform`; provider selection and public-media behavior come from adapter maps and the central capability catalog.

## Background jobs

Publishing and other durable work flows through a database-backed jobs table.

## Media

Media uses the `BlobStorage` abstraction with local filesystem storage by default and S3-compatible storage for cloud deployments. The Media service owns physical assets, quota accounting, thumbnails, signing, and safe deletion.

OpenPost Image Editor is a separate backend handler/service and a dedicated `frontend/src/lib/image-editor/` module. It persists a strict OpenPost document schema, normalized pages, optimistic revisions, extracted media references, recovery history, templates, brand metadata, and one-time composer return tokens. Fabric.js stays behind an adapter and is never the persisted data model. The background-removal runtime and model load only after a user requests removal.

OpenPost Video Editor is a frontend-only, local-first system under `frontend/src/lib/video-editor/` and `frontend/src/routes/video-editor/`. A user-selected workspace folder owns project documents, collected media, linked-source records, recordings, derived media, render queues, and final exports. IndexedDB stores only reopenable filesystem handles and their safe metadata. OPFS holds bounded caches, downloaded local models, recorder recovery data, and export scratch files that do not belong in the workspace until they are complete.

Deterministic timeline operations, project migrations, atomic filesystem writes, and render-job snapshots protect local state. Preview and export share the same evaluators, rasterizers, audio rules, effects, and backdrop-aware compositor. Mediabunny provides container and packet access, while WebCodecs, Web Audio, canvas, workers, and WebGL2 perform bounded decode, mix, composition, and encode work. The backend has no Video Editor project model. It receives only explicit stock-search requests and final exports sent through the normal Media upload path.

## Deployment

The built frontend is embedded into the Go binary for single-binary deployment.

## Client surfaces

The web app, CLI, MCP server, and direct HTTP clients share the same backend authorization, validation, quotas, and audit records. They intentionally differ in interaction design. See [Product Surface Parity](/reference/surface-parity) for the supported workflow matrix.
