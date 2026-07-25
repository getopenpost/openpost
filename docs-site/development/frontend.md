# Frontend

The frontend is a SvelteKit app using Svelte 5 runes, TailwindCSS, Paraglide for i18n, and typed API access generated from the backend OpenAPI spec.

## Expectations

- Use standard Svelte 5 runes
- Keep API calls typed
- Preserve adapter-static output because the backend embeds the built assets

## Useful commands

```bash
pnpm --filter @openpost/web dev
pnpm --filter @openpost/web check
pnpm --filter @openpost/web lint
pnpm --filter @openpost/web test
```
