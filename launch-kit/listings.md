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
| Repository | <https://github.com/getopenpost/openpost> |
| Product | <https://openpost.social> |
| Documentation | <https://docs.openpost.social> |
| Hosted service | <https://app.openpost.social> |
| Supported networks | Bluesky, LinkedIn, Mastodon, Threads, and X |
| Install methods | Docker Compose, GHCR container, a single Go binary, or the Android APK from each GitHub release |
| Remote MCP endpoint | `https://app.openpost.social/mcp` (Streamable HTTP, OAuth 2.0 with PKCE) |
| First tagged release | `v0.1.0`, 2026-03-29 22:06 UTC |
| License | [AGPL-3.0-only](../LICENSE) |
| Icon | [`assets/brand/icon.svg`](../assets/brand/icon.svg), [raw GitHub](https://raw.githubusercontent.com/getopenpost/openpost/main/assets/brand/icon.svg) |
| Primary lockup | [`assets/brand/lockup.svg`](../assets/brand/lockup.svg), [raw GitHub](https://raw.githubusercontent.com/getopenpost/openpost/main/assets/brand/lockup.svg) |
| Symbol | [`assets/brand/logo.svg`](../assets/brand/logo.svg), [raw GitHub](https://raw.githubusercontent.com/getopenpost/openpost/main/assets/brand/logo.svg) |
| Social card | [`assets/brand/og-image.png`](../assets/brand/og-image.png), [raw GitHub](https://raw.githubusercontent.com/getopenpost/openpost/main/assets/brand/og-image.png) |

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
| [awesome-selfhosted/awesome-selfhosted-data](https://github.com/awesome-selfhosted/awesome-selfhosted-data) | Self-hosted, Analytics | submitted | [PR #2820](https://github.com/awesome-selfhosted/awesome-selfhosted-data/pull/2820) | Prepare, review, schedule, publish, and track posts across multiple social networks (alternative to Buffer, Hootsuite). | None | 2026-07-30 | One schema-valid `software/openpost.yml` entry after the four-month release-age gate. |
| [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | Social Media MCP server | blocked |  | OpenPost gives agents controlled MCP access to prepare social posts while people review and approve publishing. | Icon | 2026-07-26 | Requires a claimed Glama listing with a passing quality score and badge. |
| [appcypher/awesome-mcp-servers](https://github.com/appcypher/awesome-mcp-servers) | Social Media MCP server | blocked |  | Draft, schedule, and publish social posts through a self-hosted MCP server. | Icon | 2026-07-26 | The repository keeps an old contribution guide but has Pull Requests disabled. |
| [wong2/awesome-mcp-servers](https://github.com/wong2/awesome-mcp-servers) | MCP server | blocked |  | OpenPost gives agents controlled MCP access to prepare social posts while people review and approve publishing. | Icon | 2026-07-26 | Pull Requests are disabled; the README directs submissions to mcpservers.org. |
| [JAW9C/awesome-remote-mcp-servers](https://github.com/JAW9C/awesome-remote-mcp-servers) | Remote MCP server, Social Media | submitted | [PR #533](https://github.com/jaw9c/awesome-remote-mcp-servers/pull/533) | `OpenPost \| Social Media \| https://app.openpost.social/mcp \| OAuth2.0` | None | 2026-07-26 | Live Streamable HTTP endpoint with OAuth 2.0 authorization code and PKCE. |
| [RunaCapital/awesome-oss-alternatives](https://github.com/RunaCapital/awesome-oss-alternatives) | Social Media, Buffer and Hootsuite alternative | submitted | [PR #381](https://github.com/RunaCapital/awesome-oss-alternatives/pull/381) | Self-hosted social media scheduler. | None | 2026-07-26 | One README table row. |
| [janosh/awesome-sveltekit](https://github.com/janosh/awesome-sveltekit) | SvelteKit app | listed | [Live listing](https://janosh.github.io/awesome-sveltekit), [merged PR #158](https://github.com/janosh/awesome-sveltekit/pull/158) | Self-hosted social media scheduler with an MCP server, CLI, and API. | None | 2026-07-26 | The live README and generated directory both include OpenPost. |
| [hueyy/awesome-mastodon](https://github.com/hueyy/awesome-mastodon) | Toot management | submitted | [PR #71](https://github.com/hueyy/awesome-mastodon/pull/71) | Schedule and publish posts to Mastodon, Bluesky, X, LinkedIn, Threads, and more. | None | 2026-07-26 | Added at the bottom of the required category. |
| [hemanth/awesome-pwa](https://github.com/hemanth/awesome-pwa) | Apps, Tools and Utilities | submitted | [PR #449](https://github.com/hemanth/awesome-pwa/pull/449) | Self-hosted social media scheduler. | None | 2026-07-26 | Links to the installable Hosted service PWA without claiming offline publishing. |
| [tractiongroup/awesome-marketing-tools](https://github.com/tractiongroup/awesome-marketing-tools) | Social Media Management | submitted | [PR #43](https://github.com/tractiongroup/awesome-marketing-tools/pull/43) | Self-hosted social media scheduling for humans and AI agents. | None | 2026-07-26 | One README entry at the bottom of the category. |
| [johnjago/awesome-free-software](https://github.com/johnjago/awesome-free-software) | Web Applications, free software | submitted | [PR #140](https://github.com/johnjago/awesome-free-software/pull/140) | Self-hosted social publishing tool for preparing, scheduling, and tracking posts across multiple networks. | None | 2026-07-26 | One alphabetical README entry with the AGPL-3.0 license link. |
| [sfermigier/awesome-foss-alternatives](https://github.com/sfermigier/awesome-foss-alternatives) | Business, Buffer and Hootsuite alternative | submitted | [PR #45](https://github.com/sfermigier/awesome-foss-alternatives/pull/45) | Self-hosted social publishing tool for preparing, scheduling, and tracking posts across multiple networks. | None | 2026-07-26 | Adds one Social media management subsection under Business. |
| [diegoleme/awesome-open-source-alternatives](https://github.com/diegoleme/awesome-open-source-alternatives) | Buffer and Hootsuite alternative | submitted | [PR #35](https://github.com/diegoleme/awesome-open-source-alternatives/pull/35) | OpenPost | None | 2026-07-26 | Adds one indexed proprietary-app section and one OpenPost link. |
| [princepal9120/awesome-solo-founder-oss](https://github.com/princepal9120/awesome-solo-founder-oss) | Marketing and growth, social publishing | submitted | [PR #5](https://github.com/princepal9120/awesome-solo-founder-oss/pull/5) | Self-hosted social publishing with API, CLI, and MCP access. | None | 2026-07-26 | One README row and matching YAML record beside Postiz and Mixpost. |
| [mikeroyal/Self-Hosting-Guide](https://github.com/mikeroyal/Self-Hosting-Guide) | Social, self-hosting guide | submitted | [PR #378](https://github.com/mikeroyal/Self-Hosting-Guide/pull/378) | Self-hosted social publishing and scheduling with destination-specific content, reusable media, a calendar, API, CLI, and MCP access. | None | 2026-07-26 | One entry in the Social section; the PR discloses maintainer ownership and personal use. |
| [hotheadhacker/awesome-selfhost-docker](https://github.com/hotheadhacker/awesome-selfhost-docker) | Communication, Docker self-hosting | submitted | [PR #65](https://github.com/hotheadhacker/awesome-selfhost-docker/pull/65) | Self-hosted social publishing and scheduling platform with Docker Compose support. | None | 2026-07-26 | One README table row. The only red check is an external-contributor Vercel authorization failure. |
| [vihar/awesome-oss-saas](https://github.com/vihar/awesome-oss-saas) | Growth and Marketing, Buffer and Hootsuite alternative | submitted | [PR #41](https://github.com/vihar/awesome-oss-saas/pull/41) | Self-hosted social publishing and scheduling. | None | 2026-07-26 | One table row with the repository star badge, alternatives, docs, and GitHub links. |
| [iAmCorey/awesome-indie-hacker-tools](https://github.com/iAmCorey/awesome-indie-hacker-tools) | Product launch and promotion | submitted | [PR #150](https://github.com/iAmCorey/awesome-indie-hacker-tools/pull/150) | 开源、可自托管的社交媒体发布和排程工具，可在一个工作区内为多个平台准备、审核和发布内容。 | None | 2026-07-26 | One Chinese-language entry in the repository's canonical README. |
| [lincolixavier/awesome-indie-hackers](https://github.com/lincolixavier/awesome-indie-hackers) | Marketing | submitted | [PR #20](https://github.com/lincolixavier/awesome-indie-hackers/pull/20) | Plataforma open source e autoalojada para preparar, rever e agendar publicações em várias redes sociais. | None | 2026-07-26 | One Portuguese-language entry. |
| [yzfly/Awesome-MCP-ZH](https://github.com/yzfly/Awesome-MCP-ZH) | Communication and collaboration MCP server | submitted | [PR #413](https://github.com/yzfly/Awesome-MCP-ZH/pull/413) | 开源、可自托管的社交媒体发布平台，MCP 可查询工作区、准备多平台内容版本、复用媒体并在人工审核后排程或发布。 | None | 2026-07-26 | One Chinese table row with Go, hosted/self-hosted, Streamable HTTP, OAuth 2.0, and stdio metadata. |
| [MobinX/awesome-mcp-list](https://github.com/MobinX/awesome-mcp-list) | Marketing MCP server | submitted | [PR #362](https://github.com/MobinX/awesome-mcp-list/pull/362) | Authenticated MCP server for preparing destination-specific content, reusing media, validating, scheduling, publishing, and inspecting delivery status. | None | 2026-07-26 | One README entry with the repository star badge. |
| [toolsdk-ai/toolsdk-mcp-registry](https://github.com/toolsdk-ai/toolsdk-mcp-registry) | Marketing MCP registry | submitted | [PR #422](https://github.com/toolsdk-ai/toolsdk-mcp-registry/pull/422) | Open-source social publishing and scheduling with an authenticated MCP server. | None | 2026-07-26 | One schema-valid JSON package with the GHCR image, AGPL licence, docs, remote endpoint, Streamable HTTP, and OAuth 2.0; Biome and Package Schema Check pass. |
| [sylviangth/awesome-remote-mcp-servers](https://github.com/sylviangth/awesome-remote-mcp-servers) | Marketing and CRM remote MCP server | submitted | [PR #72](https://github.com/sylviangth/awesome-remote-mcp-servers/pull/72) | Social publishing tools for inspecting workspaces and media, preparing destination-specific content, validating posts, and scheduling or publishing. | None | 2026-07-26 | Lists the Hosted service Streamable HTTP endpoint with OAuth 2.0 and the equivalent self-hosted `/mcp` endpoint. |
| [lobstercare/mcp-hub](https://github.com/lobstercare/mcp-hub) | Communication MCP server | submitted | [PR #57](https://github.com/lobstercare/mcp-hub/pull/57) | Open-source social publishing and scheduling with remote Streamable HTTP, OAuth 2.0, local stdio, destination-specific drafts, media reuse, validation, and queue status. | None | 2026-07-26 | One Go, hosted, and self-hosted README entry. |
| [TensorBlock/awesome-mcp-servers](https://github.com/TensorBlock/awesome-mcp-servers) | Social Media and Content Platforms MCP server | submitted | [PR #1416](https://github.com/TensorBlock/awesome-mcp-servers/pull/1416) | Open-source, self-hosted social publishing and scheduling with an authenticated Streamable HTTP endpoint and local stdio proxy. | None | 2026-07-26 | One source entry with remote endpoint, OAuth 2.0, compact tool surface, and canonical docs; awaiting maintainer approval. |
| [YuzeHao2023/Awesome-MCP-Servers](https://github.com/YuzeHao2023/Awesome-MCP-Servers) | Social Media MCP server | submitted | [PR #377](https://github.com/YuzeHao2023/Awesome-MCP-Servers/pull/377) | Open-source, self-hosted social publishing and scheduling with authenticated Streamable HTTP and stdio MCP access. | None | 2026-07-26 | One README entry in Social Media. |
| [Model Context Protocol Registry](https://github.com/modelcontextprotocol/registry) | Official remote MCP registry | listed | [Live registry entry](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.rodrgds/openpost), [merged OpenPost PR #19](https://github.com/getopenpost/openpost/pull/19) | Manage social publishing workflows through OpenPost. | None | 2026-07-26 | Published as `io.github.rodrgds/openpost` version `1.32.2`; registry API reports active and latest, with the canonical source at `getopenpost/openpost`. |
| [pathintegral-institute/mcpm.sh](https://github.com/pathintegral-institute/mcpm.sh) | Professional Apps and Productivity MCP server | submitted | [PR #366](https://github.com/pathintegral-institute/mcpm.sh/pull/366) | Official MCP server for OpenPost. Inspect connected accounts and media, draft and review social content, schedule or publish it, and manage comments where supported. | None | 2026-07-26 | One schema-valid hosted HTTP manifest. Repository manifest validation, lint, and tests pass. |
| [MobileFirstLLC/social-media-hacker-list](https://github.com/MobileFirstLLC/social-media-hacker-list) | Multi-platform social media tool | submitted | [PR #138](https://github.com/MobileFirstLLC/social-media-hacker-list/pull/138) | Self-hosted scheduling and publishing across multiple social networks. | None | 2026-07-26 | One alphabetically placed table row; the official 185-link checker passes. |
| [marketingtoolslist/awesome-marketing](https://github.com/marketingtoolslist/awesome-marketing) | Social Media Management | submitted | [PR #150](https://github.com/marketingtoolslist/awesome-marketing/pull/150) | Open-source, self-hosted tool for preparing, scheduling, and publishing posts across multiple social networks. | None | 2026-07-26 | One README entry beside other scheduling tools. |
| [ishanvyas22/awesome-open-source-systems](https://github.com/ishanvyas22/awesome-open-source-systems) | Social Media Management | submitted | [PR #27](https://github.com/ishanvyas22/awesome-open-source-systems/pull/27) | A self-hosted social publishing tool for preparing, reviewing, scheduling, and tracking posts across multiple networks. | None | 2026-07-26 | Adds one indexed category and one entry. |
| [lunaperegrina/awesome-bsky](https://github.com/lunaperegrina/awesome-bsky) | Bluesky apps and tools | submitted | [PR #32](https://github.com/lunaperegrina/awesome-bsky/pull/32) | Open-source, self-hosted tool for preparing and scheduling posts to Bluesky and other social networks. | None | 2026-07-26 | Matching entries in the required Portuguese and English READMEs. |
| [atblueprints/awesome-atproto](https://github.com/atblueprints/awesome-atproto) | AT Protocol tools | submitted | [PR #7](https://github.com/atblueprints/awesome-atproto/pull/7) | Self-hosted social publishing tool that schedules posts to Bluesky through AT Protocol alongside other networks. | None | 2026-07-26 | One alphabetically placed Tools entry. |
| [songtianlun/selfhost-hub](https://github.com/songtianlun/selfhost-hub) | Self-hosted, Analytics | submitted | [PR #25](https://github.com/songtianlun/selfhost-hub/pull/25) | Open-source, self-hosted social publishing platform for drafting, reviewing, scheduling, and publishing content across multiple social networks. | None | 2026-07-26 | One frontmatter-valid English catalog entry beside Postiz and Mixpost. |
| [OSSDrop](https://github.com/OSSDrop/OSSDrop) | Open-source communication and social tool | listed | [Merged PR #1](https://github.com/OSSDrop/OSSDrop/pull/1) | Open-source, self-hosted social media scheduler for publishing to Bluesky, Mastodon, X, LinkedIn, Threads, and more. | None | 2026-07-26 | The directory explicitly encourages makers to submit their own tools and has no popularity threshold. The merged JSON entry uses the exact `AGPL-3.0-only` SPDX identifier. |
| [Open Source Observer directory](https://github.com/opensource-observer/oss-directory) | Open-source project directory and analytics | submitted | [PR #1126](https://github.com/opensource-observer/oss-directory/pull/1126) | Open-source, self-hosted social media scheduler for publishing across multiple networks. | None | 2026-07-26 | One version-7 YAML record. Repository-native validation passes; the external OSO PR check awaits the required maintainer `/validate` approval. |
| [FreeAlternative](https://freealternative.app) | Free and open-source Buffer, Hootsuite, and Sprout Social alternative | submitted |  | Open-source, self-hosted social media scheduler for publishing to Bluesky, Mastodon, X, LinkedIn, Threads, and more. | None | 2026-07-26 | Form confirmed receipt and says manual review takes two to four business days. |
| [Open Source Startups](https://www.opensourcestartups.com) | Communication, open-source startup | submitted |  | Self-hosted social media scheduling without handing over your data. | None | 2026-07-26 | Form confirmed receipt and queued OpenPost for review; submitted manually after the site's GitHub autofill hit its shared API rate limit. |
| [selfh.st/apps](https://selfh.st/apps/) | Self-hosted apps directory | submitted |  | Open-source, self-hosted social media scheduler for publishing to Bluesky, Mastodon, X, LinkedIn, Threads, and more from one web app, CLI, API, or MCP server. | None | 2026-07-26 | Form confirmed receipt. OpenPost's March 2026 first release was disclosed through the repository, and AI-assisted development was answered honestly. |
| [SelfHostTools](https://selfhosttools.com/) | Communication, self-hosted Buffer and Hootsuite alternative | submitted |  | A self-hosted alternative to Buffer and Hootsuite for teams and individuals who want to prepare, review, schedule, and publish social content without handing their workflow or data to another SaaS. | None | 2026-07-26 | Form confirmed receipt. The directory accepts reviewed suggestions without an account or popularity threshold. |
| [GitFind](https://gitfind.ai) | Early-stage GitHub project discovery | submitted |  | OpenPost combines a self-hosted social publishing web app with an API, CLI, and authenticated MCP server, giving humans and agents one reviewable scheduling workflow instead of separate automation scripts. | None | 2026-07-26 | Form confirmed receipt. OpenPost scored 0/100 on the site's Early Signal Score and entered manual review instead of automatic listing. |
| [OpenSaaS Directory](https://opensaas.directory) | Open-source SaaS project | blocked |  | Open-source, self-hosted social media scheduler for teams and individuals. | None | 2026-07-26 | The form issued a request to `/api/contact` but retained all values and showed its error path; no receipt was created. Retry when the endpoint works. |
| [GitDB](https://gitdb.net) | GitHub project directory | blocked |  | Open-source, self-hosted social media scheduler. | None | 2026-07-26 | The live form explicitly returned `Failed to submit project. Please try again later.` |
| [UND-RDR](https://undrdr.com/#/submit) | Under-1,000-star GitHub repository discovery | blocked |  | Open-source, self-hosted social media scheduler with web, CLI, API, and MCP interfaces, active releases, and complete installation docs despite its early star count. | None | 2026-07-26 | Repository validation reached `READY TO REVIEW`, but `/api/submit-repo` timed out and the form explicitly reported that the submission could not be received. |
| [GitFounders](https://www.gitfounders.com/submit) | Open-source Buffer, Hootsuite, and SocialPilot alternative | blocked |  | Open-source, self-hosted social media scheduler. | None | 2026-07-26 | The live submission URL currently returns `Deployment Paused`. |
| [OpenAltFinder](https://openaltfinder.com/submit) | Self-hosted social media management alternative | blocked |  | Open-source alternative to Buffer, Hootsuite, and SocialPilot. | None | 2026-07-26 | Submission data is prepared, but Cloudflare Turnstile remained blank with no token or interactive checkbox in the automated browser. Requires a normal human browser session. |
| [MCP Trove](https://mcptrove.com/submit) | Communication MCP server | blocked |  | Prepare, review, schedule, and publish social content through OpenPost. | None | 2026-07-26 | The completed valid form reports that submissions are disabled in its read-only demo until the operator configures `DATABASE_URL`. |
| [OpenAlternative](https://openalternative.co) | Open-source Buffer and Hootsuite alternative | blocked |  | Self-hosted social publishing tool for preparing, reviewing, scheduling, and tracking posts across multiple networks. | Icon | 2026-07-26 | Submission form requires Rodrigo to complete an interactive GitHub sign-in. |
| [Docker MCP registry](https://github.com/docker/mcp-registry) | Remote MCP registry | blocked |  | OpenPost gives agents controlled MCP access to prepare social posts while people review and approve publishing. | Icon | 2026-07-26 | Requires structured metadata, OAuth testing, and a permissive licence; current guidance says GPL is unsuitable and OpenPost is AGPL. |
| [Cline MCP marketplace](https://github.com/cline/mcp-marketplace) | MCP marketplace | blocked |  | OpenPost gives agents controlled MCP access to prepare social posts while people review and approve publishing. | Icon | 2026-07-26 | Uses a GitHub issue form rather than Pull Requests. |

## Archive

Move rejected or retired rows here with their final status, last public URL, date,
and reason.

| Surface | status | public listing or PR URL | archived | reason |
| --- | --- | --- | --- | --- |
| [altstackHQ/altstack-data](https://github.com/altstackHQ/altstack-data) | retired | [Closed PR #30](https://github.com/altstackHQ/altstack-data/pull/30) | 2026-07-26 | Closed voluntarily: the catalog requires evidence of real-world usage, which OpenPost cannot yet substantiate cleanly. Revisit after stronger external adoption. |
| [fishttp/awesome-bluesky](https://github.com/fishttp/awesome-bluesky) | retired | [Closed PR #91](https://github.com/fishttp/awesome-bluesky/pull/91) | 2026-07-26 | The README states that the list is no longer maintained. |
| [Ibexoft/awesome-startup-tools-list](https://github.com/Ibexoft/awesome-startup-tools-list) | rejected | [Closed PR #215](https://github.com/Ibexoft/awesome-startup-tools-list/pull/215) | 2026-07-26 | Maintainer closed the scoped Sales and Marketing addition without feedback. |
| [runtipi/runtipi-appstore](https://github.com/runtipi/runtipi-appstore) | retired |  | 2026-07-26 | The official App Store explicitly no longer accepts new applications; creating a one-app community store would add maintenance without meaningful distribution. |
| [avelino/awesome-go](https://github.com/avelino/awesome-go) | retired |  | 2026-07-26 | Package-focused rules require a root `go.mod`, pkg.go.dev, Go Report Card, coverage, and five months of history; OpenPost is a multi-module application. |
| [TheComputerM/awesome-svelte](https://github.com/TheComputerM/awesome-svelte) | retired |  | 2026-07-26 | The Application Examples section currently accepts desktop apps, not web applications. |
