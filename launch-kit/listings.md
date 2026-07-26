# Listing Tracker

Use this file as the source for directory and marketplace submissions. Update the
canonical facts and copy here first when the product or brand changes, then review
every active row.

## Status

- `research`: Confirm fit and submission rules.
- `blocked`: Wait for the condition in Notes.
- `ready`: Copy, asset, and submission path are checked.
- `submitted`: A submission is open but not accepted.
- `listed`: The public listing is live and verified.
- `rejected`: The placement was declined.
- `retired`: The listing was removed or is no longer useful.

## Canonical facts

| Item | Canonical value |
| --- | --- |
| Repository | <https://github.com/rodrgds/openpost> |
| Product | <https://openpost.social> |
| Documentation | <https://docs.openpost.social> |
| Managed app | <https://app.openpost.social> |
| Supported networks | Bluesky, LinkedIn, Mastodon, Threads, and X |
| Install methods | Docker Compose, GHCR container, or a single Go binary |
| Remote MCP endpoint | `https://app.openpost.social/mcp` (Streamable HTTP, OAuth 2.0 with PKCE) |
| First tagged release | `v0.1.0`, 2026-03-29 22:06 UTC |
| License | [AGPL-3.0-only](../LICENSE) |
| Icon | [`assets/brand/icon.svg`](../assets/brand/icon.svg), [raw GitHub](https://raw.githubusercontent.com/rodrgds/openpost/main/assets/brand/icon.svg) |
| Primary logo | [`assets/brand/logo.svg`](../assets/brand/logo.svg), [raw GitHub](https://raw.githubusercontent.com/rodrgds/openpost/main/assets/brand/logo.svg) |
| Social card | [`assets/brand/og-image.png`](../assets/brand/og-image.png), [raw GitHub](https://raw.githubusercontent.com/rodrgds/openpost/main/assets/brand/og-image.png) |

## Description variants

- **Core and self-hosted:** OpenPost is a self-hosted social publishing tool for preparing, reviewing, scheduling, and tracking posts across several networks.
- **MCP and agents:** OpenPost gives agents controlled MCP access to prepare social posts while people review and approve publishing.
- **SvelteKit:** OpenPost uses a SvelteKit interface for managing social content, accounts, schedules, media, and publishing results.
- **Go and single binary:** OpenPost packages its Go server and SvelteKit interface in one binary with SQLite and local media storage by default.
- **Fediverse:** OpenPost prepares, schedules, and publishes posts for Mastodon alongside Bluesky, X, LinkedIn, and Threads.

## Change checklist

When any canonical fact changes, update it above and recheck every `ready`,
`submitted`, and `listed` row.

- **Name:** Listing title, repository description, submitted copy, image alt text, and asset text.
- **Product URL:** Listing links, screenshots, social cards, redirects, and link health.
- **Repository:** Repository links, raw asset URLs, install links, badges, and open pull requests.
- **Description:** Every Submitted copy cell, category fit, supported claims, and length limits.
- **Supported networks:** Core and Fediverse copy, categories, tags, screenshots, and provider links.
- **Logo or icon:** Asset cells, raw URLs, format and size rules, cached marketplace images, and social cards.
- **License:** License field, eligibility rules, submitted copy, and repository license link.
- **Install method:** Setup instructions, package or image references, platform requirements, and marketplace manifests.
- **MCP endpoint:** Transport and authentication instructions, server metadata, install configuration, and MCP directory links.

## Active placements

Keep the public URL blank until a pull request or listing exists. Submitted copy
is proposed copy, not evidence of submission.

| Surface | fit/category | status | public listing or PR URL | submitted copy | asset | last checked | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [awesome-selfhosted/awesome-selfhosted-data](https://github.com/awesome-selfhosted/awesome-selfhosted-data) | Self-hosted, communication | blocked |  | OpenPost is a self-hosted social publishing tool for preparing, reviewing, scheduling, and tracking posts across several networks. | Icon | 2026-07-26 | Do not submit before 2026-07-29 22:06 UTC. |
| [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | Social Media MCP server | blocked |  | OpenPost gives agents controlled MCP access to prepare social posts while people review and approve publishing. | Icon | 2026-07-26 | Requires a claimed Glama listing with a passing quality score and badge. |
| [appcypher/awesome-mcp-servers](https://github.com/appcypher/awesome-mcp-servers) | Social Media MCP server | blocked |  | Draft, schedule, and publish social posts through a self-hosted MCP server. | Icon | 2026-07-26 | The repository keeps an old contribution guide but has Pull Requests disabled. |
| [wong2/awesome-mcp-servers](https://github.com/wong2/awesome-mcp-servers) | MCP server | blocked |  | OpenPost gives agents controlled MCP access to prepare social posts while people review and approve publishing. | Icon | 2026-07-26 | Pull Requests are disabled; the README directs submissions to mcpservers.org. |
| [JAW9C/awesome-remote-mcp-servers](https://github.com/JAW9C/awesome-remote-mcp-servers) | Remote MCP server, Social Media | submitted | [PR #533](https://github.com/jaw9c/awesome-remote-mcp-servers/pull/533) | `OpenPost | Social Media | https://app.openpost.social/mcp | OAuth2.0` | None | 2026-07-26 | Live Streamable HTTP endpoint with OAuth 2.0 authorization code and PKCE. |
| [RunaCapital/awesome-oss-alternatives](https://github.com/RunaCapital/awesome-oss-alternatives) | Social Media, Buffer and Hootsuite alternative | submitted | [PR #381](https://github.com/RunaCapital/awesome-oss-alternatives/pull/381) | Self-hosted social media scheduler. | None | 2026-07-26 | One README table row. |
| [janosh/awesome-sveltekit](https://github.com/janosh/awesome-sveltekit) | SvelteKit app | listed | [Live listing](https://janosh.github.io/awesome-sveltekit), [merged PR #158](https://github.com/janosh/awesome-sveltekit/pull/158) | Self-hosted social media scheduler with an MCP server, CLI, and API. | None | 2026-07-26 | The live README and generated directory both include OpenPost. |
| [hueyy/awesome-mastodon](https://github.com/hueyy/awesome-mastodon) | Toot management | submitted | [PR #71](https://github.com/hueyy/awesome-mastodon/pull/71) | Schedule and publish posts to Mastodon, Bluesky, X, LinkedIn, Threads, and more. | None | 2026-07-26 | Added at the bottom of the required category. |
| [hemanth/awesome-pwa](https://github.com/hemanth/awesome-pwa) | Apps, Tools and Utilities | submitted | [PR #449](https://github.com/hemanth/awesome-pwa/pull/449) | Self-hosted social media scheduler. | None | 2026-07-26 | Links to the installable managed PWA without claiming offline publishing. |
| [tractiongroup/awesome-marketing-tools](https://github.com/tractiongroup/awesome-marketing-tools) | Social Media Management | submitted | [PR #43](https://github.com/tractiongroup/awesome-marketing-tools/pull/43) | Self-hosted social media scheduling for humans and AI agents. | None | 2026-07-26 | One README entry at the bottom of the category. |
| [johnjago/awesome-free-software](https://github.com/johnjago/awesome-free-software) | Web Applications, free software | submitted | [PR #140](https://github.com/johnjago/awesome-free-software/pull/140) | Self-hosted social publishing tool for preparing, scheduling, and tracking posts across multiple networks. | None | 2026-07-26 | One alphabetical README entry with the AGPL-3.0 license link. |
| [sfermigier/awesome-foss-alternatives](https://github.com/sfermigier/awesome-foss-alternatives) | Business, Buffer and Hootsuite alternative | submitted | [PR #45](https://github.com/sfermigier/awesome-foss-alternatives/pull/45) | Self-hosted social publishing tool for preparing, scheduling, and tracking posts across multiple networks. | None | 2026-07-26 | Adds one Social media management subsection under Business. |
| [diegoleme/awesome-open-source-alternatives](https://github.com/diegoleme/awesome-open-source-alternatives) | Buffer and Hootsuite alternative | submitted | [PR #35](https://github.com/diegoleme/awesome-open-source-alternatives/pull/35) | OpenPost | None | 2026-07-26 | Adds one indexed proprietary-app section and one OpenPost link. |
| [princepal9120/awesome-solo-founder-oss](https://github.com/princepal9120/awesome-solo-founder-oss) | Marketing and growth, social publishing | submitted | [PR #5](https://github.com/princepal9120/awesome-solo-founder-oss/pull/5) | Self-hosted social publishing with API, CLI, and MCP access. | None | 2026-07-26 | One README row and matching YAML record beside Postiz and Mixpost. |
| [Docker MCP registry](https://github.com/docker/mcp-registry) | Remote MCP registry | blocked |  | OpenPost gives agents controlled MCP access to prepare social posts while people review and approve publishing. | Icon | 2026-07-26 | Requires structured metadata, OAuth testing, and a permissive licence; current guidance says GPL is unsuitable and OpenPost is AGPL. |
| [Cline MCP marketplace](https://github.com/cline/mcp-marketplace) | MCP marketplace | blocked |  | OpenPost gives agents controlled MCP access to prepare social posts while people review and approve publishing. | Icon | 2026-07-26 | Uses a GitHub issue form rather than Pull Requests. |

## Archive

Move rejected or retired rows here with their final status, last public URL, date,
and reason.

| Surface | status | public listing or PR URL | archived | reason |
| --- | --- | --- | --- | --- |
| [altstackHQ/altstack-data](https://github.com/altstackHQ/altstack-data) | retired | [Closed PR #30](https://github.com/altstackHQ/altstack-data/pull/30) | 2026-07-26 | Closed voluntarily: the catalog requires evidence of real-world usage, which OpenPost cannot yet substantiate cleanly. Revisit after stronger external adoption. |
| [fishttp/awesome-bluesky](https://github.com/fishttp/awesome-bluesky) | retired | [Closed PR #91](https://github.com/fishttp/awesome-bluesky/pull/91) | 2026-07-26 | The README states that the list is no longer maintained. |
| [avelino/awesome-go](https://github.com/avelino/awesome-go) | retired |  | 2026-07-26 | Package-focused rules require a root `go.mod`, pkg.go.dev, Go Report Card, coverage, and five months of history; OpenPost is a multi-module application. |
| [TheComputerM/awesome-svelte](https://github.com/TheComputerM/awesome-svelte) | retired |  | 2026-07-26 | The Application Examples section currently accepts desktop apps, not web applications. |
