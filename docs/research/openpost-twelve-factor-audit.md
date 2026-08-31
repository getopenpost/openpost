# OpenPost twelve-factor audit

Status: completed audit snapshot, 2026-08-30

This audit grades the OpenPost server and its container delivery path against the
published [Twelve-Factor App](https://12factor.net/) methodology. Supporting
artifacts such as the mobile app, CLI, marketing site, documentation site, and
n8n package are included where they affect source or release boundaries.

The repository evidence uses the clean OpenPost snapshot at
`bdac13f98bdc6f2bd1714304de019e95d600a23d`; `origin/main` matched that revision
at inspection time. The live service was separately verified as `v4.13.1` at
source revision `ae15eed`. Its tag points to the same source revision, and both
[CI run 33317817068](https://github.com/getopenpost/openpost/actions/runs/33317817068)
and [release run 33319075574](https://github.com/getopenpost/openpost/actions/runs/33319075574)
succeeded. These are different snapshots, so repository findings describe
`bdac13f` unless the text explicitly says they were verified live.

The deployment findings come from a read-only inspection of the
`~/.config/home` OpenPost module and current service metadata. No secret value,
local `.env` content, or secret-store content was read. A metadata-only access
test did establish that the unprivileged account named `nobody` can read known
OpenPost secret paths. That proves access, not whether any value was previously
read or exfiltrated. No production state was mutated.

## Executive summary

OpenPost follows much of the methodology, but the production result is uneven.
The release path is the strongest part. CI builds the production image once,
records its source revision and manifest, verifies its digest, and promotes that
same digest without rebuilding. The Home deploy pulls the digest, verifies its
OCI revision, runs a configuration preflight, retags it as a local convenience
alias, then verifies both local and public exact revisions. Live OpenPost and
PostgreSQL were healthy at inspection time.

The overall grade is C+. This is a judgment, not an average. Strong
artifact provenance cannot offset a confirmed local secret-read exposure, an
unbounded shutdown path, an untested production data plane, or a short local log
history that continuously rotates with no observed off-host copy.

The most important findings are:

1. Every inspected OpenPost mounted secret, plus the rendered cloud and
   PostgreSQL environment files, is `root:root` mode `0444`. Their parent
   directories are mode `0751`. A metadata-only `sudo -u nobody test -r`
   confirmed that the unprivileged `nobody` account can read the JWT secret and
   cloud environment file. No contents were read, and access history is unknown.
   This is an immediate credential-containment and rotation issue.
2. The deployment webhook reuses one `deploy_webhook_secret` across OpenPost,
   Montra, and personal deployment paths. The request has no verified timestamp,
   nonce, or event identifier for replay rejection, and the endpoint returns
   command output. One disclosure or replay can therefore cross deployment
   boundaries and expose operational detail.
3. Hosted production uses PostgreSQL and S3-compatible storage, while the normal
   backend and image tests use SQLite and local storage. PostgreSQL-specific
   tests skip unless `OPENPOST_TEST_POSTGRES_URL` is supplied, and the inspected
   CI workflow does not supply it. Required S3 access is also absent from startup
   and readiness proof, and storage calls discard cancellation. This is a real
   runtime and dev/prod parity gap, not a stylistic concern.
4. Shutdown is ordered incorrectly for a disposable process. On `SIGTERM`, the
   process cancels and waits for the worker before asking Echo to stop accepting
   HTTP traffic. The worker wait has no deadline. Only the later HTTP shutdown
   has a ten-second timeout. A slow or non-cancellable job can consume the host's
   whole stop window while the server still accepts requests.
5. One process runs HTTP, the durable queue worker, recurring schedulers, and
   schema migrations. This is easy to self-host, but it prevents hosted web and
   worker capacity from scaling independently and makes every process startup an
   administrative database event. Production currently has one OpenPost unit
   and one PostgreSQL unit, with no CPU or memory limits.
6. Dependency declarations are extensive, but toolchains are not fully aligned.
   `backend/go.mod` and `cli/go.mod` name Go 1.26.6, while the container builder
   uses Go 1.27.0. The root and CI pin Bun 1.3.11, while the mobile package names
   Bun 1.3.13. The image also runs an unversioned `apk upgrade` and installs
   unversioned runtime packages, so a rebuild of the same commit can resolve
   different packages.
7. OpenPost has strong config and credential-handling code, but administrator
   values stored in the database override environment and `*_FILE` values after
   startup. In cloud mode, that means a stale database copy of a billing, email,
   OIDC, or provider secret can supersede the deployment secret store. The
   production database currently has zero `instance_settings` rows, so this is
   a latent precedence risk rather than an active production override. GitHub
   secret scanning and push protection are disabled, and CI's Trivy invocation
   scans vulnerabilities only.
8. Daily database and media backups and the weekly restore drill all succeeded
   on the inspection day. They still share the production VPS failure domain,
   and no `OnFailure` alerting was found. Journald is capped at 512 MB and held
   507.8 MB, with no off-host drain found.

The practical target is not "make the repository look like Heroku in 2011."
Keep the single-binary self-host experience. Add explicit `web`, `worker`, and
`migrate` roles to the same image for hosted operation, retain `all` as the
self-host default, prove the cloud data plane in CI, and make shutdown bounded.
That resolves most of the material gaps without splitting the repository or
introducing a new orchestration platform.

## Recommended order of work

| Priority | Change                                                                                               | Factors         | Completion test                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Restrict mounted-secret access, then rotate exposed credentials in dependency order                  | III             | Secret directories are `0700` or the narrowest required `0710`; files are `0400` or `0440` and owned by the exact mapped service identity or dedicated group. The container still starts, while `sudo -u nobody test -r` fails for every known secret path. JWT/session impact is planned. The data-encryption key uses dual-read, new-primary-write, verified re-encryption, then old-key removal rather than a blind replacement. |
| P1       | Isolate and harden deployment webhooks                                                               | III, XII        | OpenPost, Montra, and personal deploy paths use different secrets and least-privilege executors. Each signed request binds method, path, body digest, timestamp, and nonce or event ID. Stale or repeated identifiers fail, responses are constant and do not contain command output, and the shared secret is retired.                                                                                                             |
| P1       | Add a hosted data-plane CI lane with real PostgreSQL and an S3-compatible service                    | IV, VI, VIII, X | A release-blocking test boots cloud mode, runs all migrations, exercises one media write/read/delete and concurrent queue claims, then restarts against the same resources. PostgreSQL-specific tests report zero skips.                                                                                                                                                                                                            |
| P1       | Make termination a bounded drain                                                                     | IX, XI          | A container test starts an HTTP request and a leased job, sends `SIGTERM`, proves readiness flips first, new traffic stops, in-flight work either finishes or releases its lease, and PID 1 exits before the deployment stop deadline.                                                                                                                                                                                              |
| P1       | Add runtime roles and an explicit migration command                                                  | V, VIII, XII    | The same image digest runs `openpost web`, `openpost worker`, and `openpost migrate`. Hosted rollout runs migration once. Web and worker replicas scale independently. `openpost all` preserves the self-host default.                                                                                                                                                                                                              |
| P1       | Move recovery evidence and logs off the production VPS                                               | IV, XI, XII     | Encrypted database and media backups are copied to a separate account and failure domain, then a restore drill starts from that copy. Failed backup, restore, and deployment units page an operator. Structured stdout is shipped off-host under a documented retention and access policy before local journald rotation removes it.                                                                                                |
| P1       | Enable repository secret-leak prevention                                                             | III             | GitHub secret scanning and push protection are enabled. CI or protected pushes scan the current diff and reachable history without printing candidate values. A synthetic canary is rejected before merge.                                                                                                                                                                                                                          |
| P2       | Use one declared Go and Bun toolchain, remove time-dependent package resolution from the image build | II, V, X        | CI, Devenv, release binaries, and the image report the same toolchain versions. Rebuilding the same source with the same declared inputs yields the same application artifacts, or documented non-reproducible operating-system bytes are the only difference.                                                                                                                                                                      |
| P2       | Define a structured stdout log contract                                                              | IX, XI          | Every event has timestamp, severity, event name, revision, and correlation fields. Redaction tests cover credential-shaped inputs, and no application-owned log file is introduced.                                                                                                                                                                                                                                                 |

## How this audit interprets the methodology

The published site says it was last updated in 2017. The official project is
working on a replacement and says the core app/platform contract remains valid,
while examples and guidelines have drifted. The update is not yet the published
standard. This audit therefore uses:

- the published factor text as the normative intent;
- the official project's [update FAQ](https://github.com/twelve-factor/twelve-factor/blob/main/UPDATE_FAQ.md)
  and [vision](https://github.com/twelve-factor/twelve-factor/blob/main/VISION.md)
  to distinguish enduring principles from outdated examples;
- OCI and Kubernetes primary documentation only as concrete translations for a
  containerized runtime, not as extra factors and not as a recommendation that
  OpenPost adopt Kubernetes.

For example, "store config in the environment" still means the build must not
contain deploy-varying config. It does not mean high-value secret bytes must be
visible in a process environment when the platform can mount a read-only secret
file or provide workload identity. Likewise, "process" maps to a supervised
container role, not necessarily one Unix process per physical server.

### Grade scale

| Grade | Meaning                                                                                      |
| ----- | -------------------------------------------------------------------------------------------- |
| A     | The design aligns, and an automated or directly observed test proves the important behavior. |
| B     | The design aligns, but proof or one bounded capability is missing.                           |
| C     | A material operational gap exists, or the critical deployment behavior is unverified.        |
| D     | The current design directly depends on behavior the factor rejects.                          |
| ?     | There is not enough evidence to grade.                                                       |

## Assessment

| Factor                 | Grade | What is working                                                                                          | Main gap                                                                                                                                              |
| ---------------------- | ----- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Codebase            | B+    | One Git history, source revision embedded in release evidence                                            | Several independently deployed product artifacts share the repository without one concise deployment-unit map                                         |
| II. Dependencies       | B     | Go, Bun, Nix, actions, and base images are declared or locked                                            | Go and Bun version skew, plus time-dependent Alpine package resolution                                                                                |
| III. Config            | C     | Environment and `*_FILE` inputs, cloud validation, encrypted managed secrets                             | Mounted secrets and rendered environment files are world-readable on the VPS; deploy webhook secret is shared; repository secret scanning is disabled |
| IV. Backing services   | C+    | PostgreSQL/SQLite and S3/local adapters are selected by config; live backup and restore jobs pass        | Required S3 access is absent from startup/readiness proof, storage calls discard cancellation, hosted CI is missing, and backups remain on the VPS    |
| V. Build, release, run | B+    | Build-once digest promotion, OCI revision validation, config preflight, exact local/public revision gate | Migrations run inside every normal process start, and old-image rollback does not prove schema compatibility or the previous live revision            |
| VI. Processes          | C+    | Cloud state is in PostgreSQL/S3, queue state is durable, temp files are transient                        | Web and worker roles are coupled, while rate and concurrency limits weaken per replica                                                                |
| VII. Port binding      | A     | Self-contained Go server binds the configured port and sits behind routing                               | No material repository gap found                                                                                                                      |
| VIII. Concurrency      | C     | Database-backed jobs can be claimed by multiple process instances                                        | One combined app replica, coupled web/worker scaling, and no CPU or memory limits                                                                     |
| IX. Disposability      | C-    | SIGTERM handling, HTTP shutdown API, leases, stale-job recovery, restart smoke                           | Worker stop is unbounded and precedes HTTP drain; interrupted bookkeeping and storage I/O can ignore cancellation; Home liveness uses readiness       |
| X. Dev/prod parity     | C     | Devenv and CI are declarative; the tested digest is deployed                                             | Normal tests use SQLite/local storage, PostgreSQL tests skip, S3 integration is mocked                                                                |
| XI. Logs               | C     | Application and worker logs go to standard streams; request IDs are recorded                             | The 512 MB journal is continuously rotating with no off-host drain, structured event contract, or broad redaction contract                            |
| XII. Admin processes   | C-    | Admin scripts, config preflight, backups, and restore drill are versioned                                | Migrations are implicit startup work; exact-image restore/admin commands and scheduled-failure alerting are missing                                   |

## I. Codebase

Published intent: one app has one version-controlled codebase, and that codebase
can have many deploys at different revisions. A second codebase means a second
app. Shared functionality should be an explicit dependency rather than copied
source. [Official factor](https://12factor.net/codebase)

2026 reading: a monorepo is not automatically a failure. The important contract
is that each independently runnable unit has one authoritative source lineage,
one repeatable build boundary, and traceable deploys. Splitting a cohesive
product into repositories solely to satisfy the old wording would reduce clarity.

Practical test:

- Pick any running OpenPost unit and identify its exact repository revision.
- Rebuild it from that revision without copying untracked production code.
- List every independent deployable and show which source and pipeline owns it.
- Prove staging, production, and developer instances are deploys of that same
  source lineage, even when they run different revisions.

Verified evidence:

- The audited application snapshot was a clean checkout at `bdac13f`, and
  `origin/main` pointed to the same commit.
- The server, embedded web app, CLI/MCP binaries, mobile app, marketing site,
  documentation site, and n8n package are tracked in one Git repository.
- `docker/Dockerfile` writes source revision and version into OCI labels and the
  running binary.
- `.github/workflows/release.yml` ties a release tag to a successful CI run for
  the exact tagged SHA, then checks the live revision.
- `scripts/public-deployment-proof.mjs` has source-revision checks for public
  web deployments.
- The live application was `v4.13.1` at `ae15eed`; the tag resolved to the same
  commit, and the exact-source CI and release runs both succeeded.

Gaps and uncertainty:

- The server, marketing site, docs site, mobile artifact, CLI, and n8n package
  are not the same runnable app. The repository has pipelines for them, but no
  short canonical inventory states the deploy boundary, owner, artifact, config
  authority, and revision proof for each.
- One `v*` workflow coordinates the server image, standalone binaries, Android
  artifact, n8n package, deployment, and GitHub release. A signing or publication
  failure in one independently consumed unit can block release recovery for the
  others.
- Mobile declares generated OpenAPI types but the repository contract check does
  not regenerate or diff them. The audited mobile schema had 234 paths versus
  248 in the frontend authority; the exact missing routes are listed under
  adjacent defects.
- The live server's lineage was verified. This pass did not repeat equivalent
  live lineage checks for the static sites, mobile artifact, CLI, or n8n package.

Recommended action:

- Keep the monorepo. Add a small deployment-unit table to the existing
  repository map or release manifest. Do not create another mutable agent note.
  Each row should name the unit, build task, artifact, release cadence, runtime
  config owner, and public revision check.
- Require every deployable to expose or publish its source revision through its
  natural artifact metadata. The server already does this.
- Add the mobile schema to the canonical generated-contract gate. Give server,
  Android, and n8n releases independent retry/recovery paths even if they keep a
  coordinated product version.

## II. Dependencies

Published intent: declare every application library and system tool completely
and exactly, and isolate execution so undeclared host software cannot leak in.
A new developer should be able to run one deterministic setup/build command.
[Official factor](https://12factor.net/dependencies)

2026 reading: a container image, Nix closure, language lockfile, or statically
linked binary is the isolation boundary. "Vendor the tool" means put the exact
tool and version in the declared build or runtime image. It does not require
checking third-party binaries into Git. OCI image configuration is content
addressed, and changing it creates a different image identity.
[OCI image configuration](https://github.com/opencontainers/image-spec/blob/main/config.md)

Practical test:

- Build and run on a clean host with only the declared bootstrap tool.
- Remove common host tools and prove the app still starts and exercises media
  paths that need SQLite and FFmpeg.
- Compare the dependency graph and toolchain used by development, CI, release
  binaries, and the container.
- Rebuild twice from the same source and declared inputs, then compare artifact
  digests or account for every difference.

Verified repository evidence:

- `bun.lock`, Go module sums, `devenv.lock`, and `docker/image-policy.json`
  declare application and environment dependencies.
- GitHub Actions are pinned to commit SHAs. Docker base images are pinned by
  digest.
- CI uses `bun install --frozen-lockfile`; the Docker build downloads Go modules
  from `go.mod` and `go.sum` before compiling.
- `scripts/smoke-production-image.sh` exercises the image's SQLite, FFmpeg, and
  FFprobe runtime dependencies rather than assuming the host provides them.
- CI produces an SPDX SBOM and a vulnerability report for the final image.

Gaps:

- `backend/go.mod` and `cli/go.mod` declare Go 1.26.6, while
  `docker/Dockerfile:7` builds with Go 1.27.0.
- Root `package.json` and CI use Bun 1.3.11, while `mobile/package.json` declares
  Bun 1.3.13.
- `docker/Dockerfile` runs `apk upgrade` and installs unversioned Alpine packages.
  Base-image digest pinning does not make those repository resolutions immutable.
- The Home module runs PostgreSQL from the mutable
  `docker.io/postgres:17-alpine` tag. An upstream tag move can change the
  database image on a pull without a Home configuration change.
- Standalone server binaries invoke `ffmpeg` and `ffprobe` from `PATH`. Devenv
  and the container declare them, but the standalone artifact neither packages
  them nor checks their version at startup. Its real runtime dependency set is
  therefore larger than the binary release evidence shows.
- `scripts/sync-docs-external.mjs` fetches the Home repository's moving `main`
  branch during a documentation build. The same OpenPost revision can produce
  different documentation as that external branch moves, or fail without the
  network.
- The Docker image is intentionally `linux/amd64` only. This is a supported
  product constraint, but it narrows runtime portability and must stay explicit.

Recommended action:

- Name the Go and Bun versions once, then validate every consumer against them.
  Prefer the module's Go toolchain as the container builder version.
- Remove `apk upgrade` from the application image build. Refresh the pinned base
  digest through dependency updates instead. Pin or snapshot extra Alpine
  package inputs where exact rebuilds matter.
- Pin PostgreSQL to an audited patch version and digest. Upgrade it deliberately,
  with a backup, compatibility check, and rollback plan.
- Package a supported FFmpeg build with standalone distributions, or make the
  dependency and accepted version range explicit and fail startup when it is
  absent.
- Pin imported Home documentation to a commit. Refresh that input as an explicit
  source change instead of fetching a moving branch during the build.
- Keep the existing image smoke and SBOM gates. Add a clean-room build check for
  the declared toolchain rather than adding another package manager.

## III. Config

Published intent: code is invariant between deploys, while backing-service
handles, credentials, canonical hostnames, and other deploy-varying values are
external config. The classic litmus test is that the repository could become
public without exposing credentials. Variables should be independently
controlled, not bundled into fragile named environment profiles.
[Official factor](https://12factor.net/config)

2026 reading: preserve strict separation from the immutable image, but use the
platform's safest injection mechanism. Environment variables are suitable for
non-secret scalar config and secret references. Read-only files and external
secret stores are valid for secret bytes. Kubernetes documents both secret
volumes and secret-backed environment variables, and warns that its Secret
objects need encryption and least-privilege access.
[Kubernetes Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)

Practical test:

- Publish the repository and image to an internal scanner with no credential
  findings.
- Deploy the same image digest to development, staging, and production using
  different resource handles and hostnames.
- Rotate one high-value secret without rebuilding the image.
- Dump config metadata and logs while proving secret values are absent.
- Vary one setting without selecting a bundled `production` or `staging` profile.

Verified repository and deployment evidence:

- `backend/internal/config/config.go` loads deploy config from environment
  variables. `getEnvValue` also supports a `*_FILE` companion for every normal
  key, with direct environment values taking precedence.
- Cloud-mode validation requires its data plane, account, billing, AI routing,
  CORS, and telemetry contracts before startup completes.
- `backend/internal/config/managed.go` distinguishes bootstrap/database/network/
  storage config from database-backed administrator settings. Secret settings
  are marked write-only and are encrypted by the instance settings service.
- `backend/internal/services/instancesettings/service.go` applies stored values
  after environment config. Its tests explicitly prove that a database override
  wins until an administrator unsets it, at which point the environment value is
  restored.
- `.gitignore` excludes `.env` files, and `SECURITY.md` directs operators to
  Docker/Kubernetes secrets or a secret manager.
- The binary has a no-side-effect `check-config` command used by the image smoke
  and deployment gate.
- The Home module renders OpenPost secrets from SOPS, exposes their paths through
  `*_FILE`, and bind-mounts them read-only. This keeps secret bytes out of the
  image and Nix store.
- Production currently has zero rows in `instance_settings`. Database-over-env
  precedence therefore exists in code but is not an active production override.
- GitHub reports both secret scanning and secret-scanning push protection as
  disabled for `getopenpost/openpost`. The CI Trivy job sets `scanners: vuln`, so
  it does not provide a second secret-scanning gate.

Gaps and cautions:

- `godotenv.Load()` runs unconditionally at process start. This is useful for
  local and simple self-host installs, but a stray `.env` in the runtime working
  directory becomes an implicit config source.
- `.env.example:31-34` says environment values remain authoritative and stored
  administrator values apply only when the matching variable is unset. That is
  false for managed settings, which are applied after environment loading and
  win when present. Provider applications use a separate merge rule, which
  makes the contradiction harder to spot.
- The example JWT and data-encryption placeholder strings satisfy the current
  minimum-length validation. An operator can therefore boot with a documented,
  publicly known secret value unless startup explicitly rejects those examples.
- `META_GRAPH_API_VERSION` and `LINKEDIN_API_VERSION` are read directly by
  adapters rather than the central loader. LinkedIn defaults to the previous
  calendar month, so restarting the same release later can change provider
  behavior with no code or deploy-config change.
- Invalid enum and integer values log a warning and fall back. For deployment
  settings, a typo can silently choose a different driver or limit instead of
  failing the release preflight.
- `scripts/security-check.sh` runs Go and Bun dependency vulnerability checks,
  but no secret-leak scan. `.gitignore` prevents common accidents but does not
  prove the Git history is clean.
- The SOPS rendering boundary is correct in concept, but its live file access is
  critically broad. `/run/secrets.d` and rendered-template directories are mode
  `0751`. Every inspected mounted OpenPost secret and both rendered cloud and
  PostgreSQL environment files are `root:root` mode `0444`. A metadata-only
  `sudo -u nobody test -r` proved that the unprivileged account named `nobody`
  can read the JWT secret and cloud environment file. File contents were not
  read. This test proves the access condition, not prior access or exfiltration.
- Database-backed product choices are application data when an operator changes
  them through OpenPost. Treating that whole layer as a factor violation would
  be wrong. Credentials are different. The managed list includes billing,
  transactional-email, OIDC, Google, and stock-provider secrets, and a stored
  value wins over an environment or `*_FILE` value. In cloud mode, this weakens
  the deployment secret store's authority and makes rotation easy to misread.
  Zero production rows make the risk latent today, not resolved.
- The deployment receiver uses one `deploy_webhook_secret` for OpenPost, Montra,
  and personal deployment paths. The verified request contract has no timestamp,
  nonce, or event ID to reject replay and returns deployment command output to
  the caller. This couples three trust boundaries and exposes operational detail.
- Normal startup creates the schema and runs migrations before it applies stored
  settings and completes full runtime validation. A bad release configuration
  can therefore mutate the schema before the process rejects its config.
- `openpost check-config` validates the environment-only snapshot and exits
  before opening the database. It cannot see the database overrides that normal
  startup applies later, so it does not prove the effective runtime config.

Recommended action:

- Treat the file-readable credentials as potentially disclosed to any local
  unprivileged account that knew or discovered the paths. Immediately make
  rendered directories `0700`, or the narrowest required `0710`, and files
  `0400` or `0440`, owned by the exact mapped OpenPost/PostgreSQL service identity
  or a dedicated group. Re-render, restart, confirm `/health`, `/ready`, and the
  exact revision, then prove `sudo -u nobody test -r` fails for every known path.
  `systemd` credentials or Podman secrets are reasonable alternatives if they
  preserve the same least-privilege test.
- Rotate the affected credentials in stages after containment. Use independent
  webhook secrets first, then database, object-store, billing, email, AI, OAuth,
  and provider credentials according to each provider's overlap and revocation
  support. A JWT-secret change will invalidate sessions unless OpenPost first
  gains a dual-verification-key window. Record only key identifiers, timing, and
  validation outcomes.
- Do not blindly replace `OPENPOST_ENCRYPTION_KEY`. It protects persisted
  ciphertext, including provider credentials and any encrypted instance
  settings. Add key identifiers plus dual-read and new-primary-write support,
  re-encrypt every stored ciphertext under the new key, verify reads and counts
  without printing values, then remove the old key only after no row needs it.
  The empty `instance_settings` table reduces one migration set, but does not
  prove that no other encrypted row exists.
- Give OpenPost, Montra, and personal deployment endpoints independent secrets
  and least-privilege executors. Sign a canonical method, path, body digest,
  timestamp, and nonce or event ID; reject stale and previously seen identifiers;
  return a constant acceptance/result envelope without command output; then
  revoke the shared secret.
- Keep `*_FILE` support and prefer it for high-value secret bytes. Environment
  variables can carry the file path or secret identifier.
- In cloud mode, make environment, `*_FILE`, or workload-identity inputs
  authoritative for secret-classified settings. Restrict database overrides to
  non-secret product settings, or require an explicit self-host policy to enable
  stored credentials. Show the effective source without revealing the value.
- Add history-aware secret scanning in CI and protected pushes. Configure output
  so findings identify file and rule without echoing the candidate value.
- Correct `.env.example` to match the implemented authority model. Replace the
  known secret examples with empty/generated inputs, or reject their exact
  fingerprints during startup and `check-config`.
- Put provider API versions through the typed loader and pin them in production.
  Fail on invalid deployment-affecting values; use defaults only when a value is
  absent.
- Generate one redacted config inventory from the loader/managed-setting
  definitions and validate docs against it. Record source class, mutability,
  secret classification, restart requirement, and owning deployable.
- In managed production, reject or warn on loading a local `.env` file. Preserve
  it for development and explicit self-host workflows.
- Split bootstrap validation from full application validation. Validate the
  edition, database, storage, encryption, and network contract before any schema
  write. Apply allowed database settings later, then validate the complete
  runtime before opening traffic.
- Name the checks honestly. A no-I/O `check-bootstrap-config` can validate
  deployment inputs. A read-only effective-config check can load existing stored
  settings and report only sources and validation results, never values.

## IV. Backing services

Published intent: databases, object stores, queues, mail systems, and external
APIs are attached resources. The app refers to them through config and can swap
one instance for another without a code change. Locally managed and third-party
services use the same application boundary.
[Official factor](https://12factor.net/backing-services)

2026 reading: "swap" means the application contract and resource handle are
stable. It does not promise that PostgreSQL can be replaced with an unrelated
database without adapter work. A restored PostgreSQL instance or another
S3-compatible endpoint should be attachable through config alone.

Practical test:

- Restore production-shaped data into a replacement PostgreSQL service, change
  only the handle, and prove readiness plus core reads and writes.
- Point the same image at another supported S3-compatible endpoint and run
  upload, ranged read, direct upload, and delete behavior.
- Make an external provider unavailable and prove startup/readiness policy,
  bounded timeouts, retries, and user-visible state match the service's role.

Verified repository evidence:

- `backend/internal/database/database.go` selects SQLite or PostgreSQL through a
  driver and DSN contract.
- `backend/internal/services/mediastore/` implements a `BlobStorage` boundary
  with local and S3-compatible adapters.
- `backend/internal/config/config.go` selects service handles through config and
  requires PostgreSQL plus S3 in cloud mode.
- External email, AI, telemetry, OAuth/provider, connector, and feedback
  resources are constructed from config rather than hard-coded deployment hosts.
- `scripts/restore-drill.sh` contains a versioned PostgreSQL restore check.
- The live OpenPost and PostgreSQL units were active and healthy at inspection
  time. Daily database and media backup jobs, plus the weekly restore drill, had
  all succeeded on 2026-08-30.
- The encrypted VPS secret file has multiple SOPS age recipients, including the
  VPS, laptop, and desktop. Loss of one machine's age identity therefore need
  not make the encrypted source file unrecoverable.

Gaps:

- Normal CI does not exercise the production PostgreSQL/S3 pairing.
- S3 tests use fake clients. They prove adapter logic, not endpoint, credential,
  signature, multipart, timeout, or lifecycle compatibility.
- `/api/v1/ready` checks PostgreSQL but not the required cloud object store. The
  S3 constructor validates strings and does no remote capability check. A bad
  endpoint, bucket policy, or credential can therefore pass both startup and the
  current deployment readiness gate until a media operation uses it.
- `BlobStorage` does not accept `context.Context`, and S3 save, multipart, open,
  range, and delete paths create `context.Background()` operations. Client
  cancellation and process shutdown cannot bound a stalled storage request.
- PostgreSQL uses the default `database/sql` pool with no explicit open, idle,
  lifetime, or idle-time limits. Adding replicas could multiply connections
  without a declared budget.
- Local storage writes directly to the final path. A crash can leave a partial
  durable object instead of an atomic replacement.
- Current database and media backup artifacts remain on the same VPS as the live
  service. They do not cover host loss, account loss, or a destructive storage
  event. No `OnFailure` notification was found for backup or restore units.
- The media backup job reuses the application's S3 credential instead of a
  separate read-only backup identity, so compromise of that one-off process has
  more object-store capability than its task requires.
- The current same-VPS restore drill does not prove that an operator can recover
  the SOPS source with an independent age recipient, render
  `OPENPOST_ENCRYPTION_KEY` after loss of the VPS identity, or decrypt restored
  application rows protected by that key.

Recommended action:

- Add one production-shaped integration lane rather than duplicating the whole
  test suite. Run the migrations, high-risk PostgreSQL tests, durable queue
  claims, and the complete media object lifecycle.
- Add a bounded S3 capability check during cloud startup and expose a cached
  readiness result. Do not make every readiness request perform a remote object
  operation.
- Make the blob boundary context-aware, set transport and request deadlines, and
  prove cancellation during upload, range read, and delete. Configure an
  explicit PostgreSQL connection budget per process role.
- Write local objects to a temporary sibling, flush as required, and rename them
  into place atomically.
- Turn the existing restore script into scheduled evidence with a clear RPO,
  RTO, artifact identity, and cleanup result. A successful command on an empty
  database is not a restore drill.
- Copy encrypted backups to a separate account and failure domain, with retention
  and deletion protection suited to the data. Alert on every failed backup or
  restore unit rather than relying on later journal inspection.
- Give backup and verification jobs their own least-privilege credentials.
- Add a non-disclosing off-host disaster-recovery drill. Starting from an
  independent SOPS age recipient, recover secrets into tmpfs, render credentials
  for a disposable target, and run an exact-image, read-only restore check with
  workers and external egress disabled. Report only row/object counts, revision,
  timing, and errors. Prove encrypted rows can be read, then destroy the target
  and tmpfs material.
- Document which backing-service failures should fail readiness, degrade a
  feature, retry in the durable queue, or reject new work.

## V. Build, release, run

Published intent: build source and dependencies into an artifact, combine that
immutable build with deploy config to create a uniquely identified release, then
run it with minimal moving parts. Releases form an append-only ledger and can be
rolled back. Runtime must not mutate code or redo build work.
[Official factor](https://12factor.net/build-release-run)

2026 reading: the OCI digest is the build identity. A release is that digest plus
the deployment's config and rollout identity. Tags are human aliases, not
immutable identity. Kubernetes also documents that tags can move while digests
are fixed. [Kubernetes image names](https://kubernetes.io/docs/concepts/containers/images/)

Practical test:

- Build a candidate once, test it, promote only its digest, and deploy by digest.
- Compare source SHA, release manifest, image digest, configured release, and the
  running `/api/v1/version` response.
- Roll back by selecting an older release without rebuilding it.
- Start a released image with network access to package registries disabled.

Verified repository evidence:

- `.github/workflows/ci.yml` builds the canonical frontend once, embeds those
  bytes in one production image, smokes the image, records image evidence, and
  publishes a SHA tag.
- `.github/workflows/release.yml` requires successful CI for the tagged SHA,
  verifies the candidate digest and release manifest, then adds version and
  `latest` tags to the same digest without rebuilding.
- Production deployment receives the verified digest. The workflow then checks
  public readiness, version, and exact source revision before publishing the
  GitHub release.
- The container runs as a non-root user and starts only the compiled binary.
- The Home deploy transaction pulls `image@sha256:...`, compares the candidate's
  `org.opencontainers.image.revision` label with the requested source revision,
  and runs `openpost check-config` against production config and mounted secret
  paths before promotion. It retains the previous image under a rollback alias.
- After promotion, the Home transaction checks the local version and readiness,
  then the public readiness and exact revision. The live `v4.13.1` deployment at
  `ae15eed` matched its tag after successful CI and release runs.

Gaps:

- `database.CreateSchema` and all pending migrations run during every normal
  server startup. That makes the run stage perform administrative release work
  and complicates rollback when a migration is not backward compatible.
- `RunMigrations` reads the applied-version set once and runs each pending item
  in its own transaction, but no migration-wide advisory or database lock is
  present in that path. Concurrent starters can select the same pending version.
- Fresh databases first create the current model schema and then run the full
  historical migration chain. Fresh installs and upgraded installs therefore
  reach the schema through different authorities.
- `docker-compose.yml` uses `ghcr.io/getopenpost/openpost:latest`. That is useful
  as a convenience channel, but it does not identify a repeatable self-host
  release and can move between pulls.
- The Home service runs a local `latest` alias after the deploy transaction
  verifies and retags the candidate. The surrounding digest, image-label, and
  exact-revision checks currently bind that mutable alias to the intended build,
  but running directly by digest or immutable image ID would reduce reliance on
  transaction correctness.
- Rollback retags the previous image, but database migrations occur on ordinary
  startup and are not reversed. Image rollback is therefore not proof of schema
  rollback compatibility.
- The rollback readiness loop does not make timeout an error or verify the exact
  previous revision on every path. A restart of the old image can be reported as
  rollback even when public recovery has not been proved.
- Clean-host bootstrap depends on a pre-existing local `latest` image before the
  deploy transaction pulls the candidate. With `pullPolicy = "never"`, a rebuilt
  VPS with an empty image store has no declarative known-good OpenPost image from
  which to start.
- Cutover is an in-place restart behind one Caddy upstream. There is expected
  downtime and no warmed old slot to receive traffic if the new process fails.
- The VPS verifies the candidate's revision label but not its version label or a
  Sigstore-style image signature. The signed webhook proves knowledge of its
  HMAC secret; it is not artifact-signature verification.
- OpenPost deployment runs directly from the webhook rather than through a
  dedicated bounded one-shot unit with durable status. This makes timeout,
  operator inspection, and response minimization weaker than they need to be.

Recommended action:

- Add `openpost migrate` to the same binary and image. Hosted rollout should run
  it once, using the release config, before web/worker replacement. Keep an
  explicit auto-migrate mode for the one-container self-host experience.
- Require expand/contract migrations across at least one rollback window. A
  release should not become irreversible merely because the previous binary no
  longer understands the schema.
- Make migrations the schema authority for both fresh and upgraded databases.
- Add a declarative bootstrap digest and revision. Make rollback fail unless the
  previous local and public revision becomes ready within a fixed deadline.
- Add a bounded deployment one-shot and return a constant webhook response while
  retaining details only in the host journal. Verify the release version label;
  add artifact-signature verification as a later supply-chain hardening step.
- After migration compatibility and role separation are in place, use a
  two-slot web cutover if deployment downtime is no longer acceptable.
- Change self-host examples to a version tag and show an optional digest pin.
  Keep `latest` documented as a moving convenience channel, not a release ID.
- Prefer having the generated unit run the verified digest or immutable local
  image ID. Retain the previous digest and its schema-compatibility window for
  rollback. Keep the existing label and local/public exact-revision gates even
  after removing the mutable runtime alias.

## VI. Processes

Published intent: application processes are stateless and share nothing. Durable
state belongs in backing services. Process memory and local disk may hold only
single-transaction or replaceable cache data. A future request or job must not
depend on reaching the same process.
[Official factor](https://12factor.net/processes)

2026 reading: a stateful self-host product can still satisfy the intent when its
SQLite database and media directory are explicit attached volumes. The process
must not confuse the container's writable layer with durable storage. Kubernetes
describes ephemeral volumes as following the Pod lifetime, which is the right
failure assumption even on another container manager.
[Kubernetes ephemeral volumes](https://kubernetes.io/docs/concepts/storage/ephemeral-volumes/)

Practical test:

- Delete and recreate the application container while preserving only declared
  backing resources. User data, schedules, jobs, and media must remain correct.
- Run two cloud instances behind a router with no session affinity.
- Interrupt a job after claim and prove another worker either recovers it or
  records a deliberately ambiguous external write rather than duplicating it.
- Erase temp storage between operations and prove no later request depends on it.

Verified repository evidence:

- Cloud validation requires PostgreSQL and S3-compatible storage. Sessions,
  queue jobs, schedules, publication state, and provider-write fences are stored
  in the database.
- The durable worker records locks, heartbeats, retries, stale-job recovery, and
  ambiguous external-write state in the database.
- Media storage is an explicit adapter. The container defaults place SQLite and
  local media under `/data`, while Compose mounts a named persistent volume.
- Video and provider paths use temporary files for bounded operations and remove
  them, rather than treating them as durable media storage.
- The image smoke recreates the process and checks that the volume-backed SQLite
  service returns ready after restart.
- The active production topology has one OpenPost application instance and one
  PostgreSQL instance. The Home cloud configuration attaches PostgreSQL and
  S3-compatible storage rather than the container writable layer for durable
  application data.

Gaps and uncertainty:

- With one application instance, production does not prove no-affinity requests
  or failover to a second process. With one PostgreSQL instance, database host
  failure is a service outage even though the app process itself is stateless.
- The restart smoke covers the self-host SQLite path. It does not prove two
  cloud replicas against PostgreSQL and S3.
- Authentication, MFA, invitation, email-change, AI, discovery, meme, caption,
  and stock-media rate limits use process-local maps. With `N` replicas, the
  effective allowance is roughly `N` times the intended value and resets when a
  process restarts.
- Several expensive request concurrency limits are also local channels/maps.
  Values described as global or per-user become per-replica once web scales.
- Same-VPS backup and restore jobs pass, but off-host recovery remains unproved.
  Process statelessness does not make the overall service highly available.

Recommended action:

- Add the cloud multi-instance test described under factor X.
- In cloud mode, fail closed if a durable feature resolves to local filesystem
  storage. Current validation appears to do this, retain a direct regression
  test at the top-level runtime boundary.
- Move security and paid-resource quotas to a shared PostgreSQL or dedicated
  limiter boundary before adding web replicas. Keep process-local load shedding
  as a separate overload control.
- Inventory every write outside configured database, media, and temporary
  directories. Treat an unexplained write to the container layer as a defect.

## VII. Port binding

Published intent: the app is self-contained and exports its service by binding a
port. A routing layer maps public hosts to that port. The execution environment
must not inject a web server into the application process.
[Official factor](https://12factor.net/port-binding)

2026 reading: an ingress proxy, Caddy, Nginx, systemd socket policy, or cloud load
balancer remains outside the app. The app owns its HTTP server and listens on a
configured internal port.

Practical test:

- Start the same artifact on an arbitrary available port and call health,
  readiness, OpenAPI, and one authenticated route directly.
- Put a reverse proxy in front without changing application code.

Verified repository evidence:

- `backend/cmd/openpost/main.go` starts Echo on `OPENPOST_PORT`.
- `docker/Dockerfile` exposes 8080 and runs the self-contained Go binary.
- `docker-compose.yml` maps a host port to the application's configured port.
- TLS and public routing are documented as deployment responsibilities.
- The Home module publishes the container only on host loopback port 8090 and
  registers that internal port with Caddy. TLS and public routing remain outside
  the OpenPost process.

No material port-binding gap was found. Probe semantics are a disposability
issue covered under factor IX: the generated container health check currently
uses `/ready`, although the image and application contract distinguish liveness
`/health` from readiness `/ready`.

## VIII. Concurrency

Published intent: model workload types as first-class supervised processes and
scale horizontally by changing the number of each process type. Processes do
not daemonize or manage PID files. The execution environment owns restart and
shutdown.
[Official factor](https://12factor.net/concurrency)

2026 reading: a process type maps cleanly to a container role or service unit.
Internal Go goroutines are fine for multiplexing, but they should not be the only
way to add capacity for workloads with different scaling signals. Horizontal
autoscaling means adding replicas, not only assigning more CPU or memory.
[Kubernetes horizontal autoscaling](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/)

Practical test:

- Run `N` web replicas and `M` worker replicas from the same release, with
  `N != M`, and vary each independently.
- Scale workers on queue depth or oldest-job age while scaling web on request
  load and latency.
- Prove concurrent claims do not execute one job twice and external writes keep
  their idempotency or ambiguity guarantees.
- Stop any instance and let the external supervisor replace it.

Verified repository evidence:

- The Go process does not daemonize or write a PID file.
- Durable jobs use database claims, worker IDs, lock heartbeats, retry policy,
  and stale-worker recovery. This is a credible base for horizontal workers.
- The container expects an external supervisor through its foreground `CMD` and
  health check.
- Production currently runs one combined OpenPost instance. The Home unit has no
  explicit CPU or memory limit or reservation.

Material gap:

- `main.go` always starts one HTTP server and one serial background worker in
  the same process. It also schedules recurring work there. Adding a web replica
  adds a worker, and adding worker capacity adds another web server.
- All job classes share one worker loop. A slow video or provider job can delay
  unrelated due work in that process.
- No queue-depth, queue-age, or per-job-class saturation signal was found in this
  pass. The deployed formation is one combined replica, so there is no live proof
  of independent scaling or multi-worker claim behavior.
- Resource limits are not themselves a Twelve-Factor requirement, but their
  absence makes overload behavior and capacity planning less predictable on a
  VPS shared with PostgreSQL and other services.

Recommended action:

- Add a runtime-role enum, not boolean flags: `all`, `web`, `worker`, and
  `migrate`. Use `all` by default for self-hosting. Hosted operation should run
  separate web and worker units from the same image.
- Start with one worker role and one safe loop. Split job classes only after a
  measured workload proves independent scaling or isolation is needed.
- Expose queue depth, oldest due age, active leases, terminal failures, and job
  duration by class. Scale from service demand, not CPU alone.
- Measure current peaks, then set per-unit memory and CPU protections that leave
  headroom for PostgreSQL and host recovery. Alert before limits cause repeated
  restarts. Do not use a low arbitrary cap as a substitute for workload roles.

## IX. Disposability

Published intent: processes start quickly, stop gracefully on `SIGTERM`, and
survive sudden death. Web processes stop accepting new work and finish in-flight
requests. Workers return or safely recover interrupted jobs. Jobs should be
reentrant or idempotent where possible.
[Official factor](https://12factor.net/disposability)

2026 reading: "a few seconds" is a target to measure, not a universal magic
number. Set a startup and termination budget that fits the platform. A container
manager's grace-period countdown is finite, and it eventually kills a process
that has not exited. Kubernetes documents the same TERM-then-force-kill model.
[Kubernetes Pod termination](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination)

Practical test:

- Measure cold start to liveness and readiness with production-shaped config and
  a migrated database.
- During a long request and a leased job, send `SIGTERM`. Readiness must go false
  first, new work must stop, in-flight work must resolve safely, and PID 1 must
  exit within the platform deadline.
- Send `SIGKILL`, restart elsewhere, and prove stale jobs recover without an
  unsafe repeat of external provider writes.

Verified repository evidence:

- `main.go` listens for interrupt and `SIGTERM`.
- Echo has a ten-second graceful shutdown context.
- The worker accepts a cancellation context. Jobs have lock heartbeats, stale
  recovery, retry classification, and special fencing for ambiguous provider
  writes.
- The production image has liveness and readiness endpoints, and the smoke test
  exercises restart.
- The Home service checks the live application and exact revision after deploy,
  and both OpenPost and PostgreSQL were healthy at inspection time.

Material gap:

- On signal, `main.go` cancels and calls `worker.Stop()` before `e.Shutdown()`.
  `worker.Stop()` waits on an unbounded channel. Echo therefore keeps accepting
  requests while shutdown waits for the worker, and the ten-second HTTP timeout
  does not bound the worker wait.
- When cancellation makes an executor fail, terminal-job bookkeeping reuses the
  canceled worker context. That update can fail and leave the job in
  `processing` until the fifteen-minute stale-lock recovery window.
- Blob operations do not accept the worker context and S3 paths use background
  contexts. A storage cleanup can process thousands of objects sequentially
  while ignoring shutdown, leaving the supervisor to force-kill the process.
- There is no explicit readiness-draining state in the inspected shutdown path.
- The image and deployment documentation use `/health` for process liveness and
  `/ready` for traffic eligibility. The Home Podman health command instead calls
  `/ready`, collapsing those contracts. A backing-service readiness failure can
  mark a live process unhealthy, obscure the actual dependency failure, and make
  any health-triggered restart policy counterproductive.
- Startup performs schema creation, migrations, service initialization, and
  scheduling before the server listens. No startup budget or regression test was
  found.
- The image declares no `STOPSIGNAL`; normal SIGTERM is suitable. The Home source
  module does not declare an OpenPost-specific systemd stop deadline, so the
  effective generated-unit deadline should be recorded in the TERM test.

Recommended action:

- Add a drain coordinator. On signal, mark readiness false, stop accepting HTTP
  traffic, cancel worker intake, and wait for HTTP plus worker shutdown under one
  deadline shorter than the supervisor's stop timeout.
- Separate "stop claiming new jobs" from "cancel the current job." Let safe jobs
  finish inside the budget. Release or expire leases for interrupted work. Keep
  provider-write fencing for operations whose remote outcome is unknown.
- Use a new short, non-canceled context only for final lease/failure bookkeeping,
  and propagate the bounded shutdown context through every blob operation.
- Add cold-start and TERM/KILL container tests. Use real elapsed-time assertions
  with generous platform-aware bounds, not sleeps that happen to pass locally.
- Change the Podman liveness command to `/api/v1/health`. Keep `/api/v1/ready`
  in Caddy/rollout traffic gates, and test that loss of PostgreSQL fails readiness
  without claiming the OpenPost process itself is dead.

## X. Dev/prod parity

Published intent: keep time, personnel, and tooling gaps small. Developers stay
close to deploys, changes reach production frequently, and development/staging
use the same type and version of backing services as production.
[Official factor](https://12factor.net/dev-prod-parity)

2026 reading: laptops and production hosts need not have the same CPU count or
operating system. The same immutable build, service protocols, schema behavior,
and failure modes matter. A fast SQLite unit suite is valuable, but it cannot be
the only gate for a PostgreSQL production data plane.

Practical test:

- Run the release candidate in cloud mode against the same PostgreSQL major
  version and S3 protocol used by production.
- Execute migrations, concurrent queue claims, transactional edge cases, direct
  media upload, multipart storage, and restart.
- Deploy the already-tested digest to staging and production. Do not rebuild.
- Compare toolchain versions across laptop, CI, release build, and runtime.

Verified repository evidence:

- Devenv and Nix declare the developer environment. Root tasks provide shared
  check, test, build, and verify commands.
- CI builds and browser-tests canonical artifacts, then the release workflow
  deploys the same image digest and checks the live revision.
- A set of PostgreSQL-specific tests exists for migrations, concurrency,
  credentials, media lifecycle, billing, and provider writes.
- The Home cloud topology declares PostgreSQL 17 and S3-compatible storage, and
  the live exact application revision was verified. Artifact parity is strong
  even though service-behavior parity is not.

Material gap:

- Those PostgreSQL tests read `OPENPOST_TEST_POSTGRES_URL` and skip when it is
  absent. No assignment or PostgreSQL service for that variable appears in the
  inspected CI workflow. The normal backend job therefore does not prove them.
- Most tests use in-memory SQLite. S3 behavior uses fake clients. This diverges
  from the required cloud data plane.
- Production PostgreSQL is declared with mutable tag `17-alpine`; CI does not
  run against a digest-pinned copy of that production database image.
- The Go and Bun version mismatches under factor II add a smaller tool gap.
- There is no repository-owned staging environment contract in the evidence
  inspected here. Production proof is strong, but production should not be the
  first place the hosted service combination runs.

Recommended action:

- Add a focused, release-blocking `hosted-data-plane` job. Use a real PostgreSQL
  service and a disposable S3-compatible server. Set cloud mode, run the same
  image or binary, and exercise the contracts most likely to differ.
- Make the job fail if any PostgreSQL-tagged test skips for missing service
  config. Keep the SQLite suite for speed and self-host coverage.
- Use the same PostgreSQL major version as production. S3-compatible test
  coverage should target protocol behavior OpenPost relies on, not a claim that
  every vendor behaves identically.
- Reuse the candidate image in a staging smoke if a staging deploy exists. Keep
  release latency low by focusing the lane on the real blast radius.

## XI. Logs

Published intent: the app writes an unbuffered event stream to standard output
and does not own log files, routing, rotation, or retention. The execution
environment captures and sends the stream to search, archival, and alerting
systems. [Official factor](https://12factor.net/logs)

2026 reading: stdout and stderr remain the container contract. Structured JSON
or logfmt makes the stream queryable, but format is not the factor itself.
Metrics, traces, product analytics, and audit records are separate signals and
should not be forced into application logs. Kubernetes likewise describes
stdout/stderr as the common container path and leaves cluster-level storage to a
separate system.
[Kubernetes logging architecture](https://kubernetes.io/docs/concepts/cluster-administration/logging/)

Practical test:

- Run the container with a read-only root filesystem and no writable log mount.
- Generate a request, job retry, terminal failure, and shutdown. Capture every
  event from stdout/stderr.
- Query events by revision, request ID, job ID, severity, and event name in the
  deployed collector.
- Feed credential-shaped values into safe test paths and prove the stream does
  not contain them.

Verified repository evidence:

- Backend and worker code use Go's standard logger and do not configure an
  application logfile.
- HTTP request logs include request ID, normalized route, status, latency, and
  response size.
- Worker events include worker and job identity, lifecycle, retry, and terminal
  outcomes. Telemetry captures exceptions separately.
- `.gitignore` excludes local log artifacts.
- The Home runtime captures standard streams in journald and caps the host
  journal at 512 MB. Observed use was 507.8 MB.

Gaps and cautions:

- Log lines are ad hoc plain text. Field names and severity are not consistent,
  and multiline errors can complicate parsing.
- Some events include remote IP, URI path, provider/app identifiers, job IDs, and
  error text. These are useful, but there is no one documented redaction and
  retention contract for potentially personal or credential-bearing data.
- No off-host log drain or searchable retained copy was found. Approaching the
  512 MB cap does not mean an immediate disk-full failure because journald
  rotates within its quota, but it does mean older evidence can disappear soon.
  The observed size is host-wide, not proof that OpenPost alone produced it.
- The app's PostHog telemetry does not satisfy the logs factor. Losing the
  stdout stream would still leave an operational gap.

Recommended action:

- Adopt one structured stdout event schema with timestamp, severity, event,
  revision, request/job correlation, and safe dimensions. Preserve human-readable
  local viewing through the collector or formatter rather than dual log paths.
- Centralize redaction for URLs, headers, provider payloads, error chains, and
  config metadata. Add negative tests with synthetic credential-shaped values.
- Ship the stream off-host over an authenticated, encrypted channel before local
  rotation removes it. Define retention, access control, deletion, and alert
  policy, then prove queries by exact application revision and request/job ID.
  The application should never manage rotation or archive files itself.

## XII. Admin processes

Published intent: migrations, consoles, and maintenance scripts run as one-off
processes from the same codebase, release, dependencies, and config as long-lived
processes. Admin code ships with the application rather than living as an
unversioned operator snippet.
[Official factor](https://12factor.net/admin-processes)

2026 reading: use a one-shot container or service unit from the exact application
image, not an interactive shell inside a long-running container. A Kubernetes
Job is one representative model: it runs a task to completion and records the
result. OpenPost can implement the same contract with systemd or Podman.
[Kubernetes Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/)

Practical test:

- Run `migrate`, config validation, repair, or restore verification from the same
  image digest and deployment config as the target release.
- Record command, image digest, target, actor, start/end time, and exit status
  without recording secrets.
- Retry only commands designed to be idempotent, and prove migrations cannot run
  concurrently in an unsafe way.

Verified repository evidence:

- The application binary has a `check-config` one-off command.
- Database migrations and repair logic are versioned in the repository.
- Release and restore scripts are versioned and run declared tools.
- The Home deploy runs the candidate image's own `check-config` command with
  production config before promotion. Daily database/media backups and the
  weekly restore drill succeeded on the inspection day.

Material gap:

- Migrations are not exposed as a one-off role. They run implicitly inside every
  normal server process before runtime validation completes.
- A horizontally scaled rollout can start several instances that all attempt
  schema setup. The migration runner has per-migration transactions but no
  migration-wide lock, so concurrent starters can observe the same pending set.
  Some duplicate-column cases are tolerated, but that is not general migration
  serialization.
- Backup and restore are scheduled and leave systemd/journal evidence, but no
  `OnFailure` notification was found. Silent timer failure can therefore persist
  until an operator checks the unit or the next audit.
- The deployment webhook is an administrative execution boundary. It shares one
  secret across three deployment families, accepts no verified anti-replay
  field, and returns command output. These are security gaps even though the
  invoked deploy scripts validate their arguments and artifact revisions.
- No bounded catalog of supported production admin commands was found.

Recommended action:

- Add explicit `check-config`, `migrate`, and narrowly scoped repair commands to
  the application binary. Avoid a generic remote REPL for production.
- Run hosted migrations as a one-off unit from the candidate digest and release
  config. Record the result before switching long-lived units.
- Keep self-host auto-migration as an explicit convenience policy, protected by
  database locking and documented rollback limits.
- For restore drills, use the same schema code and release identity, but restore
  into an isolated target. Never test by mutating the production database.
- Add failure notifications for backup, restore, migration, and deployment
  one-shots. An alert should name the unit, target, release identity, and exit
  status without embedding command output or secrets.
- Apply the isolated, timestamped, nonce-protected webhook design under factor
  III. Treat a webhook as permission to invoke one fixed admin action, not as a
  general command transport.

## Cross-factor acceptance suite

One compact suite can prove most of the missing behavior:

1. Render deployment secrets for the exact service identity. Prove OpenPost and
   PostgreSQL can read only their required files and that `nobody` cannot read
   any known secret or rendered environment path.
2. Send one valid, one stale, one repeated, and one cross-deployment webhook
   request. Only the fresh request to its intended deployment may execute, and
   no response may contain command output.
3. Build one candidate image and retain its source SHA, manifest, SBOM, and
   digest.
4. Start disposable PostgreSQL and S3-compatible services. Run `check-config`
   and `migrate` from the candidate digest.
5. Start two web replicas and two worker replicas from that digest with the same
   config. Exercise no-affinity HTTP sessions, media lifecycle, scheduled work,
   and concurrent claims.
6. Send `SIGTERM` during an HTTP request and a leased job. Check readiness drain,
   bounded exit, and safe job recovery. Repeat with `SIGKILL`.
7. Restart all application processes with only PostgreSQL and object storage
   preserved. Verify state and media.
8. Capture stdout/stderr and assert the event schema plus absence of synthetic
   secrets.
9. Restore an encrypted off-host backup using an independent SOPS recipient into
   a disposable, egress-disabled target. From the exact image, prove row/object
   counts and encrypted-row reads without starting workers or printing values.
10. Promote the same digest to a staging release, then production, and compare
    the running revision with the candidate.

This should be a focused hosted-runtime gate, not a second copy of every unit and
browser test.

## Reconciled deployment evidence

This table replaces the initial Home-module checklist. "Verified" means the
module, generated/runtime metadata, job result, or public revision was directly
inspected without reading secret contents. It does not turn an observation into
a historical guarantee.

| Area                          | Verified current evidence                                                                                                                                                                                                                                          | Remaining risk or correction                                                                                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source and live release       | The audited checkout was clean at `bdac13f` with matching `origin/main`. Live was `v4.13.1` at `ae15eed`; its tag matched, and CI 33317817068 plus release 33319075574 succeeded.                                                                                  | Repeat the exact lineage proof for each other deployable in the monorepo.                                                                                                                                                                                                  |
| Image promotion               | Home pulls the requested digest, verifies the OCI revision label, runs `check-config`, records a rollback image, retags local `latest`, then checks local and public readiness and exact revision.                                                                 | A clean host still requires a pre-existing local image, and rollback does not prove the previous public revision on every path. Add a bootstrap digest and fail-closed rollback proof. Running the unit by digest or immutable image ID is a smaller later simplification. |
| Secret delivery               | SOPS renders file-backed secrets outside the image. All inspected OpenPost secret files and the cloud/PostgreSQL env files were `root:root` `0444`; traversable parents were `0751`; unprivileged `nobody` could read tested JWT/cloud paths. No content was read. | Restrict permissions immediately, validate the exact container identity, then rotate in stages. Access is proven; access or exfiltration history is not. Use dual-key re-encryption for the data-encryption key.                                                           |
| Effective database settings   | Production had zero `instance_settings` rows.                                                                                                                                                                                                                      | Database-over-env secret precedence is latent, not active. Change the authority model before administrators begin storing credential overrides.                                                                                                                            |
| Backing services and topology | One OpenPost application unit and one PostgreSQL unit were healthy. Cloud config attaches PostgreSQL and S3-compatible storage.                                                                                                                                    | Readiness checks PostgreSQL but not S3, there is no app or database replica, and the Postgres `17-alpine` tag is mutable. Add bounded storage readiness, pin it, and prove replacement behavior.                                                                           |
| Backup and restore            | Daily database and media backups and the weekly restore drill succeeded on 2026-08-30. The SOPS file has independent VPS, laptop, and desktop age recipients.                                                                                                      | Backups and the current drill remain on the VPS, and media backup reuses the app credential. Add encrypted off-host copies, `OnFailure` alerts, least-privilege credentials, and an independent-recipient drill that proves restored encrypted rows can be read.           |
| Process formation             | The live topology is one combined web, worker, scheduler, and migration process. No CPU or memory limit was declared for OpenPost/PostgreSQL.                                                                                                                      | Split hosted roles when independent capacity is needed, add saturation signals, then set measured resource protections.                                                                                                                                                    |
| Health and termination        | The deploy checks `/ready`; the app and image expose separate `/health` and `/ready` endpoints.                                                                                                                                                                    | Home incorrectly uses `/ready` as the Podman liveness command. Change liveness to `/health`, retain readiness for traffic, and prove bounded TERM drain under the effective systemd timeout.                                                                               |
| Logs                          | Standard streams reach journald. The host cap is 512 MB and observed use was 507.8 MB.                                                                                                                                                                             | No off-host drain was found, so rotation can remove the only observed evidence. Add secure remote shipping, retention, queries, and alerting.                                                                                                                              |
| Deployment webhook            | One secret covers OpenPost, Montra, and personal deploys. The request has no verified timestamp/nonce/event ID, and the response includes command output.                                                                                                          | Separate credentials and executors, add canonical request signing plus replay storage, minimize responses, then revoke the shared secret.                                                                                                                                  |

## Adjacent defects uncovered

These findings are not additional Twelve-Factor criteria. They surfaced while
following identity, one-off state, contract, and release boundaries, and they
should not wait for a broad architecture program.

| Priority | Finding and exact evidence                                                                                                                                                                                                                                                                     | Risk                                                                                                                                                                                                                | Focused action and proof                                                                                                                                                                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0       | `backend/internal/platform/threads.go:19-24,77-141` stores callback-specific `user_id` in shared `ThreadsAdapter.lastUserID`; the later read is also outside the mutex. `backend/internal/api/handlers/oauth.go:1188-1200` prefers that token `Extra.user_id` over the fetched `profile.ID`.   | Two interleaved Threads callbacks can make one exchange return the other user's ID, then persist cross-bound identity metadata. The mutex prevents only some memory races; it does not make request state isolated. | Remove `lastUserID`. Carry the token subject as request-local data through the exchange, compare it with `profile.ID`, and reject a mismatch. A deterministic two-callback barrier test must fail on the old adapter, pass on the new one, and run cleanly under Go's race detector. |
| P0       | OAuth-state consume is SELECT then DELETE in `backend/internal/services/oauthstate/store.go:60-90`; X request-token consume has the same shape in `backend/internal/api/handlers/x_request_store.go:37-64`. Neither path makes returning the payload conditional on winning one atomic delete. | Two simultaneous callbacks can both observe and accept a supposedly one-time credential before either deletion is authoritative.                                                                                    | Implement a single atomic consume, preferably `DELETE ... RETURNING` behind the database boundary for both SQLite and PostgreSQL, or an equivalent transaction that proves exactly one winner. Concurrent tests must show one success and one invalid/already-consumed result.       |
| P1       | `frontend/openapi.json` has 248 paths while `mobile/src/lib/api/schema.d.ts` has 234. `scripts/check-contracts.mjs` regenerates frontend, docs, and automation contracts but omits the mobile schema.                                                                                          | Mobile can compile against a stale API contract while the repository contract gate is green.                                                                                                                        | Add `mobile/src/lib/api/schema.d.ts` and `mobile`'s `generate:api` command to the generated-contract gate. Regenerate it now, and make any future API drift fail `check:contracts`.                                                                                                  |
| P1       | `mobile/app.json` still declares app version `0.1.0` and Android `versionCode: 1`, independent of the server's `v4.13.1` release identity.                                                                                                                                                     | Android artifacts are hard to order and cannot be upgraded through channels that require a monotonically increasing version code.                                                                                   | Define mobile release identity separately from server SemVer, but make it intentional and monotonic. Record version name, version code, source SHA, and artifact digest in the Android candidate evidence, and reject reuse of a released version code.                              |

## What twelve-factor does not prove

A high score would not prove security, privacy, disaster recovery, tenancy
isolation, accessibility, cost control, or complete observability. Twelve-Factor
is deliberately about the contract between application and platform. Keep the
existing supply-chain, legal, provider-safety, backup, and product-quality gates
as separate requirements.

## Primary sources

Published Twelve-Factor text:

- [Introduction and all twelve factor titles](https://12factor.net/)
- [I. Codebase](https://12factor.net/codebase)
- [II. Dependencies](https://12factor.net/dependencies)
- [III. Config](https://12factor.net/config)
- [IV. Backing services](https://12factor.net/backing-services)
- [V. Build, release, run](https://12factor.net/build-release-run)
- [VI. Processes](https://12factor.net/processes)
- [VII. Port binding](https://12factor.net/port-binding)
- [VIII. Concurrency](https://12factor.net/concurrency)
- [IX. Disposability](https://12factor.net/disposability)
- [X. Dev/prod parity](https://12factor.net/dev-prod-parity)
- [XI. Logs](https://12factor.net/logs)
- [XII. Admin processes](https://12factor.net/admin-processes)

Official Twelve-Factor modernization project:

- [Update FAQ](https://github.com/twelve-factor/twelve-factor/blob/main/UPDATE_FAQ.md)
- [Project vision](https://github.com/twelve-factor/twelve-factor/blob/main/VISION.md)
- [In-progress next-branch factor text](https://github.com/twelve-factor/twelve-factor/tree/next/content),
  used only to understand the maintainers' direction, not as the published
  compliance baseline

Container translations from primary sources:

- [OCI image specification](https://github.com/opencontainers/image-spec/blob/main/spec.md)
- [OCI image configuration and content-addressed identity](https://github.com/opencontainers/image-spec/blob/main/config.md)
- [Kubernetes container image tags and digests](https://kubernetes.io/docs/concepts/containers/images/)
- [Kubernetes Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)
- [Kubernetes ephemeral volumes](https://kubernetes.io/docs/concepts/storage/ephemeral-volumes/)
- [Kubernetes horizontal workload autoscaling](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/)
- [Kubernetes Pod termination](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination)
- [Kubernetes logging architecture](https://kubernetes.io/docs/concepts/cluster-administration/logging/)
- [Kubernetes Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/)
