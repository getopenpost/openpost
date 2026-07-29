---
target: landing page and marketing pages
total_score: 26
max_score: 36
na_heuristics: 7
p0_count: 0
p1_count: 2
timestamp: 2026-07-28T15-24-36Z
slug: marketing-site
---

# OpenPost marketing-site critique

## Design Health Score

| #         | Heuristic                                    |           Score | Key issue                                                                                                                                                                       |
| --------- | -------------------------------------------- | --------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | Visibility of system status                  |             2/4 | Provider caveats are explicit, but current-location cues and the path from public tool to product are weak.                                                                     |
| 2         | Match between system and the real world      |             3/4 | The product model is concrete, but agent, MCP, deployment, and provider terminology appears before a first-time buyer has a simple outcome model.                               |
| 3         | User control and freedom                     |             3/4 | Managed and self-hosted paths are clear; dense mobile comparison tables and isolated tools reduce control over how information is consumed or carried into the app.             |
| 4         | Consistency and standards                    |             4/4 | Components, spacing, color, and interaction patterns are disciplined across the marketing site.                                                                                 |
| 5         | Error prevention                             |             3/4 | Limits and provider caveats are unusually honest, but plan and capability comparisons require too much cross-column checking.                                                   |
| 6         | Recognition rather than recall               |             2/4 | Five plans, seven tools, six comparisons, many nav destinations, and wide tables make visitors remember distinctions across a long page.                                        |
| 7         | Flexibility and efficiency of use            |             N/A | The reviewed surfaces are primarily informational rather than repeated task flows.                                                                                              |
| 8         | Aesthetic and minimalist design              |             3/4 | The visual system is coherent, but repeated cards, borders, eyebrows, tables, and oversized headings make the site feel denser and more generic than the brand brief calls for. |
| 9         | Help users recognize and recover from errors |             3/4 | Public tools offer useful constraints, but the preview tool does not explain unsupported formats or the difference between an estimate and provider-rendered output.            |
| 10        | Help and documentation                       |             3/4 | Documentation and trust material are thorough, but they compete with the primary buying story.                                                                                  |
| **Total** |                                              | **26/36 (72%)** | **Good foundation; material information-architecture problems.**                                                                                                                |

## Anti-pattern verdict

The site does not read as careless AI output. Its claims, provider caveats, deployment model, and copy are specific to OpenPost. Its visual composition does read as moderately generic developer SaaS: eyebrow chip, oversized heading, orange primary button, repeated rounded bordered cards, thin dividers, Lucide-style iconography, and a long dark product page. The problem is not the brand palette; it is how often the same composition repeats without a stronger product-led narrative.

The deterministic source scan found one warning in `marketing-site/static/404.html`: a single Arial/system font. This is a low-confidence false positive because the standalone noindex page still establishes hierarchy through size and weight. A narrower scan of `marketing-site/src/routes` returned no findings.

Browser scans of the home page, pricing, and the Instagram platform page at desktop and phone sizes produced 90 rule instances: 22 nested-card flags, 18 low-contrast flags, 18 long-line flags, 18 cramped-padding flags, 6 layout-transition flags, 4 thin-border/wide-shadow flags, 2 single-font flags, 1 hero-eyebrow flag, and 1 viewport-edge flag. Several are false positives: table headers and preview frames are not literal nested cards, table cells have adequate padding, Geist has real size and weight hierarchy, and the width transition belongs to a character-counter progress indicator. The actionable results are the repeated 4.3:1 orange-on-brown small text, roughly 98–105-character desktop lines, many touch targets below 44px, a phone-width item extending 26px past the viewport, and the cumulative density of borders and frames.

The detector overlays were injected and confirmed in the DOM, but the shared browser remained non-visible and snapshot capture failed, so there is no reliable user-visible overlay or screenshot to claim.

## Overall impression

OpenPost has more substance than its marketing hierarchy can carry. The home page tries to sell the text-and-thread composer, agents, provider safety, deployment control, analytics, managed hosting, self-hosting, pricing, and trust in one 10,758px desktop narrative that grows to about 17,700px on a phone. The biggest opportunity is to choose one buyer outcome, prove it with the real product and destination previews, and progressively disclose the technical and provider detail.

Competitor length is not the useful benchmark. Postiz and PostBridge also have long pages. Their stronger pages make the product visible earlier and let a single outcome organize the sections. Shoutrrr's useful lesson is architectural as much as visual: normalize post content once, then send it through format-aware platform preview renderers.

## What works

1. **Trustworthy specificity.** OpenPost names provider limitations, approval states, sources, update dates, and self-hosting tradeoffs. This is more credible than generic “all networks, one click” copy.
2. **A real product model.** Publications, destinations, managed/self-hosted operation, and provider capabilities are tangible. There is enough differentiated material for an excellent site once it is ordered.
3. **A disciplined implementation.** Shared marketing components, semantic headings, zero missing image alt attributes on inspected pages, and clean Svelte autofixer results provide a strong base for a redesign rather than a rebuild.

## Priority issues

### P1 — The home page has no single dominant buyer story

**What:** The hero leads with agent-oriented language, then the page repeatedly re-explains agent control, provider readiness, safety, deployment, pricing, and self-hosting. There are 11 major sections and 1,756 body words.

**Why it matters:** A first-time creator or social manager must infer what OpenPost helps them do before deciding whether agent support or self-hosting matters. The cognitive-load review failed 4 of 8 checks: chunking, minimal choices, working-memory demand, and progressive disclosure.

**Fix:** Lead with the everyday outcome: create once, tailor and preview each destination, then publish or schedule with confidence. Put a real composer-to-preview product demonstration in the first viewport. Reduce the page to roughly six narrative beats; move agent operation, deployment detail, the full provider matrix, and deep trust material to secondary pages or expandable sections.

**Suggested command:** `/distill`, followed by `/shape`.

### P1 — Desktop comparison structures are being compressed into phone browsing

**What:** Pricing and provider tables retain desktop-width geometry inside horizontal wrappers. The pricing table is about 928px wide inside roughly 341px of phone content; the provider matrix is about 1,152px wide. The pages avoid document-level overflow, but users must pan and remember row/column context.

**Why it matters:** Mobile visitors cannot compare plans or capabilities at a glance. The phone pricing page is about 6,459px tall before the visitor also encounters a wide comparison table.

**Fix:** Replace phone tables with question-led accordions or one-plan/one-platform comparison cards; preserve tables at content-safe breakpoints. Add visible scroll cues only where a table remains necessary. Review all interactive targets for a 44px touch area or sufficient inline spacing.

**Suggested command:** `/adapt`.

### P2 — Too many equal-weight choices weaken orientation

**What:** The main navigation exposes eight destinations/actions, pricing shows five equal plan cards, tools shows seven equal cards, compare shows six equal comparisons, and the footer contains more than 30 links. The active navigation location is not marked.

**Why it matters:** These are catalogs, not decisions. Visitors must inspect every option to understand which path applies to them.

**Fix:** Use four primary nav groups: Product, Pricing, Free tools, and Resources, with Docs and the main CTA separate. Group pricing around buyer stages and reveal plan detail progressively. Rank tools by direct product relevance. Keep platform and comparison detail pages for search and evaluation without making both indexes primary navigation choices.

**Suggested command:** `/layout` and `/clarify`.

### P2 — Preview is a marketing promise but not yet a shared product capability

**What:** OpenPost already has custom visual branches for X, Mastodon, Bluesky, LinkedIn, Threads, Instagram, Facebook, YouTube, and TikTok, plus a generic fallback. The free preview tool supports only six platforms and a single image. The in-app account menu offers customize/resync but no preview. The render model does not express output format, polls, link or quote cards, content warnings, carousels, stories, reels, Shorts, or provider settings.

**Why it matters:** The best product proof is disconnected from the actual authoring flow, and the free tool understates OpenPost's supported destinations. A second implementation would create drift.

**Fix:** Build one normalized, format-aware preview model and provider registry that both the marketing tool and authenticated app consume. Map current composer/publication state and provider-specific settings into that model. Add “Preview [account]” to each selected destination's three-dot menu and open a noindex standalone preview in a new tab. Label previews as approximate because provider interfaces can change.

**Suggested command:** `/shape`.

### P2 — The visual language is consistent but too repetitive and public theming is incomplete

**What:** Dark panels, rounded borders, eyebrows, orange buttons, grids, and tables repeat across the home, pricing, security, platform, and tool pages. The design context says light and dark are equally important, while the public experience is effectively a hard-coded dark technology aesthetic.

**Why it matters:** Repetition makes distinct ideas feel equivalent and increases perceived clutter. The developer-tool mood is narrower than the creator, social-manager, and agency audience.

**Fix:** Keep the warm orange and neutral brand, but give product imagery, typography, and whitespace more responsibility than container chrome. Use fewer framed cards, vary section composition by content, support the intended light/dark behavior, and reserve dense technical surfaces for trust and documentation pages.

**Suggested command:** `/quieter`, `/typeset`, then `/polish`.

## Persona red flags

**Jordan, first-time social manager:** The hero asks Jordan to understand an agent boundary before showing the familiar job of composing and adapting a post. Eight header choices, provider terminology, and no active-nav state increase uncertainty. Jordan is likely to scroll past useful proof while looking for a simple “what does this replace?” answer.

**Riley, evidence-seeking operator:** Riley values the dated sources, approval caveats, and self-host details. However, healthy “Available” states create noise, changelog content can make the site feel stale when not current, and legal reading pages end with the same conversion-oriented chrome instead of a focused reading mode.

**Casey, phone-first creator:** Casey receives a roughly 17,700px home page, a five-plan vertical stack, horizontally panned comparisons, and a free character-counter task that begins well below a large marketing hero. The tool's value is delayed by the page selling itself before permitting the task.

## Minor observations

- The home hero has three competing actions; one primary and one secondary are enough.
- Long workflow and FAQ lines should be constrained to a more readable measure.
- Small orange labels at 4.3:1 need either stronger contrast, larger type, or a non-text decorative role.
- The public tools should put the task above promotional copy and carry results into a draft or schedule flow.
- Legal pages should use a reading-first shell without a large sales hero.
- Healthy provider state should remain quiet; show only setup, degraded, unsupported, approval-dependent, or planned conditions.
- The footer should be grouped around user tasks rather than exposing the full route inventory at equal weight.
