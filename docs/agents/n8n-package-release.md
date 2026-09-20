# n8n package release

The npm package is `@getopenpost/n8n-nodes-openpost`. Its SemVer is independent from the OpenPost app version.

## One-time registry bootstrap

npm requires a package to exist before it can trust a GitHub Actions publisher. Run `scripts/setup-n8n-publishing.sh` once. It publishes only a non-functional `0.0.0` placeholder, then guides the maintainer through trusting `getopenpost/openpost` and `.github/workflows/release.yml` for `npm publish`.

The real package must come from CI. Do not publish version `0.1.0` or later from a workstation because n8n verification requires GitHub provenance.

## Routine releases

Every publishable change under `packages/n8n-nodes-openpost/` must increase its stable package version. Pull-request CI enforces this rule.

The app's `v*` release workflow publishes n8n independently alongside deployment. The workflow packs the n8n package and checks npm:

1. An absent version publishes once through npm trusted publishing.
2. An existing version with the same tarball integrity is safe to reuse.
3. An existing version with different integrity stops the release and requires a version increase.
4. An unclear publish result triggers registry reconciliation, not a blind retry.

The workflow then runs n8n's community-package scanner, verifies npm signatures and provenance, and clean-installs the registry package with the pinned current n8n version. Package failures do not block the app release.

For a package-only release or recovery, increase its version, run `bun run check:n8n`, commit and push to main, then run `gh workflow run release.yml --ref main -f package=n8n`. This dispatch runs only the n8n publication and verification job, retaining trusted-publisher provenance without rebuilding or redeploying the app. Finish when that job succeeds and the registry serves the intended version.

Creator Portal submission remains a manual, one-time action after npm and release verification succeed.
