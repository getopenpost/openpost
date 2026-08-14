# Testing

Run the project-owned root commands so local checks match CI.

This page is for contributors choosing the smallest reliable gate for a change.

```bash
bun run check
bun run lint
bun run test
bun run build
```

`bun run verify` runs the format, check, lint, test, and build gates. The check gate also verifies local documentation links, release-version behavior, and generated OpenAPI, TypeScript, CLI, and translation artifacts.

The named commands run independent work in parallel. Turbo restores unchanged
type-check, frontend lint, test, policy, and build tasks by content; Go reuses its
shared compile cache. Formatting and Go lint still scan their complete requested
scope. Use `TURBO_FORCE=true bun run check -- frontend` only when diagnosing
cache behavior, not as the normal feedback loop.

Ordinary pushes use the installed changed-file syntax and formatting hook. Before a release, `bun run release -- check` runs formatting, checks, lint, and non-browser unit tests without production builds, browser suites, security scans, or Docker. `bun run release -- check-full` keeps the exhaustive local rehearsal when it is specifically needed.

Targeted commands are available for faster iteration:

```bash
bun run test -- backend
bun run test -- frontend
bun run test -- cli
bun run test -- e2e
bun run test -- e2e-app
bun run test -- e2e-docs
```

Use the pinned Playwright Chromium installed by `setup`, and run one browser suite at a time. For visible changes, verify representative desktop and phone widths, keyboard and touch access, overflow, action visibility, and browser console health.

Browser suites start their own preview servers by default so an old process on the configured port cannot satisfy the test preflight. Set `OPENPOST_APP_E2E_REUSE_SERVER=1`, `OPENPOST_MARKETING_E2E_REUSE_SERVER=1`, or `OPENPOST_DOCS_E2E_REUSE_SERVER=1` only when deliberately testing an already-running matching server.
