# OpenPost Video Studio

Video Studio is a local-first editor for short social videos. Open `/video-studio` in a current desktop Chromium browser to import or record footage, edit it, and export without an account or watermark.

## What stays on your device

Guest projects, source files, recordings, captions, analysis results, proxies, and exports stay in browser-managed storage. Video Studio does not create a cloud project or upload a source until you choose **Save to OpenPost** or **Use in a post**. Clearing site data can remove local projects, so use **Protect local projects** when the browser offers persistent storage and keep downloads of important exports.

Local voice detection and multilingual transcription download their disclosed model files only after you start the tool and confirm the download. The files are cached for offline reuse and can be removed from **Models**. Editing continues while analysis runs.

## Edit one sequence for four formats

The primary sequence uses ripple editing: split, trim, reorder, duplicate, freeze, or remove a clip and later clips follow it. Add video or image overlays, camera footage, text, captions, shapes, audio, transitions, fades, color adjustments, and guided keyframes.

The shared sequence controls cuts, speed, audio, transcript content, and transition timing. Portrait (9:16), feed portrait (4:5), square (1:1), and landscape (16:9) can each override framing, overlay placement, text wrapping, camera placement, and caption layout without changing another format.

Video Studio keeps the inspector focused on the current selection. Common keyboard controls include Space to play or pause, `S` to split, `Shift+Delete` to ripple-delete, arrow keys to move the playhead, and the standard undo and redo shortcuts.

Four source-free starter templates set useful caption and canvas defaults for clean captions, product demos, talking-head clips, and announcements. Signed-in workspaces can also load their existing Brand kit colors, fonts, and text styles. Guests can save text styles in local browser storage.

## Captions and cleanup suggestions

Transcription, voice activity detection, filler candidates, smart framing, and focus zooms run locally. They produce suggestions and never change the project until you apply them. Low-confidence words remain visible for review.

Changing caption text changes only the caption. Removing a timed passage lets you choose between removing caption text and ripple-cutting the matching video range. Silence and filler batches show the time they remove, preview before application, and apply as one undoable action.

## Record screen, camera, and sound

The browser chooser controls which screen, window, or tab is shared. Camera, microphone, and browser-supplied system or tab audio are recorded as separate synchronized sources. System audio depends on the browser and operating system and is available only when the returned capture stream includes it.

Recording chunks and an append-only manifest are written to origin-private storage. Each chunk records its byte range, session and media timestamps, flush sequence, and SHA-256 checksum. Recovery stops at the first invalid chunk and steps back to a decodable boundary. If a tab closes or a device disappears, the editor offers the flushed tracks for recovery. A browser recording contains cursor pixels, not native cursor or click telemetry; focus zoom and click-pulse tools remain manual or reviewable suggestions.

## Save, recover, and export

Autosave runs after editing pauses and at important workflow boundaries. The local history keeps the latest 20 automatic versions. Named checkpoints remain with the local project. A project saved to OpenPost also has cloud revisions and can be reopened on another desktop. If another browser changed it, Video Studio keeps the local copy and lets you load the OpenPost version or save the local edit as a new project.

Preview and export use the same frame evaluator and bounded WebGL2 compositor. Preview runs in an OffscreenCanvas worker, keeps at most three video decoders active, and drops stale video-frame requests instead of growing a queue. Exports write incrementally to a selected file when the browser supports the File System Access API, or to a temporary origin-private file before download. The supported ceiling is 1080p at up to 60 fps. MP4 uses H.264 and AAC only when the exact selected profile, dimensions, frame rate, bitrate, and audio configuration pass browser probing; otherwise the editor offers WebM for download and explains why OpenPost handoff is unavailable.

## Use an export in a post

Open Video Studio from Media, a Story, short-video, or video composer, or the main create menu. The composer tells Video Studio which unique format variants are required. Video Studio uploads only the selected final exports, assigns each one to the matching destination rendition, and returns to the composer. Publishing and scheduling remain in the composer.

## Stock media and credits

When the operator configures them, Pexels supplies photos and video, Unsplash supplies photos, and Pixabay supplies images and video. Search results show the creator and provider. Selection tracking follows each provider's API rules, the chosen bytes become a durable local source, and the project keeps provenance for its Credits panel and cloud Media record.

The included audio pack contains eight checked-in mastered loops and twelve checked-in interface or transition sounds. Its machine-readable manifest records each file's CC0 license, author, duration, loop points, mastering targets, size, and SHA-256 hash. Video Studio verifies the selected file before importing it. Third-party music search is not enabled.

## Limits

- Current desktop Chrome and Edge are the complete editing target. Mobile provides project preview and composer handoff.
- Projects are limited to 20 minutes, 250 sources, 2,000 non-caption timeline items, 5,000 caption cues, four visual overlay tracks, eight audio tracks, two caption tracks, and a 5 MiB project document.
- 4K files can be imported, but preview artifacts and exports are limited to 1080p.
- Video Studio has no server render, transcription, or AI fallback.
- Native cursor replacement, reverse playback, 4K or HDR export, live background removal, nested compositions, and direct publishing are not included.
