### Fixed

- Repaired the `svelte-check` gate: fixed five type errors in browser regression tests (missing default test-fixture argument, Playwright `Locator` has no `.locator()` method so scope with `getByTestId`, and the spied OpenAPI `GET` options parameter resolving to `never`).
