# Releases and Versioning

OpenPost follows [Semantic Versioning 2.0.0](https://semver.org/) and derives the normal release bump from [Conventional Commits](https://www.conventionalcommits.org/).

| Commit impact | Version change | Example |
| --- | --- | --- |
| Backward-compatible fix or maintenance | Patch | `v1.27.9` → `v1.27.10` |
| Backward-compatible feature | Minor | `v1.27.9` → `v1.28.0` |
| Breaking API or product change | Major | `v1.27.9` → `v2.0.0` |

`feat:` selects a minor release. A `!` after the commit type or a `BREAKING CHANGE:` footer selects a major release. When neither appears, a release advances the patch version.

## Production release

Run the release from a clean, up-to-date `main` worktree:

```bash
devenv shell -- doctor
devenv shell -- verify
pnpm release:prod "fix: describe the shipped change"
```

The release script stages the complete worktree, creates a commit when needed, inspects every commit since the latest tag, and creates the highest required SemVer bump. It then pushes `main` and the tag, waits for the `Build and Release` workflow, confirms the GitHub release, and checks public readiness.

Use `RELEASE_BUMP=minor|major` only to raise the inferred impact for an intentional release boundary. `RELEASE_VERSION=vX.Y.Z` is reserved for an explicit version-line correction or migration. Overrides cannot lower the version required by the commit history.

## Version-line correction

Historical OpenPost tags advanced the patch component for most releases and later reset to `v1.1.0`, even when the releases contained backward-compatible features. The reconstruction classified the Conventional Commit subjects in each `previous tag..tag` cohort, then applied the highest impact in that cohort. Replaying the published releases from the first stable line gives 27 feature-bearing release cohorts and seven patch-only releases after the last feature cohort, with no published breaking change.

The code shipped as `v1.1.22` therefore maps to `v1.27.7`. The versioning and documentation correction was the next patch-only change, `v1.27.8`, but that tag failed preflight before GitHub release creation or deployment. Following the immutable-tag failure policy, `v1.27.9` fixes the clean-checkout check and becomes the first published release on the corrected line. Future releases continue from there using the rules above.

## Failure policy

Never move or reuse a published tag. If a tag workflow fails, fix the cause and release a new SemVer version. A release is complete only after the workflow succeeds, the GitHub release exists, the production deployment reports the new revision, and `/api/v1/ready` succeeds.
