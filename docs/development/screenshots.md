# Product screenshots

Canonical product images live in `assets/screenshots/` and are embedded by user
guides and marketing surfaces. They are captured deterministically (seeded
fixtures, fixed clock, 1440×960 at 2x, dark and light) by
`tests/app/product-screenshots.spec.ts`.

## Refreshing after a UI change

Run the full pipeline from the repository root:

```sh
bun run capture:product-screenshots
```

This re-captures, optimizes to WebP, and syncs copies to the docs, marketing,
and app surfaces. Commit the changed images in the same PR as the UI change
after inspecting them — a capture whose locators no longer match fails loudly,
but purely visual drift does not.

## Checklist for editor UI PRs

- Run the capture command above.
- Inspect every changed image under `assets/screenshots/`.
- Commit updated shots in the same PR; never land a visible editor change with
  stale guide screenshots.
- If a capture fails on a locator, update the capture alongside the UI — the
  locator is the tripwire that keeps the shot honest.

## Scheduled drift check

The `Product screenshots refresh` workflow re-captures weekly and opens a
review PR when images drift. It never commits to `main` directly. Merge its PR
only after reviewing the images. Refresh commits use the openpost-bot GitHub
App identity, falling back to `github-actions[bot]` until the app credentials
are configured (same pattern as the README assets workflow).

## Native mobile README gallery

Run on macOS with Xcode 26.2, the iOS 26.2 runtime, Bun, CocoaPods, and Maestro 2.5.1 available:

```sh
bun install --frozen-lockfile
(cd apps/mobile && bun install --frozen-lockfile)
bun run capture:mobile-screenshots
```

The command creates an isolated iPhone 17 simulator, builds the native app, and uses Maestro to wait for each screen before capturing it. The fixture entry fixes sample content and the clock without contacting a live server. Production keeps `expo-router/entry`. The capture-only Metro config selects an ignored fixture shim without changing the shipping manifest. Stop any existing Metro server on port 8081 first.

Raw captures and diagnostics stay in `apps/mobile/artifacts/screenshots/`. `scripts/render-mobile-gallery.mjs` frames those captures and adds labels above the phones, producing `assets/screenshots/mobile-gallery-{light,dark}.webp`. The README selects the matching scheme without a table.

For local iteration with an already compiled simulator app, set `OPENPOST_SCREENSHOT_APP` to its absolute `.app` path. Native dependency changes require a fresh build.

The weekly refresh workflow captures the mobile gallery on macOS alongside the web captures. It opens the existing screenshot review PR when either set changes. Inspect every phone before merging. A failed native capture blocks the refresh rather than publishing old images.
