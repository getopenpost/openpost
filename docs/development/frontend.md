# Frontend

The frontend is a SvelteKit app using Svelte 5 runes, TailwindCSS, Paraglide for i18n, and typed API access generated from the backend OpenAPI spec.

This page is for contributors changing the web app or its shared marketing controls.

## Expectations

- Refresh canonical product screenshots when a change alters a captured surface; see [Product screenshots](screenshots.md).

- Use standard Svelte 5 runes
- Keep API calls typed
- Preserve adapter-static output because the backend embeds the built assets
- Reuse the shared Shadcn-svelte controls from `apps/web/src/lib/components/ui/` for inputs, text areas, selects, checkboxes, radio groups, sliders, and related form UI
- Keep marketing controls on those same primitives; the marketing SvelteKit project resolves `$lib` to the shared frontend library
- Do not add visible native `input`, `select`, or `textarea` elements outside the shared primitives

## Browser baseline

The normal application baseline is Safari 16.4 and equivalents. Tailwind 4
already requires Safari 16.4, and the theme runtime depends on regex
lookbehind, which Safari gained in 16.4. Removing an avoidable failure on an
older engine (for example the `@asamuzakjp/css-color` detector patch) does not
certify the whole application there.

Keep unsupported-browser failures out of stale-chunk reload recovery:
reloading identical bytes into the same engine cannot add the missing
capability. Theme startup reports them under the `theme_unsupported_browser`
boundary and keeps the CSS fallback. Probes for a single engine feature must
use `new RegExp('(?<=a)b')` inside `try/catch`, never a lookbehind literal
that an older parser rejects before the catch executes.

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
