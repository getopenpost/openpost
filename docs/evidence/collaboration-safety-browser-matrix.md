# Collaboration-and-safety browser matrix

The collaboration-and-safety release cohort uses the built OpenPost application, HTTP authorization, and database persistence. Browser tests cover the visible journeys. Service and handler tests cover concurrency, provider callbacks, atomic deletion, redaction, and permission states that a browser cannot reproduce reliably.

## Invitation lifecycle

| Contract                                                                                                                       | Evidence                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New and existing recipients, provider acceptance, confirmed delivery, failure, expiry, revocation, and acceptance              | `tests/app/workspace-team.spec.ts`, `apps/server/internal/services/workspaceteam/service_test.go`, and `apps/server/internal/services/notifications/service_test.go`                                 |
| Authenticated, idempotent, generation-safe delivery callbacks with redacted evidence                                           | `apps/server/internal/api/handlers/email_delivery_webhook_test.go` and `apps/server/internal/services/notifications/service_test.go`                                                                 |
| Concurrent resend deduplication, secret rotation, exact cooldown and hourly retry times, and recovery after an enqueue failure | `apps/server/internal/services/workspaceteam/service_test.go`                                                                                                                                        |
| Seat limits under concurrent creation and expired-invitation resend                                                            | `apps/server/internal/services/workspaceteam/service_test.go` and `apps/server/internal/api/handlers/workspaces_test.go`                                                                             |
| One enumeration-safe response for expired, revoked, unknown, and wrong-recipient acceptance                                    | `apps/server/internal/api/handlers/workspaces_test.go`                                                                                                                                               |
| No raw acceptance token in notification, audit, provider-failure, or callback evidence                                         | `apps/server/internal/services/workspaceteam/service_test.go`, `apps/server/internal/services/notifications/service_test.go`, and `apps/server/internal/api/handlers/email_delivery_webhook_test.go` |

The browser journey verifies the administrator's complete member and invitation lifecycle, truthful provider-accepted and delivered labels, copy-link recovery, resend limits, immediate revocation, permissions, desktop and phone layouts, overflow, and clean console output.

## Destructive Organization and Workspace operations

| Contract                                                                                                                           | Evidence                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Previewed removal, retention, access, recovery, billing, pending work, and final-Workspace blockers                                | `apps/server/internal/api/handlers/workspaces_delete_test.go`, `apps/server/internal/api/handlers/organizations_delete_test.go`, and `tests/app/settings-workspace.spec.ts` |
| Current Owner, exact canonical name, and recent-authentication enforcement                                                         | `apps/server/internal/api/handlers/workspaces_delete_test.go`, `apps/server/internal/api/handlers/organizations_delete_test.go`, and `tests/app/settings-workspace.spec.ts` |
| Concurrent final-Workspace protection and no arbitrary wait after blockers clear                                                   | `apps/server/internal/api/handlers/workspaces_delete_test.go` and `apps/server/internal/api/handlers/organizations_delete_test.go`                                          |
| Atomic failure, complete boundary removal, job and credential cleanup, terminated access, and retained content-free audit evidence | `apps/server/internal/api/handlers/workspaces_delete_test.go` and `apps/server/internal/api/handlers/organizations_delete_test.go`                                          |

`tests/app/settings-workspace.spec.ts` keeps the destructive dialog open after rejected reauthentication, proves the Organization still exists, then completes deletion at 320 px through the real API.

## Ownership and audit

| Contract                                                                                                                                        | Evidence                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exactly one willing Owner after nominee acceptance, with decline, revocation, expiry, single-use, and rollback behavior                         | `apps/server/internal/services/organizationownership/service_test.go`, `apps/server/internal/api/handlers/organization_ownership_test.go`, and `tests/app/organization-ownership.spec.ts` |
| Organization identity assurance, current-Owner authority, browser-session recent authentication, and zero-Workspace nominee access              | `apps/server/internal/services/organizationownership/service_test.go`, `apps/server/internal/api/handlers/organization_ownership_test.go`, and `tests/app/organization-ownership.spec.ts` |
| Actor and effective actor, explicit result, permission-safe Organization and instance projections, filters, and structured JSON and CSV exports | `apps/server/internal/api/handlers/organization_audit_test.go` and `tests/app/organization-audit.spec.ts`                                                                                 |
| Ordinary users, Workspace roles, Organization Owners, and scoped credentials cannot read instance-wide evidence                                 | `apps/server/internal/api/handlers/organization_audit_test.go`                                                                                                                            |
| Content, email addresses, secrets, invitation links, credentials, and provider payloads remain excluded                                         | `apps/server/internal/api/handlers/organization_audit_test.go` and `tests/app/organization-audit.spec.ts`                                                                                 |

## Daily email and temporary Mutes

`tests/app/collaboration-safety-cohort.spec.ts` is the cohort tracer. It uses real account, Workspace, Mute, and preference persistence, while projecting configured email-provider availability at the browser boundary. In one settings journey it proves keyboard operation, Daily selection, explicit digest time and IANA timezone saves, disabled Transactional frequency controls, overlapping account and Workspace scopes, visible exact end times, safe overflow, and clean page and console output.

| Presentation                    | Evidence                           |
| ------------------------------- | ---------------------------------- |
| Desktop, English, light theme   | `collaboration-safety-1280-en.png` |
| 390 px, English, dark theme     | `collaboration-safety-390-en.png`  |
| 320 px, Portuguese, light theme | `collaboration-safety-320-pt.png`  |

The screenshots are Playwright run artifacts, not committed assets. `tests/app/notifications.spec.ts` separately proves account and Workspace Mute creation, exact UTC instants, visible status on Notifications and Settings, End now without changing the other scope, 44 px controls, and fixed-navigation clearance at all three widths.

The non-browser acceptance evidence is in `apps/server/internal/services/notifications/service_test.go`, `apps/server/internal/api/handlers/notifications_test.go`, and `apps/web/src/lib/components/notification-preferences.svelte.test.ts`. Together they cover the 09:00 browser-timezone default, unchanged saved choices, Off/Immediate/Daily validation, durable timezone batching, deduplication, bounded retries, confirmed-send advancement, schedule-change races, high-volume bounded rendering, deterministic overlapping scopes, expiry, concurrent create/end, optional Immediate and Daily suppression, immediate in-app behavior, and Transactional bypass.

Run the cohort through the root task boundary:

```sh
bun run doctor
bun run check -- contracts
bun run check -- frontend
bun run lint -- frontend
bun run test -- frontend
bun run test -- backend
bun run test -- e2e-app
```
