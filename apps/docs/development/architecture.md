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

OpenPost Image Editor is a separate backend handler/service and a dedicated `apps/web/src/lib/image-editor/` module. It persists a strict OpenPost document schema, normalized pages, optimistic revisions, extracted media references, recovery history, templates, brand metadata, and one-time composer return tokens. Fabric.js stays behind an adapter and is never the persisted data model. The background-removal runtime and model load only after a user requests removal.

OpenPost Video Editor keeps local editing and rendering under `apps/web/src/lib/video-editor/` and `apps/web/src/routes/video-editor/`, with Cloud Video Project persistence owned by `apps/server/internal/services/videoprojects/`. Signed-in cloud projects are Workspace-owned and contain portable authored documents, immutable revisions, mutation batches, conflict branches, checkpoints, Trash state, and Project Asset references. The shared portable contract lives in `packages/video-project/` and is consumed by web and mobile. A Local-only project keeps its document and source media in a user-selected folder.

Cloud saves use versioned, idempotent mutation batches with stable entity and property targets. The backend rebases disjoint stale changes and preserves overlapping work in an explicit conflict branch. Project Assets use the configured `BlobStorage` and remain separate from Workspace Media until an explicit save or composer handoff. Device view state, browser filesystem handles, derived media, render queues, downloaded models, and unsaved exports remain local. IndexedDB and OPFS hold bounded offline state, caches, recorder recovery data, and export scratch files.

Deterministic timeline operations, project migrations, atomic filesystem writes for Local-only projects, and render-job snapshots protect state. Preview and export share the same evaluators, rasterizers, audio rules, effects, and backdrop-aware compositor. Mediabunny provides container and packet access, while WebCodecs, Web Audio, canvas, workers, and WebGL2 perform bounded decode, mix, composition, and encode work.

## Deployment

The built frontend is embedded into the Go binary for single-binary deployment.

## Client surfaces

The web app, CLI, MCP server, and direct HTTP clients share the same backend authorization, validation, quotas, and audit records. They intentionally differ in interaction design. See [Product Surface Parity](/reference/surface-parity) for the supported workflow matrix.
