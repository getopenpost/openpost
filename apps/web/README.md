# OpenPost Frontend

The OpenPost web app is a Svelte 5 and SvelteKit application embedded in the Go server. The standalone Expo app in `apps/mobile/` owns native Android delivery.

Use the repository-owned commands from the project root:

```bash
bun run check -- frontend
bun run lint -- frontend
bun run test -- frontend
bun run build -- frontend
```

The frontend uses Tailwind CSS, Paraglide translations in English, Spanish, French, German, European and Brazilian Portuguese, Turkish, Japanese, Korean, and Simplified Chinese, `openapi-fetch` with generated API types, Oxfmt, Oxlint with ESLint retained for Svelte template rules, Vitest, and Playwright. Do not hand-edit `openapi.json`, generated API types, or the Paraglide runtime; regenerate them from their source contracts.

For current architecture and workflows, see the [frontend development guide](../docs/development/frontend.md), [development setup](../docs/development/setup.md), and [Android guide](../docs/installation/android.md).
