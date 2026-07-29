# Frontend

The frontend is a SvelteKit app using Svelte 5 runes, TailwindCSS, Paraglide for i18n, and typed API access generated from the backend OpenAPI spec.

## Expectations

- Use standard Svelte 5 runes
- Keep API calls typed
- Preserve adapter-static output because the backend embeds the built assets
- Reuse the shared Shadcn-svelte controls from `frontend/src/lib/components/ui/` for inputs, text areas, selects, checkboxes, radio groups, sliders, and related form UI
- Keep marketing controls on those same primitives; the marketing SvelteKit project resolves `$lib` to the shared frontend library
- Do not add visible native `input`, `select`, or `textarea` elements outside the shared primitives

## Useful commands

```bash
pnpm --filter @openpost/web dev
pnpm --filter @openpost/web check
pnpm --filter @openpost/web lint
pnpm --filter @openpost/web test
pnpm check:ui-consistency
```
