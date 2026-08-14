# Frontend

The frontend is a SvelteKit app using Svelte 5 runes, TailwindCSS, Paraglide for i18n, and typed API access generated from the backend OpenAPI spec.

This page is for contributors changing the web app or its shared marketing controls.

## Expectations

- Use standard Svelte 5 runes
- Keep API calls typed
- Preserve adapter-static output because the backend embeds the built assets
- Reuse the shared Shadcn-svelte controls from `frontend/src/lib/components/ui/` for inputs, text areas, selects, checkboxes, radio groups, sliders, and related form UI
- Keep marketing controls on those same primitives; the marketing SvelteKit project resolves `$lib` to the shared frontend library
- Do not add visible native `input`, `select`, or `textarea` elements outside the shared primitives

## Useful commands

```bash
bun run dev -- frontend
bun run check -- frontend
bun run lint -- frontend
bun run test -- frontend
bun run check -- ui-consistency
bun run build -- frontend
```

The cached frontend task owns `frontend/build`. `bun run build -- frontend`
packages that validated artifact into `backend/cmd/openpost/public` only after
the build completes, so stale or partial files cannot enter the Go embed tree.
