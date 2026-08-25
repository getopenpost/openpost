# FreeCut Depth Audit - Follow-Up

Skeptical source-level re-audit of the Video Editor against `references/freecut`
(rev `4d62e808`, 2026-08-07), triggered by the earlier waveform false positive
in [`freecut-parity-audit.md`](freecut-parity-audit.md). Method: for each sampled
PRESENT row, trace FreeCut's actual service/state/failure/cancellation/persistence/
preview/export/UI behavior into OpenPost source; file names, type names, and tests
alone were not accepted as parity. Focus areas were the largest LoC gaps: timeline,
editor shell, preview/runtime, keyframes, export, media-library. Audited 2026-08-25.

**Initial result: 12 confirmed behavioral gaps, none of which the parity audit
listed as PARTIAL or MISSING.** Most were unclaimed sub-capabilities of rows
marked PRESENT; two contradicted their row's evidence. The list below preserves
the audit evidence, while the resolution log records later product changes.

## Confirmed gaps (ordered by impact)

| #   | Gap                                                                      | FreeCut evidence                                                                                                                                                                                                                                                                                                                                                                                                    | OpenPost evidence                                                                                                                                                                                             | User impact                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Animated GIF/animated WebP play as a frozen first frame                  | Animated GIF/WebP items extract all frames with per-frame delays and animate on the timeline, in filmstrip tiles, and in export (`timeline/hooks/use-gif-frames.ts`, `timeline/services/gif-frame-cache.ts`, `timeline/components/clip-filmstrip/image-filmstrip.tsx`, `export/utils/canvas-item-renderer/image.ts` uses `getFrameAtTime` with speed scaling)                                                       | `.gif`/`.webp` map to plain image media (`media/media-file-types.ts:7,20`); no GIF/WebP frame extraction exists anywhere; image items render one decoded frame in preview and export                          | Any animated GIF/WebP imports "successfully" but previews and exports a still. Silent content loss; the audit's PRESENT row cites only docs copy that FreeCut itself contradicts in code.        |
| 2   | DTS/TrueHD audio silently unsupported; AC-3 not decodable at all         | Import worker flags undecodable codecs and the library shows an explicit dialog (`media-library/workers/media-processor.worker.ts` `UNSUPPORTED_AUDIO_CODECS`: dts/dtsc/dtse/dtsh/dtsl/truehd/mlpa; `media-library/components/unsupported-audio-codec-dialog.tsx`). AC-3/E-AC-3 decode via `@mediabunny/ac3` (`shared/utils/ac3-decoder.ts`, wired into waveform + audio-decode workers)                            | `media/import.svelte.ts:403` hardcodes `audioCodecSupported: true`; nothing consumes the field (`rg audioCodecSupported` finds no readers); only `@mediabunny/prores` is registered - no AC-3 decoder         | MKVs with DTS/TrueHD import cleanly, then preview silently without audio and export without it. AC-3 tracks never decode. No warning at any step; users discover missing audio after publishing. |
| 3   | Timeline has no viewport culling, density overview, or minimap navigator | `timeline/hooks/use-visible-items.ts` + `use-clip-visibility.ts` window clip rendering to the viewport (200 px margins); `timeline/components/timeline-density-overview.tsx` + `timeline-dom-density.ts` bucket very dense tracks and keep marquee selection working; `timeline/components/timeline-navigator.tsx` renders a draggable/resizable minimap thumb                                                      | `components/timeline-panel.svelte:3248` renders every item of every track unconditionally; no culling, bucketing, or navigator (`rg 'visibleItems\|virtualiz\|navigator'` is empty)                           | On long or dense sequences the timeline DOM grows unbounded: scrolling, dragging, and zoom get sluggish exactly when projects get big. No overview navigation for long-form timelines.           |
| 4   | No multi-select group transform gizmo on the canvas                      | `preview/components/group-gizmo.tsx` + `preview/utils/group-transform-calculations.ts`: bounding-box handles move/scale/rotate all selected visual items together, updating per-item transforms/keyframes                                                                                                                                                                                                           | `components/preview-player.svelte:1030` passes one `selectedResolved` item to `OnCanvasTools`; `preview/on-canvas-tools.ts` is single-item throughout                                                         | Multi-select scale/rotate must be done clip-by-clip with numeric fields. The audit's PRESENT transform-gizmo row does not disclose the single-item limitation.                                   |
| 5   | No canvas snap guides during transform drags                             | `preview/utils/canvas-snap-utils.ts` snaps drags to canvas edges, center, and percentage positions with 8 px enter / 18 px exit hysteresis; `preview/components/snap-guides.tsx` draws labeled guide lines                                                                                                                                                                                                          | `preview/on-canvas-tools.ts` has only 15-degree rotation snapping (`on-canvas-tools.ts:294-313`); position/size drags snap to nothing                                                                         | Aligning overlays, PiP windows, and lower thirds by hand requires numeric x/y edits; FreeCut gives magnetic guides.                                                                              |
| 6   | Center points of positional GPU effects are not editable on canvas       | `infrastructure/gpu-effects/spatial-point-editor.ts` maps 7 effects (twirl, bulge, trigger-wave, radial-blur, zoom-blur, ripple-glass, droste) to draggable canvas points with keyframe-aware updates (`preview/components/spatial-effect-point-overlay.tsx`)                                                                                                                                                       | All 7 effects exist in `effects/gpu/shaders/distort.ts` but parameters are edited only numerically via `components/gpu-param-control.svelte`; no point overlay                                                | Center-dependent effects (radial blur, bulge, twirl...) require typing normalized coordinates blind instead of dragging the visible center.                                                      |
| 7   | Track push/pull gesture missing                                          | `timeline/hooks/use-track-push.ts`: drag the left edge of a clip that has a gap to shift all items at/after that point across every track, clamped by the tightest gap, snapped, with live preview store                                                                                                                                                                                                            | No equivalent: `rg 'track.?push'` across `frontend/src/lib/video-editor` is empty; edit-gesture implements trim/roll/slip/slide/rate-stretch only                                                             | Inserting room mid-timeline means manually selecting and moving every downstream clip or repeated ripple operations.                                                                             |
| 8   | Multi-select align/distribute tools missing                              | `preview/components/alignment-hud.tsx`: align left/center/right/top/middle/bottom, distribute horizontally/vertically, magnet-to-center, auto-keyframe aware                                                                                                                                                                                                                                                        | `rg 'distribute'` across the editor is empty; no alignment actions anywhere                                                                                                                                   | Arranging multi-element layouts (PiP grids, caption blocks) is manual numeric work; bento presets cover only fixed arrangements.                                                                 |
| 9   | Audio mixer and level meters missing                                     | `editor/components/audio-mixer-view.tsx` (per-track channel strips with dB faders, mute/solo, master fader) + `audio-meter-panel.tsx` segmented live meters + `shared/state/mixer-live-gain.ts`; docs p12 "Mixer and meters"                                                                                                                                                                                        | Per-track volume exists in the model/render path (`project/types.ts`, `media/render-plan.ts:308-332`) but there is no fader UI and no playback metering (`rg 'mixer\|meter'` matches only mic input metering) | Balancing levels means selecting clips one at a time and watching no meters; the audit has no mixer row at all - an inventory omission, not just an implementation gap.                          |
| 10  | Media-pool drag onto the timeline missing                                | `media-library/components/media-card.tsx` is draggable; `use-media-library-drag-drop.ts` + `timeline/hooks/use-external-drag-preview.ts` show a placement ghost on the timeline                                                                                                                                                                                                                                     | `components/media-pool-list.svelte` offers button insertion (`addToTimeline`, line 286); drag placement exists only for scene results (`timeline-panel.svelte:1229`)                                          | Placing media at a specific track/time requires insert-then-move; scene results alone support direct drag.                                                                                       |
| 11  | No non-destructive hover skimming or ghost playhead                      | `timeline/components/timeline-content.tsx` publishes a separate `previewFrame` on hover, coalesces pointer work through `requestAnimationFrame`, suppresses it during playback, drags, zoom, and dialogs, and clears it on leave; `timeline-preview-scrubber.tsx` + `shared/ui/timeline-preview-scrubber-visual.tsx` draw the ghost line, handle, and timecode while the program monitor renders that preview frame | `components/timeline-panel.svelte` changes the committed playhead only during ruler presses and drags. There is no separate hover-preview frame, ghost playhead, or hover-driven program-monitor render path. | Inspecting another frame currently moves the real playhead. FreeCut can skim the program monitor and timecode without changing the edit position.                                                |
| 12  | No clear-keyframes command for selections                                | `editor/components/clear-keyframes-dialog.tsx`: Shift+A/context-menu clears all keyframes, or one property's keyframes, across the multi-selection, with confirmation and undo hint                                                                                                                                                                                                                                 | `timeline/actions/keyframes.ts` supports `removeKeyframes` by explicit refs only (dope-sheet selection); the inspector exposes no per-property or item-level clear                                            | Removing animation from several clips means marquee-selecting every key in the dope sheet per property.                                                                                          |

## Resolution log

- 2026-08-25: gap 1 resolved. GIF and WebP import probing records real
  composited frame count, loop duration, and effective frame rate. A cancellable
  worker decodes every frame with exact container timing, a shared 100 ms
  zero-delay fallback, an explicit 2,000-frame safety limit, bounded LRU memory,
  and OPFS persistence. Timeline filmstrips, preview, reverse and speed playback,
  still capture, and full or range export share the same frame clock. Export
  rejects decode or missing-frame failures instead of silently using a poster.
  Generation-guarded clearing, pinned eviction, terminal cancellation, and
  main-thread and worker bitmap cleanup prevent stale writes, hangs, and GPU
  leaks. Focused timing, lifecycle, persistence, probe, and export tests plus
  real Chromium GIF/WebP pixel checks cover the full path.
- 2026-08-25: gap 2 resolved. Import probing now records codec support, DTS and
  TrueHD require an explicit import-without-audio decision, and AC-3/E-AC-3 use
  the lazy `@mediabunny/ac3` decoder in main-thread and worker realms. Real
  Chromium fixtures prove probing, preview PCM, progressive waveform peaks,
  transcription PCM, processed-media preservation, and WAV export. Silence
  analysis and full video export share the same tested `AudioSampleSink` path.
- 2026-08-25: gap 12 resolved. Shift+A and the timeline toolbar open a scoped
  clear-keyframes confirmation across the multi-selection. Scalar, effect,
  path-vertex, and coupled vector lanes clear atomically; locked tracks stay
  unchanged, the dialog reports exact key counts, and one undo restores the
  full selection edit. A real 320 px Chromium test covers the visible warning,
  44 px action, mutation, lock behavior, and one-step history.
- 2026-08-25: gap 5 resolved. Direct move and resize gestures now snap to
  canvas edges, centers, 25 percent divisions, and neighboring visible layer
  edges and centers. The 8 px enter and 18 px release thresholds stay constant
  across preview scales, rotated and off-center-anchor bounds use their visual
  AABB, Alt bypasses snapping, the shared magnet disables it, and localized
  live guides show each held target. Focused geometry tests cover thresholds,
  hysteresis, rotation, item alignment, aspect-locked and free resize; a real
  Chromium pointer test covers the visible guide, snapped commit, cleanup, and
  Alt bypass.
- 2026-08-25: gap 11 resolved. Mouse hover publishes a volatile preview frame
  through one animation-frame-coalesced store without changing the committed
  playhead. The timeline draws a separate ghost line, handle, and full timecode,
  while the program monitor resolves transitions, keyframes, effects, stacked
  blends, subtitles, text motion, video, nested compositions, Lottie, and
  animated GIF/WebP at that frame. Audio stays on the committed playhead. Hover
  preview clears on leave, playback, zoom, dialogs, and every edit gesture, and
  stays disabled for touch and button-down input. Focused store tests and real
  Chromium component tests cover latest-pointer coalescing, desktop and 320 px
  layout, playback and touch suppression, monitor rendering, cleanup, and the
  unchanged committed frame.
- 2026-08-25: gap 6 resolved. Twirl, bulge, trigger wave, radial blur,
  zoom blur, ripple glass, and Droste now expose a single explicit canvas
  center editor. OpenPost maps the shader's source-texture UV through crop,
  transform, custom anchor, rotation, flips, parent motion, and projective
  corner pin so the handle stays on the exact preview and export point. Drag
  previews coalesce to one update per animation frame and commit both parameter
  lanes in one undo step, including existing and automatic keyframes. Escape,
  pointer cancellation, lost capture, item or effect changes, multi-selection,
  and effective track locks clear drafts without a late write. The spatial
  editor owns the program monitor while active, supports precise keyboard
  nudges and a 44 px handle, and uses localized copy in all ten editor locales.
  Pure homography and source-UV tests plus real Chromium overlay, inspector,
  program-monitor, cancellation, keyboard, 320 px, and lock tests cover the
  integrated path.
- 2026-08-25: gap 9 resolved. Audio tracks now expose compact channel strips
  with -60 dB to +12 dB faders, mute, solo, true stereo level meters, peak
  hold, clipping state, and one master strip. Preview uses one shared audible
  path per source through stable track buses and one master bus; analyser taps
  terminate through a silent branch, so they cannot sum channels or double
  gain. Each attachment owns one cleanup handle, meter reads never allocate or
  retain nodes, and live faders work from silence through boosted levels.
  Pointer drafts coalesce per animation frame, commit one undo record, and
  restore exact audio and UI state on Escape, pointer cancellation, lost
  capture, panel close, or lock. Keyboard and double-click edits stay atomic.
  Root and nested sequence master settings persist through navigation, undo,
  direct export, queued export, and project saves. Preview, rendered video,
  audio-only export, and smart-copy eligibility share the same gain truth.
  Actual OfflineAudioContext samples prove asymmetric stereo, one-time track
  and master gain, mute, and attachment ownership; a real AC-3 WAV export
  proves exact -6.02 dB amplitude and master silence. Chromium component tests
  cover gestures, cancellation, locks, narrow layout, and the timeline entry.
- 2026-08-25: gap 10 resolved. Ready media and nested sequences can now be
  dragged from the media pool to an exact timeline row and frame through a
  versioned OpenPost-only MIME payload. The timeline coalesces pointer work,
  snaps the start and end against the shared target set, auto-scrolls at both
  edges, and shows a green or rejected ghost before any mutation. Compatibility,
  inherited locks and visibility, occupied ranges, missing companion audio
  rows, and composition cycles reject the shown position instead of silently
  choosing or creating another track. Mixed nested sequences preview and insert
  linked visual and audio wrappers on both shown rows as one undo step. The
  media action also opens the same placement mode for keyboard and touch input:
  arrows choose the row and frame, Enter commits, Escape cancels, and a tap
  places at the touched frame. Pure payload, collision, duration, companion-row,
  and edge-scroll tests combine with real Chromium drag, rejection, linked
  composition, repeated keyboard, touch, undo, and 320 px visual checks.
- 2026-08-25: gaps 4 and 8 resolved together. Selecting two or more active
  visual clips now draws one canvas AABB with pointer, keyboard, and touch-sized
  move, corner-scale, and rotation controls. The exact geometry accounts for
  rotated layers and custom transform anchors; uniform scaling preserves every
  anchor and relative offset around the visual group center, and Shift snaps
  rotation to 15-degree steps. Move and scale share canvas, neighboring-layer,
  hysteresis, Alt-bypass, and visible-guide behavior with the single-item
  tools. A compact localized toolbar aligns every selected visual bound to all
  six canvas axes, distributes three or more unequal rotated bounds by equal
  edge gaps, and exposes the shared magnet. Group scaling also scales font,
  spacing, padding, background, shadow, stroke, and per-span text metrics;
  frame-scoped scale animation keys those metrics at the same frame. Existing
  and automatic keyframes, selected parent-child transforms, effective locks,
  selection changes, Escape, pointer
  cancellation, and one-step undo stay atomic; a failed item rolls the whole
  group edit back. Pure custom-anchor, rotation, scaling, hit-test, snapping,
  alignment, distribution, and changed-property tests combine with real
  Chromium pointer, keyboard, cancellation, selection, accessibility, and 320
  px visual checks.
- 2026-08-25: gap 7 resolved. A dedicated track push/pull tool now moves every
  clip at or after the chosen cut across all tracks from one stable baseline.
  Left movement stops at the tightest gap on any affected track, while the
  anchor edge shares timeline snapping and its visible guide. Hidden unlocked
  clips participate. An affected direct or group-inherited lock blocks the
  whole operation so track timing cannot split around locked content. Pointer
  previews coalesce to one animation frame, Escape and pointer cancellation
  restore items and transitions, and commit records one undo step. Keyboard
  arrows move one or ten frames, touch uses the same Pointer Events path, and
  short localized copy explains missing gaps and downstream locks. Transition
  pairs entirely before or after the cut stay intact; a pair that straddles the
  cut hides during preview and is removed only on commit. Pure planning tests
  cover global participants, the tightest clamp, snapping, hidden tracks,
  inherited locks, and transition partitions. Real Chromium covers live
  preview, cancellation, transition cleanup, undo, exact keyboard steps,
  locked feedback, and the 320 px layout.
- 2026-08-25: gap 3 resolved. Timeline rows now use an interval index to mount
  only clips and transitions inside a bounded viewport overscan, including long
  clips whose starts sit offscreen. Dense rows collapse compact clips into at
  most 1,024 indexed density buckets, cap rich clip roots at 256, and promote a
  bounded selection without losing the primary item. Bucket presses enter the
  normal drag path, while geometry-backed marquee selection still reaches
  unmounted clips and records no edit history. Scroll work coalesces through one
  animation frame. A project-wide navigator renders bounded density, pans with
  a draggable viewport, zooms from either edge, supports keyboard and Escape
  rollback, and keeps 44 px coarse-pointer handles with an 88 px minimum thumb.
  Pure tests cover long overlaps, sparse and dense overscan, 30,000 compact
  clips, 10,000 overlapping wide clips, root caps, selection promotion, and
  navigator math. Forty-one real Chromium tests cover culling swaps, density
  interaction, geometry marquee, pan, resize, cancellation, undo boundaries,
  and the 320 px layout.
- 2026-08-25 (additive): MotionAnimationLayer gap resolved. FreeCut's `MotionAnimationLayer` (add/multiply blending after base keyframes, before procedural modifiers) was missing from OpenPost types, evaluator, preview, export, saved-animation capture, and UI. Added durable typed `MotionAnimationLayer`/`MotionLayerTrack`/`MotionLayerKeyframe` with `add` (x,y,rotation,opacity) and `multiply` (width,height) blending in `timeline/motion-layer-eval.ts`, ordered evaluator `animated-properties.ts:resolveAnimatedItemLocalAt` (keyframes -> layers -> modifiers), one-step undo actions `timeline/actions/motion-layers.ts` (apply/remove/enable/rename and preset-as-layer with staggered multi-selection), clone-safe `project/project-clone.ts` and saved-animation capture, bake support covering layers, and focused accessible Motion workspace UI (`components/motion-presets-panel.svelte` additive layers section with toggle/remove and Add layer per preset, 320 px wrap, 10-locale strings). Pure evaluator plus Chromium layer-panel tests cover stacking, enable, independent removal, and keyboard targets.
  Current unresolved count: 0.

## Rows checked with no gap found

Verified down to constants, wiring, and failure paths; parity holds.

| Claim spot-checked                                                                      | Evidence both sides                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adaptive snapping threshold                                                             | FreeCut `calculateAdaptiveSnapThreshold` (`timeline/utils/timeline-snap-utils.ts:168`) = base px / sqrt(zoom), min 1 frame; identical math in `timeline/snapping.ts:41-42`.                                                                                    |
| Ctrl-wheel timeline zoom coalesced to one update per animation frame around the pointer | FreeCut `use-timeline-zoom.ts`; OpenPost `timeline-panel.svelte:2285-2310` queues level+anchored scrollLeft and flushes via `requestAnimationFrame`.                                                                                                           |
| Waveform row (the prior false positive) is genuinely fixed                              | `media/waveform-worker.ts` streams progress/partial peaks; `waveform-client.ts` `subscribeWaveform` renders partial data reactively; panel subscribes per media id.                                                                                            |
| Adaptive preview quality staged caps/EMA/cooldown                                       | `preview/adaptive-preview-quality.ts`: scales `[0.25,0.33,0.5,1]`, EMA alpha 0.2, degrade/recover thresholds match claim; changes real render size.                                                                                                            |
| Scrub proxy fallback numbers                                                            | `preview/scrub-proxy-fallback.ts:4-5`: 60 ms stall, 0.75 s max drift - exact.                                                                                                                                                                                  |
| Decoder prewarm budget                                                                  | `preview/prewarm-plan.ts` limit 2 boundaries / 2.5 s lookahead; `decoder-prewarm-client.ts` 12 MP LRU cap.                                                                                                                                                     |
| Audio skim grain length                                                                 | `audio/audio-skim.ts:9` `DEFAULT_GRAIN_SECONDS = 0.045`.                                                                                                                                                                                                       |
| Reverse conform resolution                                                              | `media/reverse-conform-service.ts`: shared 1280x720 conform, fingerprinted, cancellable.                                                                                                                                                                       |
| Proxy height                                                                            | `media/proxy-client.ts:16` `PROXY_MAX_HEIGHT = 540`.                                                                                                                                                                                                           |
| Transition catalog breadth                                                              | FreeCut 44 built-in presentations (`types/transition.ts`); OpenPost registry contract test asserts exactly 44 entries with GPU fallback (`transitions/transitions.test.ts:67-69`).                                                                             |
| Dope-sheet claimed behaviors                                                            | Marquee, retime, duplicate, clipboard/paste, locks, animated/search/group filters all present in `components/keyframe-dopesheet.svelte` + `timeline/keyframe-dopesheet.ts`; value graph has fit/zoom/Alt-duplicate (`components/keyframe-value-graph.svelte`). |
| Render queue semantics                                                                  | pause/resume/cancel/retry/reorder/persisted hydrate in `export/render-queue-store.ts`, `render-queue-runner.ts`, `render-queue-panel.svelte` (OpenPost even adds reorder FreeCut lacks).                                                                       |
| Smart-copy guard rails                                                                  | `media/render-export.ts:730-750` assesses eligibility, falls back safely on source metadata change, keeps sidecar SRT.                                                                                                                                         |
| Transcription engine fallback                                                           | Engine resolution reports `fallbackReason` and fires `onFallback` (`transcript/engine/transcriber.ts:36`); Parakeet and Whisper workers exist.                                                                                                                 |
| Background media-task aggregation/cancellation                                          | `media/media-tasks.svelte.ts`: queued/running/cancelling states, per-owner cancel handlers.                                                                                                                                                                    |
| Transition duration resize gesture                                                      | Drag-resize wired in `timeline-panel.svelte:432-663` mirroring FreeCut `use-transition-resize.ts`.                                                                                                                                                             |

## Valid Svelte consolidation (not gaps)

- **Export renderer sharing the preview compositor**: FreeCut keeps a parallel
  canvas-item-renderer stack in `features/export` (~25k LoC); OpenPost reuses
  `media/canvas-stack-compositor.ts` + `media/render-plan.ts` for preview, stills,
  and export (~9.7k total). Same output contract, less duplicated logic.
- **Dope sheet as two files vs 89 React files**: much of FreeCut's
  `dopesheet-editor/` is React plumbing around behaviors OpenPost implements once
  in shared stores; claimed behaviors verified present above.
- **Preview runtime smaller than FreeCut's pump**: OpenPost drives native video
  element playback plus targeted prewarm rather than FreeCut's full render-pump /
  scrubbing-cache machinery. Output-equivalent today; revisit if scrub latency on
  heavy timelines regresses.
- **Eager waveform generation**: OpenPost decodes waveforms for all audio-bearing
  timeline media instead of FreeCut's viewport-gated prefetch. More eager work,
  same user-visible result; watch memory on huge projects.

## Production LoC method and results

Method: `find ... | xargs wc -l` over `.ts/.tsx/.svelte`, excluding test files
(`*.test.*`, `*test*` for OpenPost) and FreeCut test helpers; FreeCut's
`features/docs` in-app help pages (3,514 LoC) excluded per audit scope. FreeCut
also keeps production code outside `src/features` (`infrastructure`,
`runtime`, `shared`, `types`), which the parity audit's directory framing ignored.

| Area (mapped)                            | FreeCut production LoC                                                            | OpenPost production LoC                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Timeline editing & gestures              | 88,078 (`features/timeline`)                                                      | 17,761 (`timeline` + `sequences`)                                                             |
| Preview/playback runtime                 | 44,697 (`features/preview` 41,318 + `runtime/player` 3,379)                       | ~9,915 (`preview` 2,339 + `audio` 4,852 + preview-player/layer/transport 2,724)               |
| Editor shell, panels, workspaces         | 46,463 (`features/editor`)                                                        | 36,660 (`components` + `workspaces` + editor routes)                                          |
| Keyframes & animation                    | 26,452 (`features/keyframes`)                                                     | ~11,090 (keyframe/easing/motion/vector files inside `timeline`, `effects`, `components`)      |
| Export & render queue                    | 25,468 (`features/export`)                                                        | ~9,717 (`export` + `media/render-*`, smart-copy, preflight)                                   |
| Media library & local AI                 | 32,131 (`features/media-library` + storage infra)                                 | ~24,669 (`media` 18,931 + `local-ai` 2,912 + `workspace-fs` 2,826)                            |
| Effects/color/scopes/shapes/transitions  | ~14,700 (`features/effects` 6,385 + `infrastructure/gpu-*` ~13,900 minus overlap) | ~19,000 (`effects` 9,580 + `transitions` 5,781 + `shapes` 1,308 + typography/lottie/stickers) |
| Cross-cutting runtime/composition engine | 20,066 (`runtime/composition-runtime`) + `shared` 26,283                          | distributed across stores/actions (no single counterpart)                                     |
| **Total production**                     | **369,361**                                                                       | **118,192** (incl. page + `$lib/media` helpers)                                               |
| Tests (reference)                        | 133,763                                                                           | 44,289                                                                                        |

Reading: OpenPost is not a shallow port - effects, transitions, local AI, and
persistence areas meet or exceed FreeCut depth, and several gaps above were
closed in prior passes (waveforms, scopes, transitions catalog). But overall
production LoC remains 32.0% of FreeCut's. The twelve source-audit gaps are now
closed. The size difference remains concentrated in React component and state
plumbing plus FreeCut's separate preview, export, and shared runtime stacks,
where OpenPost reuses Svelte stores, actions, and one compositor.
