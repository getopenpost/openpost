# Static client source maps (issue #490, lane B)

Web and marketing run the existing PostHog plugin only for Vite client builds. Their Vite 8 configuration callbacks use `isSsrBuild` to avoid maps for build-only SSR output. The upload plugin also filters `config.build.ssr`, before its config/output/write hooks run. A post-order config hook disables inherited SSR maps after SvelteKit sets the effective `build.ssr`, even when the initial callback did not know it was an SSR build. Docs behavior stays unchanged.

Pinned `@posthog/rollup-plugin` 1.4.7 has a sequential `writeBundle` hook awaiting `runSourcemapCli`, then reloads modified JavaScript into the bundle. The client retains that path, hidden maps, release name/version/build identity, strict key/project/region/revision checks, upload failure propagation, and deletion after success. Uploads remain synchronous.

## Output and error audit

Both production Svelte configs use adapter-static. Marketing prerenders routes; web disables SSR and produces an HTML fallback. Installed adapter-static writes client assets, prerendered pages and an optional fallback, without a request-serving server. Web packaging copies apps/web/build into apps/server/cmd/openpost/public for Go embedding. Public composition reads marketing dist.

Marketing has no server handleError override. Installed SvelteKit logs formatted server errors and throws on prerender HTTP errors by default. A real minimal SvelteKit static build fixture verifies HTML output without a server directory or maps, while .svelte-kit/output/server/index.js remains build-only. A deliberate prerender load failure fails the build and includes the original error message without uploaded SSR symbols.

This fixture and source audit do not constitute a full production build or deployed-output inspection.

## Verification

`bun test tests/build/posthog-source-maps.test.ts` initially reproduced two failures: Vite resolved the upload plugin for both app and marketing SSR builds. The fixed tests load both actual Vite configs with client/SSR ConfigEnv values and exercise Vite plugin resolution.

Root integration runs the real Vite fixtures in Node, matching production execution. A Node module-resolution hook changes only the installed plugin's CLI executable to a local mock. The mock checks map source content and records release arguments. Client builds call it and leave no public maps or sourceMappingURL; SSR builds do not call it. A failing CLI rejects the build and retains maps. Missing credentials, region and release identity fail explicitly. The mock makes no network request and does not prove real identifier injection or live symbolication.

Helper type validation passes with `bunx tsc --noEmit --skipLibCheck --module esnext --moduleResolution bundler --target esnext scripts/posthog-source-maps.ts`. Test-file static type validation was unavailable because this checkout lacks Bun type declarations. Bun executes all 12 tests successfully. Fixture subprocess output uses file-backed logs because this macOS Bun runtime loses some piped subprocess output; Vite bundling itself runs in Node.

An accidental broad test command caused by shell quoting was stopped. Its results are not qualification evidence.

## Remaining integration proof

Root must inspect full shipping app/public-site artifacts, verify private matching browser maps and release association against exact deployed bytes, and demonstrate browser symbolication for both surfaces. Confirm build-only failures remain actionable in CI logs. Measure client and avoided SSR processing separately. No identifier determinism, asset churn cause, throughput or wall-time saving is claimed here.
