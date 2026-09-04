---
name: OpenPost
description: Themeable publishing workspace with semantic actions, protected product identity, and precise shared chrome.
colors:
  primary: "oklch(0.55 0.155 45)"
  primary-dark-theme: "oklch(0.66 0.14 45)"
  canvas: "oklch(0.985 0.002 80)"
  canvas-dark: "oklch(0.145 0.008 55)"
  surface: "oklch(1 0 0)"
  surface-dark: "oklch(0.2 0.01 50)"
  ink: "oklch(0.2 0.01 50)"
  ink-dark: "oklch(0.92 0.005 85)"
  muted-ink: "oklch(0.52 0.015 55)"
  muted-ink-dark: "oklch(0.65 0.015 55)"
  border: "oklch(0.9 0.005 80)"
  border-dark: "oklch(0.25 0.015 55)"
  danger: "oklch(0.57 0.22 25)"
  danger-dark: "oklch(0.6 0.2 25)"
  success-ink: "oklch(0.42 0.12 160)"
  success-ink-dark: "oklch(0.75 0.13 155)"
  docs-cta-shadow: "oklch(0.5 0.15 45 / 0.18)"
typography:
  wordmark:
    fontFamily: "Manrope Variable, Manrope, Geist Variable, Geist, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
  display:
    fontFamily: "Geist Variable, Geist, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 7vw, 3.75rem)"
    fontWeight: 600
    lineHeight: 1.04
    letterSpacing: "-0.025em"
  app-title:
    fontFamily: "Geist Variable, Geist, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Geist Variable, Geist, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  metadata:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "0.75rem"
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
    textColor: "{colors.canvas}"
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

**Default Creative North Star: "The Well-Maintained Workshop"**

OpenPost is a focused working environment: every control has a clear job, related information stays aligned, and operational state is easy to scan. Workshop is the default theme and complete fallback. Its identity comes from precise composition, warm-tinted neutrals, a restrained orange signal, and the Converge mark, not from decorative dashboard effects.

The authenticated app stays compact and predictable. Marketing pages use the same materials with more breathing room and stronger type contrast. Documentation keeps VitePress reading conventions while sharing the product palette, assets, and direct voice. Workshop provides equal light and dark expressions. Other families may support one or both schemes. When a family does not support the effective scheme, the complete Workshop scheme renders instead. Themes never mix token fragments.

**Key Characteristics:**

- Warm technical minimalism rather than corporate dashboard styling.
- Thin structural borders and tonal layers instead of decorative shadows.
- Orange reserved for action, selection, and meaningful status.
- Compact app hierarchy with more spacious public and reading surfaces.
- Consistent page, loading, empty, notice, toast, and destructive patterns.

## Identity

The Converge symbol is the canonical OpenPost mark. Four equal rounded modules face one centered opening, expressing one workspace publishing outward. Preserve the exact supplied geometry: four-fold symmetry, even axis gaps, and a square footprint that remains legible at 16px. Do not redraw it as a pen, star, flower, window, or generic app grid.

Use the standalone mark when “OpenPost” is already written beside it or space is compact. Use the supplied outlined Manrope Semibold lockup for README, brand references, and static compositions that need the complete name. On light surfaces, use Workshop Orange for the symbol and Carbon Ink for the wordmark. On Workshop Orange, use the reversed white lockup. “Your socials, on steroids.” is the approved brand headline; it is optional, never mandatory UI chrome.

## Colors

The values below define Workshop. Warm neutrals carry most of that family; orange is a scarce product signal. Custom themes replace complete semantic roles rather than overriding isolated CSS values.

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
- **Docs CTA Shadow** (`docs-cta-shadow`): A translucent orange lift reserved for the documentation home action.

**The One Signal Rule.** In Workshop, orange marks the next action or current selection. It is not a background decoration and should remain visually scarce. Every theme assigns the same semantic jobs to its own action, focus, and selection roles.

**The Complete Scheme Rule.** A supported scheme is incomplete until its contrast, borders, hover state, focus state, reduced-motion behavior, and browser surfaces work together. A single-scheme family is valid, but its unsupported scheme must fall back to complete Workshop rather than improvise an inversion.

## Theme contract

Organization themes are versioned visual documents. They may control semantic colors, approved typography, density, spacing, shape, elevation, motion, shell recipes, component recipes, one complete icon pack, and decorative assets. They cannot change product structure, permissions, copy, data, provider truth, or protected identity.

- Components declare intent such as `focal`, `primary`, `ordinary`, `quiet`, `destructive`, or `link`. They do not choose a brand color or theme family.
- Published revisions and built-in versions are complete and immutable. Drafts may be incomplete while editing, but runtime output may not.
- Web and native consume the same resolved semantic contract through platform renderers. Neither client reconstructs organization defaults, workspace overrides, locks, revisions, or fallback.
- Workspace name, avatar, and color remain workspace identity. Provider marks, the Converge mark, status meaning, media, and specialized editor glyphs retain their protected colors or geometry.
- Protected editor roles follow the active light or dark scheme. Protection preserves contrast, signal meaning, and authored output. It does not force dark chrome inside a light theme.
- Uploaded fonts are local static WOFF2 resources. The backend derives a validated TTF or OTF copy for native clients. Remote font and asset URLs are not theme values.
- Theme application is atomic. Fonts, icons, assets, and tokens are staged before one complete presentation replaces the prior workspace presentation.

## Typography

**Wordmark Font:** Manrope Variable Semibold (with Manrope, Geist, and system sans fallbacks)

**Workshop Display Font:** Geist Variable (with Geist and system sans fallbacks)

**Workshop Body Font:** Geist Variable (with Geist and system sans fallbacks)

**Label/Mono Font:** the platform UI monospace stack

**Character:** Manrope gives the protected OpenPost wordmark a clean, softly rounded shape that matches the Converge mark. Workshop uses Geist for compact product UI. Other families may select an approved local type recipe, while the app-scale hierarchy and readable measure stay fixed. Monospace is a functional accent for identifiers, timestamps, counts, tokens, handles, and queue data; it is not a general “technical” costume.

### Hierarchy

- **Wordmark** (`wordmark`): The fixed OpenPost brand name beside the Converge mark, set at Semibold with restrained negative tracking.
- **Display** (`display`): Public hero and major campaign headings, with strong contrast and tight tracking.
- **App title** (`app-title`): Authenticated route `h1` headings through the shared page header.
- **Body** (`body`): Controls, app copy, descriptions, and most supporting text; long prose should stay near 65–75 characters per line.
- **Metadata** (`metadata`): Compact operational values whose shape matters, including IDs, counts, timestamps, and status details.
- **Docs table** (`docs-table`): A slightly enlarged reading step for dense reference tables.

**The Task Scale Rule.** App headings stay at the shared application scale. Large display typography belongs to persuasive or reading surfaces, not routine settings and workflow pages.

**The Data Earns Mono Rule.** Use monospace only when character alignment or literal values improve comprehension.

## Layout

The app uses a centered content column up to 72rem with 1rem mobile gutters, 1.5rem tablet gutters, and 2rem large-screen gutters. Theme density may adjust bounded internal gaps, but it cannot remove safe gutters or change route structure. Shared page containers establish the route rhythm. Page headers switch from stacked to split action layout through a 44rem container query so they respond to available content width rather than the viewport alone.

Public pages use a wider 80rem frame and larger responsive section spacing. Documentation keeps a reading-first column and conventional sidebar. Mobile app navigation respects safe-area insets, keeps the primary compose action distinct, and leaves enough bottom clearance for content. Coarse-pointer controls have a minimum 44px target.

Use the established 4px spacing family, but vary it by hierarchy: tight within controls and metadata groups, moderate within sections, generous between major public-page ideas. Prefer `gap` for sibling relationships.

### OpenPost Image Editor

OpenPost Image Editor is an immersive, task-specific workspace inside OpenPost rather than a general design product. Its chrome uses the resolved semantic theme. The central pasteboard, page boundary, selection handles, transparency grid, and direct-manipulation glyphs use protected editor roles so authored work remains legible in every theme.

Desktop uses a compact menu bar, tool rail, asset pane, one active canvas, Layers and Properties panes, and an ordered page strip. Each persistent side or bottom pane has an accessible resize seam and a stable reset size. Phones use the same document model with a short top bar, a horizontal bottom tool rail, one contextual sheet at a time, a full-height Layers sheet, and a collapsible page strip. Coarse-pointer actions remain at least 44px. Two-finger input pans or zooms the canvas; one-finger input transforms the selected layer.

The DOM-based Layers tree and Properties controls are the accessible equivalents of direct canvas editing. Every persistent change runs through the command system, exposes undo and redo, and announces saves, conflicts, exports, uploads, camera state, and background-removal state. OpenPost Image Editor uses a scoped theme runtime; it does not copy another editor's CSS, generated utilities, or trade dress.

### OpenPost Video Editor

OpenPost Video Editor uses a four-zone editing model: compact project controls at the top, a fixed tool rail with one full-height content pane on the left, one dominant preview in the center, and selection-specific inspector tabs on the right. The timeline begins beside the left content pane and owns playback position; its ruler is the seek control, so a second progress slider must not compete with it. Each persistent side or bottom pane has an accessible resize seam and a stable reset size. Semantic selection and focal roles mark the active family, property tab, playhead, and Export action. Waveforms, timeline state, canvas bounds, and media keep protected editor roles.

Keep inspector settings contextual. Clip selection exposes Video, Audio, Speed, Animation, and Adjustments; overlays, captions, and audio items expose only their relevant tabs. Phones replace both side panels with one bottom tool dock and one contextual sheet while preserving the same timeline and project document. Quick Cut remains the explicit stream-copy path and Full Editor remains the composed edit path.

Keep editor copy quiet. Use short labels, values, and direct actions in the default workspace; do not repeat the active tool as a panel heading or add routine reassurance below self-explanatory controls. Reserve inline prose for errors, permissions, destructive consequences, required attribution, and limitations that change what the creator can do. Put optional technical detail in a tooltip or disclosure.

The timeline uses a hybrid track model. The ordered primary sequence and project-wide markers remain semantic rails. Visual, audio, and caption rows render from the document's actual track arrays, so multiple tracks stay distinct and empty categories do not consume permanent lanes. Items on one track cannot overlap unless an explicit transition owns the shared interval; use another track for intentional compositing.

## Elevation & Depth

Workshop is flat by default. Its surfaces separate through warm tonal changes, hairline borders, and restrained rings. Other families may select a bounded elevation recipe, but resting hierarchy must remain clear and temporary layers must remain distinguishable.

### Shadow Vocabulary

- **Focal action:** a small, low-blur shadow that keeps a floating or circular primary action legible over content.
- **Temporary layer:** a restrained menu or dialog shadow paired with a clear border.
- **Documentation CTA:** a soft orange-tinted lift used only on the primary docs action.

**The Legible Depth Rule.** A resting surface proves its hierarchy through a coherent combination of tone, border, spacing, or elevation. Themes must not stack unrelated depth cues or let decoration obscure focus and state.

## Shapes

Workshop uses a 12px base corner, 10px controls, 12px cards, and 14–16px prominent media. Theme recipes may vary bounded control and container shapes while keeping hit targets and state legible. Pills and full circles remain intentional shapes for compact controls, statuses, avatars, and focal actions, not a universal card treatment.

## Components

### Buttons

- **Shape:** Compact medium corners with a 36px desktop height and 44px coarse-pointer target.
- **Focal:** The strongest theme action treatment, used for one clear next action in a local group.
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

Desktop sidebars, public top navigation, and mobile bottom navigation share compact labels and a clear active state. Active app navigation uses the theme's selected recipe; public navigation stays quiet until hover. Mobile labels remain readable without horizontal overflow, and menus must render above drawers and sheets.

The marketing desktop header uses the shared Shadcn-svelte `NavigationMenu` for direct links and grouped resources. Its mobile header stays a compact disclosure menu with 44px targets rather than forcing desktop flyouts into a phone viewport.

### Shared Page Chrome

Authenticated routes use `PageContainer`, `PageHeader`, `SectionHeader`, and content-shaped `PageLoading` recipes. Empty, notice, toast, error, and destructive-confirmation states use the shared primitives so hierarchy and feedback do not drift between routes.

## Do's and Don'ts

### Do:

- **Do** reuse semantic theme variables and verify every change in light and dark.
- **Do** keep Workshop orange, or another theme's focal treatment, rare enough that the next action remains obvious.
- **Do** use shared page and feedback primitives before creating route-specific chrome.
- **Do** preserve touch targets, safe areas, responsive overflow, keyboard focus, and reduced-motion behavior.
- **Do** keep provider state and operational outcomes compact but explicit.

### Don't:

- **Don't** turn routine app pages into spacious marketing compositions.
- **Don't** use gradient text, glow-heavy dark UI, decorative glass panels, decorative charts, or generic card grids. A theme may use a declared material effect only when it serves its chosen world and preserves contrast.
- **Don't** wrap every group in another card or nest cards when spacing and a divider would express the hierarchy.
- **Don't** use monospace, uppercase, badges, or a theme's focal color as decoration.
- **Don't** create one-off loading, empty, success, error, or destructive patterns when a shared primitive exists.
