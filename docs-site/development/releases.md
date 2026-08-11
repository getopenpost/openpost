# Releases and Versioning

OpenPost follows [Semantic Versioning 2.0.0](https://semver.org/) and derives the normal release bump from [Conventional Commits](https://www.conventionalcommits.org/).

| Commit impact                          | Version change | Example                |
| -------------------------------------- | -------------- | ---------------------- |
| Backward-compatible fix or maintenance | Patch          | `v1.27.9` → `v1.27.10` |
| Backward-compatible feature            | Minor          | `v1.27.9` → `v1.28.0`  |
| Breaking API or product change         | Major          | `v1.27.9` → `v2.0.0`   |

`feat:` selects a minor release. A `!` after the commit type or a `BREAKING CHANGE:` footer selects a major release. When neither appears, a release advances the patch version.

## Production release

Run the release from an audited, up-to-date `main` worktree. Uncommitted work is allowed when the command includes its Conventional Commit message:

```bash
bun run release:plan
bun run release:preflight
bun run release:prod "fix: describe the shipped change"
```

`release:plan` inventories every path changed since the latest release, plus staged, unstaged, and untracked work, before anything is written. [`release-surfaces.json`](https://github.com/rodrgds/openpost/blob/main/release-surfaces.json) assigns each maintained path to one or more release surfaces or a reasoned exemption; both release planning and CI fail when a new path has no owner. Pull-request CI uses that registry to run only affected runtime, site, browser, security, and image checks. Pushes to `main` still run the complete candidate matrix. `release:preflight` checks the worktree, GitHub access, required workflows and deployment configuration, and current production readiness. `release:prod` promotes `CHANGELOG.md`, runs the release, changelog, and provider-certification contracts locally, then commits and pushes `main`. GitHub CI is the correctness authority for the immutable candidate SHA, and the command waits for that matrix before creating a tag. Use `release:check` when an explicit exhaustive local run is needed; it retains the canonical Devenv, race, security, browser, and production-image gates and the 24-hour exact-worktree stamp.

The production-image check enforces a 20 GB budget for unused local BuildKit cache and targets at least 20 GB of host free space. Inspect or enforce those limits directly with `devenv shell -- docker-cache-status` and `devenv shell -- docker-cache-prune`. Set `OPENPOST_DOCKER_CACHE_MAX_STORAGE` or `OPENPOST_DOCKER_MIN_FREE_SPACE` to change them. The prune command does not delete images, containers, or volumes.

On a 16 GiB Mac, configure Docker Desktop with 10 GB memory and 4 GB swap. The production frontend build has been verified with that allocation and can be killed by the VM with Docker's 8 GB memory and 1 GB swap allocation. Preflight rejects a macOS Docker VM below 9.5 GiB; `OPENPOST_DOCKER_MIN_MEMORY_GIB` is available only for a host-specific, proven override.

At the candidate boundary, CI derives a versioned release manifest from the prepared `CHANGELOG.md` release section and the exact Git SHA. The manifest contains the stable SemVer and full revision. CI embeds that same manifest in the image, stamps both OCI labels and server build values from it, and verifies the labels, embedded file, `/api/v1/version`, SQLite, FFmpeg/FFprobe, liveness, readiness, and the OCI health status while restart-smoking the image against a clean database. The candidate job also creates an SPDX SBOM and runs the pinned final-image vulnerability scan described in [Container Image Support and Assurance](/operations/container-image).

CI publishes the verified `linux/amd64` image once as `sha-<revision>` and records the resulting registry digest plus hashes of the manifest, SBOM, and scan report in the same candidate artifact. The tag workflow downloads that artifact from the exact successful CI run, verifies its hashes, requires the manifest version and revision to match the tag, and creates or reuses a GitHub release draft with the canonical changelog notes. A rerun accepts only a matching draft whose existing assets are complete uploads from the expected set. An already public release, changed notes, an unexpected asset, or any other inconsistent state stops the workflow. The workflow does not automatically delete a failed draft.

The draft receives the release manifest, digest evidence, SBOM, full scan report, three server binaries, four CLI binaries, four MCP binaries, and the Android APK. Candidate CI builds the unsigned Android APK once, records its SHA-256 digest, and retains both files under the exact revision. The tag workflow verifies that digest and only signs the retained APK when signing credentials are configured; it does not rebuild the frontend or Android project. Each artifact job checks that the release is still a draft before it uploads. Image promotion waits for every artifact matrix and the complete expected asset set, then copies the recorded digest to the release tag and `latest` without rebuilding. The signed deployment hook receives that digest, validates the candidate against production configuration and mounted secrets, and automatically restores the previous image if readiness fails. Hosted verification then requires public readiness plus `/api/v1/version` reporting both the release tag and exact revision. Only the final job rechecks the exact asset set and canonical notes and publishes the draft. No public GitHub release is announced while an artifact, promotion, deployment, or readiness gate is still pending.

Use `bun run release:prepare "<commit>"` when you want to stop after the exact SHA has passed local and hosted checks. Finish later with `bun run release:promote <tag>`. `bun run release:status` compares the local SHA, candidate CI run, and public production revision.

`CHANGELOG.md` is the release-history source of truth. Add notable work to `Unreleased` while implementing it. Do not edit the public marketing changelog or GitHub release notes separately; both are generated from the canonical file. `bun run check:changelog` validates the structure before release.

Use `RELEASE_BUMP=minor|major` only to raise the inferred impact for an intentional release boundary. `RELEASE_VERSION=vX.Y.Z` is reserved for an explicit version-line correction or migration. Overrides cannot lower the version required by the commit history.

## Version-line correction

Historical OpenPost tags advanced the patch component for most releases and later reset to `v1.1.0`, even when the releases contained backward-compatible features. The reconstruction classified the Conventional Commit subjects in each `previous tag..tag` cohort, then applied the highest impact in that cohort. Replaying the published releases from the first stable line gives 27 feature-bearing release cohorts and seven patch-only releases after the last feature cohort, with no published breaking change.

The code shipped as `v1.1.22` therefore maps to `v1.27.7`. The versioning and documentation correction was the next patch-only change, `v1.27.8`, but that tag failed preflight before GitHub release creation or deployment. Following the immutable-tag failure policy, `v1.27.9` fixes the clean-checkout check and becomes the first published release on the corrected line. Future releases continue from there using the rules above.

## Failure policy

Never move or reuse a published tag. A failed pre-publication attempt may be rerun against the exact unchanged tag after a transient or infrastructure failure; it reuses the matching draft. If the source or release definition must change, fix forward with a new SemVer tag and leave the failed draft available for diagnosis until a maintainer decides how to handle it. A release is complete only after the workflow succeeds, the GitHub release is public with the exact expected assets, `/api/v1/ready` succeeds, and `/api/v1/version` reports the stable tag and exact tagged source revision.
