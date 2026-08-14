# Provider Readiness and Launch Gate

This page is for operators and release reviewers deciding whether a provider-format claim is current.

OpenPost keeps provider implementation, setup, evidence, approval, and runtime
control as separate facts. An adapter in the binary proves only that code
exists. It does not make a provider or format ready, connectable, publishable,
or safe to advertise.

## Effective readiness

Every decision is for one exact subject: provider app, deployment and provider
environment, optional Mastodon instance, account kind, output profile,
immediate or scheduled operation, and policy mode. The server projects these
facts through one readiness service:

| Fact               | Meaning                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| Configuration      | The effective built-in, environment, database, or dynamic app is present.                            |
| Local test         | A current normalized local run matches the exact certification contract.                             |
| Live certification | A current real-provider run matches the same contract and subject.                                   |
| Approval           | The provider app's reviewed tier is current and permits this operation.                              |
| Authorization      | The exact connected account grant is valid. Strict certification also requires every recorded scope. |
| Policy             | The server permits the selected account, format, and policy mode.                                    |
| Runtime control    | The most restrictive current environment or ledger control is enabled.                               |

The effective state is fail-closed. Actionable states include
`approval_required`, `reconnect_required`, `trial_only`, `policy_restricted`,
`degraded`, and `expired_proof`. An explicit disable always wins. Missing
configuration or certification is reported directly. A healthy state adds no
warning or badge.

Cloud deployments keep production provider identity and public-claim rules at all times. They enforce missing approval, runtime-control, local-test, live-test, and recorded OAuth-scope evidence as operational blockers only when `OPENPOST_PROVIDER_CERTIFICATION_ENFORCED=true`. The flag defaults to `false` so an evidence rollout cannot disable configured providers or migrated active accounts. Explicit provider disables, missing configuration, revoked or invalid grants, and provider policy restrictions still block operations.

Inspect the running server with:

```sh
openpost provider readiness
openpost provider readiness --json
```

The same projection is returned by `GET /api/v1/provider-readiness`, the
account provider catalogue, capability resolution, and the MCP
`get_provider_readiness` operation. Capability metadata describes implemented
formats; the attached readiness decision says whether the exact operation may
run now.

## Current managed-service claims

The canonical
[`provider-certification/public-claims.json`](https://github.com/getopenpost/openpost/blob/main/provider-certification/public-claims.json)
is the only source for public provider-format certification claims.

<!-- provider-certification:begin -->

The checked-in public certification manifest contains **0 exact provider-format claims**.

No managed provider-format certification claim is current. Implementation descriptions do not assert managed availability.
<!-- provider-certification:end -->

The release manifest binds that file's exact SHA-256 digest, schema version,
and claim count. A build, adapter, configured credential, mocked test, or manual
checklist cannot add a claim.

The provider pages document implemented OpenPost code paths and configuration
requirements. They are not evidence that a particular managed deployment,
provider app, account, format, or policy mode is currently live-certified.

## Recording certification evidence

Migration 077 creates immutable approval-review, certification-run,
certification-check, and runtime-control ledgers. The database rejects updates
and deletes on SQLite and PostgreSQL. Records contain normalized outcomes and
one-way fingerprints only; never store a token, raw provider response, provider
URL, account ID, or operator identity in this ledger.

Only an unscoped instance administrator using a signed-in browser session may append facts through these routes. API, CLI, and MCP bearer tokens are rejected:

- `POST /api/v1/admin/provider-readiness/approval-reviews`
- `POST /api/v1/admin/provider-readiness/runtime-controls`
- `POST /api/v1/admin/provider-readiness/certifications`

The first test cannot require proof that the test already happened. The
privileged `certification_test` execution intent therefore bypasses prior local
and live evidence only. It still requires effective configuration, current
approval or explicit trial permission, the exact account authorization and
scopes, allowed policy, and enabled runtime controls. Queued work preserves the
intent and the worker rechecks readiness immediately before each provider call.
The intent never makes a result publicly claimable.

For each immediate and scheduled subject, record:

- connect and exact account-authorization results;
- the immediate or scheduled provider result;
- the final reconciled provider outcome;
- refresh and revoke results, or an explicitly permitted not-applicable reason;
- a safe hashed external-result reference;
- tested Git revision, contract digest, operator reference, test time, and
  retest expiry.

A later failed run supersedes older passing proof. Changing an app identity,
instance, account kind, output profile, operation, policy mode, capability, or
contract requirement cannot reuse another subject's evidence.

## Release gate

A provider/format may enter the public claim manifest only when all of these
are true for the exact production subject:

- the production provider app is effectively configured;
- approval is current and approved or explicitly not required;
- required and granted scope snapshots match the current account grant;
- local and live runs are current, complete, and share the current contract
  digest;
- policy is allowed and the effective runtime control is enabled;
- each required check passed, with only contract-approved refresh/revoke
  not-applicable results allowed;
- the sanitized projection contains no account, operator, credential, URL, or
  raw external-result data.

Run `bun run check -- provider-certification` before release work. The checked-in
zero-claim gate refuses a non-empty manifest unless a trusted ledger projection
supplies the current contract digests. This prevents a documentation or adapter
change from silently becoming a public readiness claim.
