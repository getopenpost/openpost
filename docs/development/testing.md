# Testing

Run the project-owned root commands so local checks match CI.

This page is for contributors choosing the smallest reliable gate for a change.

```bash
bun run check
bun run lint
bun run test
bun run build
```

`bun run verify` runs the format, check, lint, test, and build gates. Checks validate the current contracts, documentation links, release ownership, and generated artifacts. They also include the cached public production-build regression, so the complete check command costs more than typechecking alone. Repository script regressions run once in the test sweep. Explicit policy selectors retain their focused tests; CI runs the repository sweep after its policy checks.

The named commands run independent work in parallel. Turbo restores unchanged
type-check, frontend lint, test, policy, and build tasks by content; Go reuses its
shared compile cache. Formatting and Go lint still scan their complete requested
scope. Use `TURBO_FORCE=true bun run check -- frontend` only when diagnosing
cache behavior, not as the normal feedback loop.

Ordinary pushes use the installed changed-file syntax and formatting hook. Before a release, `bun run release -- check` installs frozen dependencies and runs the shared local preflight: formatting first, then generated/type/policy checks, lint, package and mobile source checks, Go tests, repository regressions, and workspace tests. Workspace tests include Vitest's Chromium component suites. The separate Playwright E2E suites, race checks, platform builds and full release rehearsal remain explicit gates. See [Releases](./releases.md) for the complete local and CI boundaries.

For a small change, start with the owning test file and scoped check. A cache hit for an unchanged whole workspace does not predict the time after a source edit. Report changed-code timings separately from cached reruns, and measure deployment after local preparation.

For an everyday edit, run the affected local checks before pushing:

```bash
bun run check:affected
bun run check:affected --base origin/main --plan
bun run check:affected --base origin/main
```

Without `--base`, the command includes unstaged, staged and non-ignored untracked paths. With `--base REV`, it also includes committed changes since the merge-base of that local revision and `HEAD`. It never fetches the base. Ambiguous names fail even when Git warnings are disabled; use an explicit name such as `refs/heads/main` to select a particular ref. Use `--base` after committing so the branch changes remain selected. A clean no-base run selects no work and does not validate `HEAD`. Conflicts, invalid revisions and invalid or duplicate flags fail before checks start.

The command checks syntax and formatting for selected existing files, then runs the maintained whole-module or workspace check/test scopes for ordinary server, CLI, web, marketing and docs changes. Standalone mobile runs `check:source` once. Deletions select their former owner, and renames select both owners. Shared packages/assets, configuration, delivery and unknown paths use full preflight after the same selected-path syntax, formatting and whitespace checks. Web library or message changes also use full preflight because marketing imports the web library through its `$lib` alias. Browser tests retain their maintained runner and production-mode cases.

`--plan` reads Git and source manifests and prints the paths, base revisions, selected commands, structured steps, fallback reasons and omitted gates without executing checks. Affected step details include the execution directory, declared argument array and environment overrides, including the executor lock override. Inherited environment values are never printed. Argument arrays precede runtime Turbo cache routing; nested tasks show their root runner command. Other commands retain their existing plan shape. A selected run omits aggregate repository policy, unrelated checks/tests, lint except where a maintained check or mobile gate runs it incidentally, the full dead-code sweep and package payload verification. Both selected runs and full-preflight fallbacks print the remaining omissions, including Playwright E2E, security scans, Go race/integration checks, production builds/container smoke and platform packaging. Local results never create release proof. Full release preparation still uses the unchanged preflight described in [Releases](./releases.md). There is no five-minute guarantee for a changed workspace.

Targeted commands are available for faster iteration:

```bash
bun run test -- backend
bun run test -- frontend
bun run test -- cli
bun run test -- e2e
bun run test -- e2e-app
```

Use the pinned Playwright Chromium installed by `setup`, and run one browser suite at a time. For visible changes, verify representative desktop and phone widths, keyboard and touch access, overflow, action visibility, and browser console health.

The app's `test:browser` command prepares translations once and runs four isolated Vitest shards sequentially. CI supplies its own shard argument. Production-mode preview tests run separately. Keep the real translation catalogue and file isolation when tuning this loop.

One-shot component runs omit source maps only for generated Paraglide JavaScript. The loader preserves the JavaScript bytes and authored source maps; watch and coverage runs bypass it. A custom CLI reporter can replace the root eligibility reporter and leave this optimization off. When upgrading Vite or Vitest, run `cd apps/web && bun run test:browser-tools` to check real generated leaf and wrapper responses, authored maps, and the coverage bypass. This command needs Chromium and belongs to browser verification, not repository policy checks.

On the development laptop on 2026-10-26, the maintained four-shard command passed 315 files and 1,387 cases in 7m19s, including preparation. The separate production command passed two files and three cases in 21.5s. An earlier admitted run of the same case inventory took 11m05s for development, but it was not a paired benchmark and test-body timings varied. These numbers describe component tests, not full preflight or deployment.

The complete local preflight passed in 16m16s on 2026-10-27 in a prepared checkout with partial cache reuse. Generation, type and policy checks took 4m12s, repository regressions 1m06s, and workspace tests 10m28s. Go results and 16 of 24 workspace tasks were cached. This is neither a cold-run estimate nor a five-minute release-preparation guarantee.

Browser suites start their own preview servers by default so an old process on the configured port cannot satisfy the test preflight. Set `OPENPOST_APP_E2E_REUSE_SERVER=1`, `OPENPOST_MARKETING_E2E_REUSE_SERVER=1`, or `OPENPOST_DOCS_E2E_REUSE_SERVER=1` only when deliberately testing an already-running matching server.
