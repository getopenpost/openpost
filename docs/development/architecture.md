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

### Static SvelteKit in one Go binary

OpenPost ships its web app and HTTP API in one Go binary. SvelteKit builds the
browser interface; Go serves the resulting files and owns authentication,
persistence, provider calls and jobs. The deployed app does not need a Node.js
server.

The [root layout](../../apps/web/src/routes/+layout.ts) disables server rendering
and enables prerendering. The [static adapter](../../apps/web/svelte.config.js)
writes pages and assets to `apps/web/build`, with `index.html` as its fallback.
The frontend build also generates `app-routes.json` from the app's route tree.

The [packaging step](../../scripts/package-frontend.mjs) validates the HTML and
route manifest, then installs the built app in
`apps/server/cmd/openpost/public`. The
[production entry](../../apps/server/cmd/openpost/web_embedded.go) includes that
directory with `//go:embed all:public` and passes it to the HTTP routes as an
`fs.FS`. Go compiles the files into the binary, so installing a release does not
require a separate frontend build or web directory.

Client navigation still needs correct HTTP responses when someone opens or
reloads a URL. The [SPA route handler](../../apps/server/cmd/openpost/web.go)
uses the generated manifest to distinguish app routes from unknown paths. A
known route such as `/calendar` can receive the fallback HTML. An unknown path
keeps its HTTP 404 status, and API paths stay outside the SPA fallback.
Application HTML uses `no-cache, no-store, must-revalidate`. Startup rejects
missing HTML and a missing or invalid route manifest.

Development builds use the `dev` Go build tag. Their
[frontend entry](../../apps/server/cmd/openpost/web_dev.go) reads files from
`OPENPOST_WEB_PATH`, defaulting to `cmd/openpost/public`, through `os.DirFS`.
Both build modes use the same route handler; the filesystem source changes.

The [routing tests](../../apps/server/cmd/openpost/web_test.go) cover direct
entry, unknown routes, API isolation, HEAD responses and invalid manifests.
Keep these HTTP behaviors in Go when changing frontend packaging or navigation.

## Client surfaces

The web app, CLI, MCP server, and direct HTTP clients share the same backend authorization, validation, quotas, and audit records. They intentionally differ in interaction design. See [Product Surface Parity](../reference/surface-parity.md) for the supported workflow matrix.
