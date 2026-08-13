# OpenPost social previews

This package is the shared metadata catalog for the marketing and documentation sites. It returns absolute, versioned `/og` URLs instead of writing a card for every route to the repository. Each URL contains only a stable catalog ID; the edge renderer resolves the approved OpenPost copy instead of accepting public text.

The Cloudflare Pages renderer lives in `marketing-site/functions/og.tsx`. It validates the public query parameters, renders a 1200 x 630 PNG with `@cloudflare/pages-plugin-vercel-og`, and falls back to `assets/brand/og-image.png` if rendering fails.

When the card design changes, increment `socialRendererVersion` in `src/index.js`. The versioned query string gives every route a new cache key while keeping existing cards immutable.

`scripts/social-images/catalog.mjs` keeps the small docs-page catalog in sync with Markdown headings. Asset synchronization refreshes it automatically; `bun run check:social-images` rejects stale catalog metadata.

Run the focused checks from the repository root:

```sh
bun run check:social-images
bun run marketing:build
bun run docs:build
```

For a local runtime check, build the marketing site and run Wrangler from `marketing-site`:

```sh
bunx wrangler pages dev dist --port 8790
```
