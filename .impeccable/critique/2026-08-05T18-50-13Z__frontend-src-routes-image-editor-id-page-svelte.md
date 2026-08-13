---
target: production OpenPost Image Editor
total_score: 23
p0_count: 0
p1_count: 5
timestamp: 2026-08-05T18-50-13Z
slug: frontend-src-routes-image-editor-id-page-svelte
---
Method: dual-agent (A: /root/design_review · B: /root/detector_evidence), synthesized with an additional hands-on production browser pass by /root.

## Post-audit remediation

The release that includes this report fixes all five P1 findings: fit-to-canvas now uses the available pasteboard, Undo and Redo remain available at 320 px, advanced inspector groups are collapsible, layer renames commit into history, and effect actions expose their current state. It also adds platform-correct shortcut labels, a Help surface, first-edit guidance, a broader template catalog, and corrected still-image stock copy. The findings below preserve the pre-fix evidence that guided those changes.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 3 | Save, export, background-removal, and destructive states are clear; some direct edits fail silently. |
| 2 | Match System / Real World | 2 | “Fit canvas” does not fit, effect toggles keep “Add” labels when they remove, and the stock pane mentions footage/B-roll in an image editor. |
| 3 | User Control and Freedom | 2 | Desktop undo/redo is solid, but both disappear at 320px and are absent from More actions. |
| 4 | Consistency and Standards | 2 | Mac shows Ctrl shortcuts, mobile sheets duplicate headings, and layer renaming looks editable but reverts. |
| 5 | Error Prevention | 3 | Resize constraints, local autosave, conflict safety, and destructive confirmation are strong. |
| 6 | Recognition Rather Than Recall | 2 | Desktop rail is icon-first, grouped variants rely on hidden context menus, and no shortcut/help surface exists. |
| 7 | Flexibility and Efficiency | 3 | Shortcuts, multi-select, grouping, resizable panels, pages, and direct manipulation provide a strong expert base. |
| 8 | Aesthetic and Minimalist Design | 2 | The canvas remains central, but one selected shape with effects exposes 40 controls across 4.5 inspector viewports. |
| 9 | Error Recovery | 3 | Local persistence survived reload; export, resize, background-removal optimization, and deletion communicate recovery well. |
| 10 | Help and Documentation | 1 | There is no Help menu, shortcut sheet, guided first edit, or contextual explanation for advanced tools. |
| **Total** |  | **23/40** | **Acceptable — significant improvement needed** |

## Anti-Patterns Verdict

The editor does not look like generic AI dashboard output. Its page model, social presets, local guest persistence, stock attribution, Media handoff, and workspace path are specific to OpenPost. The weakness is creative depth: the public catalog has only five templates, four of which use effectively the same accent/headline/supporting-copy composition. It feels procedurally varied rather than art-directed, far below the Canva half of the stated bar.

The deterministic detector returned zero findings across the route and 13 Image Editor Svelte components. That means none of its 25 encoded markup anti-patterns were present; it does not negate the interaction defects and cognitive-load findings observed live. No detector overlay was injected because Assessment B had no connected browser. The parent browser pass supplied production interaction evidence instead.

## Overall Impression

This is a serious editing engine inside a shell that exposes too much expert machinery too early. It is closer to a compact open-source graphics editor than to Photoshop blended with Canva. The strongest opportunity is not adding more controls; it is creating a confident novice path and progressively revealing the power that already exists.

## What’s Working

- Local-first safety is excellent: autosave, reload persistence, explicit browser-storage caveats, conflict protection, and irreversible-delete confirmation all build trust.
- The power-user foundation is real: menus, shortcuts, multi-select, grouping, ordering, page duplication, resizable zones, filters, crop, effects, and social-page export are coherent capabilities.
- Stock search/import worked with visible Pexels attribution, and a six-page PNG export completed successfully with a clear completion state.

## Priority Issues

### [P1] “Fit canvas” is functionally false

At 1280×720, Fit canvas set zoom to 75%. The canvas became 810×1013 inside a 656×540 viewport, leaving internal scroll dimensions of 733×776. The clickable zoom percentage behaves the same way.

Why it matters: fit-to-window is table stakes in every serious editor. A false command immediately damages expert trust and leaves novices unsure whether clipping is intentional.

Fix: compute contain scale from actual pasteboard bounds with a stable margin, recalculate after panel/viewport/page-size changes, and make Cmd/Ctrl+0 call the same operation.

Suggested command: `$impeccable harden`

### [P1] Undo/Redo vanish at 320px

At 390px both are 44px controls. At 320px they disappear from the header and are not present under More actions. The phone tool rail contains no history actions either.

Why it matters: a touch user has no visible recovery path for normal edits. That is a core editing failure, not polish.

Fix: keep Undo/Redo in a stable mobile history cluster or put both at the top of More actions with visible enabled/disabled state. Test 320px, landscape, safe areas, and coarse-pointer targets.

Suggested command: `$impeccable adapt`

### [P1] The inspector overwhelms instead of guiding

A selected image exposes transform, effects, mask, drop/inner shadow, fit/crop, five quick looks, 12 adjustment sliders, and more in one continuous pane. A selected shape with effects measured 40 controls and 1,591px of content in a 353px viewport (4.5 screens). Mobile copies the same long inspector into a sheet.

Why it matters: the interface presents expert depth as the default state. First-timers cannot identify the three controls that matter for the current task, while experts spend time scrolling.

Fix: use contextual groups such as Position, Appearance, Image, and Effects; keep frequent controls open, collapse advanced groups, and remember disclosure state. Mobile should open to a task-specific subset rather than mirror desktop length.

Suggested command: `$impeccable distill`

### [P1] Layer renaming appears editable but silently reverts

Typing “Headline” in Layer name, pressing Enter/Tab, and clicking elsewhere left the tree item as “Text”; the field then reverted to “Text.” Undo stayed disabled until a separate transform action occurred.

Why it matters: the UI accepts input and gives no error, which makes users doubt whether their other edits are saved.

Fix: make input/commit semantics explicit and reliable, update the Layers tree immediately, include the rename in undo history, and test Enter, Tab, click-away, mobile sheet close, and IME composition.

Suggested command: `$impeccable harden`

### [P1] Effect toggles say the opposite of what they do

After adding a border, the button remained named “Add border.” Clicking it again removed the border. Drop shadow and inner shadow use the same pattern.

Why it matters: the label predicts creation while the action is destructive. This is exactly the kind of subtle wrongness that separates a trustworthy professional tool from a frustrating one.

Fix: use a visible switch/checkbox labelled Border, Drop shadow, and Inner shadow, or change the action to Remove when enabled. Preserve focus and announce the state.

Suggested command: `$impeccable clarify`

### [P2] Mobile navigation is a wide, memory-heavy strip

The phone rail has 12 destinations: Add, Select, Pixels, Lasso select, Magic select, Text, Pencil, Fill, Eraser, Hand, Layers, and Edit. Several are initially off-screen. Mobile Add, Layers, and Properties sheets repeat their heading inside the sheet, and Properties mirrors the full desktop inspector.

Why it matters: users must horizontally explore and remember tool locations, then switch repeatedly between Add, Layers, and Edit sheets.

Fix: group tools into Add, Select, Draw, Retouch, Layers, and Properties families; keep the active family and last-used subtool visible; remove duplicate sheet headings.

Suggested command: `$impeccable adapt`

### [P2] First-use and template quality miss the Canva standard

The start page offers seven formats, custom size, five templates, open image, and prior designs, but the editor gives no “change this text first” cue, help entry, shortcut sheet, or task-led guidance. Four of five templates share the same basic composition, and only one is multi-page.

Why it matters: Canva wins by making a good result feel near. Here users get an honest start page, then land in a dense expert shell with a visually narrow template library.

Fix: lead with three intents—Template, Open image, Blank size—then teach through a skippable first edit. Art-direct distinct template families by job and platform before adding search/filter UI.

Suggested command: `$impeccable onboard`

### [P2] Export success becomes an account-conversion interruption

The six-page download succeeded, then a blocking Export complete dialog immediately promoted cloud storage, media, brand kits, scheduling, publishing, and teams.

Why it matters: download is the emotional peak. Turning it straight into a sales interruption makes the free tool feel conditional even though the copy promises no account or watermark.

Fix: use a non-blocking success toast and a quiet secondary “Save this design to OpenPost” action. Show the full benefits only when the user chooses it.

Suggested command: `$impeccable quieter`

## Persona Red Flags

**Alex, power user:** Fit canvas produces the wrong geometry; shortcut labels say Ctrl on macOS; the extensive shortcut system has no searchable reference. Multi-select/grouping and page operations are otherwise strong.

**Jordan, first-timer:** icon-first desktop tools, hidden grouped variants, terms such as marquee/tolerance/contiguous, and the long inspector arrive without a first-edit path. The button that says Add border removes an existing border.

**Sam, accessibility-dependent:** most controls have useful names and the Layers tree is a strong DOM alternative, but 320px removes history controls, the zoom control exposed a stale accessible name (`34%` while visible text said `22%`), duplicate sheet headings add noise, and keyboard-only canvas shortcut testing could not be completed reliably.

**Casey, mobile:** touch targets measured 44–48px and state survived interruption/reload, but the 12-item horizontal rail requires exploration and the Properties sheet is several screens long. At 320px there is no visible undo/redo.

## Minor Observations

- Stock search works, but its empty prompt says “footage or B-roll” inside the still-image editor.
- Crop opens as X/Y/W/H percentages; direct handles may exist on canvas, but the panel gives no cue that they do.
- At 320px the zoom control exposed an accessible name of 34% while its visible text was 22%.
- Public template categories are sparse and inconsistent in granularity.
- Local image upload could not be completed through the browser automation file-chooser bridge; this is an inconclusive test, not a claimed product defect.
- Background removal correctly warned that the test image might be too large and offered a smaller temporary copy. The flow completed without console errors.

## Questions to Consider

- Is the core promise “every image primitive in one tool,” or “ship a strong social visual faster than Photoshop”?
- What should a novice finish in the first 30 seconds, and which three controls are required for that outcome?
- If the public library stayed at five templates, could each establish a genuinely different art direction and use case?
- Should the product keep Photoshop-like depth in the inspector, or adopt Canva-like task panels with an Advanced escape hatch?
