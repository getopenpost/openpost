# Releases and Versioning

OpenPost follows [Semantic Versioning 2.0.0](https://semver.org/) and derives the normal release bump from [Conventional Commits](https://www.conventionalcommits.org/).

| Commit impact                          | Version change | Example                |
| -------------------------------------- | -------------- | ---------------------- |
| Backward-compatible fix or maintenance | Patch          | `v1.27.9` → `v1.27.10` |
| Backward-compatible feature            | Minor          | `v1.27.9` → `v1.28.0`  |
| Breaking API or product change         | Major          | `v1.27.9` → `v2.0.0`   |

`feat:` selects a minor release. A `!` after the commit type or a `BREAKING CHANGE:` footer selects a major release. When neither appears, a release advances the patch version.

## Fast feedback and release qualification

PRs and main pushes run the surfaces their diff touches, selected by `scripts/ci-plan.mjs` from [`config/release-surfaces.json`](https://github.com/getopenpost/openpost/blob/main/config/release-surfaces.json). Shared package changes follow declared dependencies to every consumer, and an unknown push base widens checks to every surface. Tags and the nightly run force the core gates; distributions such as Android and n8n follow the changes since the last published stable release.

Every job checks out the repository and runs `.github/actions/setup`, which installs the Bun version pinned in `package.json`, restores the Bun download cache, and optionally adds Go, Node, Playwright Chromium and FFmpeg. Consumers of the canonical frontend artifact start through `needs:` once it exists, so no runner waits idle for another job.

- Backend tests run once without the race detector on PRs, main and tags. The nightly run adds `-race` and coverage and splits top-level tests across four shards through `OPENPOST_GO_TEST_SHARD` (`scripts/go-test-shards.mjs`).
- Component tests run in four Chromium shards beside one unit shard.
- Core application browser shards assign whole spec files by recorded duration in `scripts/app-e2e-durations.json`. New files receive a median weight and deleted files are ignored. `OPENPOST_APP_E2E_SUITE=core` and `handoff` select disjoint suites; omitting the variable runs both locally. The handoff suite also needs the marketing artifact.
- The public-site job builds marketing and documentation once, seals the delivery candidate on main and stable tags, and proves both production artifacts.

## Release bookkeeping

Automated changelog, README asset and screenshot writes require the configured `openpost-bot` GitHub App. They fail if its credentials or identity are unavailable, rather than falling back to another author.

The post-publication recorder stages the changelog and all consumed tag-pinned fragments in one commit. Recover a failed recording by rerunning that job; its idempotent sweep also removes already-recorded fragments. Avoid separate manual cleanup commits.

Changelog-only and fragment-only pushes to main skip duplicate GitHub CI through path filters. Pull requests still validate those changes, and tag qualification stays exhaustive. Keep skip-CI markers out of release-record commits so Cloudflare can publish the public changelog. Scheduled README assets remain batched in their own periodic commit.

## Production release

Commit the release work on `main` with Conventional Commit messages, then ship it:

```bash
bun run release -- plan   # optional: changed paths, release surfaces, planned version
bun run release -- ship
```

`ship` (also available as `prod`) releases a clean, committed `HEAD`. It validates release notes and identities, installs pinned dependencies, and checks unpushed changes with `check:affected --base refs/remotes/origin/main`. Unknown, shared package, and configuration changes fall back to full local preflight. It then pushes that exact revision, creates its immutable tag, watches tag CI and the release workflow, and verifies Hosted. Tag CI runs every core gate for the tagged revision, so a newer main push cannot cancel the candidate.

When a job fails, `ship` stops and prints the failing step and the tail of its log. For canceled jobs it also reads GitHub annotations, which distinguish a job timeout from an ordinary cancellation. Fix a code failure locally and commit a new candidate. For infrastructure failures, rerun only failed jobs with `gh run rerun <run-id> --failed`, then run `ship` again. An existing remote tag resumes on its original revision even if `origin/main` advanced. Never move a failed release tag to changed code.

`bun run release -- failures <run-id>` prints the same evidence, `bun run release -- watch <run-id>` follows a run, and `bun run release -- status` compares the local SHA, candidate CI run, and public production revision. The `plan` subcommand inventories every path changed since the latest release before anything is written; both release planning and CI fail when a new path has no owner in the release-surface registry. Normal builds use the reviewed Nix documentation snapshot. Refresh it deliberately with `bun scripts/sync-docs-external.mjs --refresh`, review the diff, and commit it.

For everyday changes, [`bun run check:affected`](./testing.md) selects maintained local check/test scopes and prints its omitted gates. Use `--base REV` to keep committed branch changes in that local selection.

Mobile source checks include types, lint, unit tests and generated theme/platform-mark validation. Full mobile `check` retains `expo-doctor` for the build host; a server release does not require upgrading this laptop's iOS compiler. Android packaging and its environment checks remain in CI.

Browser and media CI jobs pin Ubuntu 24.04. Media setup first encodes and probes the required fixture formats and installs FFmpeg only when that check fails.

At the candidate boundary, CI builds the canonical release notes from the tagged `CHANGELOG.md` `[Unreleased]` section plus the tagged `changes/` fragments and derives a versioned release manifest from those notes and the exact Git SHA. The manifest contains the stable SemVer and full revision. CI embeds that same manifest in the AMD64 and ARM64 images, stamps both OCI labels and server build values from it, and verifies the labels, embedded file, `/api/v1/version`, SQLite, FFmpeg/FFprobe, liveness, readiness, and the OCI health status while restart-smoking each image against a clean database on its native architecture. The candidate jobs also create an SPDX SBOM and run the pinned final-image vulnerability scan for each architecture as described in [Container Image Support and Assurance](https://openpo.st/docs/self-hosting/maintenance).

CI publishes verified `linux/amd64` and `linux/arm64` images under immutable architecture tags, then combines their digests into the `sha-<revision>` multi-architecture index. It records the index and both platform digests in one candidate artifact. The tag workflow downloads that artifact from the exact successful CI run, requires both platform images to carry the tag version and revision, and creates or reuses a GitHub release draft with the canonical changelog notes. A rerun accepts only a matching draft whose existing assets are complete uploads from the expected set. An already public release, changed notes, an unexpected asset, or any other inconsistent state stops the workflow. The workflow does not automatically delete a failed draft.

The draft receives three server binaries. CLI and MCP binaries and their npm wrapper publish only when their inputs change. When changing CLI inputs, advance the npm wrapper version and pin `packages/cli/package.json` to the intended app tag before tagging; distribution planning rejects an old pin before deployment. SDK and n8n publication also follow their own changed inputs, while explicit package-recovery dispatch remains available. It also receives the Android APK when mobile files or shared mobile inputs changed since the last published stable release. Android uses its standalone `apps/mobile/bun.lock`; the web workspace lock does not select Android. Keep the mobile input list in `scripts/release-distribution-plan.mjs` aligned with every local mobile dependency. Release preflight and CD check the same inputs. Candidate CI retains the multi-architecture digest evidence, per-architecture SBOMs, and full scan reports in Actions for 14 days. When mobile changed, tag CI builds the unsigned Android APK once, records its SHA-256 digest, and retains both files under the exact revision. The tag workflow verifies that digest and only signs the retained APK when signing credentials are configured; it does not rebuild the frontend, container, or Android project. Binary jobs retain their output as workflow artifacts; after CI passes, one upload job checks that the binaries embed the verified frontend artifact and that the release is still a draft before it uploads them. Image promotion waits for the selected artifact matrices and their complete expected asset set, then copies the recorded index digest to the release tag and `latest` without rebuilding. The signed deployment hook receives that digest, validates the candidate against production configuration and mounted secrets, and automatically restores the previous image if readiness fails. Hosted verification then requires public readiness plus `/api/v1/version` reporting both the release tag and exact revision. Only the final job rechecks the selected asset set and notes and publishes the draft. Unchanged distributions remain on their existing versions. Before qualification, CD resolves their version-specific GitHub and npm links, checks the prior APK identity and source inputs, verifies download checksums and npm tarball integrity, and retains the resulting notes in one attempt-specific artifact. Draft creation, promotion and publication append those same notes to the canonical changelog text. APK lookup follows published releases across any number of releases without an APK. Missing, corrupt or mismatched downloads stop the release. A skipped CLI job is accepted only when the plan explicitly leaves CLI unchanged; failed prerequisites still block upload. After publication, a recorder job writes the shipped section into `CHANGELOG.md` on `main` and deletes exactly the fragments the tag contained, as an `openpost-bot[bot]` commit. Fragments added after the tag stay for the next release, and a failed candidate leaves no changelog trace behind. No public GitHub release is announced while an artifact, promotion, deployment, or readiness gate is still pending.

Android qualification keeps Expo clean prebuild and all release ABIs. Pinned `gradle/actions/setup-gradle` manages Gradle state, and React Native discovers `ccache` on PATH for C/C++ compilation. Compiler-cache keys include the mobile lock, platform and NDK generation; logs report cache statistics. Compare cold and warm candidate runs before claiming a compilation speedup. See the [Gradle CI guide](https://docs.gradle.org/current/userguide/github-actions.html) and [React Native build-speed guide](https://reactnative.dev/docs/build-speed).

`CHANGELOG.md` is the release-history source of truth. Add notable work to `Unreleased` while implementing it, either directly or as a `changes/<name>.md` fragment; both feed the generated release notes. Do not edit the public marketing changelog or GitHub release notes separately; both are generated from the canonical file. `bun run check -- changelog` validates the structure before release.

Use `RELEASE_BUMP=minor|major` only to raise the inferred impact for an intentional release boundary. `RELEASE_VERSION=vX.Y.Z` is reserved for an explicit version-line correction or migration. Overrides cannot lower the version required by the commit history.

## Version-line correction

Historical OpenPost tags advanced the patch component for most releases and later reset to `v1.1.0`, even when the releases contained backward-compatible features. The reconstruction classified the Conventional Commit subjects in each `previous tag..tag` cohort, then applied the highest impact in that cohort. Replaying the published releases from the first stable line gives 27 feature-bearing release cohorts and seven patch-only releases after the last feature cohort, with no published breaking change.

The code shipped as `v1.1.22` therefore maps to `v1.27.7`. The versioning and documentation correction was the next patch-only change, `v1.27.8`, but that tag failed preflight before GitHub release creation or deployment. Following the immutable-tag failure policy, `v1.27.9` fixes the clean-checkout check and becomes the first published release on the corrected line. Future releases continue from there using the rules above.

## Failure policy

Never move or reuse a published tag. A failed pre-publication attempt may be rerun against the exact unchanged tag after a transient or infrastructure failure; it reuses the matching draft. If the source or release definition must change, fix forward with a new SemVer tag and leave the failed draft available for diagnosis until a maintainer decides how to handle it. A release is complete only after the workflow succeeds, the GitHub release is public with the exact expected assets, `/api/v1/ready` succeeds, and `/api/v1/version` reports the stable tag and exact tagged source revision.
