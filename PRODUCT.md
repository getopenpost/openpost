# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

OpenPost serves solo founders first: people building a company without a dedicated content team who still need to explain their work, earn attention, and publish consistently. Creators, small teams, agencies, and operators use the same workflow when they manage more accounts or workspaces. Most content work happens at a desk; the responsive web app and native mobile app support quick capture, queue checks, and focused edits away from it.

## Product Purpose

OpenPost helps solo founders turn launches, product updates, lessons, and ideas into content, adapt that content for every channel, and keep it publishing from one workspace. Shared drafts, account-specific variants, media, schedules, and outcomes stay together. Success means the founder can keep building the company while OpenPost carries the repeatable work of shaping, scheduling, and tracking its content.

## Positioning

OpenPost is the all-in-one content team for solo founders. It sits above a basic scheduler: the product keeps the source idea, destination-specific copy and media, reusable assets, calendar, publishing status, analytics, and replies in one system. The Hosted service is the primary experience. Source access and self-hosting remain deployment options, not the lead customer promise.

## Operating Context

Users start on Home, which answers what is going out, what needs them, and how things are going. From there they move between composing, adapting destination variants, managing connected accounts and reusable media, planning a calendar, and inspecting scheduled or completed jobs. Writing-first creators can open on the composer with Drafts in the sidebar, a device preference that onboarding offers. Small teams share workspaces and roles. Automation uses the same workspace and account boundaries through the API, CLI, and MCP server. Users may choose the Hosted service, while self-hosted operators configure their own domain, storage, database, and provider applications.

The SvelteKit interface is embedded in the Go binary. A standalone Expo mobile app uses the same typed HTTP API, terms, permissions, and workspace boundaries through native Android and iOS interfaces.

## Capabilities and Constraints

- One post model supports shared source content plus independently valid account variants while the text-and-thread composer keeps its spacious writing canvas. Post, Thread, Story, Short video, and Video are starter presets; each destination owns its format, text, media, schedule override, and provider settings.
- Social Sets save format-independent account groups and optional account format defaults. New drafts snapshot their selected destinations so later set edits do not change scheduled work.
- Posts can be scheduled through a durable database-backed queue, with visible draft, scheduled, published, failed, and retry states.
- Workspaces organize accounts, media, prompts, schedules, members, billing, and usage limits. Product navigation groups work into Home, Posts, Inbox, Analytics, Ideas, Studio, Media, Automations, Accounts, and Settings. Find people lives under Inbox, Reposts under Automations, and editors, templates, voice profiles, and prompts under Studio.
- Organizations own a versioned theme library and default. When organization policy allows it, workspace admins may choose another published theme. Each person still chooses light, dark, or system appearance. The complete resolved theme applies to authenticated web and mobile chrome; theme creation and revision management remain a desktop web task.
- OpenPost Image Editor creates editable, multi-page social images from workspace media, original templates, brand assets, text, and shapes. Highlight-driven lens effects remain reversible. Animated GIF layers retain editable frames, timing and looping, with composited GIF export. It exports ordered derivatives back to Media or the active composer without replacing source assets.
- Signed-in Video Editor projects belong to a workspace and sync authored project state, required Project Assets, revisions, checkpoints, and conflicts across devices. Device view state and browser file handles stay local. Local-only projects remain available for people who do not want cloud storage.
- Mobile Video Projects can record or import footage, preserve it offline, and upload a non-destructive preparation recipe for completion in the full web editor. Mobile does not claim full timeline editing or export parity.
- The web app, typed HTTP API, CLI, and MCP server share authorization and workspace boundaries.
- Provider capabilities, media limits, review requirements, quotas, and live-account readiness vary. Product copy and UI must preserve those distinctions.
- The web app supports light and dark appearance, twelve translated locales, and responsive browser use. The native mobile app uses the same resolved theme semantics and supports light, dark, and system appearance on Android and iOS.
- Self-hosted deployments must remain portable: embedded static assets, configurable storage, SQLite by default, PostgreSQL support, and no hard dependency on an external queue service.
- OpenPost Image Editor remains focused on social images and bounded GIF animation. Its advertised page and layer operations are available to connected MCP clients through the same controller used by the web UI. Video timelines, keyframe animation, print color workflows, and arbitrary remote assets remain outside its product scope. GIF export supports up to 200 composited frames, 60 seconds, 2048 px per side and 100 million rendered pixels. AI image editing and background removal support still images.

## Brand Commitments

The product is named OpenPost. Use the Converge mark from `assets/brand/` and its synchronized copies in the frontend, marketing, documentation, application icons, and social assets. The symbol has four equal modules around one centered opening; preserve its four-fold symmetry, clear axis gaps, and rounded outer corners at every size. The voice is direct, calm, and factual: focused, efficient, and clean without sounding cold. Prefer precise product terms and visible caveats over hype, stock metaphors, or broad claims.

Calm is the default theme for organizations without saved theme settings and for anonymous public pages. It uses near-white or charcoal neutrals, one warm accent, and Manrope. Dither, the ordered pixel texture, is the OpenPost signature across actions, charts, progress, empty states, and brand moments, and it stays part of the identity in every default surface. Saved organization and workspace choices take precedence. Signed-in public profile viewers retain their Workspace theme. Workshop remains the complete fallback and documentation reference, with Workshop Orange (`#B74C05`), Carbon Ink (`#302B28`), warm-tinted neutrals, a Manrope Semibold wordmark, and Geist interface type. Organization themes change semantic presentation independently of app branding. Organization owners and admins may set an app display name, square logo, and optional horizontal wordmark with light/dark variants. Workspaces inherit this identity unless the organization allows workspace-admin overrides. These replace identity only inside authenticated app surfaces; public entry pages, emails, installed app icons, service identity, provider marks, workspace identity, status meaning, product terms, permissions, and content retain their own owners. OpenPost remains the default identity, and the original Converge artwork keeps its geometry. “Your socials, on steroids.” is the approved brand headline; omit it when a surface does not need a slogan.

## Evidence on Hand

- Product capabilities, provider maturity, deployment options, current limits, and public links are maintained in `README.md` and `apps/docs/`.
- The public product narrative, pricing, comparisons, and current feature claims are maintained in `apps/marketing/src/routes/_marketing.ts`.
- The implemented application surfaces and shared UI primitives live in `apps/web/src/routes/` and `apps/web/src/lib/components/`.
- Brand assets live in `assets/brand/`; representative product screenshots live in `assets/screenshots/`.
- A public product demonstration is linked from the README, marketing site, app, and docs.
- No testimonials, customer logos, benchmarks, or market-leadership claims are approved for invention.

## Product Principles

1. **Start with the founder's work.** Help users turn what they are building and learning into useful content before asking them to manage a calendar.
2. **Preserve provider truth.** Show destination capabilities, validation, and caveats instead of flattening them into one false promise.
3. **Make outcomes inspectable.** Draft, schedule, queue, publish, failure, and retry state must remain understandable.
4. **Use one coherent product.** Hosted service, self-hosted, browser, Android, iOS, API, CLI, and MCP surfaces should share terms and behavior.
5. **Earn trust through consistency.** Reuse established patterns for page chrome, tabs, loading, empty, success, error, and destructive states. The design contract is `docs/specs/calm-ux.md`.
6. **Stay calm and respect time.** Each screen answers one question, says things once, and offers a next action. Calm never hides provider truth, recovery, or functional warnings.

## Accessibility & Inclusion

Keep keyboard navigation, visible focus, semantic labels, readable contrast, reduced-motion behavior, and touch targets of at least 44px where coarse pointers apply. Every supported theme scheme must remain usable. An unsupported, unavailable, or invalid scheme resolves to the complete Workshop equivalent rather than a partial mix. User-facing app copy must stay compatible with the existing Paraglide localization workflow rather than being embedded as untranslated one-off text.
