### Added

- Focused 2D composition timeline for Motion workspace. When a `composite-2d` composition is active the footer shows a single dedicated surface instead of stacking. The compact layout keeps layer names, in/out work area and FPS header always visible, uses a shared row model so sidebar labels and the scrollable bar/keyframe lanes stay aligned, and collapses to a single column below 640px without widening a 320px page. Scrubbing the ruler seeks via the shared clock without marking the project dirty or calling autosave.
- Layer rows expose Position, Scale and Anchor as localized vector lanes. Diamonds are rendered in the scroll surface, culled via the shared timeline viewport, and use typed vector helpers without `as any`. Diamonds are interactive buttons wired to the shared `keyframeSelectionStore`; dragging a diamond repositions its frame through atomic keyframe actions with a single undo and restores on Escape or pointercancel.
- Layer bars support pointer move and start/end trim with edge detection, adaptive snapping via shared snap targets, a single commit/undo on release, Escape/pointercancel restore, locked-track guards, and no autosave while drafting. Drafts reuse `planLinkedMoveGesture` and `planTrimGesture` instead of reimplementing semantics.
- Transform parenting uses a pick-whip that highlights valid layer rows, validates only via `itemById` (no track ID casts), and shows localized cycle/duplicate errors. A successful link or detach clears to a localized success status (“Parent linked”/“Parent removed”), records exactly one undo, and cleans window listeners on destroy.
- In/out handles snapshot once, draft via raw setters, add exactly one undo only if the range actually changed, and restore on pointercancel.

### Fixed

- Composition fps header no longer hardcodes 30 due to missing parentheses.
- Keyboard Delete/Arrow nudge now works from the focusable, correctly named timeline region (`role="region"` with `aria-label`) as well as the window, with proper focus and a single undo entry.
