### Added

- Text items in the focused 2D composition timeline now show typed In, Loop and Out bands derived from the real `textMotion` spec via the shared `getTextMotionTimelineBands` math (including `segmentTextUnits` unit counts, stagger, and half-clip clamping, exact to FreeCut). Bands are rendered in both the sticky layer list and the scrollable lane, culled via the shared viewport, with localized preset and slot labels, duration and unit suffixes, and offset metadata.
- In and Out band bodies drag to change `offsetFrames` from the clip edge; Loop bodies do not offer offset. Band edges drag to change `durationFrames` (In right edge, Out left edge, Loop right handle). Loop duration edits do not create a false offset. All drags use `beginTextMotionEdit` / `updateTextMotionLive` / `commitTextMotionEdit` with a single undo per gesture, live preview via the shared store, `isTrackEffectivelyLocked` group-lock guards, pointer capture with `lostpointercapture` handling, a single stored cleanup for `pointermove` / `up` / `cancel` / `keydown` / `lostcapture` called on every terminal path and onDestroy, Escape and pointercancel restore the exact snapshot even before the 3px threshold, and `pointercancel`/`lostcapture`/`unmount` do not synthesize PointerEvent. No-op drags (clamped to start) add no undo and do not call `onedit`.

### Fixed

- Text motion band math now matches `references/freecut/src/shared/timeline/text-motion-timeline.ts` exactly, with pure tests for In/Out/Loop placement, half-clip clamping, and max offset.
