# Complete UX program browser matrix

This matrix joins the four releasable UX cohorts without replacing their focused evidence. The representative cohort tests use the built OpenPost application, HTTP authorization, and database persistence. Deterministic local adapters replace only email, Paddle, provider OAuth, and provider delivery boundaries whose live behavior cannot be made repeatable in CI. Older focused suites may use browser fixtures for narrow UI and race contracts; their owning service tests remain the persistence and authorization authority.

## One first-use journey

`tests/app/first-use-cohort.spec.ts` is the primary browser seam. At 390 px it carries one purchase choice through signup, verification, Workspace naming, checkout return, the visible Mastodon server form, external authorization and OAuth return, a fresh composer with the destination selected, meaningful composition, a blocked over-limit attempt and safe correction, Workspace Activation, View publication, and Create another. It asserts the selected plan and destination, visible progress and recovery controls, settled navigation, safe overflow, and clean console output.

The continuity cases remain explicit rather than hidden in the successful path:

| Contract                                                                                                                             | Browser evidence                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Welcome, checkout-return, OAuth-return, and composer resume after refresh or re-authentication                                       | `tests/app/auth-onboarding.spec.ts`, `tests/app/billing-settings.spec.ts`, `tests/app/oauth-composer-handoff.spec.ts`, `tests/app/first-composition.spec.ts`                                           |
| Checkout cancellation, plan mismatch, OAuth cancellation/error, destination failure, and safe retry                                  | `tests/app/billing-settings.spec.ts`, `tests/app/auth-onboarding.spec.ts`, `tests/app/oauth-composer-handoff.spec.ts`, `tests/app/accounts-providers.spec.ts`, `tests/app/composer-scheduling.spec.ts` |
| Owner, permitted administrator/editor, viewer, invited existing user, Managed identity awaiting approval, and Self-hosted deployment | `tests/app/setup-guide.spec.ts`, `tests/app/billing-settings.spec.ts`, `tests/app/oidc-sso.spec.ts`                                                                                                    |

Service and contract tests remain the authority for the concurrency, exactly-once Activation, permission, and telemetry-property cases that a browser cannot reproduce reliably. The complete first-use inventory is in `docs/evidence/first-use-browser-matrix.md`.

## Daily work

`tests/app/daily-workflow-cohort.spec.ts` authenticates through the real application, creates and publishes one persisted Rendition, then advances it through queued, submitted, processing, provider-scheduled, live, rejected, ambiguous, and manual-resolution outcomes. A dedicated E2E provider-boundary projection writes normalized attempts, deliveries, lifecycle events, and Publication and Rendition status through one Workspace-authorized transaction; browser reads and writes are not intercepted. Publication detail, version history, and Activity then read that same durable state and show its safe recovery action. A second authenticated user receives a 403 at the projection boundary.

The history suites use deterministic browser fixtures to isolate pagination and request-race behavior. They reach records beyond every former fixed limit, retain selection and reading position, reject stale Workspace or conversation responses, and handle a concurrent new message without gaps or duplicates. Service tests own the stored projection, routing, and authorization contracts for these surfaces:

- `tests/app/engagement-pagination.spec.ts`
- `tests/app/conversation-pagination.spec.ts`
- `tests/app/message-history-pagination.spec.ts`

Settings Social accounts, OAuth feedback, billing facts, Paddle task links, and provider-backed dates are covered by `tests/app/accounts-providers.spec.ts`, `tests/app/billing-settings.spec.ts`, and `tests/app/billing-recovery.spec.ts`. The complete inventory is in `docs/evidence/daily-workflow-browser-matrix.md`.

## Collaboration and safety

`tests/app/collaboration-safety-cohort.spec.ts` uses real account, Workspace, notification-preference, and Mute persistence. The app reads email availability from the local SMTP external adapter, and the browser observes each real preference write without intercepting it. The cohort proves Daily email settings, an explicit timezone, disabled Transactional controls, overlapping account and Workspace Mutes, exact end times, keyboard operation, responsive controls, safe overflow, and clean console output.

Invitation delivery and recovery, ownership transfer, Organization and Workspace deletion, permission-safe audit views and exports, and notification behavior remain covered by these focused browser suites:

- `tests/app/workspace-team.spec.ts`
- `tests/app/organization-ownership.spec.ts`
- `tests/app/settings-workspace.spec.ts`
- `tests/app/organization-audit.spec.ts`
- `tests/app/notifications.spec.ts`

Service tests own atomic deletion, concurrent resend and transfer, callback idempotency, redaction, digest batching, Mute precedence, and Transactional bypass. The complete inventory is in `docs/evidence/collaboration-safety-browser-matrix.md`.

## Local recovery

`tests/app/not-found.spec.ts` exercises the real SvelteKit error boundary for direct and client navigation, reload, simulated browser offline and online events, focused headings, correct actions, and clean console output. `tests/app/load-recovery.spec.ts` proves that Settings, Accounts, onboarding, invitations, and calendar content retry in place without presenting a failed request as an empty state.

`tests/app/editors-catalog.spec.ts`, `tests/app/engagement-pagination.spec.ts`, and `tests/app/notifications.spec.ts` retain useful local context through cloud, list, and destructive failures. Destructive dialogs stay open until completion is confirmed, retry only unfinished work, announce the result, and restore focus to a stable target. The complete inventory is in `docs/evidence/application-state-recovery-browser-matrix.md`.

## Presentation matrix

The dimensions are spread across focused journeys so a failure identifies one product boundary. The matrix does not claim that one external adapter is a live provider certification.

| Presentation                                       | Representative evidence                                                                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1280 px, English, light                            | Rendition outcomes, Accounts, Billing, collaboration, audit, notification, and shared page-frame journeys                                                    |
| 390 px, English, dark                              | Complete first-use journey, checkout, OAuth handoff, collaboration, error recovery, Accounts, Billing, and shared page-frame journeys                        |
| 320 px, Portuguese, light                          | Signup/onboarding, shared page frame, destructive Organization flow, notification settings, and error recovery                                               |
| Keyboard and visible focus                         | First-use controls, Accounts, Billing, notifications, destructive dialogs, and error recovery                                                                |
| Focus restoration and announced asynchronous state | OAuth/Activation feedback, notification saves and Mutes, destructive completion, connectivity changes, and error headings                                    |
| Touch targets and overflow                         | `tests/app/mobile-ux.spec.ts`, `tests/app/ui-consistency.spec.ts`, and every cohort's phone checks                                                           |
| Light and dark themes                              | `tests/app/app-shell.spec.ts`, `tests/app/billing-settings.spec.ts`, `tests/app/collaboration-safety-cohort.spec.ts`, and `tests/app/not-found.spec.ts`      |
| English and Portuguese                             | `tests/app/ui-consistency.spec.ts`, `tests/app/billing-settings.spec.ts`, `tests/app/collaboration-safety-cohort.spec.ts`, and `tests/app/not-found.spec.ts` |
| Clean page and console output                      | First-use, daily-workflow, collaboration-safety, Accounts, Billing, audit, notification, and local-recovery journeys                                         |

`tests/app/accessibility.ts` runs axe WCAG A and AA rules against settled first-use, daily-workflow, collaboration-safety, and local-recovery states. It reports serious and critical accessibility violations and fails if either is present. The collaboration cohort scans the complete 1280 px English light, 390 px English dark, and 320 px Portuguese light presentation set; the other cohorts scan their representative authoring, history, Activity, validation, Activation, not-found, and offline states. No rule is suppressed.

The Self-hosted public path is not a Hosted service free tier. Responsive pricing and dedicated Self-hosted pages are covered by `tests/marketing/marketing.spec.ts`; documentation, GitHub access, and the agent-readable page are covered by `e2e-docs/docs-audience.spec.ts`. These suites keep public claims synchronized with the product and documentation without changing the established OpenPost visual identity.

The line-by-line prose review is recorded in `docs/evidence/complete-ux-program-copy-review.md`.

## Verification boundary

The complete program was verified on 2026-08-15 against base
`b921c06b60b2a6da8faa3dd43299e1669a0d663f`:

| Command                                                                                                                                                                                                       | Result                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run doctor`                                                                                                                                                                                              | Passed every required check; reported only the expected local branch-upstream and linked-worktree count warnings.                                                 |
| `bun run check -- contracts`                                                                                                                                                                                  | Passed; generated API, TypeScript, documentation, and CLI contracts were current.                                                                                 |
| `bun run check -- frontend`                                                                                                                                                                                   | Passed with 0 Svelte errors and 0 warnings; English and Portuguese catalogs each contained 4,342 messages.                                                        |
| `bun run check -- ui-consistency`                                                                                                                                                                             | Passed; shared form primitives covered every visible Svelte control.                                                                                              |
| `bun run lint -- frontend`                                                                                                                                                                                    | Passed with 0 errors and 0 warnings.                                                                                                                              |
| `bun run format:check`                                                                                                                                                                                        | Passed.                                                                                                                                                           |
| `bun run test -- frontend`                                                                                                                                                                                    | Passed all package suites: 133 web test files with 578 tests, plus 62 shared-package tests.                                                                       |
| `bun run test -- backend`                                                                                                                                                                                     | Passed every backend package.                                                                                                                                     |
| `bun test scripts`                                                                                                                                                                                            | Passed 245 tests with 0 failures.                                                                                                                                 |
| `bunx playwright test --config playwright.app.config.ts tests/app/first-use-cohort.spec.ts tests/app/daily-workflow-cohort.spec.ts tests/app/collaboration-safety-cohort.spec.ts tests/app/not-found.spec.ts` | Passed all 7 aggregate browser tests, including the real first-use and daily-workflow journeys and every serious-or-critical accessibility scan, in 24.8 seconds. |
| `bun run test -- e2e-app`                                                                                                                                                                                     | Passed 180 tests with 2 intentional skips and 0 failures in 3.8 minutes.                                                                                          |
| `bun run test -- e2e`                                                                                                                                                                                         | Passed all 45 marketing browser tests in 35.5 seconds.                                                                                                            |
| `bun run test -- e2e-docs`                                                                                                                                                                                    | Passed all 5 documentation browser tests in 10.5 seconds.                                                                                                         |
| `bun run build`                                                                                                                                                                                               | Passed workspace, embedded frontend, backend, and CLI builds.                                                                                                     |

The repository checks prove generated contracts and translations are current. The representative cohorts prove authorization, persistence, and route continuity; the broader browser suite proves the listed visible controls, copy, responsive layout, themes, supported locales, keyboard behavior, focus, announcements, overflow, settled state, and console output. Live provider certification, operator configuration, and deployment readiness remain separate evidence and must not be inferred from deterministic adapters.
