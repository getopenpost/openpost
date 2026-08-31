# OpenPost Video Editor

OpenPost Video Editor is a local-first multitrack editor for social video. Open [app.openpost.social/video-editor](https://app.openpost.social/video-editor) in current Chrome or Edge, choose a folder on your computer, and create a project. Editing does not require an account and does not add a watermark.

Use [Quick Cut](/usage/quick-cut) when you only need to remove ranges without changing the picture or mix. Use the [Recorder](/usage/recording) to capture a screen, camera, or microphone before editing.

## Choose a workspace folder

The folder you choose is the source of truth for Video Editor work. OpenPost creates readable `projects`, `media`, `recordings`, and `exports` folders inside it. Project documents, copied media, linked-file references, thumbnails, waveforms, transcripts, proxies, render jobs, and finished exports stay on your computer.

The browser stores the permission handles needed to reopen known workspace folders, small editor preferences, bounded derived-media and model caches, and temporary recovery data for active recording or export work. It may ask you to reconnect a folder after a browser restart or permission change. Back up the workspace folder like any other work folder. Clearing browser data can remove saved handles, preferences, caches, and recovery data, but it does not delete the workspace folder on disk.

You can keep several known workspace folders, switch between them, or forget a handle without deleting its files. Project trash is recoverable for seven days. Portable `.openpost.zip` bundles include the project and collected media with checksums; JSON snapshots contain the project document without source bytes.

## Import and organize media

Import video, audio, images, Lottie files, and supported subtitle tracks into the Media pool. A collected source is copied into the workspace. A linked source stays at its existing location and must remain available. The editor detects duplicate media, preserves technical metadata, and builds thumbnails, filmstrips, waveforms, and preview proxies in the background.

Browser-undecodable ProRes sources keep a local compatibility proxy for preview. Full export still reads the original source. MKV, MKA, and WebM files can expose UTF-8, WebVTT, ASS, and SSA subtitle tracks for insertion into the timeline.

## Edit on the timeline

The desktop editor has a tool rail, active panel, preview, inspector, and resizable multitrack timeline. Narrow screens use a touch timeline, bottom tool dock, and contextual sheets. You can split, trim, ripple-delete, slip, slide, roll, duplicate, freeze, reverse, group, nest, and reorder clips. In and Out points can limit playback and export.

The timeline supports video, audio, image, Lottie, text, subtitle, shape, adjustment, controller, and nested composition items. Track locks, mute and solo state, snapping, markers, linked clips, multi-selection, clipboard operations, undo, redo, zoom, scrubbing, and keyboard shortcuts share one command model. Change shortcuts in Editor settings instead of relying on fixed keys.

Projects can hold reusable sequences and nested compositions. Published composition controls let one composition expose selected text, color, number, toggle, and media values to each instance.

## Motion, effects, color, and audio

Animate transforms, masks, effect values, text, and other supported properties with keyframes. The keyframe editor switches between Dope Sheet, Graph, and Split views in Edit and Motion. Its scoped shortcuts change views with 1, 2, and 3, add or update a key with K in Edit, move between keys with Option/Alt+[ and ], toggle auto-key with A, and fit the active view with F. You can remap or unassign every command in Editor settings. Spatial motion paths, easing presets, motion presets, parenting, links, expressions, and modifiers edit the same keyframe data. Direct canvas gestures commit once when the gesture ends so undo remains useful.

Visual tools include crop, corner pinning, masks, blend modes, adjustment layers, transitions, caption and text styles, backgrounds, stickers, color wheels, curves, scopes, LUTs, and reusable grade and effect presets. Preview and export use the same effect and compositing rules.

Audio tools include clip and track volume, fades, envelopes, meters, loudness normalization, ducking, channel routing, equalization, noise reduction, speed and pitch controls, compressor, pan, reverb, delay, chorus, flanger, and distortion. You can record a synced voiceover while the timeline plays.

## Transcribe and edit by text

Transcription runs on your device. Parakeet is the default on supported WebGPU devices; Whisper Tiny, Base, Small, and Large v3 Turbo are also available. The selected model downloads on first use and remains in the browser cache until you clear it in **Models** or clear site data.

Correcting a word updates the timed transcript and linked caption cue. Select timed words to remove the matching media range as one undoable ripple edit. Silence and filler tools show proposed ranges and the total time removed before they change the timeline. Quiet-section detection measures level; speech-pause detection uses the local speech model.

Caption tools can create editable caption clips, consolidate them into subtitle items, apply style presets, burn captions into video, export SRT or VTT sidecars, or add a soft subtitle track where the chosen container supports it.

## Local generation and analysis

Optional local tools cover scene detection, semantic and visual search, smart framing, focus zoom suggestions, image generation, frame interpolation, upscaling, music generation, and text to speech. Each tool shows its model and download state. Large models are downloaded only when you start the related tool and can be removed from **Models**. Generated media is committed to the workspace before it is added to the timeline.

## Save, recover, and share projects

Edits autosave to the project document in the selected workspace. Version history, named checkpoints, restore points, project duplication, trash recovery, snapshots, and portable bundles are local. Video Editor does not create or sync cloud projects.

If another tab changes the same project, the editor protects the newer disk revision instead of overwriting it. Reopen the project or save your current work as a copy. Atomic writes and temporary-file cleanup protect project documents from interrupted saves.

## Export

The export dialog validates the selected range, visible or audible content, missing sources, codec support, subtitles, expected render path, duration, and estimated size before rendering. Formats include MP4, MOV, WebM, MKV, audio-only output, and PNG, JPEG, or WebP image sequences. Available video codecs depend on the container and browser.

An eligible unmodified source range uses packet copy, preserving encoded video and audio without a decode and re-encode cycle. Other projects use the full compositor and audio mixer. Export always reads original sources at the chosen output resolution. Long or large outputs stream through browser-managed scratch storage when needed and are committed to the workspace only after success.

Add one job, marker ranges, or fixed-duration ranges to the render queue. Jobs freeze their timeline and export settings when queued. The project queue renders one job at a time, survives reloads, resumes runnable pending work, and lets you pause, reorder, cancel, retry, or clear jobs. Finished files and image-sequence folders remain available in **Exports** until you delete them.

## Send an export to OpenPost

**Send to OpenPost** uploads the selected finished export to the current OpenPost Workspace Media library. After upload, **Open composer** opens a new composer with that exact media item attached. Video Editor does not upload the project, sources, proxies, transcripts, or other exports.

Publishing and scheduling stay in the composer. If you are signed out or have no OpenPost Workspace selected, download the export or sign in before sending.

## Browser and device limits

- Current desktop Chrome and Edge are the supported target because the full editor needs the File System Access API, WebCodecs, WebGL2, workers, and origin-private storage.
- Codec, WebGPU, screen-capture, hardware-acceleration, and file-streaming support varies by browser, operating system, and device. The editor probes the selected operation and explains an unavailable option.
- Local models can require hundreds of megabytes or more. The Models panel shows stored size and provides removal controls.
- Keep the tab open while a render or local model job is active. Saved projects and queued work remain in the workspace if the page closes.
- Editing and rendering are local. OpenPost does not provide server rendering, cloud project sync, or a server transcription fallback.
