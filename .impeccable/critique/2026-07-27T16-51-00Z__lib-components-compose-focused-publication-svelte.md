---
target: current OpenPost video attachment, publishing, editing, and media-library UX
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 4
timestamp: 2026-07-27T16-51-00Z
slug: lib-components-compose-focused-publication-svelte
---
Method: dual-agent (A: video_ux_assessment_a · B: video_ux_assessment_b)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 2 | Long video uploads expose an indeterminate busy state, and analysis/conversion phases are not visible. |
| 2 | Match System / Real World | 3 | Core labels are familiar, but cover frames are raw millisecond inputs and “metadata” hides destination-specific meaning. |
| 3 | User Control and Freedom | 2 | Media can be removed, but uploads cannot be paused, resumed, or cancelled; mode changes can discard pending autosave work. |
| 4 | Consistency and Standards | 3 | Shared primitives are strong, but composer, picker, and Media library render video and upload feedback differently. |
| 5 | Error Prevention | 2 | Capability resolution exists, but broad file acceptance and disconnected analysis let users spend time on media that cannot publish. |
| 6 | Recognition Rather Than Recall | 2 | Provider settings are discoverable, but users must remember limits and imagine each destination’s crop/output. |
| 7 | Flexibility and Efficiency | 2 | Upload, library, camera, and Studio paths exist, but uploads are sequential and video has no direct edit/convert workflow. |
| 8 | Aesthetic and Minimalist Design | 3 | The form is calm and clear, but its flat media cards understate destination risk and processing state. |
| 9 | Error Recovery | 2 | Draft text survives many failures, but file-level success, failure, retry, and recovery are not modeled. |
| 10 | Help and Documentation | 1 | The composer gives no contextual format, size, duration, aspect, or strictest-destination guidance before upload. |
| **Total** |  | **22/40** | **Acceptable; significant improvement needed** |

## Design Specificity Verdict

**LLM assessment:** Authored behavior inside a generic shell. The capability-driven account compatibility, Story/Short video/Video modes, YouTube thumbnail handling, and destination settings are distinctly OpenPost. The visible experience is still a standard centered form, dashed dropzone, and media-card grid. Most of the product’s strongest cross-provider intelligence is hidden in account and validation popovers. The unused destination-preview work is a missed opportunity to make the experience feel specific to multi-network video publishing.

**Deterministic scan:** The detector scanned `frontend/src/lib/components/compose-focused-publication.svelte` and returned zero findings (`[]`). It found no rule violations or false positives. That clean result is useful but narrow: the main problems are workflow state, backend/UI contract gaps, and missing video-specific controls rather than token-level anti-patterns.

**Visual overlays:** No reliable user-visible overlay is available. The collaborative browser opened the hosted app, but snapshots and DOM evaluation timed out, and the injection preflight could not be confirmed. Source review, the clean detector result, and navigation metadata were used as fallback signals.

## Overall Impression

OpenPost already models provider truth better than many schedulers, but the video experience currently promises more than the runtime pipeline can deliver. The biggest opportunity is to turn one opaque “attach video” action into a clear asset lifecycle—uploading, analyzing, adapting, previewing, and ready for each destination—without forcing editing on users whose file is already valid.

## What’s Working

1. **Provider-aware composition is a real product strength.** The composer resolves selected-account capabilities, derives the strictest media count, exposes destination settings only when relevant, and links validation issues to accounts.
2. **Information order is intentional.** Story and Short video put media first; long Video asks for title and description first. YouTube thumbnail controls appear only when a YouTube target makes them relevant.
3. **The storage and media model are strong foundations.** OpenPost already supports local and S3/R2 storage, direct upload sessions, bounded server streaming, deduplication, usage-aware deletion, duration/frame/aspect fields, poster fields, and per-provider rendition records.

## Priority Issues

### [P0] Uploaded video is left in a non-publishable analysis state

**Why it matters:** The media handler defaults to `DisabledAnalyzer`, no production wiring installs `FFmpegAnalyzer`, and the fallback writes `analysis_status=pending`. Capability validation then blocks any non-ready video from scheduling or publishing. The UI offers video modes and provider settings for an asset that can remain permanently unready.

**Fix:** Move authoritative video analysis into an idempotent durable job. Make it storage-agnostic, wire it at startup, and expose explicit `uploading → analyzing → ready / needs conversion / failed` states. Add a regression test that uploads through each storage path and schedules a video successfully.

**Suggested command:** `$impeccable harden`

### [P1] Large-video upload is a black box with no escape

**Why it matters:** The client sends each whole file through `fetch`, sequentially, with only file-count or spinner feedback. A supported multi-gigabyte upload has no byte progress, speed, ETA, pause, resume, or cancel path. A network failure restarts the request.

**Fix:** Add persisted upload-task rows with filename, bytes, percentage, phase, cancel, and retry. Use browser multipart/resumable upload for S3/R2 and a DB-backed chunk/session protocol for local storage. Commit each successful file immediately and preserve partial success.

**Suggested command:** `$impeccable optimize`

### [P1] Capability claims, composer paths, and documentation disagree

**Why it matters:** Mastodon’s adapter accepts video but has no focused Short video or Video capability. Discord’s adapter and documentation claim attachments, but Discord is absent from the capability catalog. Pure video in Post is rejected with an instruction to switch modes, leaving those destinations without the promised path. No provider video route is recorded as live-verified.

**Fix:** Define one generated support contract that joins adapter, content profile, media constraints, composer exposure, tests, documentation, and live-verification status. Fail CI when an adapter claim has no selectable composer profile or when docs diverge from the catalog.

**Suggested command:** `$impeccable audit`

### [P1] Video has no reliable poster or useful library representation

**Why it matters:** List responses default to a `/thumb` URL that has no route, poster responses point at `/poster` with no route, and the analyzer never generates a poster. The picker renders every item as an image, while the Media grid loads each original video with `preload="metadata"`. Users see broken tiles or expensive raw-video grids, and duration/analysis state is hidden in details.

**Fix:** Generate posters and optional storyboard strips during analysis, serve them through authenticated routes, and use them everywhere. Show duration, dimensions/aspect, size, analysis/processing state, and destination compatibility on attachment and library cards.

**Suggested command:** `$impeccable optimize`

### [P1] The edit and destination-review step is missing

**Why it matters:** Video cards support playback and removal only. Cover-frame settings are generic number fields in milliseconds; there is no scrubber, trim, crop/fit, safe-area preview, mute/volume edit, or conversion explanation. Switching focused modes can destroy a component before its delayed autosave flushes.

**Fix:** Add an optional, non-destructive video editor with trim, social aspect presets, crop/fit, rotate, mute/volume, and a frame-based cover picker. Store an edit recipe and render a derivative server-side; keep attach-as-is as the fast path. Flush or explicitly convert a draft before changing video modes. Finish with a per-destination review showing which source or derivative each provider will receive.

**Suggested command:** `$impeccable shape`

## Persona Red Flags

**Alex (Power User):** Upload is strictly sequential and has no task queue, retry-failed action, or reusable transform preset. Destination output must be checked through separate settings and validation popovers. Preparing several videos is slow and hard to verify.

**Sam (Accessibility-Dependent):** Spinner-only upload and analysis states are not announced as a file-specific lifecycle. Errors are remote from the affected attachment. Video cards have playback controls but no associated duration, filename/status summary, transcript/caption state, or accessible destination result.

**Casey (Distracted Mobile User):** A slow upload cannot be resumed after interruption or cancelled from a task row. Publish actions remain at the top rather than the thumb zone. A quick switch from Video to Short video can happen before autosave completes, risking lost work.

## Minor Observations

- “Thumbnail · YouTube thumbnail” is redundant; use “YouTube thumbnail” plus optional/required context.
- Long-video title is always required even when the hint frames it as a YouTube requirement. Either define it as OpenPost’s canonical asset title or require it only where needed.
- Unsupported and excess files are silently filtered or sliced.
- Destination “media picker” controls are raw file inputs, so users cannot reuse a library asset there.
- Video attachments have no alt-description field even though the backend model supports alt text.
- The focused preview forces every video into a cropped 16:9 `object-cover` frame, which misrepresents vertical Story/Reel output.
- Studio return/recovery copy contains hardcoded English strings in otherwise localized flows.

## Questions to Consider

1. Should **Video** be a YouTube-first workflow, or a true cross-provider long-video asset that automatically creates destination renditions?
2. Should changing Story, Short video, and Video convert the active draft, or save it and start a separate publication?
3. Is attach-as-is plus optional adaptation the product principle, with transcoding invoked only when a destination actually requires it?
4. Should OpenPost make reliable progress, cancellation, retry, and resume a release gate before continuing to advertise a 16 GiB ceiling?
