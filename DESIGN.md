---
name: OpenPost
description: Calm publishing workspace with one warm accent, a dithered signature, semantic themes, and uniform shared chrome.
colors:
  primary: "oklch(0.45 0.125 45)"
  primary-dark-theme: "oklch(0.76 0.115 45)"
  canvas: "oklch(0.993 0.0015 80)"
  canvas-dark: "oklch(0.175 0.005 80)"
  surface: "oklch(1 0 0)"
  surface-dark: "oklch(0.205 0.005 80)"
  ink: "oklch(0.24 0.008 80)"
  ink-dark: "oklch(0.95 0.004 80)"
  muted-ink: "oklch(0.47 0.01 80)"
  muted-ink-dark: "oklch(0.75 0.007 80)"
  border: "oklch(0.915 0.004 80)"
  border-dark: "oklch(0.3 0.006 80)"
  danger: "oklch(0.53 0.19 25)"
  danger-dark: "oklch(0.66 0.19 25)"
  success-ink: "oklch(0.37 0.09 155)"
  success-ink-dark: "oklch(0.82 0.11 155)"
typography:
  wordmark:
    fontFamily: "Manrope Variable, Manrope, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
  display:
    fontFamily: "Manrope Variable, Manrope, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 7vw, 3.75rem)"
    fontWeight: 600
    lineHeight: 1.04
    letterSpacing: "-0.025em"
  app-title:
    fontFamily: "Manrope Variable, Manrope, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Manrope Variable, Manrope, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  metadata:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.5
  docs-table:
    fontFamily: "system-ui, sans-serif"
    fontSize: "0.92rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "0.5rem"
  md: "0.625rem"
  lg: "0.75rem"
  media: "0.875rem"
  xl: "1rem"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
  2xl: "2rem"
  3xl: "3rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 0.75rem"
    height: "2.25rem"
  input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 0.75rem"
    height: "2.25rem"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "1rem"
---

# Design System: OpenPost

## Overview

**Default authenticated app theme: Calm. Public entry pages and anonymous profiles use Calm too. Marketing keeps its original public palette with Dither texture. Recovery and documentation theme: Workshop.**

`docs/specs/calm-ux.md` is the binding contract for shared grammar and navigation. Where this document and that contract differ, the contract wins.

OpenPost is a calm working environment for solo founders and creators who do not want to waste time, and it must still work for small teams and agencies. Each screen answers one question. Organizations without saved theme settings start with Calm: near-white paper or soft charcoal, Manrope, soft dividers, and one warm accent. Dither is the signature material that ties the product together, on focal and primary actions, charts, progress, skeletons, empty states, and brand moments. Saved organization and workspace choices take precedence. Dither and Dither Moss remain selectable themes. Marketing preserves its green, blue, and lilac public palette, with Dither as a restrained visual effect. Workshop remains the complete fallback and documentation reference.

The authenticated app stays focused and predictable. Marketing keeps its spacious public layout, colorful authored panels, shared neutral controls, and sparse Dither texture. Documentation uses Fumadocs with separate Guides, Self-hosting, and API reference navigation, sharing the product palette, assets, and direct voice. Every built-in family supports its declared schemes completely. When a family does not support the effective scheme, the complete Workshop scheme renders instead. Themes never mix token fragments.

**Key Characteristics:**

- Calm working layouts across theme families, with one job per screen.
- Thin structural borders and tonal layers instead of decorative shadows.
- One filled accent action per screen, carrying the dither signature. Selected navigation and view states are neutral. Semantic colors preserve status meaning.
- Compact app hierarchy with more spacious public and reading surfaces.
- Consistent page, loading, empty, notice, toast, and destructive patterns.

## Identity

The Converge symbol is the canonical OpenPost mark. Four equal rounded modules face one centered opening, expressing one workspace publishing outward. Preserve the exact supplied geometry: four-fold symmetry, even axis gaps, and a square footprint that remains legible at 16px. Do not redraw it as a pen, star, flower, window, or generic app grid.

Use the standalone mark when “OpenPost” is already written beside it or space is compact. Use the supplied outlined Manrope Semibold lockup for README, brand references, and static compositions that need the complete name. Transparent public marks use burnt orange `#B45309` on light backgrounds and peach-orange `#FD975D` on dark backgrounds. Public components use `ThemeImage` to follow the visitor's appearance choice; the authenticated app mark follows the active theme's `--action-focal` role. On Workshop Orange, use the reversed white lockup. “Your socials, on steroids.” is the approved brand headline; it is optional, never mandatory UI chrome.

README lockups keep the exact outlined wordmark and three solid Converge modules, while the bottom-left module dissolves outward and down-left through sparse square transparent gaps. The light and dark assets use the paired public mark colors; reversed and background-backed artwork keeps its existing treatment.

## Colors

The frontmatter tokens define Calm, the default app theme, owned by `packages/ui/src/lib/themes/builtins/calm.ts`. Neutrals carry the interface and the warm accent stays scarce. The named colors below belong to Workshop, the complete fallback and documentation reference. Dither's palette is in `packages/ui/src/lib/themes/builtins/dither.ts`. Custom themes replace complete semantic roles rather than overriding isolated CSS values.

### Primary

- **Workshop Orange** (`#B74C05`; `primary`, `primary-dark-theme`): Primary actions, active destinations, focus accents, short identity lines, the Converge symbol, and selected navigation.

### Neutral

- **Warm Canvas** (`canvas`, `canvas-dark`): Page backgrounds and the base reading field.
- **Clean Surface** (`surface`, `surface-dark`): Cards, popovers, menus, and elevated tonal regions.
- **Carbon Ink** (`#302B28`; `ink`, `ink-dark`): Primary text and high-confidence icons.
- **Toolmark Gray** (`muted-ink`, `muted-ink-dark`): Supporting text, metadata, placeholders, and inactive navigation.
- **Hairline Warmth** (`border`, `border-dark`): Dividers, control boundaries, and low-contrast structure.
- **Failure Red** (`danger`, `danger-dark`): Destructive actions and genuine error state only.
- **Success Green** (`success-ink`, `success-ink-dark`): Confirmed success text and icons.

**The One Signal Rule.** The accent marks the next action, not decoration. In Calm, focal and primary share it, so a screen never shows two competing fills, and selected navigation uses neutral `navigation-active`. Every theme assigns the same semantic jobs to its own action, focus, and selection roles.

**The Complete Scheme Rule.** A supported scheme is incomplete until its contrast, borders, hover state, focus state, reduced-motion behavior, and browser surfaces work together. A single-scheme family is valid, but its unsupported scheme must fall back to complete Workshop rather than improvise an inversion.

## Public surfaces

Marketing keeps its warm public canvas, protected identity, green, blue, and lilac authored sections, and original shared button colors in both schemes. Sparse Dither texture is an effect layer on the landing tour, authored panels, resources, and primary CTA surfaces. Texture does not replace the public palette or change button backgrounds and foregrounds.

Dithered buttons use the same two-color Bayer treatment in the app, marketing, docs, and README. Use solid color at each end with a Bayer transition between them. Use a 16% label-ink tint by default and keep the cells at 2 CSS pixels. Native theme controls resolve a fixed ink and opacity around that default when an authored palette needs contrast correction. The texture pair stays between 1.18:1 and 1.8:1 contrast, a visual consistency range rather than an accessibility threshold. Text must meet 4.5:1 against both colors. Hover, focus, and press change coverage without increasing tint strength. Keep disabled buttons plain and hide decoration in forced-color mode. Dither and Workshop recovery focal actions stay flat, without a raised bottom edge.

The public palette lives in `apps/marketing/src/routes/layout.css`. Paired `marketing-lilac`, `marketing-mint`, and `marketing-blue` surface and ink tokens distinguish authored examples, editor panels, and the tour. `marketing-soft-ink` supports secondary display text; `marketing-section` separates neutral sections. Each role has a deliberate light and dark value. These tokens belong to public compositions and do not change organization themes or authenticated app chrome.

The landing page opens with a zoomable product tour using raw 2x screenshots, without the README frame or shadow. Later sections layer focused crops of actual editing, calendar, and analytics controls instead of repeating full app windows. Use colored panels and a tools-and-resources grid with concise copy. Keep trial terms and channel availability next to signup actions. Show only sourced testimonials. Label illustrative channel posts as examples and keep product-tour videos linked rather than embedded.

The shared marketing footer places a decorative ASCII OpenPost wordmark above the brand and link rows on mint. A paper-plane illustration overlaps the section above it. Keep link rows compact while preserving 44px coarse-pointer targets. Pointer movement changes the wordmark's characters; reduced motion keeps them still.

Feature artwork lives in `assets/brand/features/` for the README, public feature sections, and existing customer guides. Use large, recognizable feature silhouettes on transparent backgrounds, without a Converge frame or enclosing tile. Keep square dithering sparse so the silhouette reads at 24px. Colors draw from the green, orange, yellow, and blue badge palette, with enough contrast in both schemes. Application page titles, navigation, editor entry points, and controls use the theme icon system, without feature artwork. The Converge brand mark remains protected. Distribute public artwork through `scripts/asset-surfaces.ts`.

The screenshot tour distributes its selectors across the preview width, wrapping on mobile, with a filling underline for the active view. Advance every five seconds while visible; pause on hover or keyboard focus and provide an explicit pause/play control. Reduced motion disables autoplay. Essential copy, signup links, screenshots, the product-tour link, and FAQ answers remain available without JavaScript. Keep preview and zoom controls accessible by keyboard.

Documentation uses a quiet reading layout with a compact icon sidebar, persistent section navigation, and an optional table of contents. Guides lead with an action and keep body text to a readable measure. The homepage points straight to a first publication. Endpoint pages stay in the API section with generated examples and schemas. Workshop neutrals support both schemes; orange marks links, focus, and current navigation.

## Theme contract

Organization themes are versioned visual documents. They may control semantic colors, approved typography, density, spacing, shape, elevation, motion, shell recipes, component recipes, one complete icon pack, and decorative assets. They cannot change product structure, permissions, copy, data, provider truth, or app identity. App branding is a separate organization setting with policy-controlled workspace overrides; see `docs/development/app-branding.md`.

- Components declare intent such as `focal`, `primary`, `ordinary`, `quiet`, `destructive`, or `link`. They do not choose a brand color or theme family.
- `chart1` through `chart5` are categorical data colors. Every supported scheme keeps all five chromatic and visibly distinct against its chart surfaces; neutral gray is reserved for the aggregated "other" series. Charts also expose labels or tooltips so color is never the only identifier.
- Published revisions and built-in versions are complete and immutable. Drafts may be incomplete while editing, but runtime output may not.
- Web and native consume the same resolved semantic contract through platform renderers. Neither client reconstructs organization defaults, workspace overrides, locks, revisions, or fallback.
- Workspace name, avatar, and color remain workspace identity. The default Converge mark keeps its geometry and follows the active theme's focal color in the app. Explicit app-branding images keep their uploaded colors, aspect ratio, and light/dark variants. Provider marks, status meaning, media, and specialized editor glyphs retain their protected colors or geometry.
- Protected editor roles follow the active light or dark scheme. Protection preserves contrast, signal meaning, and authored output. It does not force dark chrome inside a light theme.
- Uploaded fonts are local static WOFF2 resources. The backend derives a validated TTF or OTF copy for native clients. Remote font and asset URLs are not theme values.
- Theme application is atomic. Fonts, icons, assets, and tokens are staged before one complete presentation replaces the prior workspace presentation.

## Typography

**Calm Font:** Manrope Variable for the wordmark, display, titles, and interface text, with system sans fallbacks. It carries Cyrillic; Japanese, Korean, and Chinese use system fallbacks.

**Workshop Font:** Geist Variable.

**Label/Mono Font:** the platform UI monospace stack

**Character:** Manrope is friendly and softly rounded, matching the Converge mark. Other families may select an approved local type recipe, while the app-scale hierarchy and readable measure stay fixed. Monospace is a functional accent for identifiers, timestamps, counts, tokens, handles, and queue data; it is not a general "technical" costume.

**Size floor:** `text-sm` (14px) is for controls and body; `text-xs` is 13px and the minimum outside editors. Editors set `data-density="editor"` and keep a 12px `text-xs`. Avoid arbitrary sizes under 13px outside editors. Use sentence case, not uppercase tracked labels.

### Hierarchy

- **Wordmark** (`wordmark`): The resolved app display name beside its mark, defaulting to OpenPost and Converge, set at Semibold with restrained negative tracking.
- **Display** (`display`): Public hero and major campaign headings, with strong contrast and tight tracking.
- **App title** (`app-title`): Authenticated route `h1` headings through the shared page header.
- **Body** (`body`): Controls, app copy, descriptions, and most supporting text; long prose should stay near 65–75 characters per line.
- **Metadata** (`metadata`): Compact operational values whose shape matters, including IDs, counts, timestamps, and status details.
- **Docs table** (`docs-table`): A slightly enlarged reading step for dense reference tables.

**The Task Scale Rule.** App headings stay at the shared application scale. Large display typography belongs to persuasive or reading surfaces, not routine settings and workflow pages.

**The Data Earns Mono Rule.** Use monospace only when character alignment or literal values improve comprehension.

## Layout

The app uses a centered content column up to 68rem in Calm (72rem in Workshop) with 1rem mobile gutters, 1.5rem tablet gutters, and 2rem large-screen gutters. Theme density may adjust bounded internal gaps, but it cannot remove safe gutters or change route structure. Shared page containers establish the route rhythm. Page headers switch from stacked to split action layout through a 44rem container query so they respond to available content width rather than the viewport alone.

Public pages use a wider 78rem frame and larger responsive section spacing. Documentation keeps a reading-first column and conventional sidebar. Mobile app navigation respects safe-area insets, labels every tab, keeps New distinct, and leaves enough bottom clearance for content. Coarse-pointer controls have a minimum 44px target.

Use the established 4px spacing family, but vary it by hierarchy: tight within controls and metadata groups, moderate within sections, generous between major public-page ideas. Prefer `gap` for sibling relationships.

### OpenPost Image Editor

OpenPost Image Editor is an immersive, task-specific workspace inside OpenPost rather than a general design product. Its chrome uses the resolved semantic theme. The central pasteboard, page boundary, selection handles, transparency grid, and direct-manipulation glyphs use protected editor roles so authored work remains legible in every theme.

Desktop uses one header row with the File, Edit, Layer, Select, Tools, View, and Help menus inline beside the title, an eight-slot tool rail (Add, Select, Crop, Text, Shape, Draw, Eyedropper, View), an asset pane, one active canvas, Layers and Properties panes, and an ordered page strip. Save state is a quiet icon with a tooltip; agent connection is a dot on the assistant button. Rulers default off. Layer eye and lock controls appear on hover or focus, or when active, and always on coarse pointers. Properties keeps text content and formatting together, with Transform, Layer, and Effects collapsed after them. Each persistent side or bottom pane has an accessible resize seam and a stable reset size. Phones use the same document model with a short top bar, a horizontal bottom tool rail, one contextual sheet at a time, a full-height Layers sheet, a non-modal Properties sheet that leaves the canvas visible and interactive, and a collapsible page strip. Coarse-pointer actions remain at least 44px. Two-finger input pans or zooms the canvas; one-finger input transforms the selected layer.

Each tool family uses one rail button with an internal corner indicator. A click activates the remembered variant; clicking the active tool, right-clicking, or pressing ArrowDown or ArrowRight opens its attached menu. Do not add a separate narrow chevron target beside the rail. Expanded pages occupy the ordered thumbnail strip; collapsed pages use its compact status row. Tool options stay in one scrollable row, with essential actions first, so wrapping controls cannot expand across the artwork. The narrow-screen More menu uses the same command registry as desktop menus. Color keeps a live canvas above its non-modal control dock on phones. Desktop Color uses a compact Layers pane so grading controls receive the available height; Edit and Color retain separate pane sizes.

The DOM-based Layers tree and Properties controls are the accessible equivalents of direct canvas editing. Every persistent change runs through the command system, exposes undo and redo, and announces saves, conflicts, exports, uploads, camera state, and background-removal state. OpenPost Image Editor uses a scoped theme runtime; it does not copy another editor's CSS, generated utilities, or trade dress.

### OpenPost Video Editor

OpenPost Video Editor uses a four-zone editing model: one quiet header row at the top, where the project title opens its details and save state is an icon, a fixed tool rail with one full-height content pane on the left, one dominant preview in the center, and selection-specific inspector tabs on the right. The timeline begins beside the left content pane and owns playback position; its ruler is the seek control, so a second progress slider must not compete with it. Each persistent side or bottom pane has an accessible resize seam and a stable reset size. Semantic selection and focal roles mark the active family, property tab, playhead, and Export action. Waveforms, timeline state, canvas bounds, and media keep protected editor roles.

Editors share `editor-header.svelte`, and their start pages return to Studio. Recorder is one centered setup card with secondary settings under More options. Quick Cut keeps one source row above the preview, with mark, remove, keep, loop, and zoom in the transport row and Find clips in Cleanup. Placement hints appear inline in the timeline status during an active placement, never as floating coachmarks. Keep inspector settings contextual. Selection exposes Properties, Animation, Effects, and Transcript only where applicable. Properties leads with content, geometry, and audio gain; anchor, appearance, crop, playback, pitch, and advanced audio settings use named disclosures. Mark modified appearance, crop, and playback groups so their state remains visible when closed. Scene detection belongs in selected-clip actions. Phones replace both side panels with one bottom tool dock and one contextual sheet while preserving the same timeline and project document. Quick Cut remains the explicit stream-copy path and Full Editor remains the composed edit path.

Video Editor property diamonds add or remove a key at the playhead. Fill the diamond only at an authored key, and keep animated properties accented between keys. Auto-key is a separate mode. Capture values before expressions and additive motion, in the property lane's units; inspectors display the current animated value and edit through the timeline actions.

Color gives its viewer and one active grading palette priority. Primaries, Curves, Qualifier, Windows, LUT, and Effects share the same named Clip or Sequence target. Keyframes replaces the active palette until closed. Scopes are optional; specialized effect filters only change which controls are shown. Keep comparison and auto-key controls available across palettes. Compact controls must remain complete at laptop sizes, with secondary settings disclosed or internally scrollable. Palette, scopes and Keyframes visibility persist per device as view state, never authored project data. Hidden scopes stop sampling; explicit color picking and Auto Balance can still capture a frame.

Playback stays direct in the preview bar; frame capture and in/out commands live in its always-available actions menu. Transcript setup leads with language and the captions action, keeps download size visible, and discloses engine settings and model storage. Existing transcripts keep generation setup collapsed; running jobs and errors stay visible. Canvas format presets change dimensions together through the existing undo owner, preserving frame rate and authored layer geometry.

Selected-object inspectors lead with the editable content. Text starts with words and font, while geometry and advanced settings follow. Corner pin stays closed unless active. Motion puts selected-layer controls before composition setup and applied animation before preset browsing. Text styles can apply to the selected text without inserting another item; the browser must show which operation its controls perform.

Shader backgrounds and image or logo effects use the existing searchable galleries. Tiles pair rendered thumbnails with short names and representative sample artwork. Gallery preview settings stay separate from authored defaults. Reuse shared inspector controls and show only settings relevant to the selected shader. Animated families follow sequence time, with speed and starting phase controls; zero speed holds a still frame. Static families omit motion controls.

Keep editor copy quiet. Use short labels, values, and direct actions in the default workspace; do not repeat the active tool as a panel heading or add routine reassurance below self-explanatory controls. Reserve inline prose for errors, permissions, destructive consequences, required attribution, and limitations that change what the creator can do. Put optional technical detail in a tooltip or disclosure.

Editor panes must shrink within the window and scroll their own content. On phones, Assets uses the full area above the timeline; Program restores the preview. Timeline marker details, mixer, and beat controls share a bounded scrolling area that leaves the tracks and overview reachable.

Fade handles appear only on selected, editable clips. New generated captions and imported subtitles start above video in compact rows. Track names expose a drag grip; reordering previews locally, commits once on drop, and cancels with Escape. Keyboard reordering remains available.

Video clips retain embedded audio by default. Detach audio in the clip menu creates a linked audio row and silences the video's embedded audio. Link and unlink control editing together, independently of which clip plays the sound. Recordings keep microphone audio with the camera, or with the screen when the camera is off.

The timeline uses a hybrid track model. The ordered primary sequence and project-wide markers remain semantic rails. Visual, audio, and caption rows render from the document's actual track arrays, so multiple tracks stay distinct and empty categories do not consume permanent lanes. Items on one track cannot overlap unless an explicit transition owns the shared interval; use another track for intentional compositing.

## Elevation & Depth

Workshop is flat by default. Its surfaces separate through warm tonal changes, hairline borders, and restrained rings. Other families may select a bounded elevation recipe, but resting hierarchy must remain clear and temporary layers must remain distinguishable.

Modal backdrops darken the page in both schemes. Keep the scrim independent of text colors so dark mode never turns it white.

### Shadow Vocabulary

- **Focal action:** a small, low-blur shadow that keeps a floating or circular primary action legible over content.
- **Temporary layer:** a restrained menu or dialog shadow paired with a clear border.

**The Legible Depth Rule.** A resting surface proves its hierarchy through a coherent combination of tone, border, spacing, or elevation. Themes must not stack unrelated depth cues or let decoration obscure focus and state.

## Shapes

Workshop uses a 12px base corner, 10px controls, 12px cards, and 14–16px prominent media. Theme recipes may vary bounded control and container shapes while keeping hit targets and state legible. Pills and full circles remain intentional shapes for compact controls, statuses, avatars, and focal actions, not a universal card treatment.

## Components

### Dither material

Dither is OpenPost's signature and the one texture across the product. Never remove it from the surfaces below without an explicit brand decision.

Calm applies it to focal and primary buttons, chart fills, progress, skeletons, empty-state halos, and brand moments such as the Home greeting. Ordinary and quiet buttons stay plain so secondary actions never look disabled, and tool buttons inside editors stay plain. Its focal accent is `oklch(0.45 0.125 45)` in light and `oklch(0.76 0.115 45)` in dark, which keeps text at 4.5:1 over the texture. The Dither theme itself pairs orange-brown actions at hue 45 with warm paper or charcoal and Geist, and textures ordinary buttons too. Dither Moss uses green actions, warm neutrals, DM Sans, and tonal navigation.

Ordered Bayer textures sit behind button labels, along card bottoms, inside chart bars, and over shared skeletons and progress fills. Text, focus rings, and chart value boundaries stay solid. Charts retain semantic series colors, labels, and keyboard interaction. Forced-colors mode removes visible decoration. Native clients use the same palette and shape tokens with the shared Bayer renderer.

Shared empty states place a static dithered halo in a 120px by 64px symbol area behind a solid 40px icon tile. The field is decorative and hidden from assistive technology. Progress meters use the theme's small corner radius, while loading previews use the real Skeleton and ProgressMeter components. Existing reduced-motion behavior stays intact.

`@openpost/dither` owns the Bayer thresholds, native-resolution SVG masks, and DOM lifecycle for Svelte and React. Every surface uses 2 CSS pixel cells. Buttons raise density on hover, keyboard focus, and press while keeping their two colors fixed; animation stops when settled and snaps with reduced motion. Preserve the Dither Kit source attribution in the package `NOTICE.md`. Marketing panels and the documentation app link share this renderer while retaining their palettes. Native filled actions and icon buttons use the DOM-free `@openpost/dither/paint` renderer, with 2-point Bayer cells, 160ms interaction transitions, and no idle animation. Native material endpoints stay between 1.18:1 and 1.8:1, with labels at 4.5:1 across rest and press.

Native content sections sit directly on the canvas, separated by spacing or a hairline. Reserve framed surfaces for isolated states, previews, and attachments. The native calendar pairs a compact month with the selected day’s time-ordered agenda. Month controls stack on narrow screens and at larger text sizes. The seven-column date grid keeps targets at least 44 points and scrolls horizontally when the width or enlarged text needs it; primary actions retain 48-point targets. Native tabs share a compact brand and workspace header without repeated page titles or introductory copy. Capture, writing, and chart panels carry static Bayer texture. iOS display text lets Dynamic Type choose the line box at enlarged sizes.

Dither buttons ease their pixel gradient on hover, keyboard focus, and press. Chart inspection emphasizes the selected day while preserving solid value boundaries and readable series labels. Tooltips stay within the visible chart viewport and dismiss with Escape. Motion uses the shared theme timings and reduced-motion rules.

The theme editor offers a coordinated Dither accent hue for both schemes, plus color pickers beside the CSS values for individual tokens. The hue control retains the palette's lightness, neutral surfaces, status colors, and distinct chart series. Color pickers preserve each token's existing opacity, and swatches display it. Edit opacity directly in the adjacent CSS value. Changes use the existing draft, undo, publish, and assignment flow. The Dither gradient component supports horizontal and vertical fades, with an optional second color.

Custom Dither button recipes must meet the text and texture contrast ranges in every interaction state. Stored palettes remain available for editing when decorative contrast rules tighten; imports, saves, and publishing enforce the current range. Theme previews block interaction with `inert` so sample controls retain their normal appearance.

### Buttons

- **Shape:** Compact medium corners with a 36px desktop height and 44px coarse-pointer target.
- **Focal:** The strongest theme action treatment, used for one clear next action on a screen. The sidebar New post counts, so most pages use outline or ghost for their own actions.
- **Primary / Ordinary / Quiet:** Decrease emphasis without changing the action's meaning. A neutral ordinary action must remain distinct from a focal action.
- **Hover / Focus:** Use the theme's complete state recipe, retain a visible semantic focus ring, and keep motion compatible with reduced-motion preferences.
- **Secondary / Outline / Ghost:** Use tonal fill, a full hairline border, or hover-only fill according to hierarchy. Destructive buttons use a quiet red tint until interaction.

### Chips

- **Style:** Compact medium corners, secondary tonal fill, full border only when needed for separation, and short labels.
- **State:** Selected chips use semantic foreground contrast and a meaningful state change rather than color alone.

### Cards / Containers

- **Corner Style:** Gently rounded large corners.
- **Background:** Clean Surface over Warm Canvas.
- **Shadow Strategy:** Flat at rest; use a subtle full ring or border for structure.
- **Internal Padding:** Usually 12–16px, increasing only when the content hierarchy needs it.

### Inputs / Fields

- **Style:** 36px standard height, medium corners, full input border, and a faint tonal fill.
- **Focus:** Semantic border plus a visible 2px ring.
- **Error / Disabled:** Error uses Failure Red border and ring; disabled controls retain legible text while clearly reducing emphasis.
- **Implementation:** Use the shared Shadcn-svelte `Input`, `Textarea`, `Select`/`AppSelect`, `Checkbox`, `RadioGroup`, `Slider`, and related primitives in the app, public OpenPost Image Editor, and marketing tools. Native controls belong only inside those shared implementations.
- **Authored colors:** Use the shared brand-aware `ColorPicker` for hex, RGB, and HSL color values. Keep canvas sampling, grading wheels, CSS color expressions, and provider-defined color categories in their specialized controls.
- **Embedded editors:** When a parent surface owns the complete boundary, the shared `Textarea` may use `unstyled` so default field chrome does not leak into the editor. The text-and-thread composer and media alt-text overlay are intentional examples; ordinary forms keep the default treatment.

### Navigation

The app sidebar runs logo, workspace switcher, notifications, and New post, then Home, Posts, Inbox, Analytics, then Ideas, Studio, Media, Automations, with Accounts, Settings, and profile in the footer. There is no desktop More menu. Phones use Home, Posts, New, Inbox, and More, all labelled. `/` stays the composer URL; app entry follows the device landing preference. Settings uses a left rail grouped into You, Workspace, Plan, and a collapsed Advanced. Desktop sidebars, public top navigation, and mobile bottom navigation share compact labels and a clear active state. Active app navigation uses the theme's selected recipe; public navigation stays quiet until hover. Mobile labels remain readable without horizontal overflow, and menus must render above drawers and sheets.

The marketing desktop header uses the shared Shadcn-svelte `NavigationMenu` for direct links and grouped resources. Its mobile header stays a compact disclosure menu with 44px targets rather than forcing desktop flyouts into a phone viewport.

### Shared Page Chrome

Authenticated routes use `PageContainer`, `PageHeader`, `SectionHeader`, and content-shaped `PageLoading` recipes. Page titles equal their navigation label, and descriptions appear only to report state. Tabs have one idiom: shared `Tabs` for in-page views and `PageTabs` for route tabs, both on the theme recipe and on their own full-width row. A segmented switch is only for two or three representations of the same data, such as List, Grid, and Calendar. `Disclosure` owns expandable sections. Refresh is icon-only with a tooltip. `InlineNotice` appears only when the reader can act; success uses a toast. Empty, notice, toast, error, and destructive-confirmation states use the shared primitives so hierarchy and feedback do not drift between routes.

### Recovery states

Recovery pages lead with a short heading, a brief explanation, and one primary action to continue. Keep optional help as a quiet secondary link and truthful status as small metadata. Public missing pages pair the copy with the shared transparent folded-paper artwork, placed above the copy on narrow screens.

Use the shared recovery layout and semantic action roles across framework and static pages. Static actions preserve the shared Bayer geometry and hover, keyboard focus, and press density, with 44px targets, visible focus, and reduced-motion behavior. Offline recovery uses the compact text-only layout, stays self-contained, and retains localized reassurance about saved local projects.

## Do's and Don'ts

### Do:

- **Do** reuse semantic theme variables and verify every change in light and dark.
- **Do** keep the focal treatment rare enough that the next action remains obvious, and keep Dither on the surfaces it belongs to.
- **Do** use shared page and feedback primitives before creating route-specific chrome.
- **Do** preserve touch targets, safe areas, responsive overflow, keyboard focus, and reduced-motion behavior.
- **Do** keep provider state and operational outcomes compact but explicit.

### Don't:

- **Don't** turn routine app pages into spacious marketing compositions.
- **Don't** use gradient text, glow-heavy dark UI, decorative glass panels, decorative charts, or generic card grids. A theme may use a declared material effect only when it serves its chosen world and preserves contrast.
- **Don't** wrap every group in another card or nest cards when spacing and a divider would express the hierarchy.
- **Don't** use monospace, uppercase, badges, or a theme's focal color as decoration.
- **Don't** create one-off loading, empty, success, error, or destructive patterns when a shared primitive exists.

Documentation uses neutral white and charcoal reading surfaces with muted blue links. Orange stays in the product mark.

App page titles use the theme’s typeface, weight, and tracking with `data-app-title`, capped at 1.25rem and a 1.4 line height. List and Calendar share the Posts header and view switch in page navigation. Narrow Calendar layouts keep a compact month or week date picker with the selected day's posts below it; List owns status tabs, search, and recovery. Calendar's secondary workspace, platform, and status filters sit behind Filters. Public profiles use the viewer’s saved Workspace theme after direct navigation or reload, and Calm for anonymous visits. Activity intensity derives from the active primary color.

### Social sharing images

OG cards use 1200 × 630 compositions designed to read at 320px wide. The landing card uses original generated paper artwork from `assets/brand/social/`. Other cards pair a large Geist Semibold title with one 304px topic symbol on a full-height mint, blue, or lilac panel. Keep the Converge mark and Manrope wordmark. Documentation uses the Workshop charcoal canvas, pale text, and a section label. Provider logos retain their colors on light panels. Avoid outer frames, small icon tiles, decorative dots, repeated descriptions, and truncated titles. The renderer and generation workflow belong to `scripts/social-images/render.mjs` and `packages/social-images/README.md`.

## Shared UI ownership

`packages/ui` owns the reusable Svelte primitives, theme catalogue, icons and CSS recipes. OpenPost web and marketing consume its workspace exports. Standalone Svelte apps consume versioned packages or compiled package archives. UI labels use per-tree message context, with English defaults. Docs map Fumadocs roles to the package’s framework-neutral `tokens.css`; mobile generates native manifests from the same built-in theme catalogue and retains its native controls.
