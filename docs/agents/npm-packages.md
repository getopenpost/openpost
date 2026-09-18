# npm SDK and CLI packages

The plain npm packages are `@getopenpost/sdk` (TypeScript client in `packages/sdk/`) and `@getopenpost/cli` (binary wrapper in `packages/cli/`). Both use independent SemVer and trusted publishing, mirroring `docs/agents/n8n-package-release.md`.

## One-time registry bootstrap

npm requires each package to exist before it can trust a GitHub Actions publisher. For each of `@getopenpost/sdk` and `@getopenpost/cli`, once from a maintainer workstation:

1. `cd packages/sdk` (or `packages/cli`), then `npm publish --access public` a `0.0.0` placeholder. Never publish a real version from a workstation; provenance must come from CI.
2. In the npm package settings, trust `getopenpost/openpost` and `.github/workflows/release.yml` as a GitHub Actions publisher, exactly like the n8n package.

Real versions only ever come from the release workflow's `publish-npm` job.

## Routine releases

Every publishable change under `packages/sdk/` or `packages/cli/` must increase that package's stable version. PR CI enforces this through `bun scripts/npm-package-release.mjs check-version --package <dir>` in the `npm-packages` job, which also runs each package's check, test, build, and an `npm pack --dry-run` payload inspection.

The app's `v*` release workflow publishes the SDK beside the Hosted deployment, never behind it. The CLI wrapper instead publishes after the GitHub release goes public, because it installs its binaries from that release:

1. `bun scripts/tasks.mjs check npm-packages` proves the exact sources, including the payload allowlist gate.
2. `bun scripts/npm-package-release.mjs publish --package <dir>` packs and either publishes an absent version once through trusted publishing or reconciles an existing version by tarball integrity. A version that exists with different content stops the release and requires a version increase.
3. `bun scripts/verify-published-npm-package.mjs --kind sdk|cli` clean-installs the registry tarball, runs `npm audit signatures`, checks integrity, and loads the package. For the CLI it also proves the default release download end to end.
4. `verify-npm-live` installs the published wrapper after publication and runs its default download exactly as users hit it. Reports only: a failure here opens a follow-up instead of blocking anything already shipped.

## CLI release pin

`packages/cli/package.json` pins `openpost.releaseTag` to the GitHub release the wrapper installs by default. Rules:

- The pin must name a release that ships `.sha256` checksum assets (every release after this change lands). Older releases fail closed unless `OPENPOST_CLI_ALLOW_UNVERIFIED=1` is set.
- Bump the pin to the upcoming tag during release preparation whenever the wrapper should track a new CLI, together with the wrapper version.
- The CLI publishes after `publish-release`, so the pinned release is public when the wrapper ships and the live download proof runs against it. If release inspection ever fails, verification fails closed instead of silently skipping.

## Update checks

The instance update system (`/api/v1/admin/update-status`) compares the running server against GitHub releases and is unaffected by npm state. The CLI wrapper downloads from those same GitHub releases, so the server remains the single source of truth for what "latest" means.
