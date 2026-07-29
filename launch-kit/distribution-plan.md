# Proof-First Distribution Plan

> **Planning template.** This file contains no user proof, endorsements, launch date, or campaign result.

Launch OpenPost around a demonstrated workflow: an agent prepared destination-specific work without receiving provider credentials, a person reviewed every destination, and OpenPost kept execution and outcomes visible.

Do not position the product as another generic Buffer alternative or lead with a count of provider logos.

## Wave 0: private proof

Recruit a small group of relevant users before a broad announcement:

- technical founders publishing product updates;
- open-source maintainers;
- developer advocates;
- indie teams with several product or personal accounts;
- developers already using MCP clients or coding agents;
- self-hosters who want a smaller runtime.

Observe whether they can understand the product, connect two relevant destinations, create distinct renditions, schedule or publish, recover from provider setup failures, and return for another campaign.

Do not manufacture proof. Collect attributed quotes, campaign examples, and comparison reasons only with permission and only after the person has used the workflow.

Record ten participants in [`pilot-evidence-log.md`](./pilot-evidence-log.md). Treat empty rows, incomplete workflows, and failures as useful evidence rather than filling the public campaign with assumed success.

## Wave 1: technical and open-source launch

Prepare material for each destination instead of pasting one announcement everywhere:

| Destination | Material |
| --- | --- |
| X | Short verified product video and a compact technical post or thread |
| LinkedIn | Founder/build narrative about provider-aware preparation and human control |
| Bluesky and Mastodon | Open source, self-hosting, provider truth, and the compact runtime |
| Show HN | Architecture, provider differences, MCP authority, queue design, tradeoffs, and honest limitations |
| Self-hosting communities | Container or binary setup, storage, backups, provider credentials, and operational duties |
| GitHub | Current screenshots, architecture, provider evidence levels, launch kit, and a direct request to try the workflow |

Suggested Show HN title:

> Show HN: OpenPost – a self-hosted publishing layer for humans and AI agents

The body should explain why “write once, publish everywhere” hides real provider differences; how canonical content and account-specific renditions work; why `mcp:read` and `mcp:full` have different authority; how the durable queue exposes failures; and which paths remain preview or unverified.

## Wave 2: agent and self-hosted ecosystems

After the first technical launch produces real usage, submit the integration to relevant MCP directories, agent communities, developer-tool newsletters, self-hosted software directories, and NixOS or homelab communities where promotion is allowed.

Share this launch kit as the reusable artifact. It should prove the workflow with real evidence added after publication, not merely repeat product claims.

## Wave 3: broader launch after proof

Use a broad launch channel only after OpenPost has:

- real users who completed the core workflow;
- attributed quotes and campaign examples with permission;
- a known activation path and measured setup failures;
- a refined, current demo;
- provider rows verified for the formats shown;
- people willing to discuss their actual experience in their own words.

## Supporter guidance

Ask only people who have seen or used OpenPost. Send the direct launch URL and invite honest feedback or sharing if they genuinely find it useful. Do not provide scripted praise, buy engagement, or recruit irrelevant accounts to simulate demand.

## Measure activation

Define targets before launch, then collect the first fourteen days with [`metrics-plan.md`](./metrics-plan.md). The social-provider Analytics page does not measure product activation, and OpenPost does not include a product-usage analytics vendor or launch KPI dashboard, so assign an owner and evidence source for every value.

The recommended starting targets are planning values, not current results:

- `[TARGET]` qualified registrations;
- `[TARGET]` users who connect at least two destinations;
- `[TARGET]` users who create account-specific renditions;
- `[TARGET]` users who successfully schedule or publish;
- `[TARGET]` paying customers;
- OAuth failure rate;
- first-publication failure rate;
- time from signup to first scheduled post;
- queue backlog and posts that never reach a final state;
- support requests, refunds, and immediate cancellations.

Reach without account connections points to trust or onboarding. Connections without a schedule point to value or complexity. One publication without a return visit points to retention. Record what happened in [`results-template.md`](./results-template.md).
