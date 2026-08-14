# Production Architecture and Checks

OpenPost uses one product core for the managed app and self-hosted servers. This page records the current architecture and the checks needed before a release or public campaign.

## Product and public sites

- **OpenPost** is the product name.
- The official service is the **managed app**.
- `openpost.social` is the marketing site.
- `docs.openpost.social` is the docs site.
- `app.openpost.social` is the managed app.
- The self-hosted server uses the same AGPL application code.

## Shared architecture

- `OPENPOST_EDITION=selfhost|cloud` selects the server mode.
- Self-hosted mode uses SQLite and local media by default.
- Cloud mode requires Postgres, S3-compatible media storage, and Paddle billing settings.
- The API keeps normal database work portable across SQLite and Postgres.
- Durable database jobs handle publishing, media work, token refresh, analytics, comments, and inbox updates that must survive a restart.
- The built SvelteKit app is embedded in the Go server.

Keep production secrets, social app keys, monitoring, backups, and private operator scripts outside this repository.

## Billing and limits

- The managed app opens Paddle's one-page checkout inside OpenPost. Paddle acts as Merchant of Record for payment processing, tax, receipts, refunds, and subscription management.
- OpenPost saves current Paddle customer and subscription mirrors plus plan limits in its own database. Normal API requests do not call Paddle.
- Limits cover workspaces, members, social accounts, posts, media, schedules, and provider writes.
- Self-hosted mode has permissive defaults unless the operator changes them.
- The managed app creates one workspace before checkout. Every plan begins with a card-required 14-day trial; an active or trialing membership is required to connect social accounts, upload media, schedule, or publish.
- The public prices and limits live in `marketing-site/src/routes/_marketing.ts`.

## Social networks

The current publishing adapters are X, Mastodon, Bluesky, LinkedIn, Threads, Facebook, Instagram, TikTok, YouTube, and Discord.

- Bluesky and Discord need no shared server app keys.
- Mastodon can use set server apps or create an app for a public server during connection.
- Facebook, Instagram, and YouTube let the user choose the Page, account, or channel after OAuth.
- Threads, Facebook, Instagram, and TikTok need public HTTPS media links for server-side media fetches.
- Each account and format still needs a live test. Working code and server setup do not prove that a social network will accept a real post.

Analytics, comments, and inbox reads use optional adapter interfaces. They do not run inside the core publishing interface. Page loads read saved data; background jobs call social network APIs.

## Posts and media

- Publications are the user-visible post list.
- Post, Thread, Story, Short video, and Video are creation presets in one publication composer and use `/publications/:id`; a linked editor row and `/posts/:id` remain only for compatibility.
- Social Sets provide reusable account groups. Publications snapshot the chosen destinations.
- Each selected account can have its own format, text, media, settings, and schedule override, with per-field inheritance from the shared source.
- Schedules and current status stay on the grouped publication and its independently published renditions.
- Media uses local storage or S3-compatible storage through `BlobStorage`.
- Direct S3/R2 uploads use a signed browser upload when the file fits one request. Larger files stream through bounded multipart uploads.
- OpenPost Image Editor saves still-image designs, pages, templates, brand items, history, and media links. Its saved document format does not depend on Fabric.js.

## API, CLI, and MCP

- The web app, CLI, MCP, and direct HTTP clients share backend access checks, plan limits, validation, jobs, and audit records.
- Remote MCP is available at `/mcp`.
- The local `openpost-mcp` process forwards standard input and output messages to that endpoint.
- MCP and API tokens can be read-only or full-access and can be limited to one workspace.
- MCP exposes a small search tool plus separate read and write execution tools. The server checks every operation again before it runs.
- Settings shows recent MCP tool calls and lets users remove tokens and OAuth grants.

## Public copy and docs

- `CHANGELOG.md` is the source for the public changelog and GitHub release notes.
- Marketing includes product, platform, pricing, security, open-source, comparison, changelog, and free-tool pages.
- The sitemap must include every current public page, platform guide, comparison, and tool.
- User docs explain the product. Self-hosting docs explain server work. Developer docs explain the code and contracts.
- Keep claims about access, limits, app review, and live tests with the relevant social network page.

### Agent-readable public content

The marketing production build generates a `.md` representation for every static product, pricing, platform-index, comparison-index, tool-index, browser-tool, FAQ, security, trust, open-source, changelog, and legal page. The documentation build generates one for every ordinary maintained page. Canonical HTML advertises each available representation and the documentation discovery index; sitemaps list only canonical HTML pages.

The marketing route manifest owns stable page titles, descriptions, canonical URLs, representation groups, and discovery classes. The marketing `llms.txt` prioritizes the product overview, features, pricing, platform index, FAQ, security, trust, open-source path, and documentation. Comparison and browser-tool indexes are optional entries. Platform, comparison, and browser-tool detail pages appear in their own optional sections. Changelog and legal representations remain available at explicit `.md` URLs but are not listed in `llms.txt`.

The generated documentation catalogue is the checked-in contract shared by both public builds. It derives each page's title and concise description from the maintained Markdown and records its canonical route, representation policy, discovery class, and full-corpus membership. `bun run check -- social-images` rejects drift through the root verification interface. An ordinary documentation prose change runs documentation checks only; a catalogue change runs both public surfaces.

The documentation `llms.txt` links to explicit Markdown entry points for the user guide, providers, CLI, MCP, installation, self-hosting, configuration, operations, API, and development. It links to the API guide and authoritative OpenAPI JSON rather than converting the OpenAPI operation catalogue. MCP discovery remains MCP and JSON-RPC. The API-reference page keeps its interactive viewer but also maintains useful no-JavaScript guidance and a direct OpenAPI JSON link. The generated Nix module include expands into the page representation during the owning build.

`scripts/generate-agent-surfaces.mjs` owns the shared generation and validation contract. Marketing representations preserve semantic prose, links, tables, informative images, provider limits, comparison evidence, and browser-tool explanations from prerendered `<main>` content while excluding navigation and interactive controls. Documentation representations start from maintained Markdown, expand controlled in-tree includes, retain headings, prose, lists, tables, code, and supported containers, normalize supported raw HTML, remove links to the private app, and resolve public links and assets against the canonical page. Browser-tool source marks the canonical explanation with `data-agent-include` and the unusable interactive region with `data-agent-exclude`; other pages may use the exclusion annotation for illustrative or duplicate responsive content. Unknown meaning-bearing markup, unresolved or unsafe includes, metadata drift, duplicate outputs, unknown public page targets, invalid rendered fragments, private routes, and representations over 256 KiB without a reviewed catalogue exception fail the build. External targets remain the source owner's responsibility.

Both build outputs include a Cloudflare Pages `_headers` contract. Explicit `.md` files declare `text/markdown; charset=utf-8`; discovery and corpus text files declare `text/plain; charset=utf-8`. This artifact contract does not enable canonical-URL content selection. Optional edge selection remains a separate operator action.

The documentation build also publishes `llms-full.txt`, an OpenPost convenience artifact rather than part of the llms.txt v2 proposal. Catalogue metadata selects each page, records exclusions with reasons, and assigns included pages to stable sections. The corpus preserves one source link per page while removing repeated representation metadata and generated warnings. It excludes OpenAPI bodies, legal notices, generated CLI reference repetition, and every explicit catalogue exclusion. The build warns when the corpus exceeds 1 MiB and fails when it exceeds 2 MiB. Each site invokes only its own projection, and generated files stay in ignored build output.

The production-artifact contract enumerates every manifest and catalogue route. It requires one canonical HTML file, one explicit Markdown file, useful prerendered content, identity and discovery metadata, absolute links, bounded output, no stale aliases, and no exposed framework state. It also proves canonical plan values, provider facts, comparison evidence, legal text, browser-tool explanations, HTML-only sitemaps, curated indexes, corpus policy, and repeatable generation. Shared generator and catalogue changes plan both public builds. Ordinary documentation prose plans only documentation, and each public build cache includes the shared generator, catalogue dependency, and complete output directory.

Run `bun run check -- public-routes` for the production-artifact contract and `bun run check -- release-version` for selective CI planning. Then use `bun run build -- marketing` and `bun run build -- docs` to inspect the exact production artifacts.

This content covers public product and operating information only. Do not add authenticated application state, Workspace data, OpenAPI conversions, or MCP protocol conversions to these outputs.

## Verification order

1. Update behavior, generated contracts, tests, and public docs together.
2. Run `bun run doctor` before broad or release work.
3. Run scoped root checks while editing, then `bun run verify`.
4. For visible changes, run the related app, docs, or marketing browser suite at desktop and phone widths.
5. Before a public campaign, complete the [Launch Verification Matrix](/providers/launch-matrix) for each account and format.
6. For a production release, follow [Releases and Versioning](/development/releases) and verify the workflow, release, deployed revision, and public readiness.
