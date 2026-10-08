# OpenPost social previews

This package owns social metadata and stable image URLs for the marketing and documentation sites. Every page gets a static card at `/og/<page-key>.png`; the route catalog defines marketing keys and docs paths define documentation keys.

`src/extensions.js` owns the browser extension catalogue, including descriptions, screenshots, install links and privacy summaries. The free-tools directory and extension pages consume that catalogue. Add store links only after the listing is public; until then, installation points to the project README.

`scripts/generate-social-images.mjs` creates the 1200 x 630 PNGs during each site build. The homepage composites the canonical brand mark and wordmark over the generated artwork in `assets/brand/social/home.png`. Other pages use large Geist titles and one prominent topic symbol, with mint, blue, or lilac panels. Documentation uses charcoal and a section label. Lucide supplies tool and guide symbols; provider and self-hosting pages use their existing logos from `assets/logos/`. Conversion cards show the source and output formats. Titles must fit in full, never truncate.

The homepage prompt and provenance live beside its source in `assets/brand/social/generation.json`. Keep the launch-kit copies `assets/brand/og-image.png` and `assets/brand/og-docs.png` aligned with generated home cards. The renderer is the editable source for the documentation card.

`scripts/social-images/catalog.mjs` keeps the small docs-page catalog in sync with Markdown headings. Asset synchronization refreshes it automatically; `bun run check -- social-images` rejects stale catalog metadata.

Run the focused checks from the repository root:

```sh
bun run check -- social-images
bun run build -- marketing
bun run build -- docs
```

Inspect representative generated cards after changing the renderer, then run the focused checks above. Do not commit generated `apps/marketing/static/og/` or `apps/docs/public/og/` output.
