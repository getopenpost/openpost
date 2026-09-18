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
only after reviewing the images.
