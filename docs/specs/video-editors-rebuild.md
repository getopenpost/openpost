# Video editors rebuild: Cloud Video Projects + local-first editing

Status: approved by owner in session (all open questions answered). This spec is the source of truth for the rebuild; tickets reference it.

## Goal

Replace the retired Video Editor with two local-first editing surfaces and a rebuilt recorder, while keeping signed-in authored projects portable through Cloud Video Projects:

1. **Video Editor** (`/video-editor`) — multi-track timeline editor ported from FreeCut (MIT). Signed-in projects belong to the current OpenPost Workspace by default. Users can still create Local-only projects in a chosen folder. Transcription, transcript/text-based cutting, subtitles, silence removal, export.
2. **Quick Cut** (`/quick-cut`) — fast lossless trimmer inspired by LosslessCut (**GPL-2.0: behavioral reference only, zero code ported**). No transcoding for eligible cuts; stream copy via mediabunny. Signed-in source projects save to the current Workspace by default, with an explicit Local-only mode.
3. **Recorder** — screen / webcam / combined / audio capture, one shared module, entry points both standalone (`/record`) and inside the Video Editor. Signed-in recordings become required Project Assets in a Cloud Video Project by default. Local-only capture still downloads ordinary files.

Cloud projects synchronize portable authored state, required original Project Assets, revision history, named checkpoints, and conflicts. Device view state, filesystem handles, derived caches, downloaded models, and unsaved exports remain local. Local-only projects never sync unless the user starts an explicit import. Final exports cross into Workspace Media only through an explicit save or composer handoff.

## Naming and domain terms

- Full editor product name: **OpenPost Video Editor**, route `/video-editor`.
- Lossless tool: **Quick Cut** (established domain term), route `/quick-cut`. The old in-editor "quick-cut" mode is deleted.
- Durable domain terms to retain in Hindsight: **Cloud Video Project** (Workspace-owned portable authored state and required Project Assets), **Project Asset** (source material required to reproduce a project), **Local-only project** (user-chosen disk folder holding project data), and **Recording** (capture produced by the recorder).
- `/video-editor`, `/quick-cut`, and `/record` are the only editor routes. The old `/video-studio` and `/studio` aliases do not exist.

## Architecture

`backend/internal/services/videoprojects/` owns authorization, immutable revisions, mutation application, conflict branches, checkpoints, Project Asset references, Trash retention, and completeness. Web and mobile consume the portable contract in `packages/video-project/`. The editor keeps storage mechanics behind its repository boundary, so timeline and route components work with project concepts rather than choosing cloud or filesystem persistence directly.

Cloud saves use versioned, idempotent mutation batches with stable targets. A stale batch rebases when its targets are disjoint from newer work. An overlapping change creates an explicit conflict branch instead of silently replacing another device's edit. Originals use the configured `BlobStorage`; lightweight project state loads before optional originals, and `Keep available offline` pins the required originals on that device.

Ported from FreeCut (adapt React→Svelte 5 runes, Tailwind 4 + bits-ui `ui/` primitives, and paraglide i18n). Product chrome inherits the resolved organization theme. Preview, timeline, image pasteboard, guides, handles, scopes, and signal meters use explicit protected editor roles so authored media and editing geometry remain stable across every theme:

Protected roles resolve with the active light or dark scheme. They preserve contrast and signal meaning without imposing a dark editor surface inside a light theme. Authored pixels, scopes, meters, and other literal output may remain fixed.

| Layer                                                                                                                                                                                        | Source                                                    | Port strategy                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Workspace storage (`workspace-fs`: root handle, handles-db, bootstrap, paths, fs-primitives, atomic writes, index, media, project-media, trash, transcripts, thumbnails, waveforms, exports) | FreeCut `infrastructure/storage/workspace-fs/`            | Near-verbatim (framework-free)                                                                                  |
| Project document + migrations                                                                                                                                                                | FreeCut `types/project.ts`, `shared/projects/migrations/` | Verbatim types, trimmed item-type surface                                                                       |
| Timeline stores + command/undo system + edit actions (split, ripple, slip/slide, range removal incl. silence/filler/transcript)                                                              | FreeCut `features/timeline/stores/`                       | Logic verbatim; Zustand→Svelte runes classes (getState/setState/subscribe maps cleanly)                         |
| Clock, video-sync-plan, video-timing, audio-scene, preview audio graph                                                                                                                       | FreeCut `runtime/player`, preview utils                   | Verbatim (framework-free)                                                                                       |
| Workers: filmstrip, waveform, silence-detection, media-processor, whisper (+decoder/chunker/resampler/word-timings)                                                                          | FreeCut workers                                           | Verbatim; transformers.js via existing npm dep (3.8.1), not CDN                                                 |
| Media library/import/dedup/thumbnails/waveforms/proxies                                                                                                                                      | FreeCut `features/media-library` services                 | Services verbatim; store/UI Svelte                                                                              |
| Transcription engine + transcript editing model + silence removal + captions cue builder                                                                                                     | FreeCut transcription + timeline utils                    | Verbatim logic; dialogs/panels Svelte                                                                           |
| Export pipeline (settings resolution, packet-remux fast path, canvas render orchestrator/engine, render queue)                                                                               | FreeCut `features/export`                                 | Verbatim engine core; reduced item-type renderer surface                                                        |
| Preview composition rendering                                                                                                                                                                | FreeCut `runtime/composition-runtime`                     | Rewrite in Svelte (largest rewrite surface): `<video>` pool + transform wrappers + text/subtitle canvas overlay |

Dependencies in `frontend/package.json`: `mediabunny@^1.51.0`, `@mediabunny/prores@1.51.0`, `@huggingface/transformers@4.1.0`, `onnxruntime-web@1.26.0-dev.20260410-5e55544225`, and `fflate`.

### Current parity scope

- The project model includes all ten FreeCut timeline item kinds: video, audio, image, Lottie, text, subtitle, shape, adjustment, controller, and composition. Reusable compositions support nested timelines and controller-based Motion parenting.
- Local music generation, upscale, and frame interpolation are implemented. The packaged ACE-Step path passed a fixed-seed real-model WebGPU run with a valid, non-silent 10-second stereo WAV. Local scene captions, semantic and visual search, embeddings, and three-engine local voice generation are present.
- Keyframes include the value graph, dope sheet, spatial curves, transition guards, and shared multi-key editing.
- Projects support reusable top-level sequences and nested compound clips.
- Local transcription uses Parakeet by default and offers Whisper Tiny, Base, Small, and Large v3 Turbo, with language and WebGPU fallback.
- No bundled models/audio: transcription downloads on first use (HF CDN) and caches in-browser; self-hosted offline installs get everything except transcription. Supersedes nothing in ADR 0006 (that ADR concerns distribution of assets we no longer bundle). Editor interaction sounds use `cuelume`, not bundled clips.

## Quick Cut (lossless)

mediabunny-based (no ffmpeg.wasm): open file(s) → keyframe map via `EncodedPacketSink` → set segments (start/end, keyboard-driven, loop playback modes) → export via `Conversion` stream-copy trim; fall back to transcode only when an exact cut requires it (keyframe-cut toggle like LosslessCut's, implemented ourselves); merge segments; save to a Cloud Video Project or hand off to Send-to-OpenPost. Cloud Quick Cut documents use stable source and segment targets, upload originals as Project Assets, and fetch them only when the project is opened. Explicit Local-only projects keep their multi-file project JSON in the chosen workspace folder. UX reference: LosslessCut segment list/colors/playback modes/streams picker; code reference: none (GPL).

## Recorder

The recorder uses `getDisplayMedia` for screen capture and `getUserMedia` for webcam and microphone capture. Separate sources share a monotonic timebase and write WebM or MP4 chunks through a crash-safe worker. The standalone `/record` page turns a signed-in capture into one Cloud Video Project with aligned video and audio tracks, while Local-only mode downloads ordinary files. The Video Editor Record action uploads each capture as a Project Asset before inserting its linked timeline item. Recoverable scratch artifacts remain on the device until the cloud save or local download succeeds.

## Send to OpenPost

After any export completes (Video Editor exports folder, Quick Cut output, finished recording): "Send to OpenPost" uploads the file via the existing media upload endpoints into the workspace Media library, with success state + "Compose" deep link reusing the existing composer attach flow. No return-token round trip; the old `/video-editor/return-tokens` contract dies with the backend deletion. Composer keeps its outbound "Edit video" handoff: it links to `/video-editor?source=media:<id>` style params; the editor imports that media file locally (download via existing media URL), edits locally, and the user sends results back manually. Composer-side error keys for return tokens are removed.

## Deletions (Phase 0)

Frontend: `frontend/src/lib/video-editor/`, `frontend/src/routes/video-editor/`, old i18n `video_editor_*` keys except stock-media + composer/media keys re-homed (stock API fns move to new `$lib/stock-media.ts`), `packages/video-project/` trimmed to extract `StockMediaProvenance` (then package deleted; consumers repointed), old e2e specs (`e2e-app/video-editor*.spec.ts`), scripts (`fetch-video-editor-models.mjs`, `generate-video-editor-audio.mjs`, benchmark scripts), static dirs (`frontend/static/video-editor-audio/`, `video-editor-models/`), CI excludes, knip/build-graph/asset-surface manifest entries, `@openpost/video-project` wiring.

Backend: `handlers/video_editor.go`(+test), `internal/videoproject/`, routes registration, `tagVideoEditor` retag for stock_media, models (`VideoProject*`, `VideoReturnToken`, `MediaAttachment.VideoProjectID`), `handlers/media.go` video_project plumbing, `services/medialifecycle` revision joins, revision-backfill helpers, config `OPENPOST_VIDEO_MODEL_BASE_URL`. New migration drops `video_projects`, `video_project_assets`, `video_project_revisions`, `video_return_tokens` (+ indexes, backfill columns). Migrations 053/054/068 remain immutable history.

Contracts: regenerate `frontend/openapi.json`, `packages/api-contract/src/schema.d.ts`, docs-site copy after route removal.

Docs/marketing/legal: docs-site `usage/video-editor.md` rewritten for the new model; marketing launcher/tools pages retargeted; third-party notices add FreeCut (MIT) + mediabunny (MPL-2.0) attributions; privacy inventory entries updated; repository-map row updated; durable domain terms retained in Hindsight.

## Acceptance criteria

1. Old editor fully gone; `bun run check -- backend`, `-- frontend`, `-- contracts` pass; app boots with no dangling references.
2. Video Editor: pick workspace folder → create project → import media (copy/link) → multi-track timeline edit (split/trim/move/delete/undo-redo) → frame-accurate preview with audio → transcribe → edit by text (delete words applies ripple cut) → remove silence (signal + speech modes) → add transcript captions (burn-in + .srt sidecar) → export mp4/webm → exports listed → Send to OpenPost works.
3. Quick Cut: open file → mark in/out → lossless export verified stream-copied (no re-encode when eligible) → merge segments → send to OpenPost.
4. Recorder: screen, webcam, audio, combined recordings land in workspace and import into the editor.
5. Chromium-only gate shows the existing unsupported page elsewhere.
6. i18n complete in en, es, fr, de, pt, pt-BR, tr, ja, ko, and zh; ux-consistency bar passes; cuelume sounds on key interactions.
7. Changelog entries under `changes/`.

## Out of scope (v1)

Android wrapper optimization for the full editor, real-time collaborative editing, presence, and shared cursors remain outside the initial v1 build. Mobile capture and non-destructive clip preparation feed Cloud Video Projects without claiming full timeline or export parity. Post-v1 parity work now includes three-engine local voice generation, durable editor-generated images, upscaling, frame interpolation, and a commercial-safe local ACE-Step music generator. The other applicable items stay in the active FreeCut parity backlog.
