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
- Cloud mode requires Postgres, S3-compatible media storage, and Whop billing settings.
- The API keeps normal database work portable across SQLite and Postgres.
- Durable database jobs handle publishing, media work, token refresh, analytics, comments, and inbox updates that must survive a restart.
- The built SvelteKit app is embedded in the Go server.

Keep production secrets, social app keys, monitoring, backups, and private operator scripts outside this repository.

## Billing and limits

- The managed app embeds Whop checkout inside OpenPost and uses Whop for memberships, billing management, tax collection, and signed webhooks.
- OpenPost saves the current membership and plan limits in its own database. Normal API requests do not call Whop.
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
- Post and Thread use the text-and-thread composer and a linked editor row.
- Story, Short video, and Video use focused editors.
- Each selected account can have its own text, media, format, and settings.
- Schedules and current status stay on the publication and its account versions.
- Media uses local storage or S3-compatible storage through `BlobStorage`.
- Direct S3/R2 uploads use a signed browser upload when the file fits one request. Larger files stream through bounded multipart uploads.
- OpenPost Studio saves still-image designs, pages, templates, brand items, history, and media links. Its saved document format does not depend on Fabric.js.

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

## Verification order

1. Update behavior, generated contracts, tests, and public docs together.
2. Run `devenv shell -- doctor` before broad or release work.
3. Run focused checks while editing, then `devenv shell -- verify`.
4. For visible changes, run the related app, docs, or marketing browser suite at desktop and phone widths.
5. Before a public campaign, complete the [Launch Verification Matrix](/providers/launch-matrix) for each account and format.
6. For a production release, follow [Releases and Versioning](/development/releases) and verify the workflow, release, deployed revision, and public readiness.
