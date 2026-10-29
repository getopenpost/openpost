# OpenPost CI and delivery design

Date: 2026-10-29. Scope: measured diagnosis and an implementation playbook, not a claim that the proposed pipeline is deployed. Source baseline: v7.34.2, tag `27522bef39a703431eccf3b04a84654583770a05`; public changelog recording commit `c87e97bd9314bf1b9c57aacaeea3babffa251b41`.

## Definition of done and boundary

A changelog-only update passes when the served changelog, feed, discovery surfaces and metadata contain exactly the published release; unchanged docs and client assets come from verified, input-compatible artifacts; the production browser error still symbolicates against the deployed bytes; and failed publication never exposes the candidate release publicly. A code release must retain required authorization, contracts, tests, security, artifact integrity and exact deployed-revision checks.

Performance acceptance is separate: measure queue, setup, actual work, artifact transfer and live publication independently. Require zero duplicate shared tasks within one composed build and zero Go/API/doc recompilation for an input-compatible changelog-only update. A proposed warmed content-update target is under three minutes, not a forecast or a verified result. Revert an experiment if it breaks the correctness predicate, even when faster.

Scope: CI planning and scheduling, public-site composition, docs-input generation, source-map handling, artifact promotion and content publication. Roughly a dozen existing owners/configurations are involved. Package/native selection already works and stays in its existing owners. This investigation does not require a new build system. The first experiments are independently reversible; artifact identity changes and public delivery cutover require higher rigor and a rollback demonstration. Initial diagnosis is hours of work; the final architecture is multiple measured changes, not a promised one-day rewrite.

## What the public changelog deployment actually is

`/changelog` and its Atom feed read `CHANGELOG.md` during static marketing generation. Cloudflare's Git integration responds to the recording commit by running `bun install --frozen-lockfile && bun run build -- public-site`. That root build generates docs inputs, builds marketing and docs, then combines them into `dist/public-site`. The site contains documentation, tools, JavaScript, images and discovery files, not only the new release paragraph.

The application was already ready before this separate site deployment. Product deployment, GitHub release publication and public-site freshness are distinct outcomes. Post-publication bookkeeping correctly waits for a successful release; compiling every unaffected public component after that point is not inherent to truthful publication.

## Measured baseline

[Release workflow](https://github.com/getopenpost/openpost/actions/runs/40940826960), [tag CI](https://github.com/getopenpost/openpost/actions/runs/40940826901), [public deployment](https://dash.cloudflare.com/1e84f0262ece6e76da6df50801960036/pages/view/openpost-marketing/efd0e931-62a6-4df8-b02f-ebb6f9cad688).

- Local preparation: 32 seconds. Tag to GitHub publication: 37m32s. Tag to release-workflow completion: 38m08s. Tag to live public changelog deployment: 50m28s.
- Slowest app browser job: 23m59s, after 7m51s of runner queue. It included nearly five minutes of preparation, including 3m49s of Bun installation. Backend and marketing browser job maxima were 14m58s and 15m55s. These are parallel job runtimes, not additive phases.
- A main CI run for the same SHA competed with tag CI until canceled. Moving every consumer earlier can worsen the queue if consumers occupy slots while producers wait.
- Release skipped Android signing, all CLI builds, SDK/n8n/CLI publication and the live new-wrapper install. Tag CI skipped native packaging/source checks. The three server binaries and exact tested image still shipped and readiness passed.

Public Pages deployment: 12m22s, approximately:

| Work                           | Observed wall time | Interpretation                                                                                               |
| ------------------------------ | -----------------: | ------------------------------------------------------------------------------------------------------------ |
| Initialize and clone           |                19s | Hosting/setup overhead; reduce frequency, cannot assume zero                                                 |
| First dependency installation  |              46.5s | Includes root UI postinstall; cache/environment opportunity                                                  |
| Second dependency installation |               1.1s | Redundant, but a small saving                                                                                |
| Docs inputs                    |            120.71s | About 110s before OpenAPI sync, then CLI-reference generation; exact compile/download split not instrumented |
| Marketing build                |            467.05s | Includes synchronous client and server source-map processing and uploads                                     |
| Docs build                     |            122.73s | Runs concurrently with marketing; 573 pages, static generation only 22.2s                                    |
| Composition                    |              0.29s | Already negligible                                                                                           |
| Output validation / transition |          About 12s | Measured gap between composition and deploy stage                                                            |
| Deployment                     |          About 72s | Includes 55.28s uploading 5,543 files; 1,413 reused, 6,956 total                                             |

Do not add marketing and docs times. Do not add the 55s upload to the 72s deploy stage. There is no measured basis for attributing the full 12 minutes to Next.js, DNS or CDN propagation.

### Concrete source-map and graph evidence

The marketing log shows client symbol uploads starting at 20:13:54.999 and a second server phase starting at 20:17:15.557. Each phase processes many batches of 50 symbol sets. Marketing's client build ends at 20:17:03.533; its overall server build ends at 20:20:05.497. These windows include surrounding processing; they are not precise upload-only measurements.

Installed `@posthog/rollup-plugin` 1.4.7 uses a sequential `writeBundle` hook and awaits `runSourcemapCli`. Our helper applies that plugin to marketing without a client/server filter. Marketing uses the static adapter, so server build output is not a deployed request-serving server. Whether build-time failures require server symbolication must be checked before removing those maps. Client maps and the injected identifiers must remain matched to the final browser bytes.

The docs and marketing commands launch separate Turbo processes in parallel. Both report cache misses and execute the same shared task hashes, including Dither build/check tasks. Remote caching is disabled in the trace, and Next reports no build cache. The initial install's local UI cache hits do not demonstrate cross-job or cross-deployment artifact reuse. Cache inputs include revision/run variables: changing those inputs legitimately invalidates tasks today. Removing them blindly would risk stale provenance and diagnostics.

## Necessary safety versus avoidable cost

| Concern                                                        | Keep                                                                                  | Avoidable or changeable design                                                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Auth, storage, permissions, migrations, API/provider contracts | Meaningful coverage and compatibility checks                                          | Repeating identical proven checks for the same inputs on main and tag                                                        |
| Browser correctness                                            | Real production-artifact tests for affected user boundaries                           | Unbalanced shards, repeated installs, unrelated tests on content-only updates; reduce selection only after shadow validation |
| Artifact identity                                              | Exact source/config/toolchain inputs, checksums and correct version labels            | Rebuilding bytes that already passed; re-downloading the same artifact repeatedly                                            |
| Container/native qualification                                 | Actual changed platform/build inputs, signing and final smoke checks                  | Native builds on server-only releases; changing release ABI coverage for speed                                               |
| Diagnostics                                                    | Private matching client maps, correct release association, observable upload failures | Synchronous upload of unused server bundles; duplicate upload phases; allowing map transfer to dominate publishing           |
| Documentation                                                  | Regenerate contracts when source inputs change; verify routes/discovery/redirects     | Regenerating Go-produced references and 573 docs pages for a release-note-only change                                        |
| Public content                                                 | Correct changelog, Atom, SEO and agent-readable output                                | Recompiling all tools and docs to change a release entry                                                                     |
| Runner capacity                                                | Enough resources for producers and critical gates                                     | Duplicate same-SHA full runs, too many consumers occupying slots before producer artifacts exist                             |
| Hosting delivery                                               | Transfer changed bytes, publish and verify live routes                                | A second independent build in Cloudflare after GitHub already built and checked equivalent inputs                            |
| Automation bookkeeping                                         | One truthful, idempotent record after publication                                     | Extra cleanup commits and duplicate full CI; PR #489 addresses identity and changelog-only main CI                           |

Physical work and chosen policy are different: a deployment must transfer and serve correct bytes, but the observed 72 seconds is not a universal lower bound. The current exhaustive tag matrix is a safety policy; changing it requires a validated replacement qualification model, not merely deleting checks.

## Industry patterns worth adopting

The transferable mechanisms are explicit dependency graphs, deterministic shared outputs, changed-target selection and immutable artifact promotion. Meta's [Buck2 design](https://engineering.fb.com/2023/04/06/open-source/buck2-open-source-large-scale-build-system/) uses one incremental graph. [Bazel remote caching](https://bazel.build/remote/caching) shares reproducible action outputs. [Uber Jazelle](https://github.com/uber-web/jazelle) documents incremental, cacheable JavaScript monorepo builds. These support improving our existing task graph; they do not justify a tool migration by themselves.

Meta's [predictive selection](https://engineering.fb.com/2018/11/21/developer-tools/predictive-test-selection/) uses historical outcomes, while its [flake tracking](https://engineering.fb.com/2020/12/10/developer-tools/probabilistic-flakiness/) treats test reliability separately. We do not have equivalent evidence or training data. Keep full qualification while comparing a proposed selector against it in shadow mode.

Google SRE describes [reproducible builds, automated testing/deployment and components with independent rates of change](https://sre.google/workbook/canarying-releases/). Apply that to website content, client binaries, server images and npm distributions rather than making every app release rebuild them all. A [GitHub merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) is worth considering only if merge contention warrants its runner cost; it is not a cure for this site's rebuild.

## Ordered experiments and adoption gates

### 1. Instrument and simplify the existing build

Hypothesis: removing duplication reduces work without changing output.

- Remove the second install from the Pages user command, retaining Cloudflare's successful frozen installation and root preparation.
- Run one Turbo graph with both public-site package filters after docs-input preparation, rather than two independent graph schedulers.
- Capture per-step duration, cache keys, cache hit status, symbol upload phase and uploaded bytes/file count. Treat queue and runner occupation separately.

Gate: same public route catalogue, redirects, composed output and dependency preparation; each shared task executes once; no simultaneous writes to package output directories. Compare cold and warm builds, not one lucky run. Verdict: NOT VERIFIED.

### 2. Prove source-map scope and move transfer out of compilation safely

Hypothesis: unused server symbols and blocking transfer account for a material part of marketing latency.

First inspect the final static deployment file set and every runtime/build diagnostic reader. Disable only a proven-unused server upload scope, not all source maps. Preserve private client maps before the existing delete-after-upload stage. Measure injection separately from network upload. A known production browser error must resolve to the authored source and expected release; assert maps are not public.

Asynchronous upload is a separate, riskier experiment. It needs a durable retryable upload receipt, retained maps for exactly the deployed bytes, release association, failure alerting and proof of how errors arriving before symbols are handled. If delayed events cannot be recovered, either complete upload before exposure or retain a narrower blocking client-map gate. Do not silently convert upload failures into success. Debug-ID determinism and duplicate-upload behavior remain INCONCLUSIVE until tested against the pinned CLI.

Gate: correct production symbolication, unchanged map privacy and reliable failure recovery. Verdict: NOT VERIFIED.

### 3. Cache changed modules and generated docs inputs

Hypothesis: a changelog-only update can reuse docs, tool assets and generated Go references.

Key OpenAPI/media/CLI generation on their actual Go source, module locks, generator code, relevant config and toolchain. Use declared task outputs and an authenticated shared cache for reproducible outputs. Intentionally change each key input and prove invalidation. Compare two identical builds to determine why public client assets churn; do not assume random source-map identifiers are the cause.

Separate component identity from composition identity explicitly if required. `CF_PAGES_COMMIT_SHA`, embedded revision values and source-map release versions currently affect bytes. Retain truthful component revisions and record the composed site's source inputs; do not remove identity variables from hashes just to manufacture cache hits.

Gate: zero Go/doc compiler work on an input-compatible changelog update; all changed inputs invalidate; no stale revisions, maps or API docs. Verdict: NOT VERIFIED.

### 4. Build and check the public site once, then deploy those bytes

Hypothesis: the hosting layer should receive an already-qualified public-site artifact.

Extend the existing canonical marketing/docs artifact owners and public-artifact checks, compose and retain one deployable artifact, then upload it from the public-site delivery workflow. Use least-privilege credentials, digest/source/config validation and a known-good rollback artifact. Cloudflare documents [Wrangler deployment for Git-integrated projects](https://developers.cloudflare.com/pages/configuration/git-integration/) with automatic Git builds disabled; verify the project-specific transition before changing production settings.

A tag artifact cannot simply replace the later changelog commit: it does not yet contain the newly recorded release entry. The straightforward version builds from that recording commit with cached unchanged components, then deploys its checked artifact. A staged prebuilt candidate is possible only if generated release content, publication/date metadata and provenance are part of the qualification inputs, and promotion cannot occur before the app release succeeds. Existing deployment proof must evolve deliberately if the artifact's source model changes.

Gate: the exact tested public artifact reaches production; redirects, documentation, media/tools, changelog/feed, agent surfaces and client symbolication pass; failed publication leaves staged content private; rollback is demonstrated. Shadow preview deployment first. Verdict: NOT VERIFIED.

### 5. Make release-note updates a small content operation if still needed

Hypothesis: release entries should not require compilation of unrelated tools or documentation.

Compare a maintained content-only rendering path using compatible static assets against an edge-rendered/read-only published-release feed. The feed option introduces runtime availability and caching responsibilities; retain server-visible SEO, Atom output and last-known-good behavior. The static option must regenerate every affected representation, not patch only one HTML file. Choose only after experiments 1–4 establish the remaining cost.

Gate: new release appears in every representation, unrelated route/assets remain unchanged, publishing failures stay private and rollback works. Warmed update target under three minutes is an experiment target, not a promised saving. Verdict: NOT VERIFIED.

### 6. Shorten release qualification without reducing coverage blindly

- Avoid duplicate same-SHA main/tag work. Reuse an accepted exact-input proof or coordinate cancellation only after the full authoritative replacement is actually scheduled; never cancel an unrelated/newer revision.
- Keep producer capacity available. Earlier consumer setup is beneficial only if it does not starve the frontend/image producers. Benchmark concurrency policies with queue and runner minutes.
- Use the retained Playwright timing data to balance shards. Separate dependency installation, fixtures and browsers from actual test duration; investigate retries and flakes before pruning.
- Shadow affected-test selection against full runs, record missed failures, and retain unknown-input fallback. Move expensive cross-platform/reproducibility checks to release/nightly only where the resulting policy still qualifies the shipped artifact.

Gate: required semantic coverage and production-artifact checks remain; no missing failure in the audited selection window; cache/proof provenance holds; queue and total work improve under comparable load. Do not adopt an incomplete selector on a single successful release. Verdict: NOT VERIFIED.

## Decision and audit artifacts

Recommended first batch: experiments 1 and the server-symbol scope proof in 2. Then generated-input caching in 3. Public artifact promotion in 4 has higher payoff but a broader trust and rollout boundary. Content separation and predictive selection come after those measurements. Reject a wholesale Bazel/Buck2 migration for now: the trace already identifies fixable duplication in the current owners.

[Primary-source research](./ci-delivery-primary-sources-2026-10-29.md) records external evidence and unresolved questions. [Decision trail](./ci-delivery-decisions-2026-10-29.tsv) records verdicts. Provider responses, credentials and raw operator logs remain outside Git. The initial external trace exports are local `/tmp/v7342-public-build-log-full.json`, `/tmp/v7342-ci-jobs-raw.json` and `/tmp/v7342-release-jobs-raw.json`; linked provider runs are the durable upstream evidence.
