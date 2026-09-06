# OpenPost agent guide

OpenPost is the all-in-one content team for solo founders. It turns their work into channel-ready content, publishes it, and brings outcomes back into one workspace. Hosted is the primary product; self-hosting is a deployment option.

- A **Publication** is the user-visible post. It owns the source idea, schedule, status, and destination outputs.
- A **Rendition** is one destination-specific version with its own account, text, media, format, timing, and provider settings.

## Product bar

- Start with the founder's launches, updates, lessons, and ideas. Remove repeat work without hiding decisions.
- Preserve provider truth. Show real capabilities, limits, review needs, readiness, and failures.
- Keep every outcome inspectable: draft, scheduled, queued, published, failed, or retrying.
- Use the same terms, permissions, and workspace boundaries across web, mobile, API, CLI, MCP, Hosted, and self-hosted surfaces.
- Treat UX consistency as a product requirement. Reuse established patterns and preserve keyboard access, visible focus, readable contrast, reduced motion, localization, and touch targets.

## Route the work

Load only the branch the task needs:

| Task                                                                    | Read or use                                                                                         |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Substantial, ambiguous, or multi-ticket work                            | `agent-workflow`; the OpenPost Vikunja project for the current spec, priority, and execution state  |
| Product scope, public copy, provider support, or capability claims      | `README.md` for current public claims and readiness; `PRODUCT.md` for purpose, terms, and scope     |
| UI, visual, or user-facing copy changes                                 | `ux-consistency` and `DESIGN.md`; add `impeccable` for design critique                              |
| Interaction sounds                                                      | `cuelume`                                                                                           |
| Repository ownership or an unfamiliar seam                              | `docs/agents/repository-map.md`, then confirm its paths and symbols with `rg`                       |
| Go HTTP or OpenAPI work                                                 | `huma`; for TypeScript consumers, also use `openapi-typescript`                                     |
| Server-state reads, cache keys, invalidation, or loading boundaries     | `docs/specs/server-state-query-migration.md`                                                        |
| Deployment, runtime configuration, release workflows, or revision proof | `docs/agents/deployable-inventory.md`                                                               |
| n8n package release                                                     | `docs/agents/n8n-package-release.md`                                                                |
| Video Editor, Quick Cut, or Recorder                                    | `docs/specs/video-editors-rebuild.md` and the relevant rows in `docs/specs/freecut-parity-audit.md` |

For reference implementations, read `docs/references/README.md` before inspecting a checkout. Use `postiz` or `shoutrrr` for publishing and durable automation, `miniPaint` for the Image Editor, and the named video references for recording or editing. Keep reference checkouts shallow and Git-ignored. Audit source and license before porting code; OpenPost's architecture, security, accessibility, provider rules, and product language remain authoritative.

## Authorities

- **Vikunja** owns private work, specs, priorities, and execution state. **GitHub Issues and pull requests** own public reports and contributor discussion.
- **Hindsight bank `rodrigo`** owns durable product terms, decisions, constraints, and history. Before substantial work, recall `project:openpost`, then verify the result against current code, Vikunja, or the live system. Retain only verified durable facts tagged `project:openpost` and `source:<agent>`.
- **This repository** owns code, tests, generated contracts, build and security rules, and public technical documentation. Keep project state out of repo-local memory files and mutable task boards.

Keep deployable projects in `apps/`, shared runtime code in `packages/`, browser suites in `tests/`, deployment files in `deploy/`, and repository manifests in `config/`. Public Go module names and root task scopes do not change when source folders move. Keep community policies in `.github/`, launch templates in `docs/launch-kit/`, social artwork in `assets/social/`, and browser configurations with their test suites. Keep `PRODUCT.md` and `DESIGN.md` at the root for design-tool discovery. Local review reports and screenshots are ignored; commit maintained acceptance inputs with their owning tests or design sources.

Keep third-party deployment packaging under `deploy/<platform>/`. If a platform requires its manifest at the repository root, use a dedicated wrapper repository instead of adding another root file here.

## Engineering invariants

- SvelteKit builds the interface; Go embeds it into one binary. Echo serves HTTP, Huma owns OpenAPI, and Bun ORM owns database access. SQLite is the self-host default; PostgreSQL supports Hosted.
- Publications are the canonical authored-content inventory. Page reads use stored state; provider calls occur only in explicit sync or durable job flows.
- Persistent work uses database jobs rather than in-memory goroutines. Media crosses the `BlobStorage` boundary. Provider adapters live under `apps/server/internal/platform/`.
- The binary roles are `all`, `web`, `worker`, and `migrate`. Self-hosted `all` auto-migrates; Hosted migrates once before starting `web` and `worker` against that schema.
- Svelte code uses runes, the typed API client, and shared UI/page controls. Visible form fields use shared primitives.
- PWA registration uses an absolute root URL through `SvelteKitPWA` and `pwa-manager.svelte`. Updates wait for open windows to close. Cache only public app resources; exclude API, authorization, query-bearing navigations, and original media. Test service workers against the production build with `tests/app/pwa.spec.ts`, not Vite dev.
- Authored color fields use `$lib/components/color-picker.svelte`. Keep canvas sampling, grading tools, CSS color expressions, and provider color categories in their specialized owners.
- `@openpost/query-catalog` owns cache-safe remote reads across web and mobile. Mutations reconcile through its affected keys; each route owns one cold loading boundary and keeps cached state visible while refreshing.
- Mobile server, token, and Workspace persistence is one transaction boundary owned by `apps/mobile/src/lib/identity-store.ts`. Keep all three behind its queue and crash marker; a committed server change clears the server-scoped session.
- API, CLI, MCP, and product surfaces share terms, authorization, and workspace boundaries. For a contract change, edit its source and regenerate every consumer.
- Put Huma request size limits on `huma.Operation.MaxBodyBytes`. Do not read and replace an HTTP request body before Huma, because Huma's body-read deadline can then cancel a long-running handler after the body is already buffered.
- External application authorization is separate from social-provider OAuth. Keep delegated client identity, consent, grants, credentials, and scope policy in `apps/server/internal/services/externalapps/`; keep durable signed delivery in `apps/server/internal/services/externalwebhooks/`.
- AI features use maintained SDKs behind `apps/server/internal/ai/` and the shared model and configuration choices.
- Keep marketing illustration colors in paired public light/dark tokens; do not change authenticated organization themes to style public campaigns.
- Theme tests use the request-scoped application preview context and the existing theme runtime. Restore saved appearance on preview exit; persist the scheme only after assignment succeeds.
- Theme chart tokens are categorical data colors. Keep `chart1` through `chart5` chromatic and pairwise distinct in every built-in scheme; reserve neutral gray for aggregated data outside the top series.
- Image layers without `color_grade_version` retain legacy Fabric adjustments. Version 1 routes layer and page-output grading through the shared editor color pipeline and the Fabric preview/export adapter. Never migrate legacy layers implicitly.
- A Video Editor sequence grade is one `sequenceColorGrade` adjustment item on its dedicated locked track. The timeline store keeps it over the full sequence range, and preview/export apply it once after compositing. Never treat it as an item-scoped adjustment layer.
- Keep secrets out of code and logs. Stored provider tokens remain encrypted.

## Execution

1. **Establish the boundary.** For broad, browser, or release work, run `devenv shell -- doctor`. Inspect the worktree and the owning code, tests, docs, and current task. Preserve unrelated changes. The step is complete when every intended file belongs to the requested concern and the expected behavior is explicit.
2. **Change the owner.** Work through the owning service or abstraction instead of reaching around it. Use Devenv and root `bun run` tasks. The step is complete when the smallest coherent implementation satisfies the behavior without a parallel source of truth.
3. **Prove behavior.** Reproduce bugs through the closest practical user-facing boundary and add the smallest stable regression test when one can fail on a plausible regression. Prefer focused practical verification over circular tests of private helpers, literals, or implementation branches. The step is complete when the changed behavior has independent evidence and the nearest relevant gate passes.
4. **Synchronize surfaces.** Update affected contracts, docs, product copy, and generated outputs from their sources. Add user-visible behavior, migration, or operator notes to `changes/<issue>.md` under the right changelog group. The step is complete when no affected surface describes the old behavior and contract checks pass when applicable.
5. **Finish cleanly.** Run the scoped root gate from `docs/agents/repository-map.md`; scale up to `bun run release -- check` for broad release proof and `bun run verify` only for high-risk production-build proof. Re-run `ux-consistency` for UI or copy. Once required checks pass, broaden or repeat them only for new edits, failures, or unresolved risks. The step is complete when relevant checks pass and residual risks are reported.

## Delivery

- Commit directly to `main` with Conventional Commits, one concern per commit. Stage only files owned by the current work.
- Release assets are user downloads. Keep scan reports in Actions; use Git SHAs, image digests, OCI labels, and native signatures instead of custom release manifests. Validate workflows with `bun run check -- workflows`.
- Push only when asked. A push is not a deployment.
- A request to release authorizes the required commits, pushes, tags, artifact publication, and deployment. State the revision and effect, run the required checks, and finish without another approval prompt. Ask separately for destructive live actions outside that release workflow.
