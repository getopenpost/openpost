# VitePress Theme+ evaluation

Date: 2026-08-14

## Decision

Do not adopt `@lando/vitepress-theme-default-plus` as OpenPost's base docs theme now. Reassess if OpenPost adds a blog, a large tutorial library, or maintained documentation for several product versions. Until then, use native VitePress features or small focused additions for the few useful gaps.

## Current OpenPost fit

OpenPost has 93 tracked documentation pages but only two use frontmatter. Its content is organized as stable task and reference documentation, not a dated article stream. The existing theme extension also owns behavior that must survive any migration:

- OpenPost social and canonical metadata in `docs-site/.vitepress/config.ts`;
- PostHog page views and error capture in `docs-site/.vitepress/theme/index.ts`;
- lazy registration of `vitepress-openapi` only on the API reference route;
- custom brand CSS and generated `index.md` and `llms.txt` output.

The current eight-item top navigation is the clearest local UX gap. A grouped menu could make the user, self-hosting, provider, and development journeys easier to scan. Tabs could also improve repeated provider, package-manager, or deployment examples. Neither need requires replacing the theme.

## Upstream facts

- Theme+ extends the VitePress default theme and is MIT licensed. Its repository documents installation, configuration, guides, and examples. [Theme+ repository](https://github.com/lando/vitepress-theme-default-plus)
- npm published version `1.2.0` on 2026-07-30. The package is active rather than abandoned. [Theme+ npm package](https://www.npmjs.com/package/@lando/vitepress-theme-default-plus)
- The package brings a broad set of dependencies for feeds, globbing, Git metadata, robots generation, Sass, HTTP requests, HTML parsing, tabs, and multiversion behavior. Its manifest does not declare VitePress as a peer dependency; VitePress is a development dependency in the upstream repository. That makes compatibility an integration responsibility for the consuming site. [Theme+ package manifest](https://github.com/lando/vitepress-theme-default-plus/blob/main/package.json)
- VitePress officially supports extending an external theme and then adding another `enhanceApp` hook. OpenPost could therefore retain its telemetry and OpenAPI behavior, but it would need explicit integration and regression testing. [VitePress custom themes](https://vitepress.dev/guide/custom-theme)

## Feature assessment

| Theme+ feature                         | OpenPost value now  | Assessment                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navbar+                                | Medium              | Grouping the eight top-level links could improve scanning, especially on desktop. First try a simpler default-theme menu structure; adopt custom navbar code only after desktop and phone testing shows a real gain.                                                                                                             |
| Tabs                                   | Medium              | Useful for package managers, Docker versus binary setup, and provider-specific examples. Prefer the focused upstream tabs plugin or a small component instead of the full theme.                                                                                                                                                 |
| Collections, tags, index pages         | Low now, high later | Valuable for a future tutorials, recipes, release notes, or blog section. Current docs do not have the frontmatter or dated-content model that makes collections pay for themselves. VitePress already provides `createContentLoader` for glob-based indexes. [VitePress data loading](https://vitepress.dev/guide/data-loading) |
| Default frontmatter by glob            | Low                 | It would reduce repetition only after OpenPost adopts substantial repeated frontmatter. Today almost every page relies on shared config.                                                                                                                                                                                         |
| Advanced containers and layout helpers | Low                 | OpenPost currently uses a few standard info, tip, and warning blocks. VitePress includes these and supports registering custom containers directly. [VitePress Markdown extensions](https://vitepress.dev/guide/markdown)                                                                                                        |
| Autometa                               | Negative            | It overlaps OpenPost's tested canonical, Open Graph, Twitter, social-image, and agent-discovery output. Replacing that code risks metadata drift for little benefit.                                                                                                                                                             |
| Tracking                               | Negative            | Built-in Google Analytics or HubSpot support does not replace OpenPost's PostHog integration, environment metadata, error capture, or source maps.                                                                                                                                                                               |
| Robots                                 | Low                 | Small enough to implement directly. VitePress already has native sitemap generation. [VitePress sitemap generation](https://vitepress.dev/guide/sitemap-generation)                                                                                                                                                              |
| Contributors                           | Low                 | Helpful for community-heavy conceptual docs, but git-email resolution, GitHub API access, caching, avatars, and privacy need policy decisions. The existing edit link gives a simpler contribution path.                                                                                                                         |
| Feeds                                  | None now            | OpenPost has no blog or dated docs feed. Add this only with a real subscription use case.                                                                                                                                                                                                                                        |
| Multiversion build                     | Low now             | OpenPost documents current product behavior and already publishes release and upgrade guidance. Versioned docs add duplicate builds, old-content maintenance, routing, and search concerns. Reconsider only when supported release lines differ enough that current docs cannot serve both.                                      |
| Alerts and expiring nav badges         | Low                 | A site-wide release or migration notice could help, but normal product updates should remain in release notes and the app. Expiring client-visible notices also need time-zone, dismissal, accessibility, and stale-cache tests.                                                                                                 |
| Jobs and sponsors                      | None                | These do not serve the documentation journeys described in OpenPost's product direction.                                                                                                                                                                                                                                         |

## Recommended sequence

1. Keep the existing default-theme extension.
2. Reduce the top navigation into a few audience-based groups using the default theme if possible.
3. Add tabs only when at least two real pages need the same comparison pattern.
4. Use native `createContentLoader` if OpenPost adds a tutorials or release-note index.
5. Run a short-lived Theme+ prototype only if collections or multiversion docs become requirements. The acceptance gate should cover the docs build, metadata check, generated agent surfaces, local search, OpenAPI route navigation, PostHog page views, desktop and phone navigation, keyboard access, visible focus, dark mode, and reduced motion.

## Conclusion

Theme+ is capable and maintained, but most of its surface is not useful to OpenPost today. A full adoption would increase dependency and integration ownership while duplicating working features. The best near-term return is to borrow its information-architecture ideas and add focused features as actual documentation patterns emerge.
