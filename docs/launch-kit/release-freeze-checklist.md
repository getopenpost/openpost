# Release Freeze, Smoke, and Rollback Checklist

> **Empty rehearsal template.** Checked boxes and result fields must come from the actual release candidate. This file does not prove production readiness.

## Freeze record

- Release version or commit: `[VERSION]`
- Freeze begins: `[TIMESTAMP AND TIMEZONE]`
- Launch window: `[WINDOW]`
- Release owner: `[NAME]`
- Campaign owner: `[NAME]`
- Incident owner: `[NAME]`
- Allowed changes after freeze: first-use, reliability, provider, security, and factual-copy blockers only

## Source and artifact freeze

- [ ] The release commit is named and reproducible.
- [ ] Application, marketing, docs, screenshots, demo script, launch kit, provider matrix, and campaign copy describe the same version.
- [ ] No speculative feature work is included in the freeze window.
- [ ] Required checks, tests, and production builds pass for this commit.
- [ ] Container image or binary digest is recorded: `[DIGEST]`.
- [ ] Database migration and downgrade implications are understood.

## Recovery point

- [ ] Database, media, and required secrets have a fresh recoverable backup.
- [ ] A restore was tested in an isolated environment at: `[TIMESTAMP]`.
- [ ] Previous known-good version or image digest is recorded: `[VERSION OR DIGEST]`.
- [ ] Rollback command or deployment procedure is written and reviewed: `[LINK OR COMMAND REFERENCE]`.
- [ ] Rollback owner can reach the deployment during the launch window.
- [ ] Provider callbacks, webhooks, and public media URLs after rollback are understood.
- [ ] Any migration that prevents simple rollback has a separate recovery plan.

## Production smoke

Record the exact time and evidence for each result.

| Check | Expected result | Actual result | Evidence | Verified at | Owner |
| --- | --- | --- | --- | --- | --- |
| Public landing and docs | Current release copy and assets load | _Not tested_ |  |  |  |
| App readiness endpoint | Ready with database healthy | _Not tested_ |  |  |  |
| Register or sign in | Intended hosted/self-hosted path works | _Not tested_ |  |  |  |
| Billing boundary | Bootstrap workspace allowed; protected writes blocked until active or trialing | _Not tested_ |  |  |  |
| Workspace-scoped `mcp:read` | Read tools visible; mutation hidden and rejected | _Not tested_ |  |  |  |
| Workspace-scoped `mcp:full` | Approved draft mutation works; cross-workspace access rejected | _Not tested_ |  |  |  |
| Provider readiness | Intended launch providers return expected runtime state | _Not tested_ |  |  |  |
| Media path | Upload and public fetch work for the exact provider path | _Not tested_ |  |  |  |
| Schedule and queue | Job appears once with correct timezone | _Not tested_ |  |  |  |
| Failure visibility | Synthetic or safe failure is visible and actionable | _Not tested_ |  |  |  |
| Token activity/revocation | MCP activity appears and revoked token stops working | _Not tested_ |  |  |  |

Do not use a real public post merely to satisfy a smoke check unless the account owner approved that post.

## Campaign rehearsal

- [ ] The exact brief and prompt were run against the release candidate.
- [ ] The agent started with read-only inspection.
- [ ] Every destination came from a successful exact-path provider verification row.
- [ ] The human review step covered copy, account, media, alt text, format, and schedule.
- [ ] The client displayed the exact mutation before approval.
- [ ] The queue and lifecycle result were captured without exposing credentials.
- [ ] The final video, transcript, poster, and captions match the rehearsed result.
- [ ] The first three seconds state only the outcome that the rehearsal proved.

## Rollback rehearsal

- [ ] The team has named the conditions that trigger rollback rather than fix-forward.
- [ ] The rollback procedure was rehearsed or dry-run against a non-production target.
- [ ] Readiness, login, queue, provider callbacks, and public media checks are listed for after rollback.
- [ ] A plan exists for jobs created by the failed version.
- [ ] A communication template exists for a delayed or partially failed campaign.

## Launch decision

- Decision: `[GO / HOLD / ROLLBACK]`
- Decided by: `[NAME]`
- Decided at: `[TIMESTAMP]`
- Blocking issues: `[LIST]`
- Evidence bundle: `[LINK]`

An empty or partially completed checklist means the release remains unproven.
