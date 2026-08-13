---
target: Image Editor completeness and polish
total_score: 31
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 5
timestamp: 2026-08-06T15-04-23Z
slug: image-editor-components-image-editor-shell-svelte
---
⚠️ DEGRADED: single-context (sub-agents are disabled for this run; the human and deterministic assessments were completed sequentially)

## Design Health Score

| # | Heuristic | Score | Key issue |
| --- | --- | ---: | --- |
| 1 | Visibility of system status | 4 | Save, recovery, conflicts, export, uploads, background removal, and destructive operations expose clear state. |
| 2 | Match between system and the real world | 3 | Several familiar editor concepts are partial: crop is numerical, eyedropper is screen-level, and moving a pixel selection moves only its mask. |
| 3 | User control and freedom | 3 | Undo, redo, cancellation, recovery, and conflict options are strong, but snap behavior and some pixel operations lack user control. |
| 4 | Consistency and standards | 3 | Shared controls and the command model are coherent; declared but unwired tools and brand resources create incomplete expectations. |
| 5 | Error prevention | 4 | Typed limits, autosave, recovery, revision checks, deletion guards, and media references prevent expensive mistakes. |
| 6 | Recognition rather than recall | 2 | The shortcut map is mostly absent from Help, grouped tools hide variants, and precision behavior has no visible settings. |
| 7 | Flexibility and efficiency | 3 | Multi-select, groups, keyboard actions, touch, clipboard, pages, and templates are strong; external dropping, guides, and portable project files are missing. |
| 8 | Aesthetic and minimalist design | 3 | The canvas stays dominant and advanced groups are collapsed, but desktop and mobile still expose a large feature vocabulary without one complete command model. |
| 9 | Error recovery | 4 | Local recovery, server revisions, save-as-copy conflict handling, preserved originals, and retry paths are unusually complete. |
| 10 | Help and documentation | 2 | Product docs exist, but in-editor Help documents only a small fraction of actual shortcuts and tool semantics remain implicit. |
| **Total** | | **31/40** | **Good foundation; completeness and polish gaps remain** |

## Design Specificity Verdict

The editor feels authored for OpenPost rather than copied from a generic design tool. Its social presets, multi-page output, managed Media handoff, templates, guest migration, brand resources, and post-return workflow are specific and coherent. The quality gap is not visual sameness. It is the mismatch between a strong underlying model and several unfinished conventional editor interactions.

The deterministic scan returned zero findings across the Image Editor component directory. This rules out its encoded markup anti-patterns, but it does not cover canvas behavior, hidden commands, persistence semantics, or tool completeness. A fresh browser assessment was attempted in an isolated tab, but the browser could not reach the isolated local server. Current source, the prior remediated production critique, focused E2E, and the already completed desktop/tablet/mobile checks supplied the fallback evidence. No overlay was presented.

## Overall Impression

OpenPost already has the harder foundation: a structured document, robust persistence, accessible DOM controls, mobile adaptation, and social delivery. It will feel complete when every visible or familiar editor concept behaves end to end, the precision system is controllable, and the existing depth is discoverable without memorization.

## What's Working

- Save, recovery, conflict, revision, and media-reference behavior is stronger than most browser editors.
- Multi-selection, grouping, alignment, distribution, keyboard reordering, touch interaction, and structured clipboard form a credible expert workflow.
- The responsive shell preserves the same document model while keeping touch targets and canvas access usable on phones and tablets.

## Priority Issues

### [P1] Finish the familiar editing contract

Crop and eyedropper are declared but not complete canvas tools. Pixel-selection movement moves the mask rather than content, and external file dropping is absent from the canvas.

**Fix:** complete crop, canvas sampling, selected-pixel operations, and exact-point external drops with shared command/history behavior.

**Suggested command:** `$impeccable harden`

### [P1] Make precision behavior visible and controllable

Snapping works well internally, but users cannot toggle it, bypass it while moving, create guides, show rulers, or use a grid.

**Fix:** add one coherent precision system with snap settings, temporary bypass, guides, rulers, grid controls, and consistent move/resize/rotation feedback.

**Suggested command:** `$impeccable shape`

### [P1] Unify commands, menus, shortcuts, and Help

The implemented keyboard map is much larger than the Help surface. Tool variants and modifiers rely on recall, and there is no single command definition shared by handlers, menus, tooltips, and Help.

**Fix:** create a typed command registry and generate every shortcut label, menu entry, tooltip, enabled state, and Help row from it.

**Suggested command:** `$impeccable clarify`

### [P1] Complete existing brand and page promises

Brand backgrounds and text styles are persisted and editable in Settings but are not direct apply actions in Image Editor.

**Fix:** expose both as contextual presets, copy their values into the document, preserve template snapshot semantics, and show unavailable fonts or deleted resources clearly.

**Suggested command:** `$impeccable harden`

### [P1] Make pixel tools feel production-grade

The selection and mask model is strong, but drawing lacks pressure, smoothing, hardness, feathering, and alpha-aware object picking. Full-resolution masks and snapshot history also create large-document risk.

**Fix:** improve input quality and cursor previews, align option semantics across magic tools, add adaptive alpha hit testing, and move expensive work off the interaction path.

**Suggested command:** `$impeccable optimize`

## Persona Red Flags

**Alex, power user:** discovers a broad shortcut map but cannot view it, cannot create guides or bypass snapping, cannot drop an OS image exactly where needed, and cannot export a portable project for transfer or backup.

**Jordan, first-timer:** sees Crop and EyeDropper-like concepts in the product but gets numerical crop fields and a screen color picker rather than conventional canvas interactions. Tool modifiers and selection modes require unexplained editor knowledge.

**Sam, accessibility-dependent:** the Layers tree and properties controls provide a strong DOM alternative, but canvas-only operations still need keyboard equivalents, clear focus return after sheets/dialogs, and complete live announcements for tool modes and selection changes.

**Casey, mobile:** the grouped bottom rail is substantially improved, but precision tools, long property sets, canvas crop, and multi-step selection work still need task-focused sheets rather than desktop concepts compressed into a phone.

## Minor Observations

- Recent colors are useful, but tool option persistence should be consistent across reloads and devices.
- Replace-image behavior should explicitly state which crop, effects, dimensions, and erase masks are preserved.
- The existing browser screen eyedropper should remain as an extra option after canvas sampling is added.
- Rich text spans, many artistic filters, uncommon export formats, sprite tools, and animation are not prerequisites for a polished social-image editor.

## Questions to Consider

- What should happen every time a user presses Escape, Enter, Delete, or clicks outside an active tool?
- Can every visible persistent action be undone, saved, restored, and reproduced during export?
- Can every tool explain its target layer, sampling source, selection behavior, and destructive or non-destructive result before the user commits?
- Does mobile offer the same outcome as desktop, or merely expose the same controls in less space?
