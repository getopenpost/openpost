---
target: current AI-native post composer on the web
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-08-27T14-53-57Z
slug: ontend-src-lib-components-compose-text-post-svelte
---
⚠️ DEGRADED: single-context (Paseo delegation was not authorized for this review)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Autosave and disabled states work, but saved state is easy to miss. |
| 2 | Match System / Real World | 2 | The first writing aid is framed like AI help but is a canned prompt and example. |
| 3 | User Control and Freedom | 3 | Draft recovery, cancel paths, and destructive confirmation are solid. |
| 4 | Consistency and Standards | 3 | Shared primitives are consistent, though mobile action density breaks the pattern. |
| 5 | Error Prevention | 2 | Provider limits and disabled actions help, but applying a near-limit template with a placeholder creates a new error path. |
| 6 | Recognition Rather Than Recall | 2 | Core writing is visible, but AI, next-slot behavior, and several icon-only actions are not self-explanatory. |
| 7 | Flexibility and Efficiency | 2 | Paste, drag, autosave, and threads help; there is no fast AI transformation path on web. |
| 8 | Aesthetic and Minimalist Design | 2 | The canvas is visually quiet, but onboarding dominates it and utility surfaces expose too many peers. |
| 9 | Error Recovery | 3 | Toast retries, upload recovery, and draft persistence are strong. |
| 10 | Help and Documentation | 2 | Setup guidance exists, but writing and AI help are not contextual to the user's idea. |
| **Total** | | **24/40** | **Acceptable, with significant UX work needed** |

## Design Specificity Verdict

The shell feels like OpenPost: warm neutrals, restrained orange, calendar context, durable drafts, and publishing truth. The composer itself is category-interchangeable. Its center is a generic textarea with scheduling controls, and its only apparent writing assistance is a random stored prompt. The product has a typed `/post-builder/generate` contract, but the frontend contains no call to it.

The deterministic scan found one advisory in `frontend/src/lib/components/compose-text-post.svelte:5569`: a `999px` scrollbar-thumb radius outside the documented scale. This is a false positive. A pill radius is appropriate for a scrollbar thumb and has no meaningful UX impact.

No live overlay was produced because the browser evaluation surface rejected DOM mutation. Browser evidence instead came from settled screenshots, DOM snapshots, responsive width checks, interaction testing, and console logs.

## Overall Impression

The composer is a capable scheduler with a clean writing surface, but it is not an AI-native creation flow. The biggest opportunity is to make the user's idea the single starting point, then let AI turn it into a reviewed source post and destination renditions without making setup, settings, or scheduling compete for attention.

## What's Working

- Autosave is real and fast. Applying a prompt created a durable draft immediately, the draft appeared in navigation, and turning it into a thread persisted without friction.
- Publishing truth is respected. Character limits, disabled publish states, provider settings, destination overrides, retry paths, and schedule timezone copy are explicit.
- The responsive foundation is sound. There was no body-level horizontal overflow at 390px or 320px, light and dark themes both rendered, touch targets are generally large, and the tested flow produced no console warnings or errors.

## Cognitive Load

High: 6 of 8 checks fail.

- Single focus fails because onboarding, scheduling, publishing, settings, and writing compete in the first viewport.
- Chunking fails in the mobile media picker, which presents Library, Device, Camera, Stock media, Meme, Create, and Create video as peers.
- Visual hierarchy fails because the setup card outranks the writing canvas.
- One thing at a time fails because setup and delivery decisions appear before the idea is shaped.
- Minimal choices fails in media and scheduling utility surfaces.
- Progressive disclosure fails because secondary delivery controls are visible before content exists.
- Grouping and working-memory support are mostly sound.

## Emotional Journey

The first screen begins with a warning-shaped setup task, not creative momentum. The writing canvas looks faint and unfinished. Clicking the lightbulb creates a brief peak, but the reveal is a canned template. Applying it fills 272 of 280 characters and leaves `[answer in comments]` in the post, which turns help into cleanup work. Autosave provides reassurance, but there is no satisfying AI result, comparison, or review moment before the disabled publishing controls.

## Priority Issues

### [P1] The web composer is not AI-native

**Why it matters:** The expected loop is idea to strong post to channel-specific variants. Web currently offers a random prompt and automatic media alt text, while the actual post-builder API is unused.

**Fix:** Make the initial state a clear idea textarea with one primary `Build with AI` action and a quiet `Write it myself` path. Generate the canonical source plus selected Social Set renditions, then keep the user in review mode. Never schedule as part of generation.

**Suggested command:** `$impeccable shape`

### [P1] Setup guidance visually buries the primary task

**Why it matters:** At 390px and 320px, the setup card consumes almost the full first viewport. Desktop also gives it more weight than the composer. A founder cannot start with their idea even though the system technically permits it.

**Fix:** Collapse setup into a compact inline status near destination selection. Let users draft and run AI before connecting accounts. Ask for destinations only when renditions, queueing, or publishing require them.

**Suggested command:** `$impeccable distill`

### [P1] Mobile controls stop being simple at narrow widths

**Why it matters:** At 320px, the schedule split action visually collides with `Publish Now`. The media source rail clips after Camera with no clear scroll cue. These are the exact widths where users need fewer decisions and clearer thumb targets.

**Fix:** Use one sticky primary delivery action with a small menu for `Queue next slot`, `Schedule`, and `Publish now`. Reduce media entry to `Library` and `Device` first, then group Camera, Stock, Meme, and editors under `Create`.

**Suggested command:** `$impeccable adapt`

### [P2] Inspiration inserts a finished-looking template verbatim

**Why it matters:** The example nearly exhausts the X limit and contains an unresolved placeholder. Users may publish generic or incomplete text because the interface labels insertion as help.

**Fix:** Treat prompts as idea starters. Generate from the user's context, show the result as a proposal, preserve their original idea, and offer `Replace`, `Insert below`, and `Try again`.

**Suggested command:** `$impeccable clarify`

### [P2] Secondary utility surfaces expose too many peer choices

**Why it matters:** `Post settings` opens a full sheet for one repost section. The media picker exposes seven source or creation choices. The schedule dialog offers natural language, three quick choices, a calendar, a long time grid, randomization, and three footer actions.

**Fix:** Keep common actions direct and progressively disclose advanced delivery behavior. Fold the one-section settings sheet into an overflow menu until it has enough content to justify a page or sheet.

**Suggested command:** `$impeccable distill`

## Persona Red Flags

**Solo founder:** They arrive with one rough idea and expect OpenPost to do the repeat work. Instead, destination setup dominates the screen and the writing aid inserts a generic scenario unrelated to their work.

**Jordan, first-timer:** The lightbulb, slider icon, split schedule arrow, `Publication`, and disabled delivery buttons require interpretation. There is no clear statement that writing is safe before connecting an account.

**Casey, distracted mobile user:** The first viewport is mostly setup guidance. At 320px, delivery actions crowd each other and media sources disappear off the right edge. The actual post begins below multiple layers of chrome.

## Minor Observations

- `Post settings` is too broad a label for a sheet containing only repost behavior.
- The empty desktop canvas is so visually faint that it reads as inactive.
- `Schedule`, a next-slot icon, and `Publish Now` create three delivery decisions before the post is ready.
- The media picker says `0 of 35 selected` while the upload card says `Up to 10 files`; even if technically correct, the distinction is unexplained.
- The component is 5,578 lines. That is not itself a UX defect, but the growing number of conditions is visibly leaking into the control hierarchy.

## Questions to Consider

- What if the entire first viewport contained only the idea, selected Social Set, and one AI action?
- What delivery decision does a user truly need before the post exists?
- Should `Need inspiration?` survive once the composer can build from an actual idea?
- Would users understand one `Queue` action with scheduling options better than three adjacent delivery controls?
