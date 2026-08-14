# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

OpenPost serves solo founders first: people building a company without a dedicated content team who still need to explain their work, earn attention, and publish consistently. Creators, small teams, agencies, and operators use the same workflow when they manage more accounts or workspaces. Most content work happens at a desk; the responsive app and Capacitor Android wrapper also support quick checks and focused edits on mobile.

## Product Purpose

OpenPost helps solo founders turn launches, product updates, lessons, and ideas into content, adapt that content for every channel, and keep it publishing from one workspace. Shared drafts, account-specific renditions, media, schedules, and outcomes stay together. Success means the founder can keep building the company while OpenPost carries the repeatable work of shaping, scheduling, and tracking its content.

## Positioning

OpenPost is the all-in-one content team for solo founders. It sits above a basic scheduler: the product keeps the source idea, destination-specific copy and media, reusable assets, calendar, publishing status, analytics, and replies in one system. The Hosted service is the primary experience. Source access and self-hosting remain deployment options, not the lead customer promise.

## Operating Context

Users move between composing, adapting destination renditions, managing connected accounts and reusable media, planning a calendar, and inspecting scheduled or completed jobs. Small teams share workspaces and roles. Automation uses the same workspace and account boundaries through the API, CLI, and MCP server. Users may choose the Hosted service, while self-hosted operators configure their own domain, storage, database, and provider applications.

The SvelteKit interface is embedded in the Go binary and also packaged as a Capacitor Android wrapper. The wrapper uses the same responsive web interface rather than a separate native design language.

## Capabilities and Constraints

- One publication model supports shared source content plus independently valid account renditions while the text-and-thread composer keeps its spacious writing canvas. Post, Thread, Story, Short video, and Video are starter presets; each destination owns its format, text, media, schedule override, and provider settings.
- Social Sets save format-independent account groups and optional account format defaults. New drafts snapshot their selected destinations so later set edits do not change scheduled work.
- Publications can be scheduled through a durable database-backed queue, with visible draft, scheduled, published, failed, and retry states.
- Workspaces organize accounts, media, prompts, schedules, members, billing, and usage limits.
- OpenPost Image Editor creates editable, multi-page social images from workspace media, original templates, brand assets, text, and shapes. It exports ordered derivatives back to Media or the active composer without replacing source assets.
- The web app, typed HTTP API, CLI, and MCP server share authorization and workspace boundaries.
- Provider capabilities, media limits, review requirements, quotas, and live-account readiness vary. Product copy and UI must preserve those distinctions.
- The app supports light and dark themes, English and Portuguese, responsive browser use, and an Android build from the same frontend.
- Self-hosted deployments must remain portable: embedded static assets, configurable storage, SQLite by default, PostgreSQL support, and no hard dependency on an external queue service.
- OpenPost Image Editor remains a focused still-image editor. Video editing, animation, print color workflows, arbitrary remote assets, and low-level image-editor MCP operations are outside its product scope.

## Brand Commitments

The product is named OpenPost. Use the Converge mark from `assets/brand/` and its synchronized copies in the frontend, marketing, documentation, application icons, and social assets. The symbol has four equal modules around one centered opening; preserve its four-fold symmetry, clear axis gaps, and rounded outer corners at every size. The voice is direct, calm, and factual: focused, efficient, and clean without sounding cold. Prefer precise product terms and visible caveats over hype, stock metaphors, or broad claims.

The established identity uses Workshop Orange (`#B74C05`) as its product signal, Carbon Ink (`#302B28`) for primary type, warm-tinted neutrals, a Manrope Semibold wordmark, Geist interface type, and equally supported light and dark modes. “Publish clearly.” is the approved short brand line; omit it when a surface does not need a slogan. Future work should preserve this identity unless the user explicitly requests a redesign.

## Evidence on Hand

- Product capabilities, provider maturity, deployment options, current limits, and public links are maintained in `README.md` and `docs-site/`.
- The public product narrative, pricing, comparisons, and current feature claims are maintained in `marketing-site/src/routes/_marketing.ts`.
- The implemented application surfaces and shared UI primitives live in `frontend/src/routes/` and `frontend/src/lib/components/`.
- Brand assets live in `assets/brand/`; representative product screenshots live in `assets/screenshots/`.
- A public product demonstration is linked from the README, marketing site, app, and docs.
- No testimonials, customer logos, benchmarks, or market-leadership claims are approved for invention.

## Product Principles

1. **Start with the founder's work.** Help users turn what they are building and learning into useful content before asking them to manage a calendar.
2. **Preserve provider truth.** Show destination capabilities, validation, and caveats instead of flattening them into one false promise.
3. **Make outcomes inspectable.** Draft, schedule, queue, publish, failure, and retry state must remain understandable.
4. **Use one coherent product.** Hosted service, self-hosted, browser, Android, API, CLI, and MCP surfaces should share terms and behavior.
5. **Earn trust through consistency.** Reuse established patterns for page chrome, loading, empty, success, error, and destructive states.

## Accessibility & Inclusion

Keep keyboard navigation, visible focus, semantic labels, readable contrast, reduced-motion behavior, and touch targets of at least 44px where coarse pointers apply. Light and dark themes must both remain usable. User-facing app copy must stay compatible with the existing Paraglide localization workflow rather than being embedded as untranslated one-off text.
