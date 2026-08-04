# OpenPost Video Studio

Video Studio is a local-first editor for social videos and recordings up to two hours. Open `/video-studio` in current Chrome or Edge on a device that provides WebCodecs, origin-private file storage, and WebGL2 to import or record footage, edit it, and export without an account or watermark. Desktop uses the full four-zone workbench. Phones use a compact touch timeline, bottom tool dock, and contextual inspector sheets.

## What stays on your device

Guest projects, source files, recordings, captions, analysis results, proxies, and exports stay in browser-managed storage. Video Studio does not create a cloud project or upload a source until you choose **Save to OpenPost** or **Use in a post**. Clearing site data can remove local projects, so use **Protect local projects** when the browser offers persistent storage and keep downloads of important exports.

Local voice detection and multilingual transcription download their disclosed model files only after you start the tool and confirm the download. The files are cached for offline reuse and can be removed from **Models**. Editing continues while analysis runs.

## Choose Quick Cut or Full Studio

**Quick Cut** is for one video source when the edit only removes source ranges. It shows the original source scale, lets you mark, split, and remove kept sections, and snaps every in point to an exact verified source keyframe. Fast export can combine the kept sections or export one section at a time. It copies the encoded primary video and every supported audio track into a compatible MP4 or WebM container without transcoding. It keeps source metadata, streams to the selected file, and rejects subtitle, data, unknown-audio, or extra-video tracks rather than silently dropping them. If a kept section starts between keyframes, use **Snap for fast export** or **Precise export**. Precise export uses the complete renderer and transcodes the result. Pixel changes, speed changes, fades, mixed sources, captions, overlays, and audio adjustments also require **Full Studio**.

**Full Studio** uses a four-zone desktop layout: tool rail, active media or effect panel, preview, inspector, and resizable multitrack timeline. On a phone, the same project model uses a touch timeline plus bottom tool and inspector sheets. The editor keeps common split and ripple actions close to the timeline and moves secondary settings into the selection inspector.

## Edit one sequence for four formats

The primary sequence uses ripple editing: split, trim, reorder, duplicate, freeze, or remove a clip and later clips follow it. Add video or image overlays, camera footage, text, captions, shapes, audio, transitions, fades, color adjustments, and guided keyframes.

The shared sequence controls cuts, speed, audio, transcript content, and transition timing. Portrait (9:16), feed portrait (4:5), square (1:1), and landscape (16:9) can each override framing, overlay placement, text wrapping, camera placement, and caption layout without changing another format.

Video Studio keeps the inspector focused on the current selection. Common keyboard controls include Space to play or pause, `S` to split, `Shift+Delete` to ripple-delete, arrow keys to move the playhead, and the standard undo and redo shortcuts.

Four source-free starter templates set useful caption and canvas defaults for clean captions, product demos, talking-head clips, and announcements. Signed-in workspaces can also load their existing Brand kit colors, fonts, and text styles. Guests can save text styles in local browser storage.

## Captions and cleanup suggestions

Transcription, voice activity detection, filler candidates, smart framing, and focus zooms run locally. They produce suggestions and never change the project until you apply them. Low-confidence words remain visible for review. Focus zooms expose the focal point, amount, duration, and motion curve; the generated scale and position keyframes remain editable on the selected clip.

Changing caption text changes only the caption. Each locally timed transcript word is also a selectable edit range. Select one or more words, then remove them as one undoable ripple edit that retimes the remaining caption words, overlays, detached audio, markers, fades, and keyframes. Removing a complete timed passage still supports a ripple cut. Silence and filler batches show the time they remove, preview before application, and apply as one undoable action.

## Record screen, camera, and sound

The browser chooser controls which screen, window, or tab is shared. Camera, microphone, and browser-supplied system or tab audio are recorded as separate synchronized sources. System audio depends on the browser and operating system and is available only when the returned capture stream includes it.

Recording chunks and an append-only manifest are written to origin-private storage. Each chunk records its byte range, session and media timestamps, flush sequence, and SHA-256 checksum. Recovery stops at the first invalid chunk and steps back to a decodable boundary. During capture, Video Studio checks storage headroom against the current recording rate and stops cleanly before the browser runs out of space. If a camera or microphone disappears, it tries the selected device, falls back to the default device, and records the recovered stream as a synchronized segment. If a tab closes or recovery cannot continue, the editor offers the flushed tracks. A browser recording contains cursor pixels, not native cursor or click telemetry; focus zoom and click-pulse tools remain manual or reviewable suggestions.

## Save, recover, and export

Autosave runs after editing pauses and at important workflow boundaries. The local history keeps the latest 20 automatic versions. Named checkpoints remain with the local project. A project saved to OpenPost also has cloud revisions and can be reopened on another desktop. If another browser changed it, Video Studio keeps the local copy and lets you load the OpenPost version or save the local edit as a new project.

Preview and export use the same frame evaluator and bounded WebGL2 compositor. Preview runs in an OffscreenCanvas worker, keeps at most three video decoders active, and coalesces stale video-frame requests instead of growing a queue. Long, 4K, 60 fps, HEVC, and AV1 sources get a local VP9 preview proxy. Sources under 30 minutes use up to 720p30; longer sources use a smaller 540p24 profile to bound storage and decoding work. Exact keyframes and frame-rate data are indexed first. Thumbnail and waveform phases persist independently, so interrupted preparation keeps completed work. Proxy encoding runs in a worker, uses hardware acceleration when available, checks storage before starting, and exposes progress, cancel, retry, and removal controls. A cancelled proxy encode restarts from zero because a partial WebM is not a valid preview source. Exports always read the original source. They write incrementally to a selected file when the browser supports the File System Access API, or to a temporary origin-private file before download. The supported ceiling is 1080p at up to 60 fps. MP4 uses H.264 and AAC only when the exact selected profile, dimensions, frame rate, bitrate, and audio configuration pass browser probing; otherwise the editor offers WebM for download and explains why OpenPost handoff is unavailable.

Run `devenv shell -- pnpm benchmark:video-studio` (or `pnpm benchmark:video-studio` after direnv loads) to generate a deterministic one-hour 1920×1080, 60 fps H.264 fixture and measure import readiness, seven random seeks, native decoded-frame throughput and drops, coalesced worker requests, proxy use, and peak decoder count. The command records a JSON attachment in the Playwright result. It is a local hardware benchmark, not a promise that every device or codec will produce the same timing.

## Use an export in a post

Open Video Studio from Media, a Story, short-video, or video composer, or the main create menu. The composer tells Video Studio which unique format variants are required. Video Studio uploads only the selected final exports, assigns each one to the matching destination rendition, and returns to the composer. Publishing and scheduling remain in the composer.

## Stock media and credits

When the operator configures them, Pexels supplies photos and video, Unsplash supplies photos, and Pixabay supplies images and video. Search results show the creator and provider. Selection tracking follows each provider's API rules, the chosen bytes become a durable local source, and the project keeps provenance for its Credits panel and cloud Media record.

The included audio pack contains eight checked-in mastered loops and twelve checked-in interface or transition sounds. Its machine-readable manifest records each file's CC0 license, author, duration, loop points, mastering targets, size, and SHA-256 hash. Video Studio verifies the selected file before importing it. Third-party music search is not enabled.

## Limits

- Current Chrome and Edge are the supported editing target when WebCodecs, origin-private file storage, and WebGL2 are available. Desktop gets the four-zone workbench; capable phones get the compact touch editor. Screen capture, file-picker streaming, codecs, and export profiles still vary by browser and operating system.
- Projects are limited to 2 hours, 250 sources, 2,000 non-caption timeline items, 5,000 caption cues, four visual overlay tracks, eight audio tracks, two caption tracks, and a 5 MiB project document. Long, high-frame-rate sources use local preview proxies; exports always read the original source.
- 4K files can be imported, but preview artifacts and exports are limited to 1080p.
- Video Studio has no server render, transcription, or AI fallback.
- Native cursor replacement, reverse playback, 4K or HDR export, live background removal, nested compositions, and direct publishing are not included.
