# Video editors rebuild: local-first Video Editor + Quick Cut

Status: approved by owner in session (all open questions answered). This spec is the source of truth for the rebuild; tickets reference it.

## Goal

Replace the current cloud-synced OpenPost Video Editor (~23k frontend lines, ~2k backend sync lines) with two local-first editors and a rebuilt recorder:

1. **Video Editor** (`/video-editor`) — multi-track timeline editor ported from FreeCut (MIT). Projects live in a user-chosen workspace folder on disk. Transcription, transcript/text-based cutting, subtitles, silence removal, export.
2. **Quick Cut** (`/quick-cut`) — fast lossless trimmer inspired by LosslessCut (**GPL-2.0: behavioral reference only, zero code ported**). No transcoding for eligible cuts; stream copy via mediabunny.
3. **Recorder** — screen / webcam / combined / audio capture, one shared module, entry points both standalone (`/record`) and inside the Video Editor. Recordings land in the workspace and import like any media.

Editing never syncs to OpenPost. Only final exports cross the boundary ("Send to OpenPost": upload into the Media library, then optional composer handoff).

## Naming and domain terms

- Full editor product name: **OpenPost Video Editor**, route `/video-editor`.
- Lossless tool: **Quick Cut** (established domain term), route `/quick-cut`. The old in-editor "quick-cut" mode is deleted.
- Durable domain terms to retain in Hindsight: **Workspace folder** (user-chosen disk folder holding projects/media/caches; source of truth while editing), **Recording** (local capture produced by the recorder).
- `/video-editor`, `/quick-cut`, and `/record` are the only editor routes. The old `/video-studio` and `/studio` aliases do not exist.

## Architecture

Ported from FreeCut (adapt React→Svelte 5 runes, Tailwind 4 + bits-ui `ui/` primitives, paraglide i18n, OpenPost dark-theme tokens; editor chrome is dark-only per FreeCut's model, mapped onto OpenPost `*-dark` palette values):

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

mediabunny-based (no ffmpeg.wasm): open file(s) → keyframe map via `EncodedPacketSink` → set segments (start/end, keyboard-driven, loop playback modes) → export via `Conversion` stream-copy trim; fall back to transcode only when an exact cut requires it (keyframe-cut toggle like LosslessCut's, implemented ourselves); merge segments; save into the workspace or hand off to Send-to-OpenPost. Multi-file project files (.llc-style JSON) stored in workspace. UX reference: LosslessCut segment list/colors/playback modes/streams picker; code reference: none (GPL).

## Recorder

New `frontend/src/lib/recorder/` module: `getDisplayMedia` (screen, with system-audio option), `getUserMedia` (webcam, mic), combined screen+webcam+mic compositing via canvas + WebAudio mix into one MediaRecorder stream. Writes webm/mp4 chunks through a crash-safe writer worker into the workspace (`recordings/`), then imports as linked media. Entries: `/record` page and a Record action inside the Video Editor that drops the result onto the timeline. Replaces all old recorder code (deleted with the old editor).

## Send to OpenPost

After any export completes (Video Editor exports folder, Quick Cut output, finished recording): "Send to OpenPost" uploads the file via the existing media upload endpoints into the workspace Media library, with success state + "Compose" deep link reusing the existing composer attach flow. No return-token round trip; the old `/video-editor/return-tokens` contract dies with the backend deletion. Composer keeps its outbound "Edit video" handoff: it links to `/video-editor?source=media:<id>` style params; the editor imports that media file locally (download via existing media URL), edits locally, and the user sends results back manually. Composer-side error keys for return tokens are removed.

## Deletions (Phase 0)

Frontend: `frontend/src/lib/video-editor/`, `frontend/src/routes/video-editor/`, old i18n `video_editor_*` keys except stock-media + composer/media keys re-homed (stock API fns move to new `$lib/stock-media.ts`), `packages/video-project/` trimmed to extract `StockMediaProvenance` (then package deleted; consumers repointed), old e2e specs (`e2e-app/video-editor*.spec.ts`), scripts (`fetch-video-editor-models.mjs`, `generate-video-editor-audio.mjs`, benchmark scripts), static dirs (`frontend/static/video-editor-audio/`, `video-editor-models/`), CI excludes, knip/build-graph/asset-surface manifest entries, `@openpost/video-project` wiring.

Backend: `handlers/video_editor.go`(+test), `internal/videoproject/`, routes registration, `tagVideoEditor` retag for stock_media, models (`VideoProject*`, `VideoReturnToken`, `MediaAttachment.VideoProjectID`), `handlers/media.go` video_project plumbing, `services/medialifecycle` revision joins, revision-backfill helpers, config `OPENPOST_VIDEO_MODEL_BASE_URL`. New migration drops `video_projects`, `video_project_assets`, `video_project_revisions`, `video_return_tokens` (+ indexes, backfill columns). Migrations 053/054/068 remain immutable history.

Contracts: regenerate `frontend/openapi.json`, `src/lib/api/types.d.ts`, docs-site copy after route removal.

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

Android wrapper optimization for editors, collaborative editing, and cloud editing remain outside the initial v1 build. Post-v1 parity work now includes three-engine local voice generation, durable editor-generated images, upscaling, frame interpolation, and a commercial-safe local ACE-Step music generator. The other applicable items stay in the active FreeCut parity backlog.
