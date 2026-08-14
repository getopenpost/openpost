# Daily-workflow browser matrix

The daily-workflow release cohort uses the built OpenPost application, HTTP authorization, and Workspace persistence. Browser route fixtures provide deterministic stored projections for the history and delivery contracts under test, and replace destination-provider and Paddle boundaries where exact external outcomes are required.

## Complete saved history

| Contract                                                                   | Browser evidence                                                                                                                           |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Engagement pages beyond the former limit, including a duplicate boundary   | `e2e-app/engagement-pagination.spec.ts` reaches 235 saved items exactly once.                                                              |
| Publication filter pages beyond the former limit                           | `e2e-app/engagement-pagination.spec.ts` reaches and selects Publication 220, then preserves it through a failed remote search and retry.   |
| Conversation pages beyond the former limit, including a duplicate boundary | `e2e-app/conversation-pagination.spec.ts` reaches 235 conversations exactly once without replacing the newer record.                       |
| Message pages beyond the former limit                                      | `e2e-app/message-history-pagination.spec.ts` reaches all 235 saved messages and keeps one concurrent outbound arrival without a duplicate. |

The same fixtures prove first-page and older-page retries, preserved filters and selections, preserved message reading position, a concurrent message arrival, stale conversation-page rejection after a Workspace change, and stale message-page rejection after the active conversation changes.

## Exact Rendition outcomes

`e2e-app/daily-workflow-cohort.spec.ts` advances one `daily-cohort-rendition` through the canonical outcome order. Each transition is added to the stored event projection instead of replacing earlier history. The test compares the visible state and recovery control in the authoring result, Publication detail and its accumulated timeline, and the matching Activity tab:

| Outcome                      | Visible action                    |
| ---------------------------- | --------------------------------- |
| Queued                       | None                              |
| Submitted                    | None                              |
| Processing at provider       | Read-only reconciliation guidance |
| Scheduled at provider        | None                              |
| Live                         | None                              |
| Rejected                     | Retry destination                 |
| Outcome needs reconciliation | Read-only reconciliation guidance |
| Manual review required       | Review destination                |

The browser journey also rejects document overflow and unexpected page or console errors. Backend integration evidence for the same projection vocabulary and recovery policy remains in `backend/internal/services/providerwrite/service_test.go`.

## Accounts and Billing presentation

The presentation dimensions are orthogonal so a failure identifies one boundary instead of repeating the full purchase journey for every combination.

| Requirement                                                           | Browser evidence                                                     |
| --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Direct and Settings-embedded Accounts at desktop, 390 px, and 320 px  | `e2e-app/accounts-providers.spec.ts`                                 |
| Stable history navigation and one-time OAuth feedback                 | `e2e-app/accounts-providers.spec.ts`                                 |
| Keyboard connection flow, safe overflow, and clean console            | `e2e-app/accounts-providers.spec.ts`                                 |
| Settings-embedded Billing at desktop, 390 px, and 320 px              | `e2e-app/billing-settings.spec.ts`                                   |
| Keyboard entry, both themes/locales, safe overflow, and clean console | `e2e-app/billing-settings.spec.ts`                                   |
| Billing facts and purpose-specific Paddle actions                     | `e2e-app/billing-settings.spec.ts`                                   |
| Account-wide recovery and permission boundaries at 390 px             | `e2e-app/billing-recovery.spec.ts`                                   |
| Inline Paddle checkout at desktop, 390 px, and 320 px                 | `e2e-app/billing-settings.spec.ts`                                   |
| Light checkout surface inside a dark OpenPost theme                   | `e2e-app/billing-settings.spec.ts`                                   |
| English and Portuguese Accounts, Billing, and Paddle locale routing   | `e2e-app/ui-consistency.spec.ts`, `e2e-app/billing-settings.spec.ts` |
| Shared light and dark application theme contract                      | `e2e-app/app-shell.spec.ts`                                          |

Run the cohort through the root task boundary:

```sh
bun run doctor
bun run check -- contracts
bun run check -- frontend
bun run test -- frontend
bun run test -- e2e-app
```
