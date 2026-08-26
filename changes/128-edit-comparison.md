### Added

- Rolling and ripple edits now show a live 2-up OUT/IN comparison in the program monitor while dragging. The overlay is owned by the timeline gesture, publishes only from the snapped and validated plan, and clears on commit, Escape, pointer cancel, destroy, and tool changes. It reuses PreviewLayer and the existing decoder prewarm, proxy, and filmstrip path without a second owner, handles gaps, speed, reverse, sourceStart/sourceEnd/sourceFps, linked audio-to-visual companions, and image/composition/Lottie sources, and labels OUT, IN, and GAP with high-contrast timecodes that remain usable at 320 px without hiding export or quality failures. Slip shows new IN/OUT with baseline IN/OUT corners; slide shows the left OUT and right IN at the new cut with their pre-drag baselines as corner thumbnails, both rendered as fitted virtual items so the compared frame is always visible and aspect-correct.

### Fixed

- Edit comparison frame mapping is covered by pure tests for gaps, speed, reverse, sourceFps, linked companions, images/compositions, and timecodes, plus Chromium pointer tests that drive real timeline drags for rolling, ripple, slip, and slide, verify baseline-vs-dynamic distinction, audio-linked visual resolution, cancellation cleanup, single undo entries, absence of URL leaks, and 320 px layout.
