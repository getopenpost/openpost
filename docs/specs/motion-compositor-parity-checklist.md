# Motion compositor parity checklist — FreeCut 4d62e80 compositing-timeline.tsx (7066 lines)

This checklist maps each major FreeCut source seam to OpenPost files/tests and notes remaining gaps. Parity is not yet claimed — gaps remain and work continues.

Source: `references/freecut/src/features/editor/components/compose-workspace/compositing-timeline.tsx` plus helpers imported via `deps/timeline-motion`, motion-vector-rows, motion-keyframe-selection, motion-io-lane, motion-region-overlay, transform-parent-pick-whip-overlay.

## Composition and layer creation

| FreeCut seam | OpenPost file | Test | Status |
|---|---|---|---|
| Composition picker (select active 2D comp) | `components/composition-timeline.svelte:picker` + `sequence-store.svelte.ts` | `composition-timeline.svelte.test.ts` (picker not yet covered) | DONE — picker renders all `composite-2d` comps, switches via `sequenceStore.switchTo` |
| New composition dialog (name/fps/duration) | `composition-timeline.svelte:dialog` + `sequence-store` | manual | DONE — creates `SubComposition` with default video/audio tracks |
| Generated layers: text/solid/gradient/shape/controller | `composition-timeline.svelte:addGeneratedLayer` | `composition-timeline.svelte.test.ts` (generated layers not yet) | PARTIAL — creates minimal TimelineItem for each kind; controller non-rendering identity via label hint; needs full shape/gradient defaults from FreeCut `generated-layer-items` |
| Media add / drop onto timeline | `composition-timeline.svelte:handleDrop` (placeholder) + `media/import.svelte.ts` | Chromium drag tests missing | PARTIAL — drag-over/dropEffect set, mediaId stub; full `buildDroppedMediaTimelineItems` integration and track-type validation missing |
| Empty state | `composition-timeline.svelte:empty-layers` | `composition-timeline.svelte.test.ts` empty test | DONE — shows message and quick add |
| Duration / fps editing | `composition-timeline.svelte:meta inputs` → `sequenceStore.updateComposition` | not yet | DONE — inline number inputs with clamp 1–120 fps |
| Active-region trim | `composition-timeline.svelte:handleTrimToActive` | not yet | DONE — removes outside, shifts remainder, updates comp duration, one undo |
| Fit viewport | `composition-timeline.svelte:handleFit` | not yet | DONE — computes pxPerFrame from container width |

## Track and layer rows

| FreeCut seam | OpenPost file | Test | Status |
|---|---|---|---|
| One visible layer per visual item, linked audio collapsed | `timeline/motion-timeline-rows.ts` (O(n) linkedAudioIndexes) | `timeline/motion-timeline-rows.test.ts` (exists in main, copied) | DONE — reused, O(n) |
| Track groups expand/collapse | `composition-timeline.svelte:group-row` + `track.groups.isCollapsed` | not yet | DONE — toggle via `timelineStore._setTracks` |
| Group selection span, group row header | `composition-timeline.svelte:group-header` selects all child ids | not yet | DONE — click selects all, second click deselects |
| Visibility / lock / mute / solo, inherited state | `composition-timeline.svelte:toggleTrack*` + `isTrackEffectivelyLocked` + `motion-timeline-rows` | not yet | DONE for lock inheritance; mute/solo/visibility toggle group track only — preview/export inheritance needs audit |
| Rename | `composition-timeline.svelte:editingNameId` inline input | not yet | DONE — double-click label, Enter blur commits with one undo |
| Ungroup, delete group | `composition-timeline.svelte:ungroupTrack` / delete group | not yet | DONE — removes group track, orphans children |
| Inherited state propagation across editing guards | `timeline/utils/track-groups.ts` + `effectiveMediaTracks` | not yet | PARTIAL — lock checked in move/trim/nudge; visibility/mute/solo not yet checked in preview preflight |

## Layer identity and columns

| FreeCut seam | OpenPost file | Test | Status |
|---|---|---|---|
| Layer selection, multi-select, range select (Shift), additive (Ctrl/Cmd) | `composition-timeline.svelte:selectItem` | `composition-timeline.svelte.test.ts` single select + delete | DONE — Set<string> selectedItemIds, range via lastSelectedId |
| Context menu, copy/paste/duplicate/delete, grouping | `composition-timeline.svelte:copySelected/pasteClipboard/duplicateSelected/groupSelected` | not yet | PARTIAL — copy/paste/duplicate via snapshot clone, grouping via new group track; no context-menu UI yet, no clipboard MIME |
| Pointer and keyboard reorder | `composition-timeline.svelte:startReorder` + Alt+Arrow | not yet | DONE — pointer drag swaps track.order, keyboard Alt+Arrow; needs ghost preview and group reorder polish |
| Parent pick-whip, parent column, validation | `composition-timeline.svelte:beginParentPick` + `transform-parenting` | `composition-timeline.svelte.test.ts` pick whip cycle | DONE — pointer capture, elementFromPoint, cycle/duplicate validation via setTransformParent |
| Controller / non-rendering identity | `composition-timeline.svelte:addGeneratedLayer controller` + `layer-row.controller` | not yet | PARTIAL — dashed border, reduced opacity; export still renders as video item — needs `isController` guard in preview/export |
| Blend-mode column | `composition-timeline.svelte:blend-select` | not yet | DONE — select normal/multiply/screen/overlay/add, one undo |
| In/out timing columns | `composition-timeline.svelte:timing-cell` | not yet | DONE — shows `from–to`; not yet editable inline — FreeCut has editable number fields |

## Inline properties and keyframes

| FreeCut seam | OpenPost file | Test | Status |
|---|---|---|---|
| Inline property expansion and filter | `composition-timeline.svelte:expandedLayerIds` + `filterText` + `inline-props` | not yet | PARTIAL — expand toggle + filter hides rows, placeholder hint; full property accordion (transform/opacity/crop/effects) not yet |
| Keyframe diamonds, secondary axis | `composition-timeline.svelte:vector rows + vector-key` + `vector-keyframes.ts` | `composition-timeline.svelte.test.ts` vector keys | DONE — primary/secondary diamonds, select via keyframeSelectionStore |
| Vector rows (position/scale/anchor) | `composition-timeline.svelte:vectorRowsFor` + `MOTION_VECTOR_ROW_DEFINITIONS` | tested via vector-row presence | DONE — 3 rows, hide separated secondary |
| Dope-sheet integration | not yet — `components/keyframe-dopesheet.svelte` exists but not embedded | — | MISSING — needs inline DopesheetEditor per expanded layer, viewport-cull, shared selection |
| Value-graph (value vs time) | not yet — `components/keyframe-value-graph.svelte` | — | MISSING |
| Procedural modifier bands | `timeline/actions/motion-modifiers.ts` exists, no lane | — | MISSING — needs `getProceduralBands` lane behind dopesheet |
| Additive motion-layer bands | `timeline/actions/motion-layers.ts` exists, no lane | — | MISSING — needs layer bands per `motionLayers` |
| Text-motion bands (in/loop/out) | `timeline/text-motion-timeline.ts` + `composition-timeline.svelte:text-band` + drag handlers | `composition-timeline.svelte.test.ts` text bands + drag + cancel | DONE — in/loop/out bars, duration/offset drag with rAF coalesce, one undo, lock guard |
| Property links and expressions | `project/types.ts` propertyLinks/expressions, no UI | — | MISSING — needs link icon row + pick-whip overlay (`usePropertyLinkPickWhip`) and expression editor |
| Published controls | `sequences/composition-controls.ts` exists, no timeline surface | — | MISSING — needs inline published-controls authoring row |
| Path vertices | `timeline/path-vertex-keyframes.ts` exists, no vertex lane | — | MISSING — needs vertex list when shapeType===path |
| Masks where supported | `project/types.ts` mask fields, no timeline mask row | — | MISSING — needs mask toggle/feather lanes for masks |

## Ruler, viewport and editing chrome

| FreeCut seam | OpenPost file | Test | Status |
|---|---|---|---|
| Motion ruler (ticks, timecode) | `composition-timeline.svelte:composition-ruler` + `rulerTicks` | scrub test | DONE — 64 ticks, click to seek |
| Exact playhead scrub (separate previewFrame) | `composition-timeline.svelte:startScrub` → `timelineStore._setCurrentFrame` | scrub test covers committed frame only | PARTIAL — scrubs committed frame; FreeCut uses separate `previewFrame` via `usePreviewScrubber` to avoid marking dirty — needs `previewFrame` store + ghost playhead |
| IO lane, active-region shading, comp-end dim | `composition-timeline.svelte:io-lane` + `active-region-dim` + `comp-end-dim` | IO range + dim visibility test | DONE — in/out handles drag with one undo, left/right dims, end dim |
| Zoom / pan / fit | `composition-timeline.svelte:Slider` + `handleScroll` + `handleFit` + wheel not yet | zoom test | DONE — slider 0.25–4, scroll sync; MISSING wheel pan/zoom with Ctrl/Alt, bounded overscroll |
| Selected-key retime range, batch retime | FreeCut `motion-keyframe-selection.ts` + `MotionSelectionRetimeRange` | — | MISSING — needs selection time range header + edge drag that calls `buildMotionSelectionFrameUpdates` |
| Snapping and guides | `snapping.ts` calculateAdaptiveSnap + `buildSnapTargets` used in move/trim | — | PARTIAL — snap computed, no visible guide lines |
| Selection marquee | `composition-timeline.svelte:startMarquee` | — | DONE — box selects layer bars via overlap test |
| Clipboard (cut/copy/paste with MIME) | `composition-timeline.svelte:copy/paste` simple clone | — | PARTIAL — no `isTimelineTemplateDragData` MIME, no cross-composition cycle check |
| Nudge (Arrow, Shift+10) | `composition-timeline.svelte:handleKeydown ArrowLeft/Right` via `planLinkedMoveGesture` | — | DONE — 1 or 10 frames, linked propagation |
| Easing picker | `timeline/easing.ts` exists, no picker | — | MISSING — needs per-key segment easing popover |
| One atomic undo per gesture | `captureSnapshot` before, `commandHistory.addUndoEntry` on commit, `restoreSnapshot` on cancel | delete/parent/text-drag tests check undo | DONE — move/trim/reorder/rename/blend/trim-active/text/ kfdrag all use one entry; scrub excluded correctly |

## Span editing and safety

| FreeCut seam | OpenPost file | Test | Status |
|---|---|---|---|
| Layer span move via rAF-coalesced pointer preview | `composition-timeline.svelte:startBarPointerDown` + `onBarPointerMove` rAF | move tests not yet for multi | DONE — rAF coalesce, single preview, no per-frame history writes |
| Linked audio propagation | `planLinkedMoveGesture` + `expandMotionLayerItemIds` | — | DONE — move updates all linked ids via plan |
| Track / group locks block edit | `isTrackEffectivelyLocked` check in move/trim/nudge | text-lock test | DONE — prevents mutation and shows status |
| Transition blocking | `plan.blockedByTransition` check | — | DONE — shows `transition_blocked` status, no mutation |
| Cancellation on Escape / pointercancel / lost capture / unmount / sequence change | `handleKeydown Escape` + `pointercancel` + `lostpointercapture` + `onDestroy` + sequence effect | Escape cancel tested for text drag | DONE — restores snapshot, clears drag/pick/marquee |
| No duplicate parallel state owner | reuses `timelineStore`, `sequenceStore`, `motion-timeline-rows` only | — | DONE — no second items/tracks store; inline preview stays in local rAF state only |
| Avoid O(items*rows) scans in render | `motionPlan` once, `trackById` Map, `itemIndex` + `visibleIds` Set | — | DONE — rows derived once; visibleBars via index; no nested loops in template beyond filtered rows |
| No per-frame store writes / no whole-timeline DOM | rAF preview mutates via `_updateItems` only inside rAF, scrub writes via `_setCurrentFrame`; `visibleIds` culls | 320px overflow test | DONE — culling via index + selected keep-alive; large comp does not mount all bars |

## Visual and i18n

| FreeCut seam | OpenPost file | Test | Status |
|---|---|---|---|
| Compact OpenPost UI, quiet default, orange only for selection/action | `composition-timeline.svelte:<style>` dark tokens, `layer-row.selected` orange border, `layer-bar.selected` orange | 320px test | DONE — less crowded than FreeCut via 320px sidebar collapse, no extra chrome |
| 44px coarse targets, visible focus, keyboard names | `<style> @media (pointer:coarse)` min-height 44px, `:focus-visible` orange outline, `aria-label` on all controls | not yet full focus audit | DONE — coarse media query, focus-visible on all interactive; keyboard names via `m.*` |
| Localized copy in all ten locales, no raw English fallback | `frontend/messages/*.json` 6960 keys, `m.*` everywhere, `check-i18n` passes | — | DONE — 49 new keys added to all locales |
| No file-wide lint disables | no `oxlint-disable` in file | — | DONE |

## Performance

| Requirement | File | Status |
|---|---|---|
| Viewport-cull property/keyframe rows | `timeline-viewport` index + `visibleIds` + `filteredRows` | DONE — bars culled; property rows still rendered per visible layer only; full dopesheet cull pending when embedded |
| Coalesce pointer previews | rAF in `onBarPointerMove` + text drag live update | DONE |
| Avoid O(items*rows) scans | `motion-timeline-rows` O(n), `trackById` Map | DONE |
| No per-frame store writes | rAF batches, no `currentFrame` writes during drag except scrub | DONE |
| No whole-timeline DOM for large compositions | `visibleBars` + `visibleIds` | DONE for bars; inline dopesheet/graph still missing and would need same cull |

## Remaining gaps (must be closed before parity can be claimed)

- Inline dope-sheet and value-graph per expanded layer, with viewport cull and shared `keyframeSelectionStore`
- Procedural modifier bands and additive motion-layer bands as interactive lanes
- Property link pick-whip overlay and expression editor (direct links + sandboxed expressions)
- Published composition controls inline authoring
- Path vertex list lane for `shapeType === path`
- Mask lanes (toggle/feather/invert) where supported
- Separate `previewFrame` for exact playhead scrub (ghost playhead) without marking dirty
- Wheel pan/zoom (Ctrl-wheel zoom, Alt-drag pan) with guide snapping visuals
- Selected-key retime range header with batch retime via `buildMotionSelectionFrameUpdates`
- Easing picker per segment
- Full drag ghost for external media drop using `buildDroppedMediaTimelineItems` + validated track-type ghosts
- Controller items excluded from preview/export render (non-rendering flag)
- Editable in/out timing number fields per layer (FreeCut has them in timing columns)
- Group mute/solo inheritance into preview/audio graph (currently only lock checked)

The current branch preserves every behavior from the 1696-line starting component (selection, vector rows, text bands with cancel/undo, parent pick-whip with cycle toast, scrub without dirty, IO shading, zoom slider, 320px overflow) and adds the surfaces above. Parity is incomplete until the missing lanes and scrub/preview separation land.
