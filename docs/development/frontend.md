# Frontend

The frontend is a SvelteKit app using Svelte 5 runes, TailwindCSS, Paraglide for i18n, and typed API access generated from the backend OpenAPI spec.

This page is for contributors changing the web app or its shared marketing controls.

## Expectations

- Use standard Svelte 5 runes
- Keep API calls typed
- Preserve adapter-static output because the backend embeds the built assets
- Reuse the shared Shadcn-svelte controls from `apps/web/src/lib/components/ui/` for inputs, text areas, selects, checkboxes, radio groups, sliders, and related form UI
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

The cached frontend task owns the compiled files in `apps/web/build` and omits
the tracked immutable editor model and audio trees from its cache entry. Vite
receives a temporary public tree without those assets, so it does not copy the
large files before the build links them into the final web output.
`bun run build -- frontend` checks the selected image bundle, model, and audio
manifests and their declared file sizes and SHA-256 digests, restores those
trees from `apps/web/static` with hard links when possible, refreshes both
generated web trees, validates the complete artifact, then replaces
`apps/server/cmd/openpost/public` atomically. Missing or partial sources fail before
an existing artifact changes.
