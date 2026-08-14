# Application-state recovery browser matrix

OpenPost keeps local page context when a recoverable request or destructive action fails. Shared application primitives own the visible state; routes retain their page heading and useful content while retrying in place.

## State contract

| State               | Visible recovery                                                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading             | A shared placeholder matches the eventual list, grid, gallery, settings, composer, or calendar content.                                                                                                   |
| Empty               | A shared empty state explains the absence of records without presenting a failed load as empty.                                                                                                           |
| Retryable failure   | The page retains its heading and useful context, presents the error through a shared notice, and retries the failed request in place.                                                                     |
| Offline             | A shared connection notice keeps the current page visible. The error boundary preserves the requested address and enables retry after the browser reports that it is online.                              |
| Forbidden           | The error boundary explains that the current account lacks access and offers safe back, home, and local destination actions without a misleading retry.                                                   |
| Not found           | The error boundary identifies the missing address and offers back, home, local destinations, and documentation.                                                                                           |
| Rejected request    | Other client responses keep their HTTP status, avoid server-failure copy, and expose retry only for retryable statuses such as 408, 409, 425, and 429.                                                    |
| Server error        | The error boundary offers retry, home, and support actions.                                                                                                                                               |
| Destructive failure | The confirmation remains open, reports that completion was not confirmed, restores its controls, and retries only unfinished targets. Replay-safe batch operations reconcile responses lost after commit. |

Error headings receive focus when the boundary opens or changes state. Notices and connection changes use polite or assertive live regions according to urgency. Shared controls keep 44-pixel phone targets and visible keyboard focus.

## Browser evidence

`e2e-app/not-found.spec.ts` exercises a real SvelteKit error boundary, including direct and client navigation, reload, simulated browser offline and online events, clean console output, focus, overflow, and action visibility. It covers these presentations:

| Presentation                    | Evidence                                           |
| ------------------------------- | -------------------------------------------------- |
| 1280 px, English, light theme   | Direct 404 response and reload                     |
| 390 px, English, dark theme     | Client navigation and responsive actions           |
| 320 px, Portuguese, light theme | Localized client navigation and responsive actions |

`frontend/src/lib/components/app-error-state.svelte.test.ts` runs the shared production error primitive in Chromium at 320 px for a light-theme 500 response and at 390 px for a dark-theme Portuguese 403 response. These cases verify focus, action accuracy, touch-target height, and horizontal fit without adding test-only routes.

`e2e-app/notifications.spec.ts` forces a destructive API failure, proves that saved notifications remain visible, keeps the confirmation open with explicit failure feedback, and retries the same operation successfully. `e2e-app/load-recovery.spec.ts` separately proves in-place initial-load recovery for Settings, Accounts, onboarding, invitation refresh, and calendar context.

Component tests cover the states that a production route should not manufacture only for testing: forbidden and server-error presentation, offline precedence, connection notices, content-shaped loading, empty states, toasts, and destructive completion semantics.

Run the evidence through the root task boundary:

```sh
bun run check -- frontend
bun run lint -- frontend
bun run test -- frontend
bun run test -- e2e-app -- not-found.spec.ts notifications.spec.ts load-recovery.spec.ts
bun run check -- ui-consistency
```
