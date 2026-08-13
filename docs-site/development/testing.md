# Testing

Use the project-owned Devenv commands so local checks match CI.

```bash
devenv shell -- check
devenv shell -- lint
devenv shell -- test
devenv shell -- build
```

`devenv shell -- verify` runs all four gates. The check gate also verifies local documentation links, release-version behavior, and generated OpenAPI, TypeScript, CLI, and translation artifacts.

Ordinary pushes use the installed changed-file formatting hook. Before a release, `bun run release:check` runs checks, lint, and unit tests without production builds or browser and Docker suites. `bun run release:check:full` keeps the exhaustive local rehearsal when it is specifically needed.

Targeted commands are available for faster iteration:

```bash
devenv shell -- backend-test
devenv shell -- frontend-test
devenv shell -- cli-test
bun run test:e2e:app -- --workers=1
bun run test:e2e:docs -- --workers=1
```

Use the pinned Playwright Chromium installed by `setup`, and run one browser suite at a time. For visible changes, verify representative desktop and phone widths, keyboard and touch access, overflow, action visibility, and browser console health.

Browser suites start their own preview servers by default so an old process on the configured port cannot satisfy the test preflight. Set `OPENPOST_APP_E2E_REUSE_SERVER=1`, `OPENPOST_MARKETING_E2E_REUSE_SERVER=1`, or `OPENPOST_DOCS_E2E_REUSE_SERVER=1` only when deliberately testing an already-running matching server.
