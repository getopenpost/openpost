# Testing

Use the project-owned Devenv commands so local checks match CI.

```bash
devenv shell -- check
devenv shell -- lint
devenv shell -- test
devenv shell -- build
```

`devenv shell -- verify` runs all four gates. The check gate also verifies local documentation links, release-version behavior, and generated OpenAPI, TypeScript, CLI, and translation artifacts.

Targeted commands are available for faster iteration:

```bash
devenv shell -- backend-test
devenv shell -- frontend-test
devenv shell -- cli-test
pnpm test:e2e:app -- --workers=1
pnpm test:e2e:docs -- --workers=1
```

Use the pinned Playwright Chromium installed by `setup`, and run one browser suite at a time. For visible changes, verify representative desktop and phone widths, keyboard and touch access, overflow, action visibility, and browser console health.
