# SDK package release

The npm package is `@getopenpost/sdk`. Its SemVer is independent from the OpenPost app version.

## Routine releases

Every publishable change under `packages/sdk/` must increase its stable package version. Pull-request CI compares the package with its base commit; main and tag CI compare it with the previous published release, so a main push that changed the package without a version increase cannot prove a release. All of them fail when package sources changed without a version increase.

Version admission ignores only the compiler-excluded `src/**/*.test.ts` files, so test-only edits do not require a new version. Every other path under `packages/sdk/` still requires an increase, including build configuration, `README.md`, and the production side of a rename. The payload check rejects compiled `*.test.*` files in `dist`, so a test pulled in by a production import or stale output cannot ship.

The app's `v*` release workflow publishes the SDK independently, beside the Hosted deployment:

1. An absent version publishes once through npm trusted publishing.
2. An existing version with the same tarball integrity is safe to reuse.
3. An existing version with different integrity stops the package job and requires a version increase. It does not block the app deployment.
4. An unclear publish result triggers registry reconciliation, not a blind retry.

The package job then verifies provenance, integrity and a clean registry install.

## Package-only release or recovery

Increase `packages/sdk/package.json`, run `bun scripts/tasks.mjs check npm-packages`, commit and push to `main`, then run:

```bash
gh workflow run release.yml --ref main -f package=sdk
```

This dispatch publishes and verifies only the SDK, retaining trusted-publisher provenance without rebuilding or redeploying the app. Finish when that job succeeds and the registry serves the intended version.

Never reuse a published version with different contents. Bump the patch version instead.
