# Provider readiness and certification contract

This directory is the source boundary for public provider claims. The checked-in
[`public-claims.json`](public-claims.json) is intentionally empty until a live
certification ledger exists and a release can project current, sanitized proof
from it. An adapter, configured credential, mocked test, or successful build is
not enough to add a claim. The standalone command also refuses a non-empty
manifest until the ledger/release integration supplies current contract
digests.

Run the isolated gate with:

```sh
bun test scripts/provider-certification-manifest.test.mjs
bun scripts/provider-certification-manifest.mjs check
```

The backend projection and repository live in
`backend/internal/services/providerreadiness`. Migration 077 owns the immutable
ledger tables. REST, MCP, CLI, capability resolution, scheduling, OAuth
connection, and the publisher worker all consume the same decision service.
Provider adapters remain execution implementations; they never decide their own
readiness.

## Evidence model

Readiness is a projection of independent facts, not a mutable status column.
Each decision uses the exact subject:

- provider and effective provider-app fingerprint;
- deployment and provider-app environment;
- optional instance fingerprint;
- account kind and output profile;
- operation and policy mode.

The projection separately evaluates:

- effective runtime configuration;
- current approval review and tier;
- exact per-account authorization and granted scopes;
- server-side execution policy;
- runtime control (`enabled`, `degraded`, or `disabled`);
- current local-test evidence;
- current live-certification evidence.

The certification contract hashes its schema, capability-source digest,
policy-source digest, scopes, checks, and every execution requirement. Evidence
from an older Git revision remains usable only when this exact contract digest
is unchanged and exact-revision matching is not required. Evidence never moves
between subjects.

Hosted service publication requires current local and live evidence. The
first evidence cannot exist before a test runs, so the privileged
`certification_test` intent deliberately bypasses both prior local and prior
live proof. It bypasses no execution safety gate: configuration, approval or
explicit trial permission, exact account authorization and scopes, policy, and
runtime controls still apply. Only an unscoped instance admin can select that
intent through REST, MCP, or connection routes, and queued work carries the
intent so the worker repeats the same decision immediately before a provider
call. A certification test can execute but can never create a public claim.

Self-hosted execution still requires effective configuration and exact account
authorization, but does not require OpenPost's Hosted service approval or
certification records. It is never projected as a Hosted service public claim. A
healthy result stays quiet. Missing or unsafe facts project to a specific
blocked state; they never default to ready.

Every publication certification contract includes connect, authorization, the
exact immediate or scheduled operation, final-result reconciliation, refresh,
and revocation checks. Refresh or revocation may be `not_applicable` only when
the contract permits it and the result records a safe reason. All other required
checks must pass.

## Public-claim boundary

The manifest validator accepts a claim only when all of these are true:

- the subject uses production deployment and provider-app environments;
- the effective configuration is present;
- approval is `approved` or explicitly `not_required` and its review is current;
- required and granted scope snapshots agree with both certifications;
- policy is allowed and the runtime control is enabled;
- local and live evidence are current, use a full Git SHA, and match the current
  certification-contract digest;
- required lifecycle checks exist and pass, or an allowed refresh/revoke check
  records why it is not applicable;
- the exact subject appears only once.

The schema has exact keys. It cannot contain an account ID, raw provider result,
token, operator identity, or provider URL. Instance and external-result
references are SHA-256 fingerprints. Policy links must use HTTPS without
credentials or fragments; only allowlisted documentation-version query fields
are accepted.

## Persistence and enforcement

Migration 077 owns four append-only tables: approval reviews, certification
runs, normalized certification checks, and runtime-control events. SQLite and
PostgreSQL reject both updates and deletes. Certification rows have a composite
foreign key to the exact approval subject and store the typed subject, evidence
kind, tested Git SHA, contract digest, approval/scopes snapshot, test and expiry
times, and a one-way operator reference. Check rows store only a normalized
outcome, safe error class, optional applicability reason, a hashed external
reference, and completion time. Raw provider responses, URLs, IDs,
credentials, and tokens are prohibited.

The service builds effective configuration from built-in, environment,
database, and dynamic sources with runtime precedence. It validates new
certification evidence against the currently configured non-secret app
fingerprint, deployment/provider environment, canonical capability and output
profile, policy mode, required scopes, and current contract digest before the
repository can append it. An environment deny-list has priority over database
controls. The worker checks controls again at the last safe point before each
external provider call, so a disable event also fences work that was queued
while healthy.

The release manifest binds the exact bytes, schema version, and zero-claim
count of `public-claims.json`. A release cannot silently substitute another
claim file. The standalone gate intentionally refuses non-empty claims until a
trusted ledger projection supplies current contract digests. No certification
records are invented or backfilled by migration.

## Current claim state

Reviewed 2026-08-09.

<!-- provider-certification:begin -->
No posting option has passed our final live check on OpenPost Hosted yet.

A social app can appear in OpenPost before it is ready for real accounts.
<!-- provider-certification:end -->

The repository contains no checked-in live evidence and migration 077 never
creates any. Provider tables in product documentation describe implemented code
paths, not a certified Hosted service claim. The launch matrix, runtime API,
MCP, and CLI expose the independent evidence dimensions and the exact effective
state.

Mocked adapter tests remain useful implementation evidence, but they are not
local or live certification records. Builds and service-readiness checks prove
the application artifact, not provider approval, account scopes, provider
results, refresh/revocation, expiry, or kill-switch state. A provider/format can
enter the public manifest only through a sanitized, current ledger projection
that passes the contract-digest release gate.

## Provider policy sources

Reviewed 2026-08-09. These are implementation inputs, not proof that an OpenPost
provider or format is live-certified.

| Provider  | Current official source and certification dimension                                                                                                                                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X         | [API overview](https://docs.x.com/x-api/overview) and [rate limits](https://docs.x.com/x-api/fundamentals/rate-limits): access tier, account capability, operation, and limits must be captured per subject.                                                            |
| Mastodon  | [OAuth](https://docs.joinmastodon.org/spec/oauth/) and [Instance entity](https://docs.joinmastodon.org/entities/Instance/): evidence is instance- and version-sensitive; a built-in adapter is not proof that an instance is configured or compatible.                  |
| Bluesky   | [Getting started](https://docs.bsky.app/docs/get-started) and [video upload](https://docs.bsky.app/docs/tutorials/video): account eligibility, processing, and video-specific limits require separate proof.                                                            |
| LinkedIn  | [Community Management API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview?view=li-lms-2026-02): Development and Standard tiers have different approval and production-use boundaries.                          |
| Threads   | [Official Meta Postman workspace](https://www.postman.com/meta/threads/overview): scopes and each publishing mode must be certified against the effective Meta app.                                                                                                     |
| Facebook  | [Official Meta Postman workspace](https://www.postman.com/meta/facebook/overview): Page/account type, app review, scopes, and media mode belong in the exact subject.                                                                                                   |
| Instagram | [Official Meta Postman workspace](https://www.postman.com/meta/instagram/overview): login model, linked Professional account, review, scopes, and format are separate dimensions.                                                                                       |
| TikTok    | [Content Sharing Guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines/) and [Content Posting API setup](https://developers.tiktok.com/doc/content-posting-api-get-started/): unaudited and approved execution modes must not share readiness proof. |
| YouTube   | [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) and [OAuth authentication](https://developers.google.com/youtube/v3/guides/authentication): unaudited private-only uploads, token refresh, and revocation need explicit outcomes.          |
| Discord   | [Webhook resource](https://docs.discord.com/developers/resources/webhook) and [API reference](https://docs.discord.com/developers/reference): readiness is webhook/server/channel-specific and must cover secret rotation and effective upload limits.                  |

Postiz (`7d08f5b6fcac`) and Shoutrrr (`69e0621424a1`) were also inspected as
behavioral references. Their runtime disabled/refresh gates are useful, but
neither replaces OpenPost's evidence ledger or fail-closed public-claim gate.
