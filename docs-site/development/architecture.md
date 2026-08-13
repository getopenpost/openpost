# Architecture

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

OpenPost Video Editor uses the shared `packages/video-project` schema and deterministic timeline operations. IndexedDB owns local project metadata, revisions, analysis results, and recording manifests; OPFS owns sources, recording chunks, thumbnails, waveform data, analysis indexes, exports, and temporary files. Preview and export share the same timeline evaluator. Mediabunny provides container access and streaming muxing, while WebCodecs and canvas APIs perform bounded decoding, composition, and encoding. The backend stores only explicit cloud projects, their revisions and media references, one-time composer return tokens, normalized stock provenance, and short-lived stock search cache entries.

## Deployment

The built frontend is embedded into the Go binary for single-binary deployment.

## Client surfaces

The web app, CLI, MCP server, and direct HTTP clients share the same backend authorization, validation, quotas, and audit records. They intentionally differ in interaction design. See [Product Surface Parity](/reference/surface-parity) for the supported workflow matrix.
