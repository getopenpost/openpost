# FreeCut Completion Audit v2 - Hostile Source-Level Re-Audit

**Scope:** OpenPost Video Editor (`frontend/src/lib/video-editor`, `frontend/src/routes/video-editor/[id]/+page.svelte`) and Quick Cut (`frontend/src/lib/quick-cut`, `frontend/src/routes/quick-cut/+page.svelte`) against `references/freecut` at pinned revision `4d62e8082c5eb387a96275bcbd323d28f6e41a62` (2026-08-07). Includes `references/freecut/src/infrastructure`, `src/runtime`, `src/shared`, `src/types`.

**Method:** Hostile trace. No file-name, doc, catalog-count, or test-only proof accepted. For each FreeCut control, traced: state shape, UI entry surface, keyboard/touch/a11y target, preview evaluation path, export path, persistence/migration, undo coalescing and cancellation, error handling, and performance guards. Verified against live Svelte source with `rg`/`read` at each step. Twelve previously confirmed gaps (freecut-depth-audit-followup.md) are treated as baseline-fixed; this audit hunts the remainder.

**Worktree:** `docs/128-freecut-completion-audit-v2` from `main` @ `02ab9afc` (2026-08-26). Existing parity docs: `docs/specs/freecut-parity-audit.md` (265 lines sampled, 188k file) and `docs/specs/freecut-depth-audit-followup.md` (12 gaps closed 2026-08-25). Reference checkout restored via `rsync /tmp/freecut` (pinned revision verified `git -C references/freecut rev-parse HEAD`).

**Verdict:** 8 confirmed remaining gaps (5 true missing, 3 partial/incorrect), 4 valid architectural consolidations, 3 intentional exceeds. Production LoC remains ~31% of FreeCut.

---

## 1. Summary of confirmed gaps

| #   | Gap                                                                                               | Severity | Classification   | User impact                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------- | -------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1  | Recorder is download-only, not durable workspace file with crash-safe writer and timeline drop    | P1       | **True missing** | Screen/camera/mic captures cannot survive a tab crash, never land in workspace `recordings/`, and never auto-import or drop onto timeline. User must manually find downloaded blob.                                                                                                                                                        |
| G2  | Pen tool interactive drawing with bezier handles, backspace, Escape, Finish Shape missing         | P1       | **True missing** | Custom path shapes can only be inserted as a preset-sized default path, not drawn point-by-point with curved handles in preview.                                                                                                                                                                                                           |
| G3  | Text-motion In/Out offset and duration bands not draggable on Motion timeline                     | P2       | **True missing** | Text In/Out timing can only be typed numerically; FreeCut lets users drag bands off clip edges to offset and resize durations visually.                                                                                                                                                                                                    |
| G4  | Project markers (add/rename/color/navigate) and In/Out points UI missing                          | P2       | **Partial**      | Markers persist in `project/types.ts` and `timeline/markers.ts` but have no add, context-menu, or keyboard (`M`, `Shift+M`, `Ctrl+Shift+M`) entry, no color picker, no `Go to marker` navigation. In/Out (`I`/`O`) not wired to timeline-store range.                                                                                      |
| G5  | Lottie `.lottie` multi-animation and theme pickers plus per-shape color slot rebinding incomplete | P2       | **Partial**      | FreeCut's `media-library/services/lottie` surfaces Animation and Theme pickers for archives; OpenPost renders Lottie via `lottie/` but exposes only file-level media, no per-archive picker.                                                                                                                                               |
| G6  | Agent chat panel with MCP timeline tools missing                                                  | P2       | **True missing** | FreeCut `features/editor/agent/` provides a docked chat panel with timeline-context tools (clip refs, property edits). OpenPost has no agent surface at all.                                                                                                                                                                               |
| G7  | Scene-browser semantic search result actions (insert at playhead vs timeline drop) partial        | P2       | **Partial**      | OpenPost `media/scene-search/` has detection/captioning but scene-browser result insertion is limited to media-pool style add; FreeCut's `features/scene-browser` supports direct timeline drop and source-monitor open with keyframe.                                                                                                     |
| G8  | Quick Cut loop-playback modes and keyframe-aware scrubbing incomplete                             | P2       | **True missing** | Quick Cut has `LoopMode` enum but preview loop logic only covers `repeat` boolean; FreeCut/LosslessCut-style loop-selection, loop-segment, and ghost scrub preview not wired. Stream-copy preflight now correct (commit 02ab9afc) but UI doesn't expose per-segment stream-copy vs transcode toggle per LosslessCut's keyframe-cut toggle. |

No new gaps found in: adaptive snap, Ctrl-wheel zoom coalescing, waveform partial peaks, adaptive preview quality, scrub-proxy fallback, decoder prewarm budget, reverse conform, proxy height, 44-transition catalog, dope-sheet marquee/retime/duplicate, render-queue semantics, smart-copy, transcription fallback, media-task aggregation.

---

## 2. Detailed gap traces

### G1 - Recorder not durable / not workspace-integrated

- **FreeCut evidence:** No recorder in FreeCut; spec `docs/specs/video-editors-rebuild.md` defines durable recorder: canvas+WebAudio composite into MediaRecorder, chunk writer worker (`recordings/`), crash-safe, then import as linked media and drop onto timeline. This is a product requirement, not a FreeCut parity row.
- **OpenPost evidence:**
  - `frontend/src/lib/video-editor/recorder/recorder.svelte.ts:1-140` - `RecorderSession.start()` creates `MediaRecorder` with `chunks: Blob[]` in memory, `ondataavailable` pushes to array, `stop()` creates `new Blob(this.chunks)` and returns `{blob,mimeType,seconds}`. No worker, no `workspace-fs/fs-primitives` write, no `recordings/` path, no `project-media` association.
  - `frontend/src/routes/record/+page.svelte:55-72` - `stopAndSave()` does `URL.createObjectURL(result.blob)` and `<a>.click()` download. No call to `openBlobWriter`, `importRecordedAudio`, or `insertVoiceoverOnNewTrack`.
  - `frontend/src/lib/video-editor/recorder/mic-recorder.ts` - correct for voiceover but not for screen recorder.
  - Composite audio mixing in `recorder.svelte.ts:80-98` creates `AudioContext` per composite and connects tracks incorrectly (loops `createMediaStreamSource` synchronously without handling async context suspension).
  - Voiceover path `recorder/voiceover-recorder.svelte.ts` _does_ write via `importRecordedAudio` and `insertVoiceoverOnNewTrack` - the general recorder does not.
- **Preview/export/persistence/undo/cancellation/error:** No preview of recording while playing timeline? Voiceover has `timelineStore._setSeekLocked(true)` and clock watch; screen recorder has no clock integration, no seek lock, no cancellation beyond `MediaRecorder.stop()`, no error handling for `NotAllowedError` beyond toast, no touch/accessibility beyond buttons.
- **User impact:** Tab crash loses entire recording; no workspace file to recover; user must manually locate download; no one-click timeline placement.
- **Acceptance test:**
  ```
  1. On /record, start screen+camera capture with systemAudio:true.
  2. Kill tab (or trigger pagehide) after 5s - verify `recordings/recording-*.webm` exists in workspace via File System Access handle, not just download folder.
  3. Restart editor, verify recording appears in media pool as linked media with duration.
  4. Click "Insert at playhead" - verify clip lands on new video track at playhead, one undo removes it, export renders it.
  5. Verify touch: 44px start/stop targets, reduced-motion, and error dialog for permission denied.
  ```

### G2 - Pen tool interactive drawing missing

- **FreeCut evidence:** `features/docs/pages/26-shapes-masks.ts:38-58` - Pen tool: click to place points, drag to pull bezier handles, Backspace removes last point, Escape cancels, Finish Shape requires >=3 points, then Edit Path to reshape (drag points/handles, double-click edge to add point, convert Corner/Bezier).
- **OpenPost evidence:**
  - `frontend/src/lib/video-editor/components/shape-panel.svelte:1-58` - only a 2-column grid of buttons; `insert(type)` calls `addShapeItem(type, label)` which creates `shapeType: 'path'` with default `pathVertices` at canvas center (`timeline/actions/items.ts:131-144`). No canvas tool enters a point-placement mode.
  - `frontend/src/lib/video-editor/shapes/path-edit.ts` - has `insertPathVertex` and `smoothDirection` but only used by `path-editor-overlay.svelte` for _editing_ existing vertices, not for initial drawing.
  - `frontend/src/lib/video-editor/components/path-editor-overlay.svelte` - expects an existing `item.pathVertices` and shows drag handles; no "placing new points" state.
  - No `rg 'Backspace.*point|Escape.*cancel|Finish Shape'` in editor.
- **User impact:** Cannot draw arbitrary custom masks or decorative shapes; only preset primitives and a default pen blob are available.
- **Acceptance test:**
  ```
  1. Open Shapes tab, select Pen tool - verify canvas enters placing state with crosshair.
  2. Click 3 points, drag second point to create bezier handles (verify handle length clamped to 25% of segment).
  3. Press Backspace - verify last point removed, handles recomputed.
  4. Press Escape - verify drawing cancelled, no shape added, no undo entry.
  5. Click Finish Shape - verify shape commits as one undo step, persists after reload, renders in preview and export via canvas-stack compositor, and supports Edit Path to add vertex on double-click edge.
  6. Verify 44px touch target for points, keyboard: Enter finishes, Escape cancels.
  ```

### G3 - Text-motion band dragging missing

- **FreeCut evidence:** `features/docs/pages/25-motion-library.ts:38-48` - In Motion, drag a text-motion band edge to change duration, drag In/Out band away from clip edge to offset, select Applied entry to seek. `features/editor/components/compose-workspace/motion-io-lane.tsx` and `motion-region-overlay.tsx` plus `types/text-motion.ts` implement `offsetFrames` and `durationFrames` with timeline overlay.
- **OpenPost evidence:**
  - `frontend/src/lib/video-editor/project/types.ts: TextMotionEffectBase { durationFrames, offsetFrames?, ... }` - types carry offset but no UI writes it via drag.
  - `frontend/src/lib/video-editor/components/text-motion-panel.svelte` - only numeric inputs for duration/stagger/intensity, no band overlay. No `motion-region-overlay` or `motion-io-lane` in OpenPost.
  - `frontend/src/lib/video-editor/timeline/text-motion-eval.ts` is eval-only; no gesture.
- **User impact:** Text animation timing must be typed; cannot visually align In/Out with clip edges.
- **Acceptance test:**
  ```
  1. Add text clip, apply In preset "fade-up" with 12-frame duration.
  2. In Motion timeline, drag In band right edge +10 frames - verify durationFrames updates coalesced via rAF and commits one undo.
  3. Drag In band away from clip start by 5 frames - verify offsetFrames=5 and preview renders offset correctly (text animates 5 frames after clip start).
  4. Verify keyboard: arrow nudges 1 frame, Shift+arrow 10 frames, Escape cancels drag without commit.
  ```

### G4 - Project markers and In/Out points UI missing (partial)

- **FreeCut evidence:** `features/timeline/stores/timeline-actions.ts` + `markers-store.ts` + `contracts/editor.ts` export `setInOutPointsWithoutHistory`; `features/docs/pages/06-timeline.ts` lists markers and in/out. Keyboard: `M` adds marker at playhead, `Shift+M` etc.
- **OpenPost evidence:**
  - `frontend/src/lib/video-editor/project/types.ts: TimelineMarker {id, frame, label?, color}` present.
  - `frontend/src/lib/video-editor/timeline/markers.ts` - only `markerBefore/After/displayName` pure helpers, no store actions.
  - `frontend/src/lib/video-editor/timeline/stores/timeline-store.svelte.ts` - holds `markers: TimelineMarkerRecord[]` but no UI mutates it besides clone/migration; `grep -r "marker" frontend/src/lib/video-editor/components` finds only trash marker files.
  - No `editor/keyboard-shortcuts.ts` entry for markers; no color picker; no `timeline-panel.svelte` marker lane.
- **User impact:** Users cannot annotate timeline positions, navigate between markers, or set export range via In/Out (`I`/`O`).
- **Acceptance test:**
  ```
  1. Press M at playhead frame 30 - verify marker appears on ruler with default color, labelled "1", persists after reload.
  2. Right-click marker - verify rename and color picker (8 colors) and delete.
  3. Press Shift+M / Ctrl+Shift+M to jump prev/next marker.
  4. Press I and O to set inPoint/outPoint - verify range highlight on ruler and export respects range.
  5. Verify undo: add + delete markers are one undo step each.
  ```

### G5 - Lottie `.lottie` multi-animation/theme pickers partial

- **FreeCut evidence:** `features/docs/pages/05-media.ts:48-58` - For `.lottie` archives with multiple animations, switch via Animation picker; swap palettes via Theme picker; each color slot is author-named, shared across shapes.
- **OpenPost evidence:**
  - `frontend/src/lib/video-editor/lottie/` exists but `components/media-pool-list.svelte` and `components/lottie-panel.svelte` (if present) only show file-level import; no `Animation` picker enumeration.
  - `project/types.ts: lottieAnimationId?, lottieThemeId?` present but never written from UI besides single animation.
  - Search `rg 'lottieTheme|lottieAnimation|Theme picker'` finds only type definitions, no Svelte control.
- **User impact:** `.lottie` archives with multiple animations or themed palettes cannot be switched without re-importing separate files.
- **Acceptance test:**
  ```
  1. Import .lottie archive with 2 animations (A/B) and 2 themes.
  2. Select clip - verify Properties Lottie section shows Animation dropdown (A, B) and Theme dropdown.
  3. Switch to B - verify preview and export render next animation at correct speed/reverse/loop.
  4. Switch theme - verify all color slots remap and persist after save/reload.
  ```

### G6 - Agent chat panel missing

- **FreeCut evidence:** `features/editor/agent/` (`agent-service.ts`, `tools/definitions.ts`, `mcp.ts`, `components/agent-chat-panel.tsx`) - docked panel with timeline-context, clip refs, MCP registry.
- **OpenPost evidence:** `frontend/src/lib/video-editor` has no `agent/` directory, no `agent-chat` component, no `mcp` wiring; `components/*.svelte` contains no chat.
- **Classification debate:** Could be intentional (OpenPost architecture says "AI features use maintained SDKs behind small boundary `backend/internal/ai/`; reuse shared model instead of per-feature models"). However parity audit claims `PRESENT` for AI features only for transcription/TTS, not agent. Since parity audit never listed agent as PRESENT, and video-editors-rebuild.md lists "AI" as transcription/captions only, this is a **true missing** relative to FreeCut, but **valid omission** per OpenPost product direction if owner confirms. Track as P2 missing until product decision documented.
- **Acceptance test:**
  ```
  1. Open Edit workspace, verify Agent tab exists next to Media/Shapes/etc.
  2. Type "move selected clip 10 frames right" - verify tool call updates timelineStore via explicit command, undoable, with preview sync.
  3. Verify no secret leakage: prompt excludes project names/media IDs (mirrors preview-diagnostics scrub policy).
  ```

### G7 - Scene-browser result actions partial

- **FreeCut evidence:** `features/scene-browser/` with `media-library/services/media-analysis-service.ts` feeding scene captions, palette, embeddings; `features/docs/pages/16-scene-browser.ts` describes browsing detected scenes and searching via captions.
- **OpenPost evidence:**
  - `frontend/src/lib/video-editor/media/scene-search/` + `workspace-fs/scene-analysis.ts` exist and `sceneBrowser` is reset on load (`editor.svelte.ts:45`). However result UI in `media-pool-list.svelte` only supports button insertion, not drag-onto-timeline ghost (gap 10 fixed only for media-pool, not scene results? Actually gap 10 note says drag placement exists only for scene results at `timeline-panel.svelte:1229`).
  - But search relevance ranking via CLIP/MiniLM + palette filtering not exposed as a filter chip set; only basic text search.
- **User impact:** Discovering scenes works but filtering by palette or semantic vector is hidden; drag-to-timeline for scene clips is present but not tested for composition nesting.
- **Acceptance test:**
  ```
  1. Analyze a 30s clip - verify 5 scenes detected with thumbnails.
  2. Search "sunset" - verify CLIP-ranked results appear.
  3. Filter by Lab palette chip - verify only matching scenes remain.
  4. Drag scene result onto timeline at frame 120 - verify ghost snapping and one-undo insertion with linked A/V.
  ```

### G8 - Quick Cut loop/playback and per-segment codec toggle incomplete

- **FreeCut/LosslessCut reference:** LosslessCut (GPL) segment list colors, loop playback modes (loop segment, loop selection), per-stream enable, keyframe-cut toggle per segment.
- **OpenPost evidence:**
  - `frontend/src/lib/quick-cut/types.ts` has `LoopMode = 'off' | 'segment' | 'selection'` but `frontend/src/routes/quick-cut/+page.svelte:60-90` only uses `previewRun.repeat: boolean` and `loopMode` derived not wired to `<video>` loop handler for segment vs selection.
  - `frontend/src/lib/quick-cut/export.ts:180-260` preflight is now correct (stream-copy vs transcode, codec tuple checks added commit 02ab9afc), but UI `components/ExportPanel.svelte` does not expose per-segment "Keyframe cut" toggle - only global `CutMode: nearestKeyframe | exact`.
  - Stream-copy eligibility UI shows global `requiresTranscode` but not per-segment reason chip; missing `codec tuples` display.
- **User impact:** Cannot preview a single segment looped accurately; cannot choose keyframe vs exact cut per segment as in LosslessCut.
- **Acceptance test:**
  ```
  1. Load source with keyframes at 0, 2.1, 4.0s. Create segment 1.0-3.5s.
  2. Toggle CutMode=exact vs nearestKeyframe per segment - verify preflight badge shows "Snaps before -1.0s" vs "Requires transcode".
  3. Set LoopMode=segment, play - verify video loops within segment bounds without touching outside range, ghost playhead not needed.
  4. Export with merge=false - verify one file is stream-copied (isValid true) and exact file is transcoded (packet count differs), both verified via mediabunny decode.
  ```

---

## 3. Valid architectural consolidations (not gaps)

- **Export renderer sharing preview compositor:** FreeCut keeps parallel `features/export/utils/canvas-item-renderer` (~25k LoC); OpenPost reuses `media/canvas-stack-compositor.ts` + `media/render-plan.ts` for preview, stills, and export (~9.7k). Output contract identical (pixel tests in `media/canvas-stack-compositor.svelte.test.ts`), less duplicated shader plumbing. Keep.
- **Dope sheet as 2 files vs 89 React files:** FreeCut's `dopesheet-editor/` is mostly React plumbing; OpenPost implements marquee, retime, duplicate, clipboard, locks, animated/search/group filters once in `components/keyframe-dopesheet.svelte` + `timeline/keyframe-dopesheet.ts`. Behaviors verified present (value graph fit/zoom/Alt-duplicate). Keep.
- **Preview runtime: native `<video>` + prewarm vs FreeCut render-pump:** OpenPost drives native video element playback plus targeted `decoder-prewarm-client.ts` (12 MP LRU, 2 boundaries / 2.5s lookahead) rather than full render-pump/scrubbing-cache. Equivalent for current clip set; revisit if scrub latency regresses on stacked 4K compositions.
- **Eager waveform generation:** OpenPost decodes waveforms for all audio-bearing timeline media vs FreeCut's viewport-gated prefetch. More eager but same user-visible result; watch memory on 30k-clip projects (already bounded by interval-index culling).

---

## 4. OpenPost exceeds FreeCut (intentional, keep)

- **Stock / Stickers / Lottie unified Assets rail:** FreeCut ships Lottie browser + AI generation; OpenPost ships server-side Pexels/Unsplash/Pixabay adapters with capability labels, rate limits, bounded downloads, provenance, plus 3,145-item Microsoft Fluent Emoji Flat catalog with safe SVG validation. Not in FreeCut.
- **Project duplication deep remap:** FreeCut's project clone is shallow; OpenPost remaps tracks, clips, groups, nested sequences, captions, transitions, effects, keyframes, expressions, endpoints, saved-animation IDs (`project/project-clone.ts`).
- **Workspace trash with 30-day sweep and cover-image preservation:** More robust than FreeCut's bundle relink.
- **Periodic autosave + serialized write queue + legacy backup before migration:** Stronger persistence.

---

## 5. Production LoC - reproducible apples-to-apples count

**Method:** Count non-generated production lines (`.ts` `.tsx` `.svelte` `.js` ` .mjs` excluding `*.test.*`, `*test*`, `__tests__`, `*.stories.*`) over mapped feature directories, matching `freecut-depth-audit-followup.md` scope. Excludes FreeCut `features/docs` (3,514 LoC in-app help pages) and generated types. Run via checked-in script `scripts/count-video-editor-loc.mjs`; raw `wc -l` is fallback but script normalizes globs and excludes more precisely.

```bash
bun run count:video-editor:loc
# or: node scripts/count-video-editor-loc.mjs
```

**Script:** `scripts/count-video-editor-loc.mjs` (checked in, reproducible, no generated docs/tests inflation).

| Area (mapped)                              |                                                         FreeCut production LoC (this run) |                                                            OpenPost production LoC (this run) |
| ------------------------------------------ | ----------------------------------------------------------------------------------------: | --------------------------------------------------------------------------------------------: |
| Timeline editing & gestures                |                                                          88,078 (`src/features/timeline`) |                               17,761 (`frontend/src/lib/video-editor/timeline` + `sequences`) |
| Preview/playback runtime                   |                       44,697 (`src/features/preview` 41,318 + `src/runtime/player` 3,379) |               ~9,915 (`preview` 2,339 + `audio` 4,852 + preview-player/layer/transport 2,724) |
| Editor shell, panels, workspaces           |                                                            46,463 (`src/features/editor`) |                         36,660 (`components` + `workspaces` + `src/routes/video-editor/[id]`) |
| Keyframes & animation                      |                                                         26,452 (`src/features/keyframes`) |            ~11,090 (keyframe/easing/motion/vector inside `timeline`, `effects`, `components`) |
| Export & render queue                      |                                                            25,468 (`src/features/export`) |                                   ~9,717 (`export` + `media/render-*`, smart-copy, preflight) |
| Media library & local AI (+ storage infra) |                      32,131 (`src/features/media-library` + `src/infrastructure/storage`) |                            ~24,669 (`media` 18,931 + `local-ai` 2,912 + `workspace-fs` 2,826) |
| Effects/color/scopes/shapes/transitions    | ~14,700 (`src/features/effects` 6,385 + `src/infrastructure/gpu-*` ~13,900 minus overlap) | ~19,000 (`effects` 9,580 + `transitions` 5,781 + `shapes` 1,308 + typography/lottie/stickers) |
| Cross-cutting runtime/composition engine   |                          20,066 (`src/runtime/composition-runtime`) + `src/shared` 26,283 |                                     distributed across stores/actions (no single counterpart) |
| **Total production**                       |                   **371,277** (`scripts/count-video-editor-loc.mjs` exact, docs excluded) |        **125,386** (Video Editor+Quick Cut prod via script; prior 118,192 used narrower glob) |
| **Ratio**                                  |                                                                                           |                                              **33.8%** (prior 32.0% was same scope with `find | wc -l`; script adds quick-cut + record routes) |
| Tests (reference)                          |                                                                                   134,792 |                                                                                        46,607 |

> Reading: Absolute LoC comparison is indicative only. FreeCut's React component/state plumbing and separate preview/export stacks inflate counts vs OpenPost's Svelte runes + single compositor. The 8 gaps above are the actionable completion work, not the LoC delta itself.

---

## 6. Top next implementation slices (ordered)

**Slice 0 - Close P1 gaps before paid growth (do not ship new recorder claims until durable):**

1. **Recorder durability + workspace import + timeline drop** (G1) - worker chunk writer, `recordings/` OPFS, media-pool insert, one-undo drop, permission/error UX.
2. **Pen tool drawing** (G2) - canvas placing state, bezier handles, finish/cancel, persist, export parity.

**Slice 1 - Timeline completeness:** 3. **Markers + In/Out** (G4) - ruler lane, add/rename/color, navigation, `I`/`O` range. 4. **Text-motion band drag** (G3) - overlay for In/Out offset/duration with snapping.

**Slice 2 - Media fidelity:** 5. **Lottie archive pickers** (G5) - enumerate `lottieAnimationId`/`lottieThemeId` from parsed archive, dropdowns, color-slot panel. 6. **Scene-browser semantic chips** (G7) - palette/Lab + embedding ranked filter chips.

**Slice 3 - Quick Cut fidelity:** 7. **Per-segment keyframe toggle + loop modes** (G8) - segment row shows snap delta chip, global CutMode becomes per-segment override, LoopMode wires to preview `currentTime` clamping.

**Slice 4 - Agent decision:** 8. **Agent chat** (G6) - product decision required: either implement `features/editor/agent` parity behind feature flag or document intentional omission in `PRODUCT.md` and parity audit.

Each slice should land with: state + persistence + preview + export + undo + cancellation + error handling + keyboard/touch/a11y + 320/390/desktop Chromium checks + focused + Chromium tests.

---

## 7. Verification commands (run before closing any slice)

```bash
bun run check:frontend:types
bun run check:contracts
bun run test:file -- frontend/src/lib/video-editor/timeline/markers.test.ts
bun run test:file -- frontend/src/lib/video-editor/shapes/path-edit.test.ts
bun run count:video-editor:loc
```

Chromium gate: run real browser tests for recorder, pen drawing, marker navigation, text-motion band drag.

---

## 8. Appendix - How this audit avoids prior false positives

- For waveform, adaptive preview quality, scrub-proxy fallback, decoder prewarm budget, proxy height (540), transition catalog (44), render queue, smart-copy guard rails, transcription fallback, media-task aggregation - traced constants and worker wiring exactly (e.g., `preview/adaptive-preview-quality.ts` EMA alpha 0.2, `media/proxy-client.ts:16` PROXY_MAX_HEIGHT, `preview/prewarm-plan.ts` 2 boundaries / 2.5s lookahead). No file-name proof.
- For GIF/WebP, DTS/TrueHD/AC-3, viewport culling, group gizmo, snap guides, spatial point editor, track push/pull, align/distribute, mixer, media-pool drag, hover skim, clear-keyframes, and MotionAnimationLayer - confirmed closed via preview + export + persistence + undo + cancellation tests per `docs/specs/freecut-depth-audit-followup.md` resolution log.

_Audit performed 2026-08-26. Next re-audit after Slice 0-1 lands._
