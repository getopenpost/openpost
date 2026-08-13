# First-use browser matrix

The first-use release cohort uses the real OpenPost application, HTTP authorization, and Workspace persistence. Browser fixtures replace only external email, Paddle, and destination-provider boundaries.

## Primary journey

`e2e-app/first-use-cohort.spec.ts` covers one continuous browser session at 390 px:

1. Registration with the selected Founder annual plan and exact terms.
2. Email-verification return with the purchase choice intact.
3. Workspace naming and explicit plan confirmation.
4. Checkout load, refresh recovery, and successful checkout return.
5. Destination selection after OAuth and the exact destination selected in a fresh composer.
6. Meaningful composition, a visible validation failure, safe retry, and Publication submission.
7. Workspace Activation, retired setup guidance, View publication, and a clean Create another composer.

The test also checks horizontal overflow and unexpected page or console errors. `e2e-app/composer-scheduling.spec.ts` covers the schedule path, a changed-destination failure, retry, Activation feedback, and both post-Activation actions.

## Recovery and role coverage

| Contract                                                            | Browser evidence                                                                                                                                           |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Welcome, checkout, OAuth, and composer refresh or re-authentication | `auth-onboarding.spec.ts`, `billing-settings.spec.ts`, `oauth-composer-handoff.spec.ts`, `first-composition.spec.ts`                                       |
| Checkout cancellation and plan mismatch                             | `billing-settings.spec.ts`, `auth-onboarding.spec.ts`                                                                                                      |
| OAuth cancellation, provider error, and connection failure          | `oauth-composer-handoff.spec.ts`, `accounts-providers.spec.ts`                                                                                             |
| Scheduling failure and retry                                        | `composer-scheduling.spec.ts`                                                                                                                              |
| Owner and authorized setup guidance                                 | `setup-guide.spec.ts`                                                                                                                                      |
| Viewer and invited existing user                                    | `billing-settings.spec.ts`                                                                                                                                 |
| Managed identity awaiting approval                                  | `oidc-sso.spec.ts`                                                                                                                                         |
| Self-hosted deployment without Hosted service billing               | `setup-guide.spec.ts` with the default self-hosted test server; the authorization matrix is enforced in `backend/internal/api/handlers/workspaces_test.go` |

## Presentation coverage

| Requirement                                                   | Browser evidence                                                                                     |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Desktop and 390 px                                            | `oauth-composer-handoff.spec.ts`, `first-use-cohort.spec.ts`                                         |
| 320 px and keyboard focus                                     | `auth-onboarding.spec.ts`, `mobile-ux.spec.ts`                                                       |
| Light and dark checkout presentation                          | `billing-settings.spec.ts`                                                                           |
| English and Portuguese locale routing                         | `ui-consistency.spec.ts`                                                                             |
| Status announcements, focus, touch targets, and safe overflow | `auth-onboarding.spec.ts`, `mobile-ux.spec.ts`, `ui-consistency.spec.ts`, `first-use-cohort.spec.ts` |
| Clean console output                                          | `first-use-cohort.spec.ts`                                                                           |

Run the cohort through the root task boundary:

```sh
bun run doctor
bun run test -- frontend
bun run test -- e2e-app
```
