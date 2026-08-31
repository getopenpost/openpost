# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [4.14.0] - 2026-08-30

### Fixed

- Kept the composer AI action contrast readable while it changes from Ideate to Build with AI.
- Reject the public secret shown by older binary-install instructions and generate independent JWT and encryption keys in the current guide.
- Kept X OAuth callbacks working across mixed keyring rollout peers and removed expired plaintext request secrets during encryption-key rotation.
- Refuse to start when JWT or encryption secrets still use tracked public example placeholders, and keep bootstrap and data-plane credentials deployment-owned.
- Added rollback-safe, versioned encryption-key rotation with dual reads, bounded database re-encryption, and authenticated current-key verification across every persisted ciphertext store.
- Hosted readiness now proves PostgreSQL and required S3 write, read, and delete access with bounded requests, while release CI exercises the production-shaped data plane without skipped PostgreSQL coverage.
- Blob operations now honor cancellation without corrupting local files, failed media writes roll back with bounded cleanup, and PostgreSQL pools have role-specific budgets plus saturation signals.
- Made shutdown drain readiness, HTTP requests, and workers under one deadline, while persisting interrupted job state with a fresh bounded context.
- Serialized schema setup across PostgreSQL replicas and SQLite processes.
- Kept the Video Editor preview and timeline visible while phone-sized asset and edit tools open in contextual panels.
- Removed the duplicate Properties heading, exposed selected asset tabs to assistive technology, and enlarged coarse-pointer controls without bloating desktop controls.
- Kept Video Editor slider keys inside inspector controls, restored draft values on Escape, and preserved visible focus rings.
- Restored timeout recovery for AI publication discovery and meme suggestions after the provider SDK exhausts its internal retries.
- Kept the AI workspace fully inside the viewport at desktop and mobile sizes.
- Open new video projects centered in Fit view, deselect clips from the empty preview, and keep Motion controls inside their pane.
- Keep video clips from occupying the same track at the same time unless an explicit transition connects them.
- Keep the compact stock-media search focused on search and filters instead of repeating provider guidance.
- Show folder-backed Video Editor projects beside cloud Image Editor designs, with independent search, loading, permission, empty, and error states.
- Rechecked destination setup after every cold launch instead of opening Drafts before an active account exists.
- Made OAuth callback states and X request tokens atomic so one credential cannot authorize two concurrent callbacks.
- Kept public-route evidence checks reliable when the release gate captures Turbo's build plan.
- Prevented concurrent Threads account connections from mixing provider user IDs, and rejected token/profile identity mismatches.
- Kept an Image Editor design open when device storage rejects the final save.
- Marked the active Image Editor page for assistive technology and kept coarse-pointer color swatches inside the picker.
- Keep effect and transition previews smooth by rendering only visible cards through bounded, deduplicated preview queues.
- Apply effects to the current selection or a timed adjustment layer, and place transitions only on valid cuts without false errors when reapplying the current choice.
- Remove duplicate Program and Scopes header rows from the Color workspace while preserving the labelled preview, compact scope controls, and resize seam.

### Changed

- Keep the mobile API schema current and publish Android builds with a monotonic version plus revision and APK digest evidence.
- Align release Go and Bun toolchains, declare image and standalone media dependencies, and stop upgrading the pinned container base during builds.
- Gate repository policy on redacted scans of both candidate commit history and current files.
- Emit server and worker logs as revision-aware JSON on stdout and redact credential-shaped fields and values.
- Kept the composer AI action anchored while it slides from Ideate to Build with AI as the draft gains text.
- Open AI ideation in a compact brief dialog, then smoothly expand the same dialog into the full idea workspace.
- Made short analytics series fill the available chart width.
- Reworked the Video Editor media area into a full-height tool rail and resizable content pane, with the timeline starting beside it.
- Made persistent side and bottom panes resizable across both editors, with keyboard controls and predictable reset sizes.
- Restored local Video Editor projects to the Editors library alongside Image Editor designs.
- Reserved mobile button depth for eight forward actions and kept routine filled controls flat.
- Corrected Android availability metadata, current Settings paths, and the built-in AI creation guide.
- Clarified who the home page and free tools serve before scripts load.
- Aligned editor panel headings and expanded editor hit areas for coarse pointers without enlarging their visual marks.
- Expanded the Video Editor tool rail with Stock, text templates, shapes, effects, transitions, Lottie, transcript, and AI creation tools that can add or drag content to the timeline.
- Added the full FreeCut-inspired effect and transition catalogs with live visual previews and responsive, resizable workspace panes.

### Added

- Added explicit `all`, `web`, `worker`, and `migrate` process roles so hosted deployments can migrate once and scale HTTP and durable jobs independently.

## [4.13.1] - 2026-08-30

### Fixed

- Kept source-anchored speed curves attached during slip edits, and mapped timeline waveforms and filmstrips through variable-speed playback.

## [4.13.0] - 2026-08-30

### Fixed

- Kept transcript word shortcuts inside transcript editing, added keyboard access to word menus, and preserved Space playback while transcript words are focused.
- Prevented growth discovery jobs from deadlocking on SQLite single-connection deployments when initializing sync state for newly connected social accounts.
- Rebuilt Quick Cut segment controls so time ranges, cut mode, preview, and export stay readable on desktop and mobile, and kept mobile notifications within the viewport.

### Added

- Added source-anchored speed curves with linked audio/video editing, exact transcript and split mapping, pitch-preserving preview, and bounded variable-tempo export.

## [4.12.0] - 2026-08-30

### Changed

- Rebuilt the Video Editor Color workspace around dedicated grading controls, graded filmstrips, scopes, curves, and full keyframe editing.
- Matched FreeCut's grading readouts and section workflow with labeled scope guides, parade and vectorscope targets, visible grade actions and preset gallery, adjustment-layer creation, and per-section reset, bypass, and remove controls.
- Matched FreeCut's effect-stack workflow with one-click effect insertion, compact stack controls, collapsible panels, selection-wide bypass, and Color-aware effect filtering.
- Isolated Motion into its own composition preview and timeline, with blank composition creation, canvas controls, last-composition restore, and exact Edit return navigation.
- Reorganized animation around FreeCut's source workflow with global search, compatibility filtering, an undoable applied-animation summary, and direct Edit-to-Motion clip creation.
- Tracked each generated animation preset through keyframe edits so one applied preset can be removed without deleting manual animation.
- Rebuilt clip transforms around FreeCut's Position, Size, Rotation, Anchor, and Appearance workflow with scrubbable unit-aware fields, mixed selections, linked dimensions, grouped blend modes, reset actions, and one-step undo.
- Matched FreeCut's source-pixel crop workflow with multi-clip scrubbing, reset and auto-key controls, signed edge softness, and the same fixed-source crop geometry in preview and export.
- Rebuilt playback controls around FreeCut's live speed and fade workflow, including mixed multi-clip values, linked A/V rate stretching, reset actions, reverse status, and one undo entry per gesture.
- Matched FreeCut's multi-clip audio core with linked-audio selection, live dB gain and fade controls, throttled pitch editing, gain auto-keying, mixed values, and atomic resets while retaining OpenPost's advanced EQ and cleanup tools.
- Rebuilt parametric EQ from FreeCut's source with an interactive logarithmic response graph, pointer and keyboard band editing, mixed multi-clip presets, linked-audio targeting, and one undo step per edit.
- Added FreeCut's shape gradient swap and path-order controls, including undoable reverse and first-point actions in each path point's keyboard-accessible context menu.
- Added FreeCut's independent None, Shadow, Outline, and Glow text effects, including atomic multi-text selection updates.
- Added duration-preserving speed and reverse controls for animated GIF and WebP clips, detected from imported animation metadata rather than file names.
- Completed FreeCut's transition inspector behavior with registry-wide search, duration and per-control resets, and handle-safe placement choices.
- Matched FreeCut's marker inspector with live timecode, quick colors, reset, and the same color actions in the marker context menu.
- Added FreeCut's remappable Razor and split-at-cursor commands, including pointer-precise linked-clip cuts and keyboard operation.
- Added LosslessCut-style remove-ranges export to Quick Cut, with source-aware complements, project persistence, and lossless or exact output through the existing export path.
- Added LosslessCut-style Smart Cut for exact Quick Cut exports: only the leading GOP and audio are re-encoded while unchanged video packets are copied, including compatible merged exports.
- Added Quick Cut segment interchange for CSV, TSV, chapter text, and SRT, with editable labels and source-bound validation.
- Added progressive selected-stream waveforms plus pointer-centered zoom, wheel panning, drag scrubbing, keyframe ticks, and playhead follow to the Quick Cut timeline.
- Preserved container tags, raw same-format metadata, track names, languages, and dispositions across merged lossless, Smart Cut, and re-encoded Quick Cut exports.
- Added source-resolution PNG and JPEG frame capture to Quick Cut, including clipboard copy and playback, mark, and capture actions on the video context menu.
- Routed Quick Cut through the shared remappable editor shortcut catalog, including focused-button-safe playback, frame stepping, marks, range deletion, loop control, and live shortcut hints.
- Added beat-driven editing from OpenReel's source workflows: smart, one-per-beat, and duration-preserving clip sync across selected tracks, offsets and beat cadence, plus four-beat source cuts.
- Kept AI review inside the existing composer, with conflict-safe apply, original restoration, compact per-platform strategy summaries, and conservative adaptation for providers without a native creative model.
- Moved all AI requests to the official OpenAI Go SDK while preserving OpenRouter provider routing, privacy controls, web search, and multimodal inputs.
- Consolidated public documentation into canonical user, provider, configuration, installation, self-hosting, operations, and API routes, and removed duplicate or internal-only pages.
- Kept one authoritative Docker Compose example, moved provider readiness and invitation delivery guidance to operator audiences, and updated generated documentation surfaces and links.
- Consolidated the marketing self-hosting, AGPL source, contributor, and deployment-choice content at `/self-hosting`.
- Removed the `/open-source` and `/compare` marketing route families and their evidence, discovery, navigation, and test surfaces.
- Centralized marketing navigation views in one categorized registry.
- Made the mobile first-use screen lead with Hosted sign-in while keeping self-hosted setup clear and secondary.
- Reduced the depth of primary mobile buttons to match the flatter app hierarchy.
- Simplified the marketing and documentation entry points around OpenPost's real publication workflow.
- Grouped documentation navigation by user task and clarified that provider adapters and Hosted certification are separate.
- Shortened the README product copy and added reproducible OpenPost Image Editor and OpenPost Video Editor screenshots.
- Consolidated Publications, Inbox communications, and account management on their canonical routes across the web and mobile apps.
- Removed the public app homepage and the legacy Studio, Video Studio, Activity, Posts, and standalone Accounts routes without redirects.
- Flattened routine app and editor controls so depth marks only the current focal action or a temporary layer.
- Made Editors visible in primary workspace navigation and added readable labels to mobile navigation.
- Simplified the OpenPost Image Editor start screen to lead with real starter templates.
- Reduced visual noise in the marketing hero and Image Editor template chooser.
- Made the first Image Editor guidance select the primary editable text and avoid redundant desktop actions.

### Fixed

- Kept hidden grading effects stable during multi-clip reordering, bypass, reset, and removal actions.
- Applied unanimated multi-clip transforms to every selected clip even when the playhead is outside some clips.
- Migrated legacy ratio crop keyframes to source pixels so the keyframe graph, canvas handles, inspector, preview, and export use one unit contract.
- Matched meme caption sizing and line spacing to the pinned memegen renderer, retried transient previews, and made meme and discovery JSON generation use strict schemas with bounded recovery.
- Kept rejected AI builds on direction selection, aligned generated directions with create limits, and made ideation start from one optional brief and an explicit choice.
- Kept CLI media usage output aligned with the Publication API contract.
- Updated MCP prompts and the scheduler widget to use canonical Publication operations and results.
- Corrected API migration, settings navigation, and provider-readiness wording in the public documentation.
- Restored iOS builds on Xcode 26.2 while the pinned Expo packages await upstream Swift compatibility releases.

### Added

- Added composer-native AI ideation, five-direction drafting, durable platform-specific Rendition generation, voice profiles, internal source checks, and opt-in meme recommendations.
- Analytics can now compare daily views, engagement, and follower changes by post, platform, or account. Summary stats and the publication table are easier to scan.

## [4.11.0] - 2026-08-29

### Changed

- Simplified the Video Editor workspace around the preview, contextual inspector, and resizable timeline while keeping advanced actions in focused menus.

### Fixed

- Made Space control playback even when a menu button has focus, with Backspace lift delete and Delete ripple delete preserved.
- AI generation now retries once when the provider SDK reaches its internal deadline before the feature request budget is exhausted.

## [4.10.0] - 2026-08-29

### Added

- Added right-click and Shift+F10 segment actions to Quick Cut, including preview, export, enable or disable, ordering, and removal.
- Added right-click and Shift+F10 actions for selecting, reconnecting, and removing Quick Cut sources.

### Fixed

- Let release planning retain the previous release owner for paths deleted since the last tag.
- Kept Quick Cut playback on the saved transport shortcut when a non-editable button has focus.
- Removed the duplicate Quick Cut segment action list while keeping Preview and Export visible on each segment.
- Restored Quick Cut reconnect, success, and stream-selection reset messages in every supported locale.
- Made the translation gate reject static frontend message calls that are missing from the catalogs.
- Removed dependent segments, marks, saved handles, and stale preview URLs when a Quick Cut source is removed.
- Kept source removal atomic when workspace persistence fails and returned cleanly to the empty state after removing the final source.
- Kept multi-source controls compact by showing stream settings only for the active source.
- Kept notifications inside narrow mobile viewports instead of extending past the right edge.

## [4.9.0] - 2026-08-29

### Added

- Add direct right-click actions for reordering, resetting, toggling, and removing Video Editor effects.
- Add transcript word context actions for copying, cutting, staging, restoring, and committing edits.
- Add right-click actions for opening, renaming, duplicating, reordering, and closing Video Editor sequence tabs.
- Add right-click Download and Delete actions to Video Editor saved export rows.
- Add state-aware right-click actions to Video Editor render queue jobs.

### Fixed

- Stop context-menu listeners from surviving Video Editor navigation and reading stale interface state.
- Reject static images before animated-frame extraction without logging an expected decode warning.

## [4.8.0] - 2026-08-28

### Fixed

- Let production releases resume an already prepared candidate without trying to create an empty commit.
- Show Video Editor shortcut keys using the active keyboard layout when the browser provides it.
- Make Space control the active video monitor without clicking focused controls, with Backspace for lift delete and Delete for ripple delete.
- Saved keyboard bindings now control duplicate, select all, group, nudge, reorder, copy, paste, and delete actions in the 2D composition timeline without hijacking focused controls.
- Prevent touch-sized timeline resize controls from covering clips, transitions, and empty space in narrow windows used with a mouse or trackpad.
- AI post building and meme suggestions now retry transient managed-provider failures within their full content-generation budget instead of failing after five seconds.
- Keep video editor shortcuts active after selecting a timeline clip with the pointer.
- Create the SQLite database directory before opening it, so a fresh install with a volume mounted over the data path boots instead of failing with a misleading "unable to open database file" error.
- Duplicate migration version numbers no longer silently skip migrations. Versions 094 and 108 were each assigned to two files, so `108_idempotency_records.sql` never ran (requests carrying an `Idempotency-Key` failed with 503 "no such table: idempotency_records") and `094_workspace_invitation_delivery.sql` was skipped on upgraded databases. The skipped migrations are renumbered to 110 and 111 so existing installations heal on their next start, and the migration runner now refuses to start when two files share a version.
- Make track rename and reorder shortcuts editable, removable, and portable through Video Editor shortcut presets.
- Keep the Video Editor keyframe graph and dope sheet usable together at narrow widths.
- Keep compact calendar date ranges visible and align published-history checks with the visible calendar item.
- Keep the mobile Video Editor inspector actions clear of the timeline at short phone heights.
- Release commands now stay bound to the OpenPost repository when a checkout has extra review remotes.

### Added

- Let mobile users add an image while starting a post, then review or remove it in the existing draft editor.
- Choose a common social-video canvas or exact dimensions and frame rate when creating a Video Editor project.
- Browse, seek, remove, or clear every Video Editor timeline marker from one compact list.
- Change an existing Video Editor project's canvas size and background with undo and autosave.
- Edit a Video Editor project's name, description, dimensions, and frame rate from the project library.
- Use right-click or Shift+F10 for contextual Video Editor actions on clips, timeline space, tracks, markers, media, sequences, and projects.
- Right-click the Program monitor to choose any overlapping visual layer under the pointer, including animated, rotated, and scaled layers.
- Right-click 2D composition layer and group rows to rename, group, duplicate, copy, paste, or delete them with the same undoable actions as the toolbar.
- Analyze, refresh, or cancel one video or image Scene Browser index from its media-row overflow or right-click menu.
- Delete project media from its overflow or right-click menu with an exact timeline-impact warning, shared-file protection, and durable failure recovery.
- Use target-aware timeline right-click menus for transitions and applicable clip actions such as join, freeze frame, layout, captions, and keyframe cleanup.
- Open reverse, scene splitting, captions, speech cleanup, text-to-speech, and compound clip tools directly from timeline clip context menus.
- Copy and paste color grades across selected clips from the timeline context menu.
- Join a split clip directly with its previous or next continuous neighbor from the timeline context menu.
- Choose a fast scan or frame-accurate local AI verification when splitting clips at scene changes.
- Generate, refresh, extract, and consolidate clip captions from one target-aware timeline menu.
- Generate, cancel, and remove preview proxies from each video source menu.
- Rename reusable video sequences from their media-library menus.
- Generate and reuse source transcripts from each audio or video media menu.
- Relink missing or changed video editor media directly from its media-row menus.
- Select media with Command/Ctrl-click or Shift-click, then generate missing proxies or delete the batch from one compact toolbar. Right-click preserves a selected group and reports partial deletion failures without hiding affected sources.
- Select reusable sequences with Command/Ctrl-click or Shift-click, combine them with media sources, and delete the full asset selection from one confirmed, durable operation.
- Let self-hosted operators collect account and content analytics through per-platform HTTP sources when provider analytics API access is unavailable.
- Drag across project media and reusable sequences to select them together, then use focused Delete, Escape, or Command/Ctrl+A shortcuts without stealing timeline or text-editing keys.
- Browse project media and reusable sequences in a responsive grid or compact list, with five persistent card-size choices.
- Edit shape and mask points from a focused right-click menu without losing a multi-point selection.
- Choose the default style for new transcript and AI captions without overwriting later caption edits.
- Toggle canvas-object snapping independently from timeline snapping with `Shift+S`, the canvas magnet, or editor settings.
- Switch timeline edit tools with `V`, `Y`, or `U`, and seek visible edit points with Up or Down.
- Nudge selected visual items by 1 or 10 canvas pixels with remappable keyboard shortcuts.
- Open Scene Browser and focus its search with a remappable Command/Ctrl+Shift+F shortcut.
- Switch between Graph, Dope Sheet, and Split keyframe views and use remappable, scoped keyframe editing commands in Edit and Motion.
- Edit graph and dope-sheet keyframes from target-aware right-click menus with keyboard access and saved shortcut labels.
- Close one timeline gap from empty space or every gap on a track from its right-click menu, with sync-lock, linked-media, lock, and one-step undo safety.
- Add video or audio tracks and remove every empty track from the track-header right-click menu, with safe handling for empty timelines and groups.
- Let instance administrators edit the base and platform-specific writing prompts used for AI social-post generation.

## [4.7.0] - 2026-08-28

### Fixed

- Reject malformed changelog fragments before release preparation can omit and delete them, and keep generated release notes formatter-clean.
- Stop the Video Editor project catalog from migrating preserved schema backups and creating recursive backup copies before a project is opened.
- Enabled Pop, Zoom, Spin, Pulse, and Breath motion on text without changing its layout or line wrapping.
- Prevented unused or disconnected Quick Cut sources from blocking valid exports.
- Keep long timeline waveforms responsive by rendering only the visible window, with centered peaks and exact trim and reverse mapping.
- Merge Quick Cut sources with different selected audio-track counts without dropping tracks or failing during transcode.

### Added

- Preserve timestamp-derived frame-rate metrics for imported and relinked video so variable-rate and dropped-frame sources keep accurate trim and frame-selection behavior.

### Changed

- Batch consecutive color effects into one GPU pass so stacked grades preview and export with fewer full-frame draws while preserving the same ordered color output.

## [4.6.2] - 2026-08-28

### Changed

- Document the disk-backed Video Editor, Quick Cut, Recorder, local models, export queue, and explicit Media handoff without retired cloud-project or return-token claims.

### Fixed

- Keep transcript cuts from removing or retiming captions tied to clips on locked tracks.
- Keep corrected auto-caption lines, transcript search, karaoke, and edit-by-transcript words in sync while retaining usable word timing.
- Keep auto-caption word timing inside edited cue bounds and treat a cleared word as deletion instead of retaining a blank transcript token.
- Keep exact merged WebM Quick Cut exports in VP9 and Opus, show real export eligibility before rendering, and reject invalid ranges before they enter the project.
- Keep camera and microphone recording available when a previously selected input was unplugged by falling back to the browser default and clearing the stale choice.
- Preserve the originating draft when sending a Video Editor export to OpenPost and attach the uploaded video when the composer opens.
- Resume a previously running Video Editor render queue after reload while keeping interrupted renders safely paused.
- Refresh the open Saved exports list for every completed queue job, including jobs that finish within the same millisecond.
- List saved image-sequence folders beside rendered files and delete a sequence folder recursively after confirmation.

## [4.6.1] - 2026-08-28

### Fixed

- Restore the saved Video Editor workspace before opening a project deep link or creating a project from another OpenPost surface.
- Keep selected-clip actions contained in a compact, touch-safe inspector toolbar.

## [4.6.0] - 2026-08-27

### Changed

- Video Editor beat analysis and keyframe controls now stay out of the timeline until opened.
- The Video Editor inspector now shows only relevant Properties, Motion, Effects, or Transcript controls while keeping export actions fixed in place.
- FreeCut schema 15 projects now open as backed-up, writable OpenPost projects with their effects, audio levels, transitions, keyframes, captions, Lottie settings, and Motion compositions preserved.
- The writing canvas is open again, scheduling is shorter, and the desktop media picker shows every source.
- Interface sounds now start enabled for visitors who have not saved a preference.
- The landing page leads with the product, the navigation is shorter, and pricing is easier to scan.

## [4.5.0] - 2026-08-27

### Added

- Added Copy as draft for reusing a sent Publication without carrying over its delivery or schedule state.

### Fixed

- Kept connected accounts healthy when OAuth refresh fails because of a provider rate limit, server error, or timeout.
- Blocked X videos outside the provider's supported aspect-ratio range and stopped retrying media that X rejected during processing.

## [4.4.0] - 2026-08-27

### Added

- Video Editor audio ducking: per-clip sidechain settings (`duckOthersDb`, `attackSec`, `releaseSec`, `targetTrackIds`) lower other tracks while a clip plays. Inspector offers direct toggle, amount, attack/release, and scoped track selection with sensible copy. Preview and export share the same gain envelope, including attack/release ramps, deepest-duck overlap, muted/solo/visibility, speed and trim windows, nested sequences, and bus/master ordering. Changes are undoable.
- Quick Cut now has per-source audio and video track selection with durable export semantics. Probing enumerates every video and audio track and stores the selected track indices per source. Project parsing remains backward compatible and validates impossible selections. Preflight, stream copy, transcode, and merged export honor the selection and can produce audio-only or video-only output.
- Video Editor karaoke captions: per-word highlight mode for subtitle items using existing `SubtitleCue.words` timings with configurable active-word foreground and optional active-word background, exposed compactly in the subtitle properties panel.
- Shared deterministic karaoke word selection and cached subtitle layout so preview and export resolve the identical active word at exact frame boundaries, with untimed cues falling back to normal captions without flicker and with line wrapping preserved.
- PNG, JPEG, and WebP image-sequence export for full project, in/out range, and marker batches with exact frame counts, deterministic zero-padded names, and preserved FPS, dimensions, and effects.
- Alpha behavior: PNG and WebP preserve transparent backgrounds; JPEG flattens to the project background. WebP has explicit capability detection with honest fallback/error copy and no silent conversion.
- Bounded directory output via File System Access and ZIP fallback, with streaming/batched worker artifacts and accurate progress, cancellation, and cleanup.
- Worker and main-thread ownership with queue support for image sequences.
- Video Editor audio effect rack: compressor, stereo pan, reverb, delay, chorus, flanger, and distortion share a deep typed effect-chain abstraction and run identically in realtime preview and offline export. The rack is ordered, bypassable, resettable, bounded for safety, persisted/migrated, clone-safe, and undoable as one gesture. Compact accessible UI uses shared controls with good defaults.
- Video Editor beat detection: browser-local, cancellable analyzer for the selected audio or video clip that generates deterministic beat and downbeat markers at project frames with deduped labels and colors. Timeline insertion is atomic and undoable, the analyzer yields to the main thread on long clips, and the compact accessible panel uses shared controls and Paraglide copy.
- Local post-capture noise reduction for recorded mic/webcam/audio clips: per-clip persisted `audioNoiseReductionEnabled`/`audioNoiseReductionAmount` (0-100), compact accessible controls in clip properties, deterministic spectral gate that runs entirely on-device with identical preview and export output, bounded CPU/memory and abort/cleanup, no cloud upload, and correct ordering with EQ, pitch/speed, ducking and mixer.
- Video Editor recording now detects browser capabilities, exposes an explicit cursor mode where supported, and preserves honest system/tab audio truth from capture through workspace artifact, media metadata, timeline import, preview, and export. Adds stable persisted capture metadata with migration for legacy media.
- Procedural backgrounds for the Video Editor with mesh gradients (4-corner bilinear with smoothness, rotation, scale and offset) and repeatable patterns (dots, grid, stripes, checker) rendered deterministically at any resolution and frame. GPU fragment path is used for large tiles with exact CPU canvas fallback; preview and export share the same `CanvasStackCompositor` path so pixels are identical.
- Typed persisted `background` item model (`background` item kind, `ProceduralBackground` union) with migration 4, normalization/clamping, clone-safe deep copy and keyframe-compatible parameters (`backgroundRotation`, `backgroundScale`, `backgroundOffsetX/Y`, `backgroundSmoothness`, `backgroundDensity`, `backgroundForegroundOpacity`) resolved through the existing animated-properties seam and undo history.
- Eight built-in presets (Sunset/Ocean/Forest/Neon mesh + Dots/Grid/Stripes/Checker) stored immutably and cloned on apply; no mutable shared preset state and no bespoke parallel renderer.
- Compact responsive inspector and creation UI using shared primitives (`Button`, `Input`, `Slider`, `AppSelect`, `Label`, `Tabs`): preset grid, kind switch, color pickers, pattern selectors, density/opacity/rotation/scale/offset sliders. Honest alpha/blend via item `transform.opacity` and `blendMode` on the shared stack; accessible labels, keyboard focus, visible focus ring, and 320px layout verified in Chromium.
- Native concise copy for all ten editor locales (`en`, `es`, `fr`, `de`, `pt`, `pt-BR`, `tr`, `ja`, `ko`, `zh`) for the new panel and controls.

### Changed

- Preview and export audio graphs now apply the shared effect chain after EQ and before the mixer, preserving existing EQ, pitch, fades, and ducking and without creating extra AudioContexts.
- Recording setup shows honest capability states for screen, cursor, and system audio and never claims an audio stream exists merely because requested. Cancellation and track teardown are clean and bounded.

### Fixed

- Preview and export use actual captured tracks without duplicating or dropping audio; inactive system audio is reported as unavailable rather than presented as present.

## [4.3.2] - 2026-08-27

### Fixed

- Accept current npm metadata output when verifying a clean n8n community-node install.

## [4.3.1] - 2026-08-27

### Fixed

- The official n8n package now passes current npm and n8n publication checks while keeping write-capable OpenPost actions unavailable to AI tools.

## [4.3.0] - 2026-08-27

### Added

- Mobile idea capture can now turn a rough note into one editable post with destination-specific renditions, then send the reviewed result to the workspace's next queue slot. Manual writing and scheduling remain available when AI is disabled.
- Failed publications can now be dismissed without deleting their delivery history and restored immediately with Undo from mobile or web.

### Fixed

- Android scheduling now opens the date and time steps reliably, calendar weeks always show all seven days, and composer drawers stay usable above the keyboard.

## [4.2.0] - 2026-08-27

### Added

- Rolling and ripple edits now show a live 2-up OUT/IN comparison in the program monitor while dragging. The overlay is owned by the timeline gesture, publishes only from the snapped and validated plan, and clears on commit, Escape, pointer cancel, destroy, and tool changes. It reuses PreviewLayer and the existing decoder prewarm, proxy, and filmstrip path without a second owner, handles gaps, speed, reverse, sourceStart/sourceEnd/sourceFps, linked audio-to-visual companions, and image/composition/Lottie sources, and labels OUT, IN, and GAP with high-contrast timecodes that remain usable at 320 px without hiding export or quality failures. Slip shows new IN/OUT with baseline IN/OUT corners; slide shows the left OUT and right IN at the new cut with their pre-drag baselines as corner thumbnails, both rendered as fitted virtual items so the compared frame is always visible and aspect-correct.
- Focused 2D composition timeline for Motion workspace. When a `composite-2d` composition is active the footer shows a single dedicated surface instead of stacking. The compact layout keeps layer names, in/out work area and FPS header always visible, uses a shared row model so sidebar labels and the scrollable bar/keyframe lanes stay aligned, and collapses to a single column below 640px without widening a 320px page. Scrubbing the ruler seeks via the shared clock without marking the project dirty or calling autosave.
- Layer rows expose Position, Scale and Anchor as localized vector lanes. Diamonds are rendered in the scroll surface, culled via the shared timeline viewport, and use typed vector helpers without `as any`. Diamonds are interactive buttons wired to the shared `keyframeSelectionStore`; dragging a diamond repositions its frame through atomic keyframe actions with a single undo and restores on Escape or pointercancel.
- Layer bars support pointer move and start/end trim with edge detection, adaptive snapping via shared snap targets, a single commit/undo on release, Escape/pointercancel restore, locked-track guards, and no autosave while drafting. Drafts reuse `planLinkedMoveGesture` and `planTrimGesture` instead of reimplementing semantics.
- Transform parenting uses a pick-whip that highlights valid layer rows, validates only via `itemById` (no track ID casts), and shows localized cycle/duplicate errors. A successful link or detach clears to a localized success status (“Parent linked”/“Parent removed”), records exactly one undo, and cleans window listeners on destroy.
- In/out handles snapshot once, draft via raw setters, add exactly one undo only if the range actually changed, and restore on pointercancel.
- Edit by Transcript now supports Selection and Project scope, contiguous drag and Shift selection, active-word tracking, Backspace staging, and Ctrl or Command+Enter commit. Transcript tokens keep exact timeline ownership across repeated source uses and linked A/V pairs, while one undoable cut removes the selected phrase and its internal pauses without trimming another use of the same media.
- Transcript Copy and Cut now carry source-trimmed media, linked audio, effects, and timing gaps into the shared timeline clipboard. Paste keeps multi-track alignment, shifts the group past collisions, creates independent links and origins, and lands as one undo step. Reversed clips map transcript ranges back to ascending timeline frames without losing their source span.
- Auto-captions now queue multiple clips, show per-clip progress and queue position, and share one decode across repeated placements of the same source window. Retranscription replaces duplicate generated captions in one undo step, cancellation stays clip-owned, and results cannot attach after the source clip changes or disappears. Generated captions split with their exact source clip, while reverse playback keeps word order, filler removal, and transcript edits mapped to the correct source seconds.
- Screen, camera, and microphone captures now stay linked after insertion. Recorder chunks commit to local storage as they arrive, and a versioned session manifest restores flushed tracks with their original offsets after a tab or browser failure. Recovery remains available until the user adds, downloads, or removes it, and another live recording tab keeps ownership of its active session.
- Recording setup now keeps source, device, countdown, duration, video quality, camera direction, and microphone processing choices across sessions. Screen and camera capture support 720p, 1080p, or 4K at 24, 30, or 60 fps with matching encoder bitrates and storage estimates. A live input meter confirms microphone activity while recording.
- Local voice generation now exposes Supertonic laugh, breath, and sigh tags, remembers the chosen engine, and keeps each preview tied to the text clip that requested it. Older previews can no longer link to a newer text selection by mistake.
- Mixer tracks and the master bus now have separate six-band parametric EQ controls. Their settings persist with projects and compositions, remain undoable, apply in the same order during live preview and export, and correctly disable Quick Cut when audio must be rendered.
- Text items in the focused 2D composition timeline now show typed In, Loop and Out bands derived from the real `textMotion` spec via the shared `getTextMotionTimelineBands` math (including `segmentTextUnits` unit counts, stagger, and half-clip clamping, exact to FreeCut). Bands are rendered in both the sticky layer list and the scrollable lane, culled via the shared viewport, with localized preset and slot labels, duration and unit suffixes, and offset metadata.
- In and Out band bodies drag to change `offsetFrames` from the clip edge; Loop bodies do not offer offset. Band edges drag to change `durationFrames` (In right edge, Out left edge, Loop right handle). Loop duration edits do not create a false offset. All drags use `beginTextMotionEdit` / `updateTextMotionLive` / `commitTextMotionEdit` with a single undo per gesture, live preview via the shared store, `isTrackEffectivelyLocked` group-lock guards, pointer capture with `lostpointercapture` handling, a single stored cleanup for `pointermove` / `up` / `cancel` / `keydown` / `lostcapture` called on every terminal path and onDestroy, Escape and pointercancel restore the exact snapshot even before the 3px threshold, and `pointercancel`/`lostcapture`/`unmount` do not synthesize PointerEvent. No-op drags (clamped to start) add no undo and do not call `onedit`.
- Advertise the hosted API, authentication flow, Markdown pages, sitemap, and OpenAPI contract through an RFC 9727 API catalog, `/auth.md`, and homepage HTTP Link headers.
- Meme Maker now uses OpenPost's own fast, watermark-free renderer, a full built-in template catalog, a larger editing workbench, and template-specific AI guidance.
- Added the official `@getopenpost/n8n-nodes-openpost` package with importable workspace-listing and draft-creation workflows.
- Added a dedicated n8n CI gate for generated contracts, types, tests, lint, builds, package loading, npm payload inspection, and package version discipline.
- Video Editor preview and export now share one WebGL2 compositor and a bounded GPU texture/framebuffer pool. The ping-pong targets reuse exact-size allocations across resize cycles, clear stale pixels, stay isolated per GL context, cap at 96 MB/8 entries, and release on device loss/dispose without leaking ImageBitmap or OffscreenCanvas. Transition branches no longer detach from their canvases on parent resize, and disposing one live stack does not invalidate another. Real Chromium WebGL2 tests cover reuse, resize, context separation, dispose, transition pixel regression, and a layered-timeline allocation benchmark proving second-frame reuse.
- Animated GIF and animated WebP imports now play as real animations instead of frozen first frames. Import probes the true composited frame count, loop duration, and effective frame rate, inserts span one full animation loop, a cancellable worker extracts every frame with exact per-frame container delays into a bounded memory cache with OPFS persistence, and the timeline filmstrip, live preview (including speed and reverse), still capture, and full or range export all read the exact same decoded frames with looping playback.
- The Video Editor now has persisted Edit, Color, and Motion workspaces that keep the same project, playhead, selection, program monitor, and timeline while changing the tools around them. Color uses one fitted dock for grading, effects, and scopes; Motion focuses transforms, presets, text motion, keyframes, property links, and expressions.
- Motion can now create and enter focused 2D compositions, return to the parent sequence, add non-rendering controllers, and attach or detach transform parents. Animated parent chains keep their pose across canvas edits, deletion, compound boundaries, duplication, and project cloning, share cycle guards with property links, and resolve the same way in preview and export.
- Motion compositions now reuse full layer-group controls and can publish plain text and solid text or shape colors. Every placed instance gets independent resettable overrides without changing the source, with matching nested live preview and export output.
- Video Editor ASCII and Paper halftone effects now include their full typed control surfaces and render in both preview and export.
- GPU effects now render on image, text, and subtitle clips as well as video, with one text raster path shared by preview and export.
- The full 54-effect FreeCut GPU catalog now runs in OpenPost, including exact HQ pixel sort and complete direction/order controls for the streak variant.
- Timed adjustment layers now apply ordered CSS and GPU effects to every active visual clip below them in preview and export.
- All 25 clip blend modes now composite against the finished layers below in live preview and export, with one shared GPU stack and an exact CPU fallback.
- A full keyframe value graph now exposes sampled easing curves, direct Bezier handles, shared multi-key selection and movement, snapping, zoom, pan, fit, Alt duplication, keyboard edits, and transition-safe ranges.
- The full dope sheet now supports cross-row marquee and Shift selection, atomic multi-key retime and Alt duplication, keyboard edits, property locks and filters, normalized copy/cut/paste, and reusable cubic or spring easing presets.
- The color workspace now adds RGB Parade, frame-aware auto balance, loupe-based white/black/white point pickers, multi-clip grade copy/paste, saved grade presets, and preview-only before/after or draggable split comparison.
- The Color workspace now includes a whole-project navigator with media thumbnails, compact visual track lanes, markers, in/out range, and a preview-only scrub path that selects clips and commits the exact release frame without adding undo history.
- On-canvas editing now includes rotated source-pixel crop handles, pose-preserving anchor moves, scaled direct text editing, and editable position motion paths with versioned vector keys, smooth or split spatial Bezier handles, keyboard control, cancellation, transition guards, and atomic undo.
- The on-canvas transform gizmo now adds eight rotation-aware edge and corner handles, center or opposite-side scaling, media aspect-ratio control, snapped or free rotation, large touch targets, and precise keyboard edits.
- The complete 44-effect FreeCut transition catalog now includes searchable grouped controls, placement, easing, direction, effect parameters, timeline selection and resizing, exact endpoint timing, undo, and matching preview/export rendering through lazy WebGPU pipelines with Canvas2D fallbacks.
- Transition audio now uses full cut-centered source-handle overlap and sample-level equal-power curves in preview, full export, and range export, while synced audio companions suppress duplicate embedded video audio.
- Projects now support reusable sequences and compound clips with ordered tabs, per-sequence view and undo state, cycle-safe nesting, source-window-correct dissolve, and recursive visual/audio preview and export. Media-pool cards render cached frames from the real nested compositor, create deep independent duplicates, and confirm the exact root and nested reference impact before undoable deletion.
- The Scene Browser now detects cuts off the main thread, stores lazy thumbnails and Lab palettes, captions scenes with local LFM, indexes text and images with MiniLM and CLIP, ranks keyword, semantic, color, and palette searches, and inserts exact source ranges by button or drag with progress, cancellation, and undo.
- Local auto-captions now use a complete Parakeet and Whisper engine registry with model and language controls, safe fallback, streamed decode, warm worker reuse, staged download and inference progress, cancellation, source-window and playback-speed mapping, and removable browser model caches.
- Local voice generation now matches FreeCut with Kokoro, Supertonic 3, and MOSS Nano, all engine voices and language controls, real progress and cancellation, reusable previews, one-time media-pool saves, and atomic insertion at the playhead. OpenPost also pins the Supertonic and MOSS revisions, verifies resumable MOSS files, falls back from unavailable WebGPU adapters, and allows MOSS speed adjustment.
- The complete Video Editor now ships in English, Spanish, French, German, European and Brazilian Portuguese, Turkish, Japanese, Korean, and Simplified Chinese, with native language labels and strict catalog and placeholder checks.
- Shape clips now include rectangle, circle, ellipse, triangle, star, polygon, and heart presets with solid or linear fills, strokes, rounded geometry, direct transforms, effects, blending, nested composition support, and one shared preview/export renderer.
- Shape strokes now support arc-length trim ranges, cyclic offsets, open-path wrapping, animated variable-width start and end tapers, cap-aware outlines, bounded project loading, and the same pixels in preview and export.
- The Video Editor pen tool now draws open or closed Bezier paths with click-or-drag knots, exact curve-preserving point insertion, corner and continuous tangents, direct point and handle editing, keyboard controls, and automatic bounds fitting.
- Shape clips can now act as hard clip or feathered alpha masks with opacity and inversion. Masks affect only lower tracks and render through the same animated compositor in live preview, transitions, nested sequences, still capture, and export; path masks reuse the full Bezier editor and always stay closed.
- Visual clips now support four-point corner pinning with direct canvas handles, keyboard nudges, exact local-pixel controls, size-stable offsets, and the same projective mesh in live preview, masks, transitions, nested sequences, still capture, and export.
- Lottie JSON and dotLottie archives now import as frame-accurate clips with validated native timing, generated thumbnails, speed, reverse, loop and ping-pong modes, source-frame segments, named markers, and one deterministic renderer shared by live preview, nested sequences, still capture, and export.
- The Video Editor now browses featured, popular, recent, and searched public LottieFiles animations with live previews, cancellation, pagination, safe bounded imports, visible license guidance, and persisted creator and license details.
- The Video Editor now groups shapes, stock, stickers, and Lottie under one Assets panel. It searches configured Pexels, Unsplash, and Pixabay sources, enforces streamed import limits, keeps creator and license details, and places stock at the playhead. A lazy local catalog adds 3,145 transparent Microsoft Fluent Emoji stickers with search, reuse, direct insertion, and stored MIT provenance.
- Lottie template clips now expose bundled animation and theme pickers, author text and color controls, grouped palettes, and native scalar or two-axis slots, with the same cached source patch used by preview and export.
- The media pool now opens an independent source monitor for image, audio, video, and Lottie assets, with exact in/out marks, range dragging and playback, timecode or frame display, active-track V/A patching, and keyboard editing.
- Source insert and overwrite edits now place linked native-frame ranges at the playhead, convert frame rates, create requested tracks, preserve surrounding material and split Lottie phase, reject locked targets, and undo as one action.
- Video and audio clips now support exact reverse playback with linked undoable controls, mirrored timeline filmstrips and waveforms, reversed PCM monitoring and export, frame-accurate video export, and a shared cancellable 720p preview conform cached by source fingerprint.
- Continuous split siblings can now be joined from the timeline toolbar or with Shift+J, including linked A/V clips, reversed source windows, transition repair, locked-track guards, and one-step undo.
- Video clips can now insert an exact native-resolution two-second freeze frame from the timeline toolbar or Shift+F, with reversed-source mapping, animated visual-state capture, transition repair, race-safe media cleanup, and one-step undo.
- Timeline ruler scrubbing now plays exact 45 ms audio grains with a persisted toggle, pointer and keyboard control, reverse and nested-composition mapping, mute and solo rules, linked A/V de-duplication, stale-seek dropping, and a decoded Web Audio fallback.
- Timeline tracks now resize from 48 to 140 pixels by pointer or keyboard, support Alt resize-all and double-click reset, cancel cleanly with Escape, persist with the project, scroll vertically, and undo each completed gesture in one step.
- Project markers now render on the ruler with names and colors, drag or move by keyboard, edit label/frame/color, jump with controls or bracket shortcuts, delete with Shift+M, and participate correctly in snapshot undo and redo.
- Timeline zoom now matches FreeCut with a logarithmic control, pointer-anchored coalesced wheel zoom, playhead-anchored buttons, fit and 100% controls, and the full keyboard shortcut set.
- Hovering the timeline now skims the program monitor through a separate ghost playhead and timecode without moving the edit position or seeking audio. Pointer work is coalesced to one update per animation frame and stops during playback, touch input, zoom, dialogs, and edit gestures.
- All 36 supported Video Editor commands now use one customizable shortcut catalog with browser-local persistence, physical-key capture, command and browser conflict checks, unassign and reset controls, search and filters, and versioned OpenPost or matching FreeCut preset import and export.
- Selected clips can clear all animation or one property with Shift+A or the timeline toolbar. The confirmation reports the exact key count, keeps locked tracks unchanged, and records the whole multi-clip edit as one undo step.
- Canvas move and resize gestures now snap to canvas edges, centers, quarter positions, and neighboring layer bounds with screen-stable hysteresis, localized live guides, rotation-aware bounds, and Alt bypass. The timeline magnet controls both timeline and canvas snapping.
- Interface sounds are now opt-in with persisted volume and Signature, Velvet, or Crisp themes. Editor cues stop during preview playback, stay out of exports, and give one result cue for selection, split, delete, effect, snap, linked-selection, skimming, workspace, and track-state actions.
- Preview diagnostics now report measured frame and renderer data, adaptive quality, proxy state, GPU fallbacks, and skipped preview frames. Optional overlays stay local to the browser, while copied reports omit project names, clip labels, media IDs, and file paths.
- ProRes footage now imports with real metadata and thumbnails, prepares a playable compatibility proxy with visible progress, remains viewable at Full preview quality, supports source-monitor audio, filmstrips, scene tools, freeze frames, and exports from the original full-quality source.
- AC-3 and E-AC-3 audio now decode through a lazy worker-safe codec in source and timeline preview, waveforms, silence analysis, transcription, processed media, and export. DTS and TrueHD imports now name the codec and require an explicit choice before importing the video with a silent audio track.
- Delete now leaves an intentional gap, while Ctrl or Command + Delete performs a sync-lock-aware ripple delete across linked tracks with one undo step.
- Effect stacks now support ordered move controls, default-aware reset, bypass and enable, and removal across compatible multi-clip selections with one undo step per action.
- The searchable effect picker now shows real shader-backed previews for every GPU effect plus CSS previews, with full-strength posters, hover sweeps, reduced-motion support, and lazy rendering inside the picker viewport.
- The effect picker now includes FreeCut's nine built-in effect stacks and user-saved full-stack presets, preserving parameters and bypass state across preview, drag, atomic multi-clip apply, update, and deletion.
- GPU effect parameters now support FreeCut-compatible numeric and color keyframes, per-parameter auto-key controls, perceptual color interpolation, shared preview and export output, and automatic cleanup when an effect is removed.
- GPU effect keyframe lanes now follow FreeCut's parameter metadata: temporal rate controls stay static while pixel-sort length remains animatable.
- The seven center-based GPU effects now have a direct one-point canvas editor with source-accurate crop, transform, flip, rotation, parent-motion, and corner-pin mapping, live preview, paired keyframe writes, keyboard control, locked-track guards, and clean cancellation.
- Live histogram, waveform, RGB Parade, and vectorscope views now use FreeCut's exact WebGPU compute and phosphor-rendering path with high-DPI output, channel modes, direct graded-canvas uploads, playback-aware sampling, device-loss recovery, and an aligned BT.709 CPU fallback.
- The clip inspector now includes all 20 FreeCut Entrance, Exit, and Emphasis motion presets with animated previews, exact generator timing and easing, duration, intensity, and multi-clip stagger controls, region-scoped Replace and collision-safe Add modes, coupled position support, transition-wide safety, and one-step undo.
- Float drift, sway, breath pulse, spin, and micro shake now stay live as compact procedural motion records with deterministic preview and export output, per-channel gains, multi-clip staggering, editable speed and intensity, reduced-motion thumbnails, and coalesced undo while tuning.
- Live motion can now be baked into adaptive editable keyframes across a whole selection with transition-safe atomic undo, while an explicit cleanup removes animation parked past trimmed clip bounds without changing the final visible pose.
- Projects now carry a searchable saved-animation library that preserves scalar and coupled motion, easing and spatial handles, same-type effect instances, and live behaviors, with playhead apply, optional retiming, Replace/Add semantics, compatibility checks, confirmed deletion, and atomic multi-clip undo.
- Text clips now support all 17 FreeCut In, Out, and Loop text-motion presets with character, word, line, and whole-clip units, deterministic ordering, live stagger, duration, and intensity controls, saved-animation reuse, and matching preview and export rendering.
- Visual properties now support cycle-safe direct links with frame offsets and a bounded expression editor with scalar or vector math, `prop()` references, live validation, link and reference pick whips, duplicate-group remapping, undo, and matching preview and export evaluation.
- Position, scale, and anchor animation now support coupled vector lanes or separate X/Y tracks, safe value-preserving conversion, exact per-frame baking for mismatched and spatial timing, percentage scale curves, and the same editable result across presets, preview, and export.
- Pen and mask paths now animate every point and Bezier handle through topology-locked scalar lanes, with selected or all-point keying, Shift multi-selection, focused or complete timeline rows, saved-animation reuse, and matching preview and export geometry.
- Text clips now include all 13 current FreeCut templates, reversible one-, two-, and three-span copy layouts, per-span typography, template scaling, content-fit backgrounds, real bundled fonts, wrapped mixed-style lines, and one raster layout shared by preview and export.
- The text inspector now edits full block typography, including horizontal and vertical alignment, padding, background, stroke, shadow, font metrics, and colors, while base property edits remain available when the playhead sits outside the selected clip.
- Caption clips now include the exact Netflix, YouTube, Bold Yellow, Outlined, and TikTok recipes with bundled fonts, canvas-relative placement, one-step undo, compact previews, and direct style controls.
- Subtitle cues now parse common SRT, VTT, and ASS formatting, hide markup during transcript edits, preserve cue alignment and Bold, Italic, and Underline flags through word edits, and render the same mixed-font raster in preview and export.
- Inline text now measures and paints each styled run with its own font metrics and breaks overlong words without losing span styling.
- Caption clips linked to the same source can now consolidate into one editable subtitle item with exact absolute cue timing, shared styling, linked groups, locked-track safety, and one-step undo.
- MKV, MKA, and WebM media now expose embedded UTF-8, WebVTT, ASS, and SSA subtitle tracks with streaming scan progress, cancellation, source-fingerprinted caching, default and forced track selection, and atomic trim- and speed-aware timeline insertion.
- Export preflight now checks the exact range, visible or audible content, source readiness, device codec support, subtitle compatibility, expected duration, and output size before rendering. It blocks unsafe jobs, explains fixes, and passes the checked frame range to the renderer.
- Render jobs can now be queued from frozen timeline, nested-sequence, range, and output settings. The project queue persists locally, runs one job at a time, supports pause, reorder, cancel, retry, and clear controls, and restores interrupted work in a paused state.
- Queued exports can now split the active range at timeline markers or into fixed 10, 30, or 60 second jobs. Segment batches share one frozen timeline snapshot, keep exact frame bounds and remainder frames, and can turn an output above the in-memory limit into safe smaller renders.
- The Exports dialog now lists project files saved in the local workspace, refreshes after queued renders finish, downloads the exact saved file, and confirms permanent deletion with clear loading, empty, missing-file, and retry states.
- Immediate and queued video or audio exports now show preparing, mixing, frame rendering, encoding, and file-finalization phases with percent, frame, and elapsed-time counters, plus direct cancellation.
- Full video exports now prefer a dedicated render worker, keep progress and cancellation live, and fall back to the main thread only for known browser or worker limits. Workers return bytes while the main thread saves each output once.
- Heavy timeline footage now prepares one background proxy at a time, switches preview visuals to the smaller local file without losing source audio, and keeps Full-quality preview and every export on the original source.
- Stalled proxy scrubs now show the nearest cached filmstrip frame after a short delay and replace it as soon as the exact decoded frame settles.
- Auto preview now lowers actual GPU and stacked-canvas resolution after sustained missed frame budgets, recovers in stable playback, and predecodes exact upcoming clip, transition-handle, and recursively nested composition boundary frames in a serialized worker so new visuals appear without a cold decoder pause. The planner honors nested source trims, speed, hidden tracks, and cycle guards while retaining only the bounded nearest targets. The quality menu shows the active render percentage while adapted.
- Untouched single-source exports now use a strict keyframe-aligned fast-copy path across MP4, MOV, WebM, and MKV. It preserves the original encoded video and audio packet payloads, skips encoder checks, works in queued and shortcut exports, reports the path before export, and falls back to the full renderer for any visual, audio, subtitle, transition, codec, size, or source mismatch.
- Speech cleanup now reviews filler words, phrases, signal silence, and transcript gaps before editing. A local CLAP audio model ranks transcript matches by confidence, leaves low-confidence words unchecked, reports model and scoring progress, falls back to explicit review when audio is unavailable, and unloads through shared model controls. Cleanup also supports presets, custom detection lists, exact cut totals, audition, selection, cancellation, caption retiming, and one locked-track-safe, sync-lock-aware ripple undo.
- Transcript editing can now stage words without changing the timeline, show exact struck-through words and duration, restore any selection, clear the review, and commit every staged source-time span as one caption-aware ripple edit and one undo step.
- Transcript search now finds exact phrases as they are typed, falls back to bounded typo-tolerant word matches only when exact search fails, highlights every result, and jumps between timed words from a compact keyboard-friendly control.
- Editor settings now persist undo depth, snapping, timeline detail, local transcription defaults, and an optional 5 to 30 minute safety save. OpenPost still saves completed edits after 800 ms, while the safety timer catches dirty work during long idle sessions without overlapping an active write. The Storage section prepares proxies, clears only rebuildable waveform and filmstrip data, regenerates thumbnails, removes session proxies, and manages local models without touching source media, edits, or exports.
- The project media panel now imports direct URLs, GIFs, and safe SVG files; searches, filters, sorts, and groups assets; and shows codec, size, storage, tag, and attribution details without leaving the editor.
- Projects now detect unavailable media on open, restore expired file access, relink moved sources with fresh metadata and previews, and recover orphaned timeline clips through safe automatic or manual replacements with locked-track checks and atomic undo.
- The project browser now shows cover images, duration, resolution, aspect ratio, and frame rate; searches, filters, and sorts in either direction; supports range and keyboard multi-selection with one bulk action; renames projects; and creates deep duplicates. Its Trash section restores projects, deletes one or all projects with shared-media checks, reports partial cleanup, and removes entries older than 30 days. Duplicates preserve media links and cover art while remapping timeline, caption, effect, keyframe, expression, transition, and saved-animation IDs.
- Project files now upgrade through an ordered, append-only schema registry. OpenPost writes a legacy project backup with media links, cover art, and external folder access before it persists the new document, and it leaves projects from newer editor versions untouched.
- Projects can now export and import checksummed `.openpost.json` snapshots. Imports migrate old projects, reject newer schemas, remap project IDs, match available media without copying it, keep missing sources recoverable, and roll back failed writes.
- Projects can now travel as `.openpost.zip` bundles with their source media, saved animations, and cover image. Export streams bytes to disk with live progress, cancellation, and no media recompression; import verifies every path, size, and SHA-256 hash before it remaps IDs, reuses safe local media, or commits the project, and cancellation removes partial files.
- Color grading now includes a direct Master, Red, Green, and Blue curves graph with arbitrary control points, large touch targets, precise keyboard edits, live preview, channel reset, and one-step undo across compatible selected clips. Preview and export share the same exact 256-sample GPU lookup texture.
- Background media work now stays visible in one compact project footer across panel changes. It combines real import, proxy, filmstrip, waveform, scene-analysis, transcription, voice-generation, and reverse-preview progress, expands into per-job stages and counters, and offers cancellation only when the worker can stop safely.
- Long timeline filmstrips now fill the visible clip with stable, viewport-sized tiles, decode visible source seconds before background samples, stop work when clips leave the viewport, and transfer display bitmaps before JPEG cache writes finish.
- Long and dense timelines now mount only a bounded viewport slice, collapse compact clips into interactive density buckets, preserve geometry-based marquee selection across unmounted clips, and add a project navigator with direct pan and edge zoom. Root caps, animation-frame-coalesced scroll work, keyboard control, coarse-pointer handles, and clean cancellation keep 30,000-clip projects responsive without widening a 320 px page.
- Timeline waveforms now render for audio-only clips as well as videos, stream visible peak chunks during long decodes, preserve FreeCut's 500-sample-per-second detail in a bounded cache, cancel safely, and replace old low-resolution persisted peaks. Incremental peak indexing and one path calculation per clip keep long-source redraws bounded. Real Chromium covers worker decoding and audio timeline rendering.
- Media-pool clips and nested sequences now drag to an exact timeline track and frame with snapping, edge auto-scroll, compatible-row and collision rejection, linked visual and audio ghosts, and one-step insertion. The same honest placement mode supports touch and keyboard input without widening a 320 px page.
- Track push/pull now shifts every clip at or after a chosen cut across all tracks with a live frame-coalesced preview, magnetic snapping, the tightest safe left clamp, keyboard and touch input, clean cancellation, transition repair, and one-step undo. Hidden clips stay in sync, while any affected locked track blocks the whole edit instead of moving locked content.
- Multi-selected visual clips now move, scale, rotate, align to every canvas edge or center, and distribute by equal visual gaps through one compact on-canvas control. Rotated custom anchors, transform parents, snapping, keyframes, locks, cancellation, keyboard input, touch targets, and one-step rollback-safe undo all share the same preview and saved transform truth.
- The timeline now records voiceover takes while playback runs, with microphone selection, live levels, narration processing, exact mute restoration, pause and resume, timing offset, seek locking, a live range overlay, project-switch cleanup, and one-step insertion on a named audio track.
- Screen, camera, and microphone recording now produces separate synchronized artifacts with measured start offsets, device selection, optional system audio, countdown, live size counters, and local-space preflight. Ordered OPFS scratch writes keep long captures off the heap, a bounded fallback stops cleanly before memory can grow without limit, partial files stay downloadable after insertion failure, and successful timeline insertion rolls back every imported artifact if any later step fails.
- Timeline tracks now form one-level groups with inherited visibility, lock, mute, and solo behavior across editing, preview, and export. Groups support collapse, rename, block-safe reorder, undoable creation, safe ungrouping, and a separate confirmed action for removing grouped tracks and clips.
- Selected visual clips now arrange into automatic grids, rows, columns, picture-in-picture, focus-and-sidebar, or fixed grids through a live preview with transition-chain cells, reorder controls, canvas spacing, saved presets, grouped-lock safety, active-sequence sizing, and one-step undo.
- Project video can now create first-class 2x Anime4K upscales for live action, animation, or 3D footage and 2x through 8x RIFE frame-interpolated copies. Both tools serialize GPU work, prefer WebGPU with a WASM fallback, stream MP4 output through local scratch storage, copy compatible audio without re-encoding, show stages, bytes, progress, ETA, and cancellation, and import the playable result back into the project media library.
- Save Frame and Freeze Frame now verify their rendered pixels, create small media-library thumbnails, persist complete workspace metadata, and roll back partial writes before exposing the generated still to the project.
- The Video Editor can now create 2 to 120 second instrumental tracks locally with ACE-Step 1.5 XL Turbo, using standard or high-precision browser models. For 2 to 9 second stingers it renders the model's 10-second minimum once, then trims the PCM WAV at an exact sample frame without re-encoding. It shows the full first-run size and origin quota before downloading, serializes the GPU with video enhancement jobs, reports byte and inference progress, cancels cleanly, manages cached OPFS model data, previews each WAV, and saves or inserts it at the playhead without duplicating media.
- ACE-Step storage checks now count only the assets used by the Turbo generation path. Standard and High first-use totals, progress, cache readiness, and quota preflight no longer include the unused semantic-code detokenizer.
- Clip properties now include playhead-aware anchor and transform values, horizontal and vertical flip, exact linked A/V speed retiming, visual and audio fades, and -60 dB to +12 dB gain. Preview and export share the same fade curves, linked edits stay atomic, and retimed keyframes keep their timing.
- Clip audio now preserves pitch across 0.1x to 10x speed changes, adds independent semitone and cent tuning, shaped fades, 15 EQ presets, and a complete six-band parametric EQ. Top-level and nested preview use a low-latency SoundTouch worklet and native Web Audio filters, while export applies the same phase-coherent stereo stretch and EQ without allowing the fast-copy path to skip audible edits.
- Long video and audio exports now keep decode, time-stretch, pitch, EQ, sample-rate conversion, automation, and mixdown in fixed five-second windows while preserving one continuous DSP state across every boundary. Final mux bytes stream to local scratch storage instead of growing one whole-file heap buffer, cancellation removes partial output, stale scratch expires automatically, video-only clips no longer create false audio failures, and decode errors stop the export instead of publishing missing sound.
- The timeline now opens a compact audio mixer with per-track and master faders, mute and solo, true stereo meters, peak hold, and clipping feedback. One shared Web Audio bus graph keeps preview routing exact, while root and nested master settings persist through undo, project saves, direct exports, queued exports, and smart-copy checks.
- Local model storage now tracks and unloads every resident transcription, search, caption, voice, music, interpolation, and upscaling runtime. Removing a model first releases its worker or sessions, concurrent clears share one operation, active work settles cleanly, and partial cache failures stay visible.
- The Edit workspace now uses compact Assets, Program, and Edit panes below desktop width, keeps the program monitor and inspector usable down to 320 px, and contains wide timeline controls inside their own scroller instead of widening the page.
- Editing workspace folders can now be added, switched, and removed from one compact project-browser control. The active folder stays clear, permission loss returns to the named reconnect flow, and switching refreshes the project list without a stale workspace view.
- Motion now supports FreeCut-parity additive MotionAnimationLayers: durable typed layers with add and multiply blending evaluated after base keyframes and before procedural modifiers, independent enable and disable, named independently removable layers, preset-as-layer application with merge semantics, multi-selection one-step undo, preview and export parity through the shared evaluator, saved-animation capture with cloned layers, and a focused accessible Motion workspace UI with 44 px phone targets, 320 px narrow-width proof, and i18n across 10 locales. Each preset can be added as a non-destructive layer without touching authored diamonds, baked later into keyframes, or removed without affecting base animation or live modifiers. Direct canvas moves, resizes, and rotations now remove active layer and procedural contributions before writing the editable base, so a gesture cannot double-count live motion.
- Video Editor now has a first-class persisted `ai-captions` caption source distinct from `transcript`, `subtitle-import`, and `embedded-subtitles`. Local scene analysis output (LFM vision model via the existing `sceneCaptionProvider` / `analyzeSceneContent` stack, no new model layer) creates an editable subtitle layer without replacing transcript captions. Captions derive placement and width from the actual project canvas (16:9, 1:1, 9:16) and share preview and burn/sidecar/embedded export through the common subtitle pipeline, with correction in the transcript panel, atomic undo, and repeat-run replacement of only its own previous `ai-captions` item. The timeline tools panel now exposes direct AI caption entry with progress, cancel, and error states through shared `mediaTasks` and shared UI primitives, with responsive 44px targets, 320/390 and dark-theme Chromium coverage, and serialised per-clip AI jobs that guard rapid repeats and shared scene-worker contention.
- FreeCut 4d62e80 J/K/L shuttle parity across program and source monitors with editable `SHUTTLE_FORWARD` (`l`), `SHUTTLE_REVERSE` (`j`), and `SHUTTLE_PAUSE` (`k`) commands, saved remaps, repeat suppression, editable-field guards, and localized labels in all ten editor locales.

### Fixed

- Made clean frontend test runs generate SvelteKit's ignored configuration before Vitest starts, so fresh Linux release candidates no longer fail during dependency optimization.
- Kept Android release builds reproducible by aligning the standalone app with the current Expo SDK 57 patch set and resolving one shared linking module across all native packages.
- Updated ZIP extraction used by local AI model tooling to the patched release that rejects crafted archives with abusive memory sizes.
- Edit comparison frame mapping is covered by pure tests for gaps, speed, reverse, sourceFps, linked companions, images/compositions, and timecodes, plus Chromium pointer tests that drive real timeline drags for rolling, ripple, slip, and slide, verify baseline-vs-dynamic distinction, audio-linked visual resolution, cancellation cleanup, single undo entries, absence of URL leaks, and 320 px layout.
- Composition fps header no longer hardcodes 30 due to missing parentheses.
- Keyboard Delete/Arrow nudge now works from the focusable, correctly named timeline region (`role="region"` with `aria-label`) as well as the window, with proper focus and a single undo entry.
- Motion gestures now share one pointer session with exact ownership, frame-coalesced previews, outside-release commits, and Escape, capture-loss, supersession, and destroy cancellation. Media drops use real pool metadata and exact lanes; work-area trims preserve source bounds; published controls, property links, all compositor blend modes, and program-monitor ghost scrubbing use their canonical runtime paths. Variable-height sidebar virtualization keeps large compositions bounded while preserving expanded rows, and source-aware timing edits, inherited locks, and atomic undo now cover every inline edit.
- Text motion band math now matches `references/freecut/src/shared/timeline/text-motion-timeline.ts` exactly, with pure tests for In/Out/Loop placement, half-clip clamping, and max offset.
- Filler, silence, and transcript range removal now repair generated captions once from their source timing instead of first splitting the caption item through the normal clip-split hook. Linked video and audio still ripple together, later caption words keep their timing, and one undo restores the full edit.
- Quick Cut now uses direct English labels for its empty state, in/out marks, preview, and export actions. Imported projects also stay within 320 px by shrinking grid tracks, truncating long source names, and stacking per-segment export controls on phones.
- Every built-in transition now reaches exact outgoing and incoming endpoint pixels in its Canvas2D path. Spiral and X wipes no longer cut a one-pixel seam at zero progress, shape and iris apertures cannot leave edge fragments at completion, sparkle glow ends cleanly, and the Chromatic, Liquid Distort, Glitch, and Pixelate fallbacks retain their direction and visual character instead of collapsing to a plain crossfade or hard cut.
- Render queues now save live phase and frame progress through bounded, ordered workspace writes, preserve the latest progress document after a crash, and flush the correct project before a workspace switch or editor close.
- Video Editor workspace tabs, mobile pane controls, canvas tools, timeline markers, trim edges, transition edges, audio gain lines, and track resize handles now keep 44 px interaction targets on phones and coarse pointers without enlarging desktop editing chrome. The compact phone header keeps recording and settings clear of every workspace tab.
- The Export dialog now traps keyboard focus, returns focus to its Render control, closes with Escape or an outside click while idle, and blocks accidental dismissal during an active render.
- Video Editor loading, generation, recording, recovery, waveform, and progress indicators now stop continuous spin and pulse animation when the browser requests reduced motion.
- Streaming video output now settles close, cancellation, write failure, and cleanup through one terminal operation, so an abort cannot race a second file close, expose a partial file, or leave callers waiting forever.
- Creating a Video Editor project now opens it only after route navigation settles instead of leaving the new project on the workspace list.
- Filler confidence now decodes only each candidate's short source-time window instead of retaining the full clip.
- Filler-word cleanup now treats only explicit hesitation sounds such as "um" and "uh" as audio evidence. The broad CLAP "filler word" label no longer marks ordinary clean speech as high-confidence filler.
- Stock-media filters now open without a delayed outro that could keep reactive provider state alive after the browser closed.
- Recently used Video Editor workspaces now keep a strict newest-first order even when two folders are picked within the same millisecond, and switching to a known workspace moves it back to the front.
- Large project bundles now check cancellation at fixed 256 KiB hash boundaries, settle storage write failures as soon as they occur, and clean up partial imports without a late unhandled rejection.
- Preview audio gain updates now tolerate media elements leaving the page during proxy changes, and the workspace picker exposes its interactive popover as a labeled dialog.
- Lottie source-monitor playback now reacts to frame changes without a dead reactive expression that failed editor lint.
- Moving a Video Editor project to trash keeps its project folder and media recoverable until restore, permanent deletion, Empty Trash, or the 30-day cleanup.
- Video Editor effect-drop targets now use the editor selection color and only offer drag guidance when a clip can accept it.
- GPU effects now compile all blend modes in WebGL2 and keep source textures bound when creating LUTs or glyph atlases.
- 3D LUT effect now declares `highp sampler3D` precision and the shared WebGL2 effect pipeline declares `sampler2D`/`sampler3D` precision, so LUT preview and export render instead of failing with `sampler3D: No precision specified`.
- Image effects now wait for decoded pixels before replacing the source preview.
- Burned subtitles now keep their timeline track stacking order during export.
- Video Editor playback now advances the shared timeline playhead so timecode, subtitles, keyframes, nested sequences, and frame-aware effects stay on the clock frame.
- Video Editor migration keeps newer schema versions intact and repairs nested sequence durations that would otherwise clip their own content.
- Render planning now uses a store-free keyframe evaluator, so worker and server tests can calculate animated volume without loading Svelte editor state.
- Splitting a reversed clip now preserves descending source continuity across both resulting pieces.
- Splitting a clip that owns transcript or AI captions now slices both caption types alongside their source, keeping cues aligned with one-step undo.
- Newly added and removed clips now update visible timeline rows immediately instead of leaving a stale derived track index until another render.
- The clip Speed field now has an explicit accessible label, and the 320 px transport keeps primary playback, voiceover, timecode, and fullscreen controls visible without page overflow.
- Shared ONNX model downloads now retry two transient network or server failures while permanent client errors still fail at once, so RIFE, transcription, and local voice setup recover from a dropped request without hiding a bad model URL.
- Verified cleanup and unmount paths clear shuttle timers, animation frames, and Clock listeners, and that rapid direction changes and repeated presses do not create duplicate rAF loops or stacked renders.
- Grow no longer crashes when a follow finishes during a recommendation refresh.
- The mobile app now restores its workspace before loading data, keeps caches separate by workspace, and reports load failures instead of false empty states.
- Draft lists no longer crash on Android when formatting relative dates.
- The mobile workspace menu now opens as a safe-area-aware bottom sheet, and the calendar keeps its full-width grid.

### Changed

- App releases now publish an unpublished n8n package version only after the exact backend revision is live, then verify registry integrity, provenance, the n8n community-package scan, and a clean n8n install before making the GitHub release public.
- Extended `Clock` to support signed transport rates with FreeCut-accurate ceil/floor framing, precise `[start, end)` range boundaries, forward and reverse looping, pause-and-restore range semantics, one animation-frame loop across wraps, and a hard stop at timeline zero. Successive J/L presses advance `1x`/`2x`/`4x` and direction changes reset to `1x`; negative `playbackRate` never reaches `HTMLMediaElement.playbackRate`.
- Program preview now shows real reverse frame progression via the Clock frame queue and schedules short decoded reverse-audio grains through the existing track, clip, fade, and master gain paths. Media elements stay paused and are driven by drift-checked seeks; the stacked compositor and prewarm paths remain unchanged.
- Source Monitor now owns hover and focus routing, uses native positive `playbackRate` where browser audio stays safe, and falls back to exact frame-by-frame `requestAnimationFrame` seeking plus reverse-audio grains for reverse shuttle with correct `in`/`out` clamping. `K` pauses only the active monitor and leaves the other transport untouched.
- Added a compact localized shuttle indicator (`J`/`L` with direction arrow and speed) for transient shuttle mode, including the first `1x` press, with subtle styling at `1x` and highlighted styling at `2x`/`4x`. Normal play and every explicit pause reset the transport to `1x` normal mode.
- Mobile pairing now identifies the app and platform, and the approval page uses the requesting app name with device-neutral copy.
- The mobile launcher icon now gives the OpenPost mark more space.
- Grow can now focus on people who already follow you, require a minimum number of mutual connections, and sort by best match, follow-back potential, or most mutuals.
- Connected account settings now open in a compact side drawer with a fixed action bar and a collapsed developer shortcut instead of a tall modal.

### Quick Cut — multi-source, bounded streaming, and export semantics

- Quick Cut now uses stable multi-source IDs with `File`/`FileSystemFileHandle` resolution (`probeSourceFile` via `displayWidth`/`displayHeight`/`codec`/`sampleRate`/`channels`/`rotation`/`fps` and `EncodedPacketSink` keyframes) and `QuickCutSegment.sourceId`. The route opens multiple files in one picker, shows a source selector with missing-file warning, and adds segments from any source. Project JSON persists `sources` metadata and reconnects via `handles-db` with fingerprint verification before binding.
- Preview and segment editing switch to the segment's source. Timeline, timecode, and duration use the active source's metadata. Loop modes handle source switches at segment boundaries.
- Merge preflight compares real `videoCodec`/`audioCodec`/`width`/`height`/`sampleRate`/`channels`/`rotation`/`container` support via `getSupportedVideoCodecs` and FPS/timebase, estimates output bytes, and checks `navigator.storage.estimate` with a fixed reserve and explicit unknown/pending state (one storage contract). Incompatible merges require a unified transcode with a visible reason.
- Streaming is bounded: every scalable path writes to an OPFS `StreamTarget` scratch file. Export helpers return a plain `{scratchPath, fileName, scratchFile, wasLossless, reason, estimatedBytes}` token (serializable, no closure) and a production `discardScratchFile` helper (tested via `structuredClone`). Only the main thread copies chunkwise (4 MiB) via `openBlobWriter` (static imports, reader cancel/release in `finally`, partial final rollback). No `BufferTarget` or `arrayBuffer` for large outputs; temp files for merged transcode are also streaming and cleaned on success/cancel/init/encode/mux failure.
- Export semantics: no dummy `import('mediabunny')`, no speculative comments; `Conversion.isValid===false` throws `UnsupportedStreamCopyError` without retry, `AbortError`/mux failures are not retried, fallback only from explicit preflight before `output.start()`; sequence numbers monotonic per track; exact merged retains ordered segments without gaps; nearest-keyframe requires explicit before/after choice (default before with delta shown) and never includes outside content without UI warning; audio respects exact kept boundary and encoder delay; every early throw disposes `Input` and discards scratch; decoder configs handled per source or forced to one consistent encode.
- Preflight is per segment for individual exports; one non-keyframe exact segment does not force other independent segments to transcode. Merged export chooses one unified path.
- UI is exercised for multi-file picker, source switching, segment preview/loop across A/B/A, reconnect, project import/export, sequential individual and merged exports, cancellation, send-to-OpenPost, keyboard I/O/frame-step, 44 px targets and 320/390/desktop no-overflow, light/dark, with console clean.
- Local editing assistant now runs fully on device behind a WebGPU gate with a cancellable Gemma worker, streamed status, bounded history, grounded clip refs, typed and runtime-validated tool registry, one corrective retry for invalid model JSON, one bounded transcript lookup hop, explicit plan review before any mutation with destructive and review labels, sequential step results that stop on first failure, each timeline edit undoable through existing public actions, model runtime registration and unload, model cache visibility and quota-aware first-load preflight that blocks when insufficient, and no fake persistence. Tools cover find clips, search transcript, select, seek, add title, split, ripple delete, set speed, set volume, trim, add transition, open silence review and open filler review with scoped targets. The left rail adds an Assistant versus Generate switcher above voice and music with short direct copy, keyboard tabs, visible focus, 44px touch targets, 320px and 390px fit and dark theme support. Wired through the video editor route with project-scoped state and autosave. Includes pure tests for invalid JSON correction, stale refs, confirmation before mutation, cancellation, sequential results and scoped handoff, and browser tests for plan review, mobile overflow and keyboard behavior.
- Video Editor browser storage for presets, diagnostics, voiceover preferences, local AI models, processing scratch files, exports, and recorder recovery now has an exact privacy-inventory entry with its purpose and retention. Non-cache local AI backends no longer carry fake Cache Storage names.
- Marketing type checks now follow only the shared frontend modules the site imports instead of treating the full Video Editor source and test tree as marketing code.
- The public homepage now identifies solo founders as its audience in the server-rendered hero before JavaScript runs.
- Public marketing and connector-guide pages now state their intended audience before hydration, and the reviewed no-JavaScript evidence matches the visible production copy.
- Source monitoring, timeline marker editing, and composition authoring now use the shared input, slider, checkbox, and select controls while keeping frame-accurate keyboard edits, grouped blend modes, compact editor sizing, and narrow-screen fit.
- All 21 WebGPU transitions now compile and render through a real Chromium GPU adapter in browser tests, with read-back pixel proof for outgoing, midpoint, incoming, and advertised direction behavior. Sparkles, Chromatic, Liquid Distort, and Light Leak Burn now preserve exact endpoint frames.
- Motion, shape, Lottie, color, effect, expression, and published-control panels now use shared editor controls. Repeated keyboard slider input previews every step but commits one undo entry when the key gesture ends.
- Quick Cut, recording, transcription, local AI, scene, project, keyframe, shortcut, and timeline tools now use the same accessible form controls as the rest of OpenPost. Select menus keep their labels and disabled states, checked recording sources retain their visible selection, and the editor has no remaining native form-control exceptions.

### Tests

- Added deterministic Clock tests for negative-rate ceil semantics, range start/end boundaries, single-loop scheduling, zero clamping, successive J/L speeds and direction changes, and throttled `timeupdate`; exact reverse-audio sample, rate, envelope, cleanup, and boundary tests; shortcut and ownership tests; and Chromium coverage for the localized shuttle indicator and its 320px fit.

## [4.1.0] - 2026-08-23

### Added

- Add public About, Contact, and Developers pages, linked product and operator structured data, an Atom changelog feed, direct agent interface guidance, and explicit search and model-training permission for public marketing content.

### Changed

- Add server, support, terms, license, and usage metadata to the generated OpenAPI contract.

## [4.0.1] - 2026-08-23

### Fixed

- PostgreSQL upgrades now remove the retired Video Editor tables in foreign-key order instead of failing during startup.

## [4.0.0] - 2026-08-22

### Changed

- Rate stretch now scales keyframe timing and ripples linked downstream clips on each synchronized track.
- Crossfades now span both sides of the cut and render both clips in preview and export using validated hidden source handles.
- Made the standalone Expo app the only Android app. GitHub releases now publish its signed `openpost-app-android.apk`; the old web wrapper and its server chooser are gone.
- Reorganized Settings into clear Personal, Workspace, Organization, and Instance groups with compact desktop tabs and one mobile selector.
- Rewrote settings labels and help text so controls describe their scope and effect consistently.
- Kept save actions in the page flow instead of moving them over page content.
- Documented optional account features as per connected account in Accounts, Analytics, Engagement and Inbox, and provider docs. Direct messages, Comments and replies, Analytics, and Grow start off for new accounts. Users choose them after connection or in Account details. Disabling a feature stops future provider reads and writes without deleting history or revoking provider authorization. Provider support, required scopes, and plan access remain distinct. Grow never follows automatically.
- Updated the platform overview to clarify that Grow is available only for Bluesky and Mastodon, Direct messages for X, Bluesky, Facebook Pages, Instagram Professional accounts, and Mastodon, Engagement comments and replies for X, Mastodon, Bluesky, LinkedIn, Threads, Facebook Pages, Instagram, and YouTube, and Analytics for X, Mastodon, Bluesky, LinkedIn, Threads, Facebook, Instagram, TikTok, and YouTube. Discord webhooks support none of these optional features.
- Clarified per-provider support notes for Bluesky, Mastodon, X, Facebook, Instagram, LinkedIn, Threads, YouTube, TikTok, and Discord so provider docs list only implemented optional features and their required scopes, and note that each feature starts off and is controlled per account.
- Added upgrade notes to Accounts and Upgrades explaining that existing accounts keep current behavior: previous Inbox opt-ins become Direct messages choices, current Analytics and Engagement behavior remains enabled, Grow is enabled only where stored Grow sync state exists, and other accounts receive explicit off choices so routine reauthorization does not retrigger the setup prompt.

### Fixed

- Directly trimming a transitioned clip edge now previews the break, removes the transition with a toast, and restores it with the same undo step.
- Timeline selections no longer retain clips removed by an edit or undo state change.
- Ripple trims now preview and apply the same inserted or removed time across unlocked sync-locked tracks while preserving split media source ranges.
- Video Editor drag, undo, save, and export flows now snapshot reactive timeline state without browser cloning failures.
- Improved the Android app's large-text layout, screen-reader labels, workspace selection, draft menu, attachment retries, destination removal errors, post rescheduling, and delete failure handling.
- Load only the active settings page so hidden pages no longer fetch data or update in the background.
- Keep Settings usable without horizontal overflow at narrow mobile widths.
- Treat the absence of a pending Organization ownership transfer as a normal empty state instead of a browser error.
- Keep provider retry and reconnect actions visible instead of grouping them with providers that need administrator setup.

### Removed

- The entire cloud-synced OpenPost Video Editor: frontend editor (~23k lines), `/video-editor/*` sync API, `videoproject` package, `VideoProject*`/`VideoReturnToken` models, bundled editor model packs and audio assets, and the `@openpost/video-project` package. Migration 107 drops `video_projects`, `video_project_assets`, `video_project_revisions`, `video_return_tokens`, and `media_attachments.video_project_id`.
- Composer return-token handoff. "Edit video" now links to `/video-editor` via plain URL parameters.
- Removed the unused settings search, duplicate media-retention information, and the duplicate Organization deletion control from Workspace settings.

### Added

- Video Editor effects can now be dragged onto one visual clip or a compatible multi-selection, with live drop previews and one undo step.
- The Video Editor timeline now supports drag-marquee selection across tracks, with additive selection modifiers and a visible selection box.
- OpenPost Video Editor now supports ripple trim, rate stretch from either edge, linked-selection controls and shortcuts, multi-clip link and unlink actions, group moves and deletes, visible transition spans, and explicit transition removal.
- Video Editor move, trim, slip, and slide tools now keep synchronized audio and video companions aligned across every affected track.
- Timeline edits now preserve valid transition handles and keyframes instead of leaving broken cuts or moving keys into blend-owned frames.
- **OpenPost Video Editor** (`/video-editor`, Chromium-only): workspace folder on your disk is the source of truth (projects, media, caches, exports as plain files). The editor includes a layered multi-track preview, undo/redo, text and subtitle editing, broad clip keyframes with cubic and spring easing, a WebGL2 effects and color stack, cached waveforms and filmstrips, proxies, scene and silence tools, and transcript word editing. Rendered export supports MP4, MOV, WebM, MKV, MP3, AAC, and WAV with codec, size, quality, range, subtitle, progress, and cancel controls. Send to OpenPost uploads the finished export to the media library.
- Preview controls now match FreeCut's device-only monitor gain and mute, fit and fixed zoom presets, native fullscreen, audio-only playback, and full-resolution frame capture. Captured frames download and also join the project's media pool.
- Timeline editing now exposes ordered video and audio track creation, safe track removal, sticky lock/visibility/mute/solo/sync-lock controls, adaptive snapping, trim-start and trim-end handles, rolling cuts, source slip, neighbor-aware slide, and source-bound rate stretch. Pointer work is frame-accurate, cancelable, and grouped into one undo step; the same tools support one-frame and ten-frame keyboard edits.
- **Quick Cut** (`/quick-cut`): fast lossless trimming - mark I/O segments, save each without re-encoding via stream-copy. Inspired by LosslessCut's segment flow (behavioral reference only).
- **Recorder** (`/record`): screen, camera, microphone, and screen+camera PiP-composited capture saved locally.
- Stock-media client re-homed from the deleted editor to `$lib/stock-media`.
- Added Grow usage guide at `/usage/grow` describing discovery and follow as an optional feature per connected Bluesky and Mastodon account. It starts off, uses an explicit per-account choice, never follows automatically, and shows how enabling queues discovery while disabling stops future provider calls without deleting history or revoking provider authorization.

## [3.14.0] - 2026-08-20

### Added

- Added `changes/*.md` fragment workflow that merges per-issue changelog entries into `CHANGELOG.md` under `[Unreleased]` before each release, grouped by heading; fragments are deleted after merge so the manual changelog stays conflict-free across parallel tickets.
- Added `devenv` `doctor` script that proxies to `bun run doctor` for a single local health gate.

### Changed

- Made the product clear at a glance in README and marketing with refreshed hero, product screenshots, and copy that shows the Publication and Rendition workspace without hiding provider truth.
- Documented the single backend runtime location for `OPENPOST_PADDLE_*` (`backend/.env` for devenv, container environment for Docker) and clarified that bare `PADDLE_*` is never read; Cloud mode now warns at startup with the exact ignored names without printing values.
- Refreshed product screenshots as trustworthy, exact renders of the current app and documented the fragment workflow with granular check guidance (`check:frontend:types`, `check:contracts`, `test:file`, `test:backend:pkg`) and an `.rgignore` to keep searches fast.
- Staged provider, security, and scheduling flows with progressive disclosure: available providers stay primary while setup-required providers move behind a collapsed section, failed provider errors stay dominant with a retry beside the message, authenticator setup is staged one primary action at a time, quick schedule paths are primary while calendar and randomization are behind disclosure, and Workspace Preferences and Security panels collapse media lifecycle, danger zone, and identity sections.

### Fixed

- Instance admin plan overrides now work end to end. Assigning an override previously failed with a 500 because the generated subscription row carried an empty `workspace_id` that violated the Postgres foreign key; the model now stores a NULL workspace, and the override grants plan entitlements exactly like a paid Paddle subscription across billing status, entitlement checks, setup state, and public profiles.
- Removing an override from the plan dialog previously returned 422 because the empty `plan_id` was rejected by request validation; empty `plan_id` now reaches the removal path as documented.
- Resolved configured Mastodon adapter by canonical `instance_url` before dynamic registration so OAuth callbacks find the correct provider key.
- Loaded `SSL_CERT_FILE` into the Go root pool on macOS so local E2E Mastodon CA is trusted without `InsecureSkipVerify`.
- Ignored aborted fetch errors after component teardown and pagehide so stale composer requests do not pollute console telemetry.
- Rendered self-hosted registration and onboarding copy and skipped the hosted purchase-choice gate when `purchase_choice_required` is false; preserved signup, verify, and redirect context in purchase-choice Change links and showed a locked checkout state when a purchase choice is bound.
- Handled first-load Vite dev race for generated SvelteKit nodes with graceful chunk-reload (`vite:preloadError` plus `error` and `unhandledrejection`) guarded by a sessionStorage retry budget and proactive service-worker `controllerchange` handling, and cleared the budget after a successful load.
- Fixed Bun SQLite tag warning by using `column:type` and `column:notnull` so type and not-null are not parsed as standalone options.
- Made register and verify-email config loading resilient with `Promise.allSettled` and `try/finally`, always clearing loading state and showing a Retry action while preserving form values; corrected verification copy to inbox, code, address, and retry guidance.
- Deduplicated desktop setup guides so the home guide is visible on desktop and hidden on mobile while the composer guide does the opposite, and mapped raw backend OAuth errors for Mastodon `instance_url` and X callback allowlists to user-facing connection messages.
- Reconciled server-assigned Segment and Rendition IDs after draft creation so subsequent edits do not hit the unique position constraint, and closed the account menu before Settings navigation so it does not cover the destination page.
- Kept the writing surface focused by removing the inline schedule helper from the text post composer.

## [3.13.0] - 2026-08-17

### Added

- Instance administrators can assign or remove plan overrides for users without requiring Paddle checkout, through a new admin endpoint and plan selection dialog.

### Fixed

- Extended button and card touch targets with an invisible bottom area to improve mobile tap usability.
- Removed unnecessary wrapper padding around the Workspace setup guide in the composer.
- Fixed whitespace rendering in feedback dialog radio items.

## [3.12.0] - 2026-08-16

### Changed

- Retired the Post authoring model end to end. Post HTTP routes, MCP post and draft tools, the legacy `publish_post` Job kind, and the `posts` service are removed; the publisher, composer, scheduler, calendar, Engagement, Messaging, and notification paths operate only on Publication and Rendition identifiers. Historical migration files still upgrade older databases, and immutable `legacy_post` / `legacy_post_variant` aliases resolve old links to canonical Publications. The Post compatibility tables (`posts`, `post_destinations`, `post_media`, `post_variants`, `thread_drafts`, `post_media_deliveries`) are dropped after the legacy backfill completes and no Post rows or pending `publish_post` Jobs remain.

- Added repository-owned Oxlint checks that reject unsafe type widening, unverified runtime boundaries, reflective access, module mocking, and other patterns that weaken type and dependency contracts.
- Split engagement and messaging refresh, persistence, provider seams, recurring Jobs, and retries into independent capability outcomes, and removed the transitional communications runtime.
- Contracted REST, MCP, CLI, browser, and direct application Workspace authorization onto one read, edit, or administer decision, removed middleware-owned and membership-only policy helpers, and kept durable Jobs explicitly scoped without user impersonation.
- Extracted Messaging into an independent application module with internal Workspace authorization, capability-specific provider access, stored conversation reads and mutations, durable sends, typed outcomes, provider-write fencing, and its own recurring collection chain over transitional sync-state storage.
- Extracted Engagement into a transport-independent application module with internal Workspace authorization, a capability-specific provider port, stored read and archive state, typed outcomes, provider-write fencing, and its own recurring Job chain and health state.
- Completed Publication-only composer recovery: media queues now belong to the Composer session module, editor returns are bound once to the original Workspace, Publication, and revision, Workspace changes preserve save, discard, or stay, and old Post links redirect to canonical Publication URLs without mounting a Post-backed composer.
- Publishing, Workspace invitation, and Organization ownership producers now emit typed notification outcomes. Workspace team owns invitation delivery generations and lifecycle updates, while notifications retain only redacted, deduplicated provider delivery evidence.
- Removed the raw notification producer API, sealed topic and delivery policy behind typed outcomes, and split notification email delivery from password reset, verification, and identity email capabilities across SMTP, Resend, and Cloudflare adapters.
- The text-and-thread composer now uses one Publication-backed browser session for new and existing drafts. The session owns serialized revision saves, conflicts, validation, scheduling, immediate publishing, retries, cancellation, deletion, and success reset through the typed Publication client.
- Notification producers can now record sealed domain outcomes whose topic, delivery, Mute, deduplication, action, and presentation policy comes from one backend catalogue. Notification settings use the catalogue's generated API projection while keeping exhaustive English and Portuguese labels, descriptions, and icons in the frontend.
- Moved media usage and lifecycle protection, account and Workspace deletion, background Job scoping, and activity navigation onto canonical Publication, Segment, and Rendition ownership instead of legacy Post authoring state.
- Deprecated retained Post HTTP compatibility routes, recorded their Publication replacements and sunset evidence in the compatibility registry, added OpenAPI migration guidance, and documented the minimum 90-day and two-later-stable-release removal gate.
- Added canonical Publication aliases and terminal legacy delivery evidence to the historical Post migration so published and failed compatibility rows resolve safely without provider calls.
- Moved planner calendar loading and CLI post/thread workflows onto canonical Publication list, creation, update, schedule, and deletion contracts, with Publication calendar filters available to MCP.
- Completed the canonical Publication delivery path with application-owned get, list, history, delete, cancellation, validation, scheduling, publishing, and retry operations; stable transport-neutral error categories; a canonical cancellation contract for REST and MCP; and persisted effective random-delay ranges whose exact Job times are covered by Publication authorization.
- Unified Workspace access behind one application decision for read, edit, and administer actions across request middleware and transactional callers. The decision now combines credential Workspace binding, Organization identity policy, active Workspace membership, and role level while keeping safe denial separate from operational failure.
- Proved the complete UX program through one combined browser and integration matrix covering the first-use journey, daily work, collaboration and safety, local recovery, responsive presentations, themes, locales, keyboard and announced state, automated serious and critical accessibility checks, clean console output, and synchronized Self-hosted claims. Reconciled the audit-remediation backlog to remove the completed UX work and retain external status infrastructure as a separate deferred boundary.
- Split Cloudflare edge changes into a read-only preparation and a separate apply that requires the reviewed forward-plan and prepared-operation digests, so operators can inspect the live snapshot and exact rollback before any production write.
- Grouped the marketing and documentation edge rules into the one deployed `openpost.social` Cloudflare zone, so each phase is inspected, applied, and rolled back once without one host overwriting the other.
- Kept the exact Markdown `Accept` gate within the function set Cloudflare permits in every deployed edge phase, so the reviewed plan can be applied without weakening rejection of mixed, weighted, wildcard, parameterized, repeated, or internally spaced values.
- Added a bounded four-hour Cloudflare edge TTL to the exact `Accept` cache variants so repeated HTML and Markdown requests produce real cache hits while remaining separated in both request orders.
- Published a dedicated Self-hosted product path with an explicit no-software-fee boundary outside Hosted service plans, complete operator responsibilities, current deployment and source links, responsive no-JavaScript HTML, and an agent-readable Markdown representation.
- Completed local application-state recovery with distinct offline, forbidden, not-found, rejected-request, and server-error guidance; in-place connection recovery; focused and announced error states; and destructive confirmations that retain only unfinished targets and remain open when an operation does not complete. Media and provider-configuration deletion are idempotent so a retry can safely reconcile a response lost after commit.
- Proved the collaboration-and-safety cohort across truthful invitation recovery, atomic Workspace and Organization deletion, accepted ownership transfer, permission-safe audit exports, and responsive, localized Daily email and temporary Mute controls.
- Shared one local Turbo task cache across OpenPost worktrees with a 2 GiB total cap, removed immutable editor models and audio from frontend cache archives and build-tool copy inputs, validated their declared inventory before linking them across generated web, Go embed, and Android trees, and omitted them from CI checkouts that do not build the application. CI keeps exact-run frontend caches ephemeral so source-map uploads still execute.
- Organization Owners can now select and permanently delete any owned Organization without Workspace access after a complete preview, exact-name confirmation, and recent authentication; unconfirmed Paddle subscriptions, outstanding checkouts, pending ownership transfer, provider-scheduled work, other provider work, and cleanup remain explicit blockers, canceled checkouts cannot resume and retain an opaque boundary that terminates late Paddle subscriptions, failure is atomic, affected access, credentials, current and evidenced historical invitation email Jobs, ownership-expiry or notification Jobs end on success, and only content-free lifecycle and required billing evidence remains.
- Updated `golang.org/x/image` to 0.45.0 to fix excessive memory allocation while validating VP8L images.
- Added temporary account-wide and Workspace notification Mutes on both Notifications and Settings, with visible absolute end times and an idempotent end-now action. Mutes pause optional Immediate and Daily email without changing saved preferences, conservatively suppress pre-upgrade queued optional mail whose Workspace scope is unknown, resolve the Workspace scope first when scopes overlap, expire automatically, keep in-app notifications immediate, and never suppress Transactional security, access, invitation, or critical billing email. Workspace-bound credentials receive only their Workspace Mutes when they reconcile state. Database upgrades apply migration 100 automatically.
- Organization Owners can now select an Organization without Workspace access, see its current Owner, and nominate an active member after recent authentication and exact confirmation; a nominee can resolve the standalone action without Workspace access. Every ownership read and action enforces the Organization identity and SSO assurance decision without requiring Workspace access, and the transport-independent initiation service requires an unscoped browser credential and consumes one recent-authentication grant. The durable, expiring Transactional action uses semantic English and Portuguese notification content, clears and suppresses actions whenever transfer state cannot be loaded or its URL changes, preserves the current Owner through decline, expiry, or revocation, records every reached initiation failure in domain-owned audit evidence, exposes ownership transfers in the Organization audit filter, and atomically moves creator and subscription authority plus the Owner role to the accepting nominee while demoting the prior Owner to Administrator. Database upgrades apply migration 097 automatically; no operator action is required.
- Optional notification email topics now support Off, Immediate, or Daily delivery with a saved local time and IANA timezone. Daily items are durably batched and deduplicated per user and window, use bounded Job retries and one idempotency key, and advance only after a confirmed send; Transactional security, access, invitation, and critical billing email remains immediate.
- Fixed Cloudflare edge cache variance so parameterized and weighted Markdown requests cannot reuse the exact Markdown representation, and kept HTML fallbacks from being mislabeled when a Markdown artifact is unavailable.
- Permanent Workspace deletion now shows exact removal, retention, recovery, and lifecycle-blocker facts; requires the Organization Owner, the canonical Workspace name, and recent authentication; rechecks blockers atomically; preserves dialog and data state on failure; and retains Organization-scoped audit evidence after success.
- Added a read-only deployment proof for the public Markdown surfaces that binds the clean reviewed Git revision to both Cloudflare Pages builds by full commit hash, exact local and live artifacts, discovery and native-interface behavior, and a separate 24-hour AI crawl observation. The documentation full corpus now links only to explicit generated Markdown or intentional native machine assets.
- Instance administrators can now page, filter, and export the same permission-safe audit vocabulary across every Organization, while Organization Owner boundaries remain unchanged and ordinary users, Workspace roles, scoped tokens, and other non-browser credentials cannot request instance-wide evidence.
- Workspace invitations now distinguish provider-accepted Sent email from webhook-confirmed Delivered email, retain redacted and idempotent callback evidence, ignore stale or terminal-generation callbacks, show accepted and revoked records to administrators, return one safe acceptance error, and protect resends with a one-minute atomic cooldown plus the existing five-per-hour limit. Database upgrades apply migration 096 automatically; operators may configure `OPENPOST_EMAIL_DELIVERY_WEBHOOK_SECRET` when their mail provider supports delivery callbacks.
- Added a deterministic Cloudflare plan for both public hosts. It uses the route catalogues to redirect known paths and select Markdown only for exact requests, checks Free-plan limits before changes, inspects conflicts without writing, records apply evidence, and generates a reviewable rollback.
- Workspace invitations now queue one branded, expiring Transactional email for registered and unregistered recipients, bypass optional notification preferences, keep secrets out of ordinary notification and audit records, and preserve a truthful copy-link fallback when delivery is unavailable or fails. Database upgrades apply migration 094 automatically to add delivery state to existing invitations; no operator action is required.
- Organization Owners can now page, filter, and export one permission-safe audit projection over identity, Workspace access, Organization-scoped impersonation, billing checkout, MCP, Publication lifecycle and authorization, and provider-write evidence without gaining Workspace content access or exposing emails, content, secrets, tokens, invitation links, credentials, or raw provider responses. Owners who are not Workspace members can use the audit UI, and Android exports use authenticated requests.
- Proved the complete daily-workflow cohort across paged Engagement and Messages history, request races and retries, all eight exact Rendition outcomes, and responsive, localized Accounts and Paddle billing journeys.
- Marketing and documentation builds now prove one complete public delivery contract across every eligible HTML and Markdown route, including prerendered meaning, discovery, safety, deterministic output, cache planning, size limits, and explicit artifact content types.
- Composer destination controls now retain a usable mobile scroll area when first-use guidance is present.
- Split the billing page into Paddle-backed subscription facts, OpenPost usage, and Paddle-managed payment tasks; added verified billing-contact display, purpose-specific payment and cancellation links with a fresh generic portal fallback, qualified list-price estimates, and kept payment methods and invoice documents managed in Paddle.
- Documentation builds now expand controlled includes, normalize supported VitePress and raw HTML, publish useful no-JavaScript API guidance, and generate a bounded, provenance-preserving `llms-full.txt` convenience corpus from reviewed catalogue policy.
- Updated CI and release images to Go 1.26.6 for the latest standard-library security fixes, provisioned Nix before repository policy checks, and made partial browser-job reruns reuse the newest canonical build artifact.
- Direct and Settings-embedded social account management now share one explicitly configured Workspace component, while each route keeps its own authentication, OAuth continuation, URL cleanup, and one-time feedback without redirect flashes.
- Moved the canonical source, release links, installation commands, support URLs, badges, and container image namespace to the `getopenpost` GitHub organization while retaining the published MCP Registry identifier for compatibility.
- Messages now loads older conversation history near the top with stable cursor pages, an accessible manual control, exact reading-position preservation, deduplication, and stale-request protection across new messages, conversations, and Workspaces.
- Messages now reaches complete conversation history with stable cursor pages, deduplicated appends that keep newer records, preserved filters and selection, and in-place first-page and older-page retries.
- Publication details now keep each Rendition's exact queued, submitted, processing, provider-scheduled, live, rejected, ambiguous, or manual-resolution outcome, show safe normalized failure and attempt evidence, and offer retry only when the canonical provider-write result proves another send is safe.
- Activity, Publication detail, and lifecycle history now share exact destination outcomes and safe recovery controls, while the timeline separates event occurrence from provider attempts, reconciliation, and the latest effective state so older failures cannot appear current.
- Composer schedule and submit results now keep every destination's exact outcome visible, link to Publication detail, and offer only the canonical safe retry or review action.
- Every public browser-tool page now keeps purpose, audience, inputs, outputs, limits, privacy behavior, and a next step in no-JavaScript HTML and focused build-generated Markdown.
- Every ordinary public documentation page now publishes deterministic Markdown with canonical absolute links, per-page HTML discovery, an HTML-only sitemap, and a structured documentation `llms.txt` derived from the checked-in documentation catalogue.
- Engagement now reaches complete saved history with stable cursor pages, in-place retries, deduplicated appends, and a searchable, paged Publication filter that keeps older selections.
- Every platform and comparison page now publishes a build-generated Markdown representation with canonical metadata, provider limits or comparison evidence, HTML alternate discovery, and optional `llms.txt` sections derived from the marketing route manifest.
- Marketing and documentation production builds now generate deterministic homepage Markdown and `llms.txt` discovery files from canonical public sources, advertise them from canonical HTML, and keep sitemaps HTML-only.
- Proved the complete first-use cohort from verified signup through Workspace Activation with deterministic email, Paddle, and destination adapters, recovery and role coverage, responsive and presentation checks, and clean browser-console assertions.
- Every static marketing page now has a deterministic Markdown representation, with route metadata owning page identity and discovery policy, curated optional and primary `llms.txt` links, unlisted legal and changelog files, semantic conversion checks, and a per-page size ceiling.
- Replaced the frontend formatting and general JavaScript lint passes with Oxfmt and Oxlint, retained ESLint for Svelte template rules, upgraded production builds to Vite 8 and Rolldown, cached independent frontend quality tasks with Turbo, parallelized safe repository checks and tests, and reused the shared Go cache for local backend builds.
- Replaced the overlapping package, Devenv, CI, hook, and release command graphs with one root task registry for formatting, linting, checks, tests, builds, verification, and release subcommands; added consistent surface scopes and policy selectors; removed obsolete aliases; and made CI and local release checks call the same tasks.
- Updated the transitive Nano ID security pin so the exhaustive release dependency audit passes without the high-severity zero-size custom-generator advisory.
- Made the documentation preview accept caller-selected host and port arguments so its isolated browser gate starts reliably.
- Completed the privacy-limited first-use PostHog journey from signup intent through Workspace Activation, with server-owned lifecycle outcomes, strict browser and backend event allowlists, contract and integration coverage, and an MCP-managed production funnel with personless smoke verification.
- The first successful Publication schedule or submission now records one server-owned Workspace Activation under retries and concurrency, emits one authoritative analytics event, retires setup guidance, and offers immediate View publication and Create another actions.
- Workspace setup now recognizes the first meaningful text, media attachment, or thread-mode choice once per Workspace, while focus, destination selection, empty drafts, and repeated composer instances do not count. Its browser event allows only the interaction category and excludes authored content, media, identity, destination, and secret URL data.
- Successful first-destination OAuth now opens a fresh composer with the new Workspace destination selected, while cancellation and failure return to actionable account management without exposing provider secrets in return parameters.
- Added a server-derived Workspace setup guide that resumes from subscription, destination, and Publication state on the home, Accounts, and composer surfaces without a separate onboarding step index. Organization Owners receive the complete applicable journey, Organization administrators receive authorized billing guidance, Workspace administrators and editors receive only authorized content actions, viewers receive no setup actions, and self-hosted deployments omit Hosted service billing steps.
- Shift-activating draft deletion now bypasses the confirmation dialog consistently in the composer, planner, and day-post drawers.
- Reduced the ordinary local release gate to generated and type checks, lint, and unit tests; production builds, race and security checks, browser suites, and Docker image proof remain available through the explicit full rehearsal and candidate CI.
- Added one changed-file check for whitespace, conflict markers, formatting and Svelte parsing, Go formatting, shell syntax, and Nix syntax, and installed the same implementation as the pre-commit and pushed-range pre-push hooks.

### Fixed

- Trimmed the SMTP username so a trailing space in `OPENPOST_SMTP_USERNAME` cannot send a malformed AUTH identity and fail notification email delivery with an SMTP authentication error.
- Logged the terminal failure message when a background Job fails and recorded its retryability in error telemetry, so transient delivery failures are diagnosable without inspecting the database.
- Kept homepage animation cleanup inside the browser lifecycle so marketing prerender no longer calls browser-only animation APIs.
- Kept unlimited Publication scheduling operational when quota storage is unavailable, while preserving canonical usage accounting whenever counters exist and keeping limited plans fail-closed.
- Stopped routine autosaves from replaying the Saved animation and from replacing an unchanged Image Editor document, which refreshed page previews after edits.
- Accepted equivalent absolute and origin-relative canonical redirect locations in the public deployment proof while continuing to require the exact destination and preserved query.
- Kept the generated public Nix module example on `ghcr.io/getopenpost/openpost:latest` even when the linked deployment source pins a verified release digest.
- Restored marketing and documentation page views by requiring their production PostHog build settings, routed hosted browser telemetry through the managed first-party proxy, added matching page-leave events and privacy-limited Core Web Vitals, and kept route templates in SDK-owned URL properties.
- "Create another" after first Activation now opens a clean composer instead of retaining the published text and draft identity.
- Made direct documentation builds restore their ignored OpenAPI inputs from the tracked canonical spec before VitePress starts, so clean deployment checkouts cannot depend on generated local files.

## [3.11.0] - 2026-08-12

### Added

- Added one canonical hosted-plan catalogue and an expiring signed purchase choice that keeps exact pricing and trial terms through password signup, email verification, refresh, and identity-provider signup without defaulting invalid selections to Founder.
- Added an explicit first-Workspace confirmation that shows the selected plan and trial terms, atomically binds the named Workspace to one checkout attempt, and resumes that attempt after refresh without creating duplicates.

### Fixed

- Kept thread remove controls above their textareas, tightened publication-history and meme-picker overlays to their content, highlighted the active sidebar draft, removed the redundant AI alt-text review note, and retried one safe transient Memegen catalog read.
- Restored release gating after the hosted purchase-flow merge by accepting formatter-safe provider-catalog sources and checking marketing links and trial copy against the canonical purchase terms.

## [3.10.1] - 2026-08-12

### Fixed

- Qualified PostgreSQL provider-delivery upserts so the durable write fence reaches the provider instead of failing before every publication request.

### Changed

- Pruned completed and currently out-of-scope audit-remediation entries so the backlog contains only active or explicitly deferred work.

## [3.10.0] - 2026-08-12

### Changed

- Added a repository map, an agent workflow router, and a read-only doctor for local workflow artifacts and configured GitHub triage labels.

### Fixed

- Updated the marketing browser contract to verify the fictional workflow disclosure after removal of the unproved customer-logo rail.
- Made the changed-file pre-push formatter load the Svelte parser explicitly so marketing component changes are checked instead of blocking every push.
- Removed unproved customer-logo usage claims, labeled generated personas and workflows as fictional examples, and added a dated register that validates proof-claim owners, evidence, review dates, and expiry.
- Kept failed conversation read-state writes visible and retryable instead of clearing unread state locally, and made Android releases fail closed rather than publishing an unsigned APK under the installable asset name.
- Bound hosted checkout completion to its opaque billing attempt, persisted a validated same-origin return path with the selected plan and period, and made that path one-time so unrelated subscriptions, refreshes, and replay cannot redirect a user.
- Moved analytics account filtering, ordering, exact totals, and cursor paging to the stored-data API so workspaces with more than 50 post results keep complete newest/history views and account summaries.
- Made remote destination pickers page through provider options, deduplicate appended results, bind requests to current setting context, and clear incompatible child selections when a parent changes.
- Scrubbed engagement author and attachment metadata when a provider reports deletion or a provider-side delete succeeds, instead of retaining those fields after the body was removed.
- Bound account capability caches to the full settings and target context, output profile, intent, media shape, locale, and region so one community, location, or policy mode cannot reuse another target's provider rules.
- Extended the shared capability contract with hard and recommended title, body, description, alt-text, dimension, codec, frame-rate, audio, and local-time rules; provider catalogues and cross-transport parity coverage can now adopt those constraints incrementally.
- Added the schema and API foundation for provider subdestination targets, including target-aware authorization, retry, delete, uniqueness, and legacy Mastodon backfill behavior; provider-setting binding remains a follow-up gate before subtargets are advertised.
- Added a canonical provider-delivery projection with queued, submitted, processing, provider-scheduled, live, rejected, ambiguous, and manual-resolution states, exact reconciliation timing, and a stale-attempt fence, and exposed it on publication destinations.
- Removed the redundant gap between the desktop sidebar's draft list and workspace-navigation divider.

## [3.9.6] - 2026-08-12

### Fixed

- Escaped LinkedIn's reserved commentary characters at the provider boundary so ordinary post text with parentheses or other markup symbols is published in full instead of rendering only the prefix.

## [3.9.5] - 2026-08-12

### Fixed

- Aligned the hosted production privacy-policy version with the current application contract so candidate configuration validation and PostHog-enabled deployment use the same managed runtime environment.

## [3.9.4] - 2026-08-11

### Changed

- Made GitHub candidate CI the release correctness authority, planned pull-request checks from the fail-closed release-surface registry, split independent lint and browser work, reused SHA-addressed web artifacts in Playwright and the production image, enabled GitHub-backed Turbo caches, moved the frontend cache proof off the ordinary critical path, reduced pre-push checks to changed-file formatting, and moved Android compilation into candidate CI so tag releases only verify and sign the retained APK.

### Fixed

- Remove the legacy Umami loader from the documentation build now that the shared PostHog telemetry client owns that surface.
- Bound each GitHub release asset upload so a stalled transfer is terminated and retried instead of blocking image promotion and production deployment indefinitely.

## [3.9.3] - 2026-08-11

### Fixed

- Invoked the draft-asset upload helper through Bash and recorded its executable mode so release runners cannot reject it before its bounded retries run.

## [3.9.2] - 2026-08-11

### Fixed

- Retry draft-release discovery and asset uploads so GitHub's eventual consistency cannot cancel a release matrix immediately after the draft is created.

## [3.9.1] - 2026-08-11

### Fixed

- Resolved release artifacts from the attempt that produced each successful artifact, so a partial CI rerun can reuse the tested image manifest while consuming newly rebuilt frontend assets.

## [3.9.0] - 2026-08-11

### Added

- Added one privacy-limited PostHog telemetry layer across the app, backend, marketing site, and documentation, with explicit browser intent events, authoritative server outcomes, background-job and request error capture, opaque identity, runtime self-host configuration, and release-linked source maps.

### Changed

- Replaced the public Umami tracker with cookieless, memory-only PostHog analytics; disabled autocapture, session replay, console and network-body capture, advertising profiles, and cross-site identity; and updated the hosted Privacy Policy and subprocessor register for the managed telemetry boundary.

### Fixed

- Prevented repeated desktop or mobile New post actions from orphaning the replacement composer's account-loading state, so the Social Set and platform controls no longer disappear behind a permanent loading indicator.
- Preserved PostHog exception structure while adding application context, removed sensitive absolute URLs from browser stacks without dropping static source-map locations, propagated browser correlation through raw media transports, and added the marketing SvelteKit error boundary.
- Normalized publication authorization times to database precision so immediate publishes cannot fail before reaching a provider, and surfaced terminal preflight failures as failed instead of leaving them scheduled and pending.
- Scoped the Posts page totals and pagination to the selected Scheduled, Published, Failed, or Drafts tab instead of showing whole-history counts beside a filtered tab.
- Removed the three-item cap from the desktop draft planner, made long draft lists scroll, grouped Editors, Accounts, and Settings consistently, and added a compact animated collapse control for the lower workspace navigation.
- Kept replies authored by a connected social account out of its own Engagement feed and hid self-authored rows collected by earlier versions.

## [3.8.0] - 2026-08-11

### Added

- Added an optional Memegen-backed meme maker to the shared media picker with cached template search, editable captions and image slots, validated AI suggestions, bounded previews, Media-library imports, source metadata, and durable generation recipes.

### Changed

- Split Profile, Security, Developer, Billing, Schedule, Brand, Instance, and workspace preferences into tab-owned Settings modules that each keep loading, mutation, dirty-state, and rendering behavior local while the route owns only navigation and composition.
- Added an executable release lifecycle that shares Conventional Commit and workflow-run decisions with local preparation and verifies the identity-preserving complete-draft-to-published transition in hosted delivery.
- Made one Publication application boundary own access checks, creation, updates, validation, scheduling, immediate publishing, and retry orchestration across REST, MCP, CLI, and retained Post compatibility adapters.
- Centralized all durable job kinds, construction defaults, execution dispatch, retry classification, recurrence, stale-worker recovery, and ambiguous provider-write fencing in the job registry so producers, migrations, and workers share one policy.
- Added repository-owned engineering workflow skills and documented the GitHub issue tracker, triage labels, and single-context domain-document conventions used by agents.

### Fixed

- Kept disconnected historical account rows out of workspace provider-readiness decisions so an active verified X or Mastodon connection is not marked for reconnection by an older inactive destination.
- Kept AI meme suggestion previews recoverable when hosted rendering is slow or interrupted, retried one safe transient image download, and stopped canceled requests from appearing as expired sessions.

## [3.7.3] - 2026-08-11

### Fixed

- Kept configured cloud providers and active migrated accounts usable while certification evidence is being populated, without making uncertified providers publicly claimable. Migration 085 validates only linked, active, non-revoked legacy grants with stored encrypted access credentials. Cloud operators can opt into strict operational evidence enforcement with `OPENPOST_PROVIDER_CERTIFICATION_ENFORCED=true` after the required runtime controls, approvals, tests, and scope evidence exist.

## [3.7.2] - 2026-08-11

### Fixed

- Allowed the image-promotion job to read the private draft release with its GitHub token before verifying the complete asset set.

## [3.7.1] - 2026-08-11

### Fixed

- Made the release workflow retrieve draft releases by their database ID because GitHub's tag endpoint does not return drafts, allowing failed tag workflows to fix forward without retagging.

## [3.7.0] - 2026-08-11

### Added

- Added account settings for verification-code email changes, linked sign-in identity details with last-credential safeguards, finite scoped API-token creation, per-field public-profile visibility, and browser-scoped personal preferences. Migration 081 adds email-change challenges, linked-identity display names, and per-field public-profile visibility.
- Added inspect-before-restore version history to Image and Video Editor projects, including lazy previews, change summaries, actor attribution, named checkpoints, exact pre-restore recovery points, conflict handling, cover preservation, and revision-owned media. Migration 082 adds revision-media ownership tables and bounded backfill state.
- Added a machine-checked API and schema compatibility retirement registry with exact ownership, introduction history, replacement and migration decisions, normalized consumer evidence, a 90-day and two-stable-release sunset floor, and fail-closed OpenAPI removal gates.
- Added final-image SPDX SBOM and full vulnerability-report artifacts to candidate and release workflows, a separately enforced pinned-scanner gate for fixable high and critical findings, and digest evidence that binds each report to the exact promoted image.
- Added continuous Go and TypeScript reachability, documentation-graph, provider-fact, canonical public-route, and release-surface ownership checks with explicit roots and narrow exceptions.
- Added a complete feature hub and canonical FAQ grouped around verified product scope, current provider-certification evidence, plan and provider limits, maintained proof, and contextual documentation and support paths.
- Added a complete, audited workspace-access lifecycle with server-enforced admin, editor, and viewer permissions; active and inactive accepted members; atomic seat and pending-invitation limits; role changes, deactivation, restoration, removal, resend, revoke, search, and filters; last-admin safeguards; and an admin-only access history. Migration 080 preserves existing access as active and adds the lifecycle and audit schema.
- Added accessible password reveal controls and exact Unicode-aware server rules, preserved safe protected deep links through authentication, documented the fixed session lifetime instead of adding a cosmetic persistence toggle, and expanded authenticator enrollment into a six-step flow with a copyable manual key, resilient verification, and explicit enabled-factor confirmation.
- Added permission-aware failed-payment recovery with an account-wide notice and billing-page action that mints a fresh exact-subscription Paddle payment-method link; migration 079 preserves the first past-due transition and atomically fences stale, repeated, and out-of-order provider snapshots until newer active truth clears the restriction.
- Added an evidence-based provider-readiness ledger and runtime controls that bind approval, account authorization, policy mode, output profile, app identity, environment, contract digest, and expiring live proof; REST, MCP, CLI, composer, worker, release, and public-claim surfaces now fail closed from the same projection, with migration 077 preserving immutable evidence.
- Added a machine-checked managed-data retention schedule, complete first-party browser-storage inventory, dated legal-policy history, and reviewed security responsibility and incident-disclosure boundaries without implying independent assurance that has not occurred.
- Added automatic, reviewable image alt text when images without alt text are attached in the text-and-thread composer. The optional server-side OpenRouter integration sends a 400px JPEG thumbnail and, when present, up to 1,000 characters of the current relevant post or thread segment as untrusted context for better disambiguation; it never replaces user-written text or blocks media attachment and publishing when unavailable.
- Added durable provider-write fencing with immutable logical payload fingerprints, structured acceptance and reconciliation state, provider idempotency support, stale-worker ambiguity recovery, and no-replay crash protection across publishing, comments, messages, reposts, and media delivery; migration 076 adds the attempt ledger.
- Added a dated managed-service trust register that names current data locations, required and feature-triggered service providers, user-directed recipients, transfer facts and open reviews, and the exact human production-access boundary without implying certifications that do not exist.
- Added acknowledgement-gated authenticator setup with hashed, single-use recovery codes that are shown once, protected remaining-count and replacement flows, recovery-code sign-in, and automatic revocation when the factor is replaced or disabled; migration 072 adds the recovery-code store.
- Added normalized, encrypted provider authorization grants shared by sibling destinations, with atomic rotating-token refresh, revocation state, lossless migration, workspace isolation, and explicit destination-only versus saved-authorization removal; migration 073 adds the grant store.
- Added immutable, hash-only publication authorization receipts for scheduled, immediate, retry, reply, and compatibility publication writes, with exact actor provenance, revision and destination binding, fail-closed publisher preflight, legacy queue repair, and redacted audit/export behavior; migration 075 adds the receipt store and immutability guards.

### Changed

- Consolidated REST and MCP publication updates, rendition replacement, validation, scheduling, immediate publishing, and REST retry orchestration behind a shared application command/query boundary, with matching workspace authorization and enqueue validation.
- Pinned the production Bun toolchain, Node frontend builder, Go backend builder, and supported Alpine runtime inputs by digest; kept Vite and SvelteKit on real Node while Bun owns installs and scripts; declared Linux AMD64 as the tested container architecture; separated process liveness from traffic readiness; and expanded restart smoke coverage across OCI health, configuration, SQLite, FFmpeg, FFprobe, and release identity.
- Replaced three full shared-asset copies with a typed per-surface manifest that validates every source reference and staged output before installing the exact frontend, documentation, or marketing files.
- Made one canonical marketing route manifest own prerender entries, sitemap priorities, canonical URLs, and social metadata, including bidirectional page and content-catalog checks.
- Made release planning classify every maintained path by application, site, delivery, launch, agent-tool, asset, or repository ownership, with only documented reference-checkout exemptions.
- Replaced stale contributor design instructions with canonical guidance links and made launch, documentation, assets, and public provider-count copy agree with the backend catalogue.
- Added source, owner, evidence basis, review date, recheck deadline, and plan or region qualifier to every mutable comparison row, with a freshness check that fails when evidence expires.
- Put plan audience, exact limits, trial renewal behavior, cancellation, billing management, refunds, tax, and Paddle's Merchant of Record role beside managed-plan choices; billing-period changes now preserve focus and use one concise live announcement.
- Defined `server.json` as the immutable Official MCP Registry listing version, documented its compatibility policy separately from application and negotiated protocol versions, and made registry drift fail repository and release planning checks.
- Standardized the application, marketing site, and shared previews on the supported `@lucide/svelte` package, removed the duplicate legacy dependency, and replaced legacy icon-constructor annotations with a Svelte 5 component contract.
- Removed confirmed unused frontend helper exports and convenience types after proving no static, namespace, dynamic, glob, or package-export consumer remained.
- Removed unused drawer and scroll-area UI primitives, duplicate sidebar constants, empty frontend barrels, and the now-unneeded `vaul-svelte` dependency after proving the shipped import graph no longer reaches them.
- Made each new CLI authorization request expire older pending device sessions, and made transactional workspace deletion the sole owner of removing that workspace's media-cleanup jobs.
- Removed obsolete CLI post-write and API-token creation wrappers, and kept MCP stdio framing helpers private to the production proxy implementation.
- Removed confirmed unreachable backend and CLI helper APIs after verifying the supported runtime and test entry points remain unchanged.
- Moved destination-preview coverage into the shared social-preview package and removed the unused application wrapper.
- Removed unreachable pre-Trash media deletion and overflow posting-time helpers after preserving their database-ordering and scheduling assertions on the active lifecycle paths.
- Restored the original expressive landing hero, floating provider field, customer-logo rail, rotating result previews, and complete provider-icon definitions after product review; retained larger mobile platform-guide targets and the confirmed unreachable-code cleanup.
- Removed tracked backend import-probe commands and the unused authentication-only middleware whose name incorrectly implied workspace authorization.
- Made one validated legal-policy manifest drive the hosted Terms, Privacy, and Refund Policy dates, versions, URLs, acceptance rules, public pages, generated backend constants, cloud startup checks, and release gates so substantive Terms or Privacy changes reliably re-prompt existing accounts.
- Stamped each immutable release candidate from one strict stable-version and full-revision manifest, verified that identity across image labels, the embedded file, runtime metadata, artifact download, digest-only promotion, and deployed version checks, and blocked promotion on any mismatch.
- Replaced the nested payment dialog with a standalone responsive checkout page and kept Paddle's hosted fields on a contrast-safe light payment canvas in both app themes.
- Reworded checkout consent copy to name the actual payment-submit action instead of a nonexistent continue step, since the hosted payment form loads inline automatically.
- Hidden the customer-portal action when the workspace has no billing subscription, so a dead portal request cannot surface without a plan; plan selection remains the primary no-subscription action.
- Rebuilt the marketing landing and pricing pages with paired light and dark surfaces, a viewport-safe product-video dialog, richer destination previews, a collapsible creator-workflow mosaic, animated yearly pricing, and an interactive follower-growth planner.
- Grouped Social Set destination icons into clear overlapping avatar stacks, kept overflow counts beside the icons, and standardized shared checkbox styling and optional toggle sounds across app and menu surfaces.

### Fixed

- Updated OpenTelemetry Go to 1.41.0 to fix CVE-2026-29181 in crafted multi-value baggage-header handling.
- Made the provider-catalog fact check resolve shared platform limits in a clean checkout before SvelteKit generates its aliases, preserved the dead-code check's executable mode for clean CI runners, and removed the final unreachable post-service helper it exposed.
- Restored release-gate browser fixtures for provider readiness and canonical publication summaries, and fixed documentation-link and production-image manifest script checks.
- Pinned every external action used by the Star History workflow to a reviewed full commit so the workflow satisfies the repository supply-chain policy.
- Migration 084 retires required-SSO organization-wide app tokens, normalizes existing `allow` policies to workspace-scoped access, and limits the policy API and settings UI to one assured workspace or denial. Existing unbound tokens are not assigned to a workspace and can no longer access required-SSO resources; revoke them and issue one assured token per workspace.
- Aligned scoped automation across Huma and the authenticated upload-session content route, kept OpenPost credentials off presigned storage hosts, enforced required-SSO and workspace boundaries across REST, MCP, and CLI access paths, and made `cli:full` account and organization behavior explicit.
- Required a signed-in browser for CLI and MCP device approval and general instance administration, while retaining only typed provider-certification test operations for deliberate unscoped instance-admin automation.
- Enforced the same scope, workspace, and required-SSO checks for header and query-token media access, kept credential-served media out of shared caches, and limited public signed-media caching to the signature lifetime.
- Migration 083 replaces request-time legacy authoring sweeps with aggregate-scoped translation and a resumable bounded backfill that repairs indexed publication job identities, preserves authorization provenance across REST and MCP, and keeps authoring query counts independent of unrelated history.
- Gave local, Capacitor, Turbo, and Docker frontend builds one repository-owned Node heap contract so large Vite builds no longer inherit conflicting 4 GiB limits.
- Made PostgreSQL migration preparation normalize multiline `ALTER TABLE ... ADD COLUMN` statements idempotently, preventing fresh-schema bootstrap from aborting when the Bun bootstrap already created a newer column.
- Prevented text-and-thread drafts, media, and schedules from crossing workspace boundaries by requiring save, stay, or discard decisions with origin-scoped race guards; scheduling and publishing failures now retain exact destination, segment, and field targets, focus the affected control, and remain retryable after authoritative revalidation.
- Unified marketing route errors and the static-host 404 around one branded recovery source with product, documentation, email, and community paths that remain usable without application assets.
- Clarified that screen recordings remain local to the current browser until the user explicitly saves them to cloud storage, Media, or a post handoff.
- Restored direct image paste in the text-and-thread composer with an immediate local preview and ordered in-place upload instead of a media-picker modal; progress, cancellation, retry, validation feedback, bounded concurrency, destination changes, navigation, and teardown now preserve or safely discard transient uploads without leaking them into draft payloads.
- Enforced the fixed media lifecycle as 14 days for unused temporary media and seven days in Trash, kept legacy cleanup fields as ignored compatibility inputs, computed protected references once per bounded batch, and added migration 078's media-leading index for constant-query cleanup on SQLite and PostgreSQL.
- Made each JavaScript workspace own its build output, added an atomic and crash-recoverable frontend packaging boundary, proved clean and cached frontend artifacts are identical, included documentation in the root build, and made app browser tests serve the packaged artifact.
- Limited CI package-write permission to the production-image job and added a release-contract regression that prevents broader jobs from gaining it.
- Kept tagged releases as reusable drafts until all candidate evidence and every server, CLI, MCP, and Android artifact are complete, the exact candidate digest is promoted and deployed, and public readiness passes; final publication now verifies the complete asset set, while maintained workflow Actions use verified full-commit pins with weekly update checks.
- Aligned provider-application administration guidance with the live instance-admin UI and API, documented encrypted secret ownership and source precedence, and rejected administrator rows that cannot become effective runtime configuration.
- Pinned managed automatic image-caption requests to the verified `azure/eu` OpenRouter route, disabled provider fallbacks, denied provider data collection, and required a zero-data-retention endpoint; cloud startup now fails closed if that policy drifts.
- Bounded calendar, planner, and activity reads with canonical publication date ranges, stable cursors, complete pagination, and workspace/date-scoped refresh coalescing so autosaves no longer hydrate full history.
- Added a permission-safe publication timeline for creation, edits, authorization attempts, and provider outcomes while suppressing raw metadata, provider messages, and idempotency details.
- Added the missing OpenPost Studio overview and made the documentation gate validate every configured VitePress navigation target as well as Markdown links.
- Restored composer round trips through both editors so draft text, destinations, schedule, existing media, cancellations, and destination-specific video variants return to the exact originating publication.
- Isolated the editor catalog by workspace and query, added independent paginated design and video results, and exposed permission-safe cloud-video deletion with consequence copy and optimistic rollback.
- Gave video previews editor-scoped Blob URL leases, stale-load guards, and bounded pressure cleanup that preserves active projects while reclaiming disposable artifacts.
- Unified publication creation for REST, MCP, and the CLI's REST client behind one transactional command so every content mode stores the same intent and creation preset, resolves the same destination capabilities, and remains a draft until explicitly scheduled or published.
- Made recurring media cleanup use exact workspace and dedupe identities, an active-job uniqueness constraint, and one crash-recoverable rescheduled job per workspace; migration 071 safely consolidates older duplicate cleanup chains while preserving completed history.
- Scoped notification inbox reads and bulk actions to the authorized selected workspace plus the account-wide notices shown there; synchronized the persistent bell and paginated feed through one workspace cache; kept failed reads, deletes, and page loads recoverable without changing unread truth; and added read filters, date groups, event labels, complete time semantics, and explicit row actions.
- Made the embedded app distinguish generated SPA routes from unknown documents, return a real 404 with an accessible recovery page for unknown routes, and generate the route manifest during production builds; precompiled Paraglide message modules also make production builds deterministic.
- Invalidated in-flight composer requests before navigation and teardown so canceled account, workspace, capability, destination-option, and scheduling reads cannot report or mutate stale screens.
- Made Starter, Founder, Pro, Team, and Agency selectable for monthly or annual billing across public pricing cards and comparisons, with plan-specific guidance and verified registration links at desktop and 320 px widths.
- Made draft navigation reuse prefetched canonical publication and composer data, removed legacy and duplicate capability request waterfalls, bounded publication detail queries across destinations, stopped duplicate shell and Posts page loads, and kept the planner sidebar stable during background autosave refreshes.
- Split legacy post media cache state from rendition-owned provider deliveries, enforced workspace-safe auxiliary-media relations, encrypted and redacted resumable upload sessions, and resumed interrupted YouTube uploads from provider-confirmed offsets across SQLite and PostgreSQL upgrades; migration 074 adds typed delivery ownership and relations.

## [3.6.0] - 2026-08-08

### Added

- Added tactile press and release sounds across raised buttons and common selection controls, plus reduced-motion-aware orange confetti when a post is scheduled.
- Added the current official Postiz social logo set, an image-led publishing workflow mosaic, and an animated product-demo dialog to the marketing site.

### Changed

- Kept the expanded planner sidebar and Calendar, Posts, Inbox, Analytics, and Media navigation consistent across authenticated routes, and eased raised-button press travel.
- Restored clickable five-second hero result rotation that stops after manual selection, simplified landing-page copy, and tightened pricing layouts.

### Fixed

- Preserve plan and destination context through Google signup and legal acceptance, remove duplicate workspace bootstrap redirects, and send existing Google users back to their intended destination instead of checkout.
- Keep payment entry inside an OpenPost checkout dialog with the active theme and plan summary, while Paddle continues to securely host the sensitive payment fields.
- Constrain hosted Paddle catalog prices to one subscription unit so checkout no longer offers duplicate copies of the same plan.
- Fixed SQLite upgrades from versions before 1.1.16 by rebuilding populated legacy post tables safely when migration 038 adds the draft revision timestamp.

## [3.5.0] - 2026-08-08

### Added

- Added responsive pointer-reactive platform and AI marks plus project-owned ENF., The Actual World, Uni's Easy, ARC Gym, Ark, Dias Solutions, Montra, and Unprompted identity assets to the marketing hero.
- Added a privacy-aware YouTube product-tour section and clearly labeled illustrative creator workflows with original generated portraits.

### Changed

- Simplified the marketing hero around the “Your socials, on steroids.” promise, one raised trial action, the three illustrative result views, and a broader customer logo rail.
- Reworked the full landing-page sequence around the product demo, a tighter publishing loop, alternating product proof, creator workflows, plans, and a direct closing action; removed the separate platform-chip band and carousel controls below the result phones.
- Gave shared buttons, selects, comboboxes, badges, and tag inputs a faster raised orange interaction language, with optional interface-sound feedback on raised controls and a marketing-site sound toggle.

### Fixed

- Initialized delegated interface sounds on the marketing site so raised-button feedback plays before navigation instead of remaining silent outside the authenticated app.

## [3.4.0] - 2026-08-08

### Added

- Added grouped recovery queues for publication and engagement collection failures, analytics coverage denominators and highlights, searchable settings navigation, and read-only details for published publications.
- Completed the Image Editor command registry across desktop and mobile menus, tool rails, tooltips, shortcuts, handlers, checked states, and disabled explanations.
- Added adaptive cached alpha hit testing, Alt-click layer cycling, a visible Select layer menu, and floating pixel resize, rotation, and duplicate controls.
- Added one cancellable RGBA scan contract for magic selection, bucket fill, and magic erase, including transparent/global/contiguous semantics, previews, progress, locked-target guidance, and large-image limits.
- Added Image Editor export memory budgeting, cancellation, and resumable page-level Media/composer uploads without duplicating successful assets.

### Changed

- Rebuilt the marketing hero around illustrative cross-network result views, floating social icons, a raised trial action, and a customer logo ticker while keeping the existing product promise and plan terms.
- Simplified the text composer with contextual inspiration, a dedicated post-settings sheet for repost behavior, automatic URL recognition, and a device-first media chooser with clearer source tabs and upload guidance.
- Made the desktop planner contextual to authoring and calendar routes, reduced the primary navigation to five workflow destinations, and separated diagnostic job records from failed-publication totals.
- Reworked the desktop sidebar into a calm task stack with a stable brand and compose action, compact workspace and notification controls, three recent drafts, and one readable destination list.
- Made instance release status show the configured source, effective running value, edition override, and pending-restart state together.
- Unified Image Editor canvas, template, preview, download, Media, and composer-return rendering on the same Fabric adapter and added browser pixel-parity checks.
- Made Image Editor history restore the active page, object and pixel selection, tool, zoom, and pan while avoiding a redundant post-command document clone.

### Fixed

- Updated SvelteKit and Nano ID to their patched security releases and pinned the transitive versions used by the workspace.
- Kept the marketing changelog page's server data typed with the current SvelteKit load contract.
- Kept workspace names available to the sidebar switcher and counted failed background jobs in the Activity failure tab.
- Prevented the managed public home from flashing for signed-in sessions and stopped photo-only stock providers from offering video searches.
- Fixed stored conversation history loading, added missing-conversation handling and retry UX, generated request IDs, and kept the reply composer hidden until history loads.
- Made Media Library and instance-user searches submit reliably with Enter, added applied-query state, clear search, and Media result counts.
- Disabled settings save actions until their forms contain changes and corrected singular analytics destination copy.
- Fixed Threads location customization by waiting for a search term, using the provider's `q` parameter, requesting `threads_location_tagging`, and returning reconnection guidance when an existing account lacks that scope.
- Made Image Editor multi-selection show mixed transform and opacity values, apply compatible values to every unlocked root, and report skipped layers; missing fonts and page media now expose recovery actions.
- Completed nested Image Editor group movement with cycle-safe drag-into targets, keyboard/context move-out actions, inherited lock protection, ancestor-bound repair, and undo restoration.
- Preserved floating pixels across save, project, template, and export boundaries, and added recoverable handling for corrupt or missing local media, quota errors, concurrent tabs, and revision conflicts.
- Made Image Editor conflict reloads preserve local work as a separately titled cloud design before loading the newer server revision, with visible failure recovery.
- Added signed-in project-import cancellation and resume, stylus palm rejection, touch pinch routing, dialog/sheet focus restoration, keyboard-only export coverage, and Portuguese browser-zoom proof.

- Preserve plan and destination context through Google signup and legal acceptance, remove duplicate workspace bootstrap redirects, and send existing Google users back to their intended destination instead of checkout.

## [3.3.2] - 2026-08-06

### Added

- Added destination-aware video frame selection for Instagram Reel covers, TikTok cover timestamps, and YouTube thumbnails, including direct thumbnail and caption-file uploads from destination settings.
- Defaulted new TikTok destinations to Direct Post while keeping inbox Upload as an explicit choice.
- Completed the Image Editor crop session with independent frame and image positioning, transient rotate and flip controls, exact cancel rollback, and one-command apply history.
- Added a true 9 by 9 canvas-eyedropper magnifier with transparent edge cells, one- or ten-pixel keyboard movement, Enter sampling, and exact color-coordinate announcements.
- Added bounded Image Editor file preflight for MIME, bytes, decoded dimensions, pixel and layer budgets, and unsafe SVG content, with mixed-batch progress, isolated failures, failed-file retry, and page-thumbnail drop targeting.
- Applied one zoom-correct snapping contract to Image Editor object transforms, crop handles, guides, and gradient endpoints, with active-axis guides and Command/Control bypass.

### Fixed

- Allowed resource-sensitive app browser gates to serialize Playwright workers without slowing the default CI configuration.
- Updated the pinned YAML parser to the patched release for CVE-2026-59870.
- Prevented X analytics from replacing complete snapshots with partial batch results and added a 24-hour backoff when X API credits are depleted.
- Derived relative local media URLs from the canonical public app origin so pull-from-URL providers receive an absolute media URL without duplicate deployment configuration.
- Made Escape cancel a crop exactly even when focus remains on the tool rail or another button.
- Prevented unsupported dropped files from being silently ignored, async imports from landing on a newly selected page, and completed import batches from retaining large browser `File` references.
- Kept overlapping 44 px crop targets predictable on small images and made snapping tolerance remain ten screen pixels at every CSS zoom level.

## [3.3.1] - 2026-08-06

### Added

- Added a floating pixel-selection mode in the Image Editor so selected pixels can be moved before committing, with Enter/Escape/Delete workflows, arrow-key nudging, undo labeling, and cancel-safe rollback.

## [3.3.0] - 2026-08-06

### Added

- Added a source-grounded Image Editor completeness checklist covering interaction, history, persistence, renderer, responsive, accessibility, performance, recovery, and test requirements.
- Added persistent desktop and mobile Image Editor object-snapping controls with an accessible status announcement and Command/Control-drag temporary bypass.
- Added external image and SVG drops to the Image Editor canvas with exact placement, ordered multi-file cascading, guest OPFS storage, Media Library retention, progress, and error feedback.
- Added an interactive Image Editor crop mode with a dimmed rule-of-thirds frame, pointer and keyboard controls, social aspect presets, rotated/flipped layer geometry, reset, cancel, and single-command undo/redo.
- Added a typed Image Editor command and shortcut registry that drives keyboard dispatch, platform-aware menu labels, the complete help reference, and shortcut-collision tests.
- Added a canvas eyedropper with active-layer or composited-page sampling, pointer color/alpha preview, recent colors, and explicit paint, selected fill/text, selected stroke, or page-background targets.
- Exposed saved brand backgrounds and whole-layer brand text styles directly in the Image Editor with revision-safe snapshots and one-command multi-text-layer application.
- Added selection-content actions that project document masks into transformed image or paint layer space, delete selected pixels non-destructively, or promote them to a new editable layer with one undo entry.
- Added pressure-aware, smoothed freehand drawing with coalesced pen input, persisted tool options, and a live document-scale brush cursor.
- Added page-specific rulers and persistent pointer/keyboard/numeric guides, configurable grid display and spacing, guide/grid snapping, and live document coordinates without including editor chrome in exports.
- Added portable `.openpost-image` project export and import with bundled source media, validation, path and size limits, ID remapping, new-design creation, and guest or workspace media migration.
- Added persisted text underline, strikethrough, and word or character wrapping, plus explicit shape no-fill/no-stroke controls and aspect-locked numeric sizing.
- Added an explicit, undoable restore action for non-destructive image erase masks.

- Added an OpenPost-native media chooser with device selection, drag and drop, file paste, camera capture, local image and video thumbnails, per-file size and progress, cancel and retry controls, and actionable validation and upload errors.
- Added provider-aware stock-media filters for orientation, size, color, language, order, content safety, collections, image type, category, Editor's Choice, and minimum dimensions where each configured provider supports them.

### Changed

- Removed Uppy and moved the Media page, composer, Image Editor, Video Editor, workspace image, and profile-picture flows onto shared OpenPost controls; profile pictures now include a square crop preview and upload progress.
- Combined Library, Device, Camera, Stock, and editor creation in one media-picker surface, with stock providers labeled by their actual photo and video support.
- Reduced test-suite overhead by removing assertion-free and duplicate checks and by running viewport-independent marketing contracts once instead of once per browser size.
- Added the standalone video-project unit suite to the default local and CI test gates.
- Added a maintained miniPaint source reference and an implementation-level Image Editor parity ledger covering tools, precision controls, persistence, accessibility, and adoption priorities.

### Fixed

- Prevented no-op Image Editor mutations from dirtying a design, clearing redo history, or consuming an undo entry.
- Made Image Editor image and paint hit testing click through transparent pixels after transformed bounds filtering.
- Kept selected-pixel promotion from restoring pixels removed by earlier freehand erase masks, reduced contiguous color-selection memory use, and made pixel cut create an independently movable layer with a transparent source hole.
- Made image replacement preserve its transform, normalized crop, adjustments, masks, and effects; kept locked layers safe from bulk deletion; and selected the nearest editable layer afterward.
- Added cancellation and remaining-file retry to external image-drop batches without duplicating files that were already inserted.
- Made Image Editor, Video Editor, and workspace-image uploads use library retention so newly uploaded reusable media remains visible after the picker refreshes and reopens.
- Corrected upload guidance to show the backend's actual 16 GiB video limit and 50 MB image and audio limit.
- Corrected the Image Editor guide to include paint layers and freehand drawing and to distinguish stored brand backgrounds and text styles from the colors and fonts currently exposed in the editor.

## [3.2.1] - 2026-08-06

### Added

- Added filename editing for images, videos, audio, and other Media assets, plus right-click renaming for image designs and cloud video projects on Editors.

### Changed

- Removed logo and brand-asset roles from brand kits while keeping colors, backgrounds, text styles, and licensed fonts.
- Made two-finger trackpad scrolling pan the Image Editor canvas and reduced pinch-zoom sensitivity.

### Fixed

- Made public app pages answer `HEAD` requests with their normal status and headers so payment-provider domain verification does not treat the live site as unreachable.
- Allowed media referenced by failed publications to move to Trash even when a child rendition still has a pre-publish status, while keeping active drafts, schedules, and publishing work protected.
- Removed the unintended divider lines immediately above and below the Media search and filter controls.
- Made new text layers start with “New text,” prevented the T shortcut from typing into the layer it creates, kept later text dragging out of edit mode, and stopped multi-selection snapping from moving selected layers off-canvas.
- Kept SVG conversion automatic while replacing the backend's manual-conversion instruction with a processing error for clients that bypass the supported upload flow.

## [3.2.0] - 2026-08-06

### Changed

- Replaced the Media page, composer, and editor asset-picker upload paths with one styled Uppy dialog for files, camera capture, stock providers, OpenPost Library selection, and image or video preparation.
- Simplified Media around Library, hidden-by-default Temporary uploads, and seven-day Trash, with direct favorite controls and focused filters for reusable assets.

### Fixed

- Kept Google sign-in from the sign-up page out of new-account checkout when the Google identity already belongs to an OpenPost account with a workspace, while preserving onboarding and selected plan details for first-time accounts.
- Kept media last-use timestamps accurate when posts, publication renditions, image designs, or video projects attach or detach files, and stopped published or failed posts and deleted editor projects from blocking media cleanup.
- Converted browser SVG uploads to PNG before storage and rejected unconverted SVG input so unsupported vector assets cannot break the Image Editor.

## [3.1.1] - 2026-08-05

### Fixed

- Made the media lifecycle migration preserve historical brand assets when their upload hash already belongs to a library item, so PostgreSQL upgrades do not violate workspace deduplication.

## [3.1.0] - 2026-08-05

### Added

- Show the profile owner's highest active OpenPost plan beside their handle on public profiles.
- Added provider-driven required fields and format validation to the composer for every supported destination.
- Added a shared design-font catalog to both editors, fifteen varied Image Editor starter templates, keyboard nudging, edge and center snapping while moving, and canvas-aware snapping while resizing.
- Added a combined Editors hub for image designs and video projects, plus separate Library, Temporary, and seven-day Trash views for workspace media.

### Changed

- Made the OpenPost Video Editor available on every instance and removed its environment and database-backed feature toggle.
- Changed the OpenPost wordmark from Geist to Manrope Semibold across the canonical lockups, GitHub README, app shell, public headers, marketing chrome, and dynamic social previews while retaining Geist for interface copy.
- Replaced the post-type and composer-experience choices with one text-and-thread composer that infers destination formats, asks only for ambiguous Instagram and Facebook formats, keeps direct account tabs for preview and customization, combines Social Sets with account selection, and moves repost overrides into Advanced delivery.
- Unified OpenPost Media, upload and camera capture, stock providers, and editor creation in the reusable media picker used by the composer and Image Editor; also made the Image Editor's mobile tools, inspector, first-edit guidance, help, and guest export flow more compact and direct.
- Reworked media retention so post-specific uploads are temporary, active drafts, schedules, retries, designs, video projects, tags, favorites, and brand roles protect their files, successful publications move unprotected temporary media to Trash immediately, and idle temporary media moves there after 14 days.
- Kept logos and other brand assets in the normal reusable Media library while Settings assigns their brand roles; editable projects now live in Editors instead of being mixed into the asset grid.

### Fixed

- Kept Video Editor text visible in preview and export, stacked simultaneous timeline items into collision-safe named lanes, delayed recording project creation until capture starts, and added clear storage, import, picker, destructive-action, and mobile tool feedback.
- Made the README brand lockup use a white wordmark in GitHub dark mode while retaining the carbon wordmark in light mode.
- Made the managed app root publicly reviewable without JavaScript by exposing a concise product description, current monthly plan prices, trial terms, and direct Terms, Privacy, and Refund links, while preserving the signed-in composer and the self-hosted landing experience.
- Tightened public profiles into a compact, content-sized layout, expanded the yearly activity field to its available width, and simplified ranking lists.
- Fixed Image Editor fit-to-canvas calculations, initial Media loading, layer renaming, 320 px undo and redo access, stock-photo empty-state copy, and platform-specific shortcut labels.
- Made media deletion preserve historical post metadata, block every active normalized post, rendition, design, template, video-project, and brand reference, and allow recovery before permanent blob removal.
- Kept legacy Studio links on the public Image Editor redirect path and preserved the desktop sidebar's paired workspace navigation after adding Editors.

## [3.0.0] - 2026-08-05

### Added

- Added a durable personal Composer setting that switches between the default spacious text-and-thread plus focused-media experience and one unified rendition-first composer for every starter preset; both edit the same publications and account versions.
- Added reusable Social Sets with ordered account membership, a workspace default, optional per-account format defaults, composer management, and destination snapshots that stay stable when a set changes or is deleted.
- Added per-destination format locks, nullable text and media inheritance, reset controls, destination schedule overrides, and declarative format choices and segment strategies.
- Added ten image-generated Converge header directions, each delivered in platform-safe X and LinkedIn profile sizes with the exact OpenPost vector lockup, plus a primary slogan-led pair for X and LinkedIn.

### Changed

- Unified Post, Thread, Story, Short video, and Video under one publication-and-rendition workflow while preserving the spacious text-and-thread writing canvas as the default composer experience; drafts use shared All channels content, account tabs, destination-specific settings, and canonical `/publications/:id` editing, and linked historical post URLs redirect there.
- Changed creation modes into starter presets, stopped filtering accounts by a global mode, and made every selected account keep its own visible, independently validated rendition.
- Replaced active Whop billing with Paddle Merchant of Record billing: localized Paddle.js checkout, sandbox and production isolation, mirrored customers and subscriptions, a Paddle-native billing schema, Paddle-scoped entitlements, raw-body signed webhooks with canonical reconciliation, scheduled-cancellation access, fresh customer portal sessions, configuration, CLI, policies, and operator documentation.
- Replaced the pen identity with the four-module OpenPost Converge mark across the app, marketing site, documentation, favicons, Android assets, social previews, and downloadable social kit; adopted “Publish clearly.” as the optional short brand line.
- Replaced the pen-era social header explorations with dark Converge banners for X and LinkedIn, using image-generated physical brand environments, the exact vector lockup, and the new primary line “Turn what you’re building into content. Publish it everywhere.”

### Breaking

- Replaced the Whop billing API, webhook, configuration keys, and subscription integration with Paddle. Cloud operators must configure the complete `OPENPOST_PADDLE_*` set and the `/api/v1/billing/paddle/webhook` notification destination before upgrading. Existing Whop subscription rows are retained as historical data but do not grant Paddle-backed entitlements; migrate active customers through Paddle before deploying this release.

## [2.1.0] - 2026-08-05

### Added

- Added image-generated dark X and LinkedIn profile headers built around the real OpenPost workspace and a restrained OpenPost pen mark.
- Added nine image-generated dark X header concepts spanning cinematic, typographic, real-world, graphic, sculptural, layered, spatial, and human brand directions.
- Added release planning, exact local release checks, candidate and production status reporting, a public running-version endpoint, immutable SHA image smoke tests, and configuration-only startup validation.

### Changed

- Keep Accounts beside Settings in the expanded workspace sidebar navigation instead of using a separate footer row.
- Allowed instance administrators to override allowlisted environment-backed configuration values with encrypted database settings, with clear pending and active override labels and a one-click return to the environment value.
- Migrated the JavaScript workspace, Devenv commands, Docker build, CI, release packaging, Android build, and contributor documentation from pnpm to Bun with a committed text lockfile and age-gated dependency installs.
- Changed releases to run the full matrix in parallel on `main`, publish one immutable tested image, and promote that same image on tags instead of repeating tag-time checks and builds.
- Changed production deployment to accept a signed revision, tag, and digest, validate the candidate against production configuration, verify the running revision, and restore the previous image automatically when startup or readiness fails.
- Development backend runs, tests, vulnerability scans, and lint now use a filesystem-backed frontend build tag; only production builds embed frontend assets and use a disposable Go build cache.

### Fixed

- Made production-image smoke tests use an isolated Docker volume so the non-root server can create its database on Linux runners, and print container logs when startup exits early.
- Kept the desktop platform menu at its intended wide layout by overriding the shared navigation content width with component-scoped CSS.
- Updated marketing browser coverage to verify the publishing-activity proof that replaced the previous proof-card copy.
- Fixed profile-picture uploads to S3-compatible storage by sending small objects with an explicit size and a seekable body. The uploader now shows the server's real error instead of Uppy's generic network warning.
- Stabilized Video Editor release checks with deterministic, fully encoded WebM fixtures for analysis imports and switched recording segments.
- Kept release checks reproducible on fresh Linux runners by installing their pinned browser and media-fixture dependencies, preserving executable script modes, and bounding the fully parallel app browser suite to two workers.
- Added a daily, configurable 4 GiB safety cap for the repository-local Go build cache and removed forced Go test-cache invalidation that made repeated checks slower without addressing embedded-asset growth.
- Updated vulnerable Bun resolutions and made the security gate reject every new runtime advisory while documenting the remaining upstream-only development-tool exceptions.
- Made release checks fail before long-running work when disk, Docker responsiveness and memory, GitHub access, deployment secrets, or production readiness are unavailable; reclaim and bound unused local BuildKit cache when disk is tight; excluded dependencies, Devenv state, prior embeds, generated Android assets, and local media from Docker build contexts; isolated browser-suite servers from stale local processes; and restored the original changelog when local release verification fails.

## [2.0.2] - 2026-08-04

### Fixed

- Made repost sweep scheduling idempotent when a pending sweep already exists, so restarts do not fail on the queue's uniqueness guard.

## [2.0.1] - 2026-08-04

### Fixed

- Included the documentation catalog and social-image package in the Docker frontend build context, and raised the builder heap to match the production frontend gate, so release images can generate synchronized assets and complete the bundle.

## [2.0.0] - 2026-08-04

### Added

- Added tag-based Media organization with many tags per file, multi-tag and Untagged filters, image, video, and audio type filters, sorting, drag-and-drop upload, bulk tag assignment, and the same controls in media pickers and both editors. New uploads remain untagged unless the user explicitly uploads into an active tag.
- Added a ready-to-use OpenPost social kit with X and LinkedIn banners, profile images, post formats, a five-slide carousel, story layouts, blank templates, campaign copy, and accessible alt text.
- Added declarative route-specific Open Graph and X card images for every marketing and documentation page, rendered on demand by a versioned Cloudflare Pages image endpoint instead of stored per-page files.
- Added per-event in-app and email notification settings for publishing outcomes, account attention, conversations, failed replies, and workspace invitations, with durable deduplicated email delivery through the configured SMTP, Resend, or Cloudflare provider.
- Added durable native auto repost rules for X, Mastodon, Bluesky, and LinkedIn, with source and target account selection, delays, evaluation windows, minimum likes/comments/reposts/views, all-or-any gates, plateau checks, per-post inherit/off/custom overrides, and revocable cross-workspace target grants.

### Changed

- Renamed Studio and Video Studio to OpenPost Image Editor and OpenPost Video Editor across product copy, source names, configuration, APIs, assets, and canonical URLs. Existing `/studio` and `/video-studio` links redirect to the matching editor route.
- Changed the editor API paths from `/api/v1/studio` and `/api/v1/video-studio` to `/api/v1/image-editor` and `/api/v1/video-editor`. API clients must update these paths. Existing editor environment variables remain temporary read aliases, and migration 063 converts stored editor settings, media provenance, project modes, Creator plan settings, checkout attempts, and subscriptions to their new canonical names.
- Reworked the marketing navigation with a logo-led platform menu and replaced the footer activity grid with a compact single-row publishing pulse.
- Added local Git-ignored Postiz and Shoutrrr reference checkouts and contributor guidance to consult their current scheduler implementations when designing related features.

## [1.52.1] - 2026-08-04

### Fixed

- Improved app E2E coverage reliability by aligning onboarding/register assertions to the active checkout flow, hardening the custom Mastodon connection path, and stabilizing media/communications test fixtures for deterministic execution.

## [1.52.0] - 2026-08-04

### Added

- Added an OpenPost-owned embedded Whop checkout with monthly and annual plan selection, exact card-required 14-day trial terms, signed webhook reconciliation, local checkout-attempt mapping, and Whop membership management links.
- Added all Whop billing credentials and plan IDs to the encrypted instance-admin Configuration screen, with write-only secrets, environment precedence, and restart status.
- Added a guided first-account connection flow with OAuth trust details, a three-step activation cue, and a one-time reduced-motion-aware confetti and success-sound celebration.

### Changed

- Rebuilt Full Studio around a CapCut-style four-zone workspace with a dominant canvas, grouped creation tools, selection-specific inspector tabs, concise action-first copy, consistent panel gutters, a draggable multi-track timeline, and direct seeking on the timeline ruler instead of a separate progress slider.
- Replaced Polar billing with Whop across the backend, frontend, CLI, generated contracts, configuration, legal copy, and operator documentation. Cloud operators must configure the Whop API key, account, product, webhook secret, checkout return URL, and all ten monthly and annual plan IDs before upgrading.
- Changed managed pricing to USD-first plans: Starter $15/month or $150/year, Founder $25/$250, Pro $49/$490, Team $99/$990, and Agency $199/$1,990, each with a card-required 14-day trial.
- Simplified registration and workspace onboarding, moved plan payment into the OpenPost checkout screen, and removed the username and workspace-name decisions from the critical path.
- Reworked the marketing homepage, pricing page, navigation, product metadata, and signup proof around the managed product and interactive demo; self-hosting remains available through documentation and footer links instead of the primary conversion path.
- Repositioned OpenPost as the all-in-one content team for solo founders, centered on turning company work into content and publishing it everywhere rather than competing as another scheduler.

### Removed

- Removed the Polar configuration and compatibility path. Migration 060 replaces the unused hosted billing tables with the Whop membership and checkout schema.

## [1.51.2] - 2026-08-03

### Fixed

- Updated vulnerable transitive `brace-expansion` and `postcss` releases used by production dependency paths.

## [1.51.1] - 2026-08-03

### Fixed

- Updated the marketing browser contract to match the rebuilt homepage title on desktop and mobile.

## [1.51.0] - 2026-08-03

### Added

- Added an instance-admin Configuration screen for optional account, email, authentication, feature, provider behavior, and provider-app settings, with encrypted database values, write-only secrets, environment precedence, validation, fallback controls, and explicit restart status.
- Added six-digit email confirmation for email-and-password registration with provider-neutral SMTP, Resend, and Cloudflare Email Service delivery, plus resend throttling, attempt limits, expiry, and one-time use.
- Added first-party Google sign-in and explicit Google account linking through account security settings without unsafe email-based auto-linking.
- Added required unique usernames and opt-in public publishing profiles with yearly activity, lifetime and peak post counts, current and longest streaks, and top platform and workspace summaries.
- Added a complete touch editor for Video Studio phones with a compact timeline, bottom tool dock, contextual inspector sheets, and local export on capable browsers.
- Added configurable focus zooms, camera crop and presentation controls, reusable color-effect looks, batch transcript-word removal, and recording layout selection before capture.
- Added a reproducible one-hour 1080p60 Video Studio benchmark covering import, random seeks, playback rendering, request coalescing, proxy use, and decoder bounds.

### Changed

- Made email provider credentials optional at startup so administrators can configure delivery after installation; instances that require verification still block password registration until a transport is ready.
- Made direct and file-backed environment provider apps authoritative over matching administrator-managed database rows.
- Rebuilt the marketing homepage around the real OpenPost workflow and product surfaces, with scroll reveals, publishing-activity cells, and a shared animated footer used across marketing pages.
- Moved Quick Cut packet analysis, combined or per-section stream-copy export, and preview-proxy encoding off the UI thread; fast exports now stream directly to a selected file, preserve every supported audio track and source metadata, and reject tracks that cannot be preserved instead of dropping them.
- Made long-source artifact work staged and event-driven, with indexing, waveform, thumbnail, and proxy progress; serialized heavy work; storage preflight; cancellation, retry, proxy removal, and phase-level restart recovery.
- Added continuous recording storage-headroom checks and camera or microphone device-loss recovery, including automatic safe stop before browser storage is exhausted.

### Fixed

- Kept Post/Thread drafts open to multiple media attachments, then blocked publishing only for destinations whose current media rules reject the draft, refreshed Threads and LinkedIn multi-image limits, and honored each Mastodon instance's media count and MOV support.
- Kept hosted subscription fallback scoped to subscribed organizations the user owns or administers, so membership in another customer's organization cannot raise entitlements for an unrelated workspace.
- Batched large media cleanup jobs at the worker limit, removed workspace-scoped notifications during deletion, and hid the delete action from workspace editors and viewers.
- Kept visual overlays, detached audio, captions, markers, source offsets, fades, and animation keyframes aligned when Full Studio ripple-deletes clips, transcript cues, filler words, or silent sections.
- Fixed Quick Cut stream-copy export by preserving a compatible source container and supplying the packet reservation metadata required for MP4 fast start.
- Kept Quick Cut source boundaries on exact verified packet timestamps without project-frame rounding, and routed non-keyframe cuts to an explicit precise render instead of presenting them as lossless.
- Switched ordinary playback to the browser's native hardware video path while retaining exact worker-rendered paused frames, prevented slow long-source frames from repeatedly reopening the preview decoder, kept editor shortcuts out of sliders and form controls, and cleared stale transcript-word selections after caption replacement.
- Preserved OAuth callback errors through legacy account redirects and returned successful and failed connections to the embedded Accounts settings page.

## [1.50.1] - 2026-08-03

### Fixed

- Fixed the sidebar Accounts active state comparison failing type checks in the shared marketing component tree.

## [1.50.0] - 2026-08-03

### Added

- Added a Delete workspace action in workspace general settings that removes the workspace, its members, posts, publications, accounts, media, schedules, prompts, and analytics, with media cleanup queued in the background.
- Added an Accounts entry to the sidebar that opens the settings accounts page.

### Changed

- Wrapped the accessible data table in analytics trend charts in a visually hidden container so it stays a screen-reader-only table.
- Hid the studio color picker screen eyedropper in browsers that do not support the EyeDropper API.

## [1.49.1] - 2026-08-03

### Fixed

- Fixed Quick Cut source analysis failing before keyframes could be indexed, which left Fast export disabled, and suppressed secondary writable-stream cleanup errors during background artifact generation.
- Fixed new workspaces using Sunday instead of the declared Monday calendar default and made rolling calendar coverage stable on week-start boundary days.

## [1.49.0] - 2026-08-02

### Added

- Added a Quick Cut workflow for single-source edits with source-scale kept sections, keyframe snapping, and local MP4 or WebM stream-copy export without video transcoding.
- Added one-click smooth zoom presets, word-level transcript ripple deletion, resizable timeline height, and camera recording layouts for circle, rounded, portrait, side-by-side, and full-frame compositions.

### Changed

- Reworked Video Studio into a dark, desktop editing workbench with an explicit Quick Cut or Full Studio choice, frame-coalesced timeline gestures, prioritized preview-proxy generation, and a two-hour project limit for long 1080p and 60 fps footage.

## [1.48.2] - 2026-08-01

### Fixed

- Removed the abandoned duplicate changelog section from the failed v1.48.0 release attempt.

## [1.48.1] - 2026-08-01

### Changed

- Moved connected social accounts into Settings as a first-class workspace category and redirected legacy account links into the new location.

### Fixed

- Updated browser coverage for the Settings-owned Accounts destination.

## [1.47.1] - 2026-08-01

### Fixed

- Kept error toasts open until dismissed or retried and made every notification toast dismissible, and raised the workspace color picker to a touch-friendly height on small screens.
- Updated end-to-end coverage to the sonner notification surface and hardened the Studio shape-menu assertion against the mounted menubar menu.

## [1.47.0] - 2026-08-01

### Added

- Added a reusable workspace color setting and applied it to workspace menus and calendar surfaces.

### Changed

- Reorganized settings around workspace, organization, and personal ownership, with social accounts and members under the workspace and plan usage and SSO under the organization.

### Fixed

- Warned before discarding meaningful unsaved settings, exposed instance administration from Social Accounts, kept the sidebar planner mounted between Engagement and Messages, and prevented stale Studio preview work from replacing a newly saved design thumbnail.
- Kept new workspaces in the owner's active subscribed organization, recovered existing owner-created workspaces that were split from that subscription, and aggregated hosted X API costs across the billed organization.

## [1.46.1] - 2026-07-31

### Fixed

- Fixed feedback submission failing with a 503 on Postgres: the rate-limiter upsert referenced `request_count` unqualified inside `ON CONFLICT DO UPDATE`, which Postgres rejects as ambiguous when the table is aliased by the query builder. Qualifying the references restores feedback delivery, and a Postgres-gated regression test covers the rate limiter path.

## [1.46.0] - 2026-07-31

### Added

- Expanded writing prompts with a full example post for every built-in prompt, plus 30 new founder post prompts (Building in Public, Founder Story, Industry Commentary, Team & Culture, Lessons & Frameworks, and Engagement Starters categories) with ready-to-publish examples.
- Applying a writing prompt now fills the text-and-thread composer with the prompt's full example, and confirms with a dialog before replacing content the user already wrote. The composer's inspiration card shows the example and an Apply example button.
- Custom writing prompts can now include an optional example post that is inserted into the composer when applied.

## [1.45.0] - 2026-07-30

### Added

- Added workspace creation from the desktop and mobile workspace switchers, with a focused name dialog that refreshes the workspace list and selects the new workspace immediately.
- Added anonymous, cookie-free Umami analytics to the public marketing and documentation sites while keeping the authenticated application untracked.
- Added the official OpenPost Discord community to the marketing navigation and footer, documentation navigation, and repository overview.

### Fixed

- Allowed canonical composer source and first-segment URLs to satisfy link-profile capability requirements across providers while preserving unrelated validation and provider-availability errors.

## [1.44.4] - 2026-07-30

### Fixed

- Added the missing `packages/video-project/` workspace package to the Docker build context so the frontend can resolve `@openpost/video-project` during containerized builds.
- Added the Paraglide i18n Vite plugin to the marketing-site build so shared frontend components can resolve `$lib/paraglide/messages` at build time.

## [1.44.3] - 2026-07-30

### Fixed

- Retried transient Cachix installation failures in CI and release workflows without disabling the shared Devenv cache.

## [1.44.2] - 2026-07-30

### Fixed

- Allowed functional software WebGL2 rendering for Video Studio and aligned release browser tests with the current settings, calendar, and private-beta UI contracts.

## [1.44.1] - 2026-07-30

### Fixed

- Updated the public post-preview browser test to follow the new accessible preview-options sheet on desktop and mobile.

## [1.44.0] - 2026-07-30

### Added

- Added a dedicated instance-admin Users table with plan, access, activity, and content details, plus audited five-minute, one-use links for opening a non-admin user's session in a private browser window.
- Added a live month-and-year label to the rolling sidebar mini-calendar so its position stays clear while scrolling.
- Added OpenPost Video Studio: a local-first browser editor and recorder with a guided timeline, four social format variants, local captions and cleanup suggestions, crash recovery, incremental MP4/WebM export, optional cloud projects and checkpoints, stock photo/video search, and rendition-aware composer handoff.

### Changed

- Kept Video Studio private by default while hardening its strict project schema, bounded three-decoder WebGL2 preview, exact codec preflight, streamed source/model/export storage, resumable model downloads, recording manifests, workspace-only sync planning, brand-kit styles, and checked-in CC0 audio pack.
- Reused keyframe-aware WebCodecs decode sessions across sequential Video Studio frames, generated 720p proxies only for demanding sources, adapted playback quality without lowering paused frames, and moved export UX into a focused editor component.
- Shared attributed Pexels, Unsplash, and Pixabay photo search with the existing image Studio, including durable guest imports and local-project recovery.
- Reworked the desktop month calendar into a fixed six-week grid with compact post rows and a complete day drawer for dense dates.
- Rebuilt application and free-tool previews with richer destination data, destination-specific desktop and mobile website chrome, and full-page shells for posts, threads, images, videos, Stories, Reels, Shorts, photo posts, polls, cards, and documents across all ten supported platforms; moved optional free-tool controls into a drawer so the live preview stays full-size.
- Rewrote marketing, comparisons, free tools, user docs, platform guides, and app messages in plain language, and aligned them with the current posting, analytics, comments, inbox, Studio, and automation features.

### Fixed

- Prevented cancelled native save pickers from being mistaken for export failures, completed local VAD requests instead of leaving them busy, kept promoted recording files after manifest cleanup, recovered recordings only through verified decodable chunks, and treated narrow pointer-based desktops as the full compact editor.
- Replaced the oversized native sidebar mini-calendar scrollbar with a slimmer treatment and kept date numbers behind its sticky weekday header while scrolling.
- Kept the expanding text-and-thread editor free of an internal scrollbar while preserving the shared Textarea primitive.
- Let token-only standalone preview windows load without an authentication redirect while keeping preview content off the URL and inside the random same-origin channel.

## [1.43.2] - 2026-07-29

### Fixed

- Restored hosted X publishing on PostgreSQL by making provider-cost reservation upserts unambiguous, and retried transient Threads error code 24 after container creation.

## [1.43.1] - 2026-07-29

### Fixed

- Kept the public changelog browser gate aligned with the latest non-empty canonical changelog section instead of one past release note.

## [1.43.0] - 2026-07-28

### Added

- Added an instance-admin overview with 30-day registration and publishing trends plus a paginated user directory.

### Changed

- Moved media retention into General settings and removed its single-control navigation page.
- Replaced the sidebar month calendar with a forward-only rolling planner that starts on the current week, disables earlier days, and loads more future weeks while scrolling.

## [1.42.3] - 2026-07-28

### Fixed

- Restored the background-blending text-and-thread composer and media alt-text editors without abandoning the shared Textarea primitive, and preserved Studio's compact inline layer rename treatment.

## [1.42.2] - 2026-07-28

### Fixed

- Kept the public changelog browser gate valid after release stamping, when version headings include their visible `v` prefix.

## [1.42.1] - 2026-07-28

### Changed

- Rebuilt the marketing desktop navigation with the shared Shadcn-svelte Navigation Menu while keeping the compact mobile navigation.

### Fixed

- Kept the public Studio start page mountable by initializing its shared file-input reference with the component's nullable binding contract.
- Prevented visually hidden shared file inputs from expanding page width in public Studio, Media, brand, and preview-tool upload flows.
- Made the public changelog browser check accept both active Unreleased entries and versioned sections after release stamping.

## [1.42.0] - 2026-07-28

### Added

- Added repository checks that keep visible Svelte form controls on the shared Shadcn-svelte primitives and validate the canonical changelog structure in local, CI, and release gates.

### Changed

- Standardized visible inputs, text areas, selects, checkboxes, and sliders across the application, public Studio, marketing pages, and every free tool on the shared Shadcn-svelte control system.
- Made `CHANGELOG.md` the single source for the public changelog and GitHub release notes, with the production release script promoting `Unreleased` into the new version automatically.

## [1.41.3] - 2026-07-28

### Changed

- Replaced separate YouTube category and playlist search fields with searchable comboboxes, and moved the Studio desktop menus onto the shared shadcn-svelte Menubar.

### Fixed

- Resolved stale LinkedIn rendition profiles from the current media shape so image posts no longer inherit a text-only zero-media limit or reject supported settings, and let Studio object selection begin on the pasteboard.
- Tightened the desktop schedule dialog around its two-month calendar and made the time picker fill the calendar height with the shared styled scroll area.

## [1.28.0 to 1.41.2] - 2026-07-28

This section consolidates the changes shipped between `v1.28.0` and `v1.41.2` before release-time changelog stamping was automated. GitHub releases remain the per-tag record for that historical range.

### Added

- Added destination-aware post previews for all supported social networks, including a live, private preview window from each composer account menu and shared preview rendering in the free public tool.
- Added empty Studio paint layers that can be created above the current selection and used directly by pencil, bucket, or gradient tools.
- Added native OIDC login and organization SSO with PKCE, nonce and browser binding, explicit identity linking and JIT provisioning, action-bound step-up grants, managed onboarding, verified-domain discovery, provider assurance, token policy, RP/back-channel logout, encrypted provider secrets, audit events, break-glass access, and one-time Capacitor handoffs.
- Added a no-account OpenPost Studio at `/studio` with on-device design and image storage, watermark-free export, public starter templates, privacy-safe Umami funnel events, and an explicit path that copies local work into a new or existing workspace.
- Added a client-first video workflow across every video-capable composer and the Media library, with browser-side inspection, MP4 remuxing, H.264/AAC transcoding and compression, precise trimming, draggable aspect-ratio cropping, real upload progress and cancellation, durable server verification, poster generation, and retryable processing.
- Added a cloud-only X request-cost guardrail with durable pre-request reservations, immutable idempotent events only for confirmed successes, separate unresolved exposure, reconciled monthly counters, workspace-visible estimates, and per-workspace safety limits that never gate self-hosted publishing.
- Added a self-hosted instance-admin update status with running build details, cached and bounded stable release checks, validated official release links, and no auto-update path.
- Added LinkedIn Organization Page selection with one-grant multi-account connection, encrypted shared credentials, organization author URNs, and an explicit operator permission gate.
- Added verified Discord webhook accounts with scheduled text, streamed multipart attachments, safe mention defaults, reply references, and deletion.
- Added a durable Engagement workspace, per-user in-app notifications, and an opt-in unified inbox for X, Bluesky, Facebook Pages, Instagram Professional accounts, and Mastodon direct posts.
- Added durable account and publication analytics for X, Mastodon, Bluesky, Threads, Facebook, Instagram, TikTok, and YouTube, with adaptive background collection, explicit permission and support states, provider-specific metrics, history, and a responsive Analytics workspace.
- Added an installable `openpost-cli` agent skill with safe CLI workflows for setup, authoring, media, scheduling, publishing, recovery, and moderation.
- Added CLI commands for provider readiness and capabilities, reusable posting slots, media storage and usage, alt-text updates and deletion, and publication retry and deletion.
- Added reusable image and shape masks, drop and inner shadows, glow presets, curved text paths, and layer blend modes to Studio, with the same rendering in the canvas, saved previews, and exports.
- Added pixel-based rectangle, ellipse, lasso, and color-aware magic selections to Studio, plus persistent hard-edge Pencil and tolerance-aware Paint Bucket tools with selection clipping, brand colors, touch controls, and keyboard shortcuts.
- Added selection-clipped linear, radial, angle, reflected, and diamond gradients to Studio, plus reusable inside, center, and outside borders for visual layers.
- Added non-destructive Eraser and Magic Eraser tools, expanded image color controls and quick looks, and outside borders that follow the visible pixels of transparent images.
- Added transparent, solid, multi-stop gradient, and image page backgrounds to Studio, with opacity controls, responsive previews, and configurable JPEG matte colors.
- Added account-aware LinkedIn member and Organization Page analytics for approved Community Management API applications.
- Added a unified follower trend and publication-level content performance with expandable per-platform results.
- Added direct provider-post links to Engagement, including instance-aware Mastodon and DID-aware Bluesky links.
- Added actionable partial-publish notifications, a safe retry-all-failed-destinations action, token-free in-app workspace invitation acceptance, and X/Mastodon engagement reactions.

### Changed

- Rebuilt the marketing site around a shorter product-led homepage, task-first free tools, role-based pricing, clearer platform and comparison guides, and responsive tables that become readable phone layouts.
- Reused one transient saving and saved indicator across Studio and every composer.
- Made desktop scheduling show two adjacent months, moved engagement collection issues into a provider- and post-specific status menu, and reduced analytics native-post actions to compact external-link controls.
- Reduced app startup and publication-list load with precompressed immutable assets, service-worker caching that fills as routes are visited, video-editor code loaded only when needed, and publication data loaded in a fixed number of queries.
- Added Photoshop-style Studio tool slots, movable pixel-selection borders, textured pencil strokes, and drag-to-place media previews.
- Replaced the remaining native radio inputs with the shared shadcn-svelte radio group and synchronized Studio color editing across Hex, HSL, and RGB.
- Clarified analytics exposure metrics, made follower changes legible with a padded chart range, and kept long connected-account lists within the chart height on desktop.
- Standardized editable Settings pages on one sticky save footer, removed the redundant Brand kit name, and simplified account security with expandable password and data actions.
- Standardized checkbox controls on the shared shadcn-svelte component and moved Analytics trends to the shared shadcn-svelte chart stack.
- Described Instagram Business and Creator, Facebook Pages, TikTok, and YouTube as implemented integrations while keeping live-account verification separate from repository support.
- Added TTF and OTF brand-font uploads alongside WOFF2, simplified brand-asset editing, and reused Studio font and color selectors for brand text styles.
- Applied X text, video-duration, and video-size limits per connected account by reading the authenticated account's subscription tier, with standard limits used when the tier cannot be verified.
- Streamed large local and S3-compatible video uploads with bounded memory and multipart object writes so account-specific X video limits are reachable through the media library.
- Rebuilt Calendar and Activity from the canonical publication inventory, added month and week planning, workspace, platform, and status filters, published history, and scheduled-item rescheduling, and carried selected dates and times into every composer.
- Merged uploads and editable designs into one Media library, moved the workspace Brand kit into Settings, polished Media details with a stable thumbnail-led layout, and removed the product demo link from the profile menu.
- Kept the Settings navigation available while managing social accounts so moving between workspace settings no longer opens a disconnected page.
- Moved CLI and MCP text-post and publication mutations onto the current revision-aware authoring contract, kept linked publications and publish jobs synchronized, and reserved `--profile` for CLI profiles by naming content filters `--content-profile`.
- Reworked Studio around a media-first asset panel, brand-aware color and font pickers, custom sliders, richer shape and crop controls, transient save feedback, native range selection, inline layer naming, hierarchical groups, and contextual layer and design actions.
- Separated Studio object selection from pixel selections, grouped rectangle and ellipse selections, kept Lasso and Magic Select distinct, and split Pencil, fill, and eraser tools into clear groups.
- Moved Studio media selection into a full-height sheet and made media grids add columns as their panels grow.
- Renamed the sidebar Communications destination to Inbox, clarified archived engagement actions, and kept filter changes in place without replacing the page with a loading placeholder.
- Standardized application select controls on the shared shadcn-svelte component.
- Made Engagement post-centered with account/publication filters, reply threading, safe attachment links, edited/deleted state, and durable provider sync health.
- Kept destination customization and reset controls in the account menu, surfaced conflict resolution in the authoring flow, and replaced persistent composer status summaries with transient save feedback beside the destination selector.
- Made Analytics account filters apply to every total and content row, added per-provider metric detail, sorting, native links, stale timing, and capture-window snapshot deduplication.
- Made feedback rate limits durable across restarts and multiple app instances.

### Fixed

- Kept context-menu layer renaming open long enough to edit and submit the new name.
- Restored YouTube category and playlist choices in destination settings, populated native-post links from stored provider IDs and canonical permalinks, loaded persisted TTF brand fonts under their friendly names, and removed the stray Activity tab scrollbar.
- Kept the Studio canvas point beneath the mouse or pinch midpoint fixed while zooming, let pixel selections start or end beyond the image edge, shortened the rounded-shape label, and tightened desktop tool menus.
- Kept organization membership complete when workspace invitations are accepted and backfilled existing workspace members so organization policy, billing, and team views share the same membership boundary.
- Prevented signed-in startup redirects from briefly mounting the login form inside the authenticated application sidebar.
- Fixed Studio color picks falling back to black, first-drag layer movement and Alt duplication, unstable paint erasing, and save validation for erase masks and color adjustments.
- Persisted each Studio design's export format and quality so PNG and WebP selections no longer reset to the preset default after autosave.
- Kept desktop page widths stable when vertical scrollbars appear without narrowing phone drawers, shortened the draft context action, and made Engagement archive, restore, read, and provider-delete actions update without a loading flash or false “Move to inbox” state.
- Used the configured public media or S3/R2 URL consistently for verification and provider publishing, refreshed stale failed checks before validation, and removed duplicate HTTPS errors from destination account menus.
- Made Studio transforms undoable, made Shift-rotation snap stably to 15-degree steps, assigned Space-drag to panning and Alt-drag to duplication, and allowed pasteboard clicks to clear selection.
- Restored native Tab navigation in Studio, exposed shape insertion on desktop and mobile, and made export settings summarize output size, transparency, and destination before rendering.
- Kept the sidebar calendar and full Calendar on one canonical occurrence rule so scheduled and published items appear consistently.
- Loaded the original authenticated Brand asset when a generated thumbnail is unavailable.
- Gave the full frontend validation program enough bounded Node heap to complete the release gate.
- Aligned release browser checks with publication-backed Activity and Calendar loading, the current brand-font picker, and slower Studio export environments.
- Redirected marketing-site documentation paths to the canonical docs site and restored real 404 responses for unknown paths.
- Made Studio layer reordering work with touch drag handles on mobile, corrected one-direction drop placement, and kept keyboard reordering one step at a time.
- Preserved image aspect ratios when Studio media metadata arrives before or after insertion, made stretch the default image fit, and enlarged canvas resize handles for touch.
- Kept every grouped Studio child inside its group stacking slot during initial renders and later canvas syncs so unrelated circles, images, and other layers cannot render between grouped text and shapes.
- Added right-click and long-press actions to Media assets, editable designs, and sidebar drafts, including first-class design favorites and safe design deletion.
- Simplified the Media toolbar by combining counts with storage, removing duplicate status controls, reducing the layout switcher, and removing the doubled divider above Workspace navigation.
- Kept Android Studio text editing anchored above the keyboard without refitting the canvas or panning the document, and made long mobile Settings menus scroll within the visible viewport.
- Kept release artifact packaging on the pinned Node, pnpm, and Go toolchains after Devenv preflight so transient Nix store references cannot strand frontend, server, or CLI release assets.
- Kept Brand kit text fields and color controls mounted while their values change so keyboard focus, selection, and color-picker state no longer reset during editing.
- Kept resized Studio images flush with their frames by preserving source-pixel geometry during Fabric transforms, and kept canvas selection synchronized after document updates.
- Applied hidden and locked Studio group state to every descendant during incremental canvas updates, and recomputed cover/contain image geometry after frame aspect-ratio changes so the editor matches saved previews and exports.
- Kept the text-and-thread composer's compatibility draft in sync when normalized publications are created or edited through REST and MCP, including an upgrade backfill for existing publications.
- Kept MCP source-text updates synchronized with the linked text-and-thread editor row so agent edits reopen with the current content and revision.
- Routed uploads through the storage mode advertised by the server instead of probing an unsupported direct-upload endpoint, and raised the bounded frontend build heap to the verified bundle minimum.
- Preserved analytics and engagement continuity when OAuth accounts are reconnected, including historical renditions linked to duplicate inactive account rows.
- Removed content performance for posts that providers report as deleted or unavailable, while keeping the canonical OpenPost publication history.
- Removed generic provider quota caveats from the composer when there is no actionable account problem.
- Kept Studio export confirmation ahead of late autosave announcements and aligned end-to-end select interactions with the shared shadcn-svelte control.
- Removed the unused draft `force` request field so conflict overwrite always uses a current revision compare-and-set, and preserved engagement read/archive state across provider edits and deletions.
- Preserved X reaction state across provider syncs, exposed the inverse reaction action immediately, and enforced workspace-scoped token boundaries when accepting invitations.
- Kept direct video upload completion idempotent while analysis runs, and allowed later manual publication retries to report a fresh result without duplicating automatic-attempt alerts.

## [1.27.9] - 2026-07-25

### Added

- Added a tested SemVer release calculator that maps Conventional Commit impact to patch, minor, and major versions.
- Added a Star History link and current-star entry point to the repository overview.
- Added release and versioning documentation, including the corrected version-line rationale and immutable-tag failure policy.
- Added an authenticated, operator-configured feedback form for bugs, ideas, and questions with explicit recipients, separately optional screenshot and diagnostics previews, strict privacy limits, durable delivery jobs, and a support fallback when disabled.
- Added stable per-destination publishing failure categories, safe provider codes and retry times, direct recovery actions, manual target retry, and partial-outcome details in Activity.
- Added OpenPost Studio with versioned multi-page designs, original starter templates, brand kits and WOFF2 fonts, mobile editing, autosave recovery, client-side background removal, camera capture, export, and composer return.
- Rebuilt Media around reusable assets, designs, templates, brand resources, collections, tags, provenance, richer filtering, and one shared Library/Upload/Camera/Create picker.
- Added normalized publication and rendition segments, provider-qualified output profiles, account capability resolution, scoped destination settings, and paginated account option searches.
- Added authenticated, account-specific publishing options so composer fields can load live provider data such as YouTube playlists and regional video categories.
- Added server-enforced `mcp:read` access for inspection-only agent connections, with mutation tools hidden and mutation attempts rejected at runtime.
- Rebuilt the public platform and comparison guides and added six in-browser tools for character counting, post previews, thread splitting, handle checks, LinkedIn formatting, and timezone-aware posting plans.
- Added email password recovery, authenticated password changes, account JSON exports, and permanent account deletion with billing, administration, shared-ownership, durable storage-cleanup, and re-authentication safeguards.
- Added versioned Terms of Service and Privacy Policy acceptance for hosted registration, with public legal pages and an operator support contact.
- Added Go and production-JavaScript vulnerability scans to CI and release preflight.
- Added database restore-drill tooling, hosted restore evidence, versioned media snapshots, and declarative daily backup and weekly restore verification for the hosted service.

### Changed

- Corrected the current stable line from `v1.1.22` to `v1.27.9` after replaying published release cohorts under SemVer. The previous code state maps to `v1.27.7`; the `v1.27.8` correction tag failed preflight before publication or deployment, so this release fixes forward. Historical tags remain unchanged.
- Simplified the README around product purpose, supported platforms, setup, automation, and maintained documentation, and removed duplicated or stale repository details.
- Consolidated CLI documentation in the maintained docs site and refreshed contributor, frontend, provider, upgrade, and release guidance against current code.
- Redesigned the mobile app shell and composer with a safe-area-aware More menu, compact post controls, circular rendition targets, and always-visible touch actions for media and thread editing.
- Made linked worktrees share the primary checkout's Go and pnpm caches, added a development doctor, installed pinned Chromium during setup, and made local browser suites use that reproducible runtime by default.
- Made every active composer save revision-aware and atomic across source content, thread parts, media, destinations, overrides, segments, and settings, with serialized autosave and explicit conflict recovery.
- Named the restored default authoring surface the text-and-thread composer to reflect its role as the fast path for Post and Thread.
- Simplified the Media hub and picker, replaced blank design cards with source previews, curated the starter templates, and rebuilt the mobile Brand editor.
- Kept one intent and capability model across composer flows while restoring the text-and-thread authoring surface.
- Stopped publishing Intel macOS CLI and MCP release binaries; macOS release assets now target Apple Silicon only.
- Moved destination-specific composer settings into account cog dialogs in the Publish to menu, with structured tag, category, and playlist controls for YouTube.
- Rewrote the landing, pricing, security, open-source, changelog, platform, comparison, and tools pages around current product behavior, and refreshed the canonical composer, accounts, media, and settings screenshots.
- Restored the OpenPost composer screenshot as the product-demo preview while keeping the recorded video behind the play action.
- Updated the project to Go 1.26.5 and current patched `x/image`, `x/net`, `x/text`, and `cookie` dependencies.
- Replaced broad provider maturity labels with implemented and preview statuses that state provider approval, quota, public-media, and live-account verification constraints.
- Added the recorded product demo to the public landing page, app profile menu, user docs, and repository overview.
- Consolidated account selection and per-account content customization into one icon-based composer menu across every post format.
- Simplified the calendar day drawer with shorter copy, tighter previews, and destination icons instead of platform names.
- Gave the public landing-page hero a warmer, shorter headline and removed the placeholder testimonial wall.
- Reworked the README around the current app, automation, deployment, and per-provider publishing capabilities.
- Unified authenticated page headers, section hierarchy, empty/error feedback, toasts, destructive confirmations, and content-shaped loading placeholders behind shared responsive components.
- Standardized compact desktop controls and 44-pixel portrait touch targets across shared buttons, selects, tabs, composer actions, and mobile navigation.
- Made the contextual sidebar brand and New post action exchange with a restrained push transition, including an instant reduced-motion fallback.
- Removed disconnected composer/comment prototypes and consolidated duplicate workspace bootstrap, standalone-page, and loading styles.
- Loaded Settings subsystems only when their section is opened instead of eagerly requesting every security, developer, team, billing, and schedule resource.
- Made MCP post scheduling accept atomic destination-specific renditions and made status/list readback authoritative for rendition content and media; the CLI can inspect renditions and replace or clear source media on post updates.
- Added restrained, optional interface sounds for publishing and media-upload outcomes, with a persistent mute control in the profile menu.
- Collapsed Mastodon connection choices into one consistent provider card that asks for the server address in a focused dialog.
- Replaced generic Instagram, Facebook, YouTube, and TikTok glyphs with their actual brand marks throughout the app.
- Restored a desktop planning sidebar with a compact schedule calendar, one-click autosaved draft resumption, and always-visible workspace navigation while preserving the mobile bottom navigation and collapsed icon rail.
- Reworked the authenticated app around persistent primary navigation, a focused Posts area, intent-based composer formats, clearer content customization language, compact social accounts, day drawers, and task-specific settings pages on desktop and mobile.
- Relicensed OpenPost from MIT to AGPL-3.0-only and restored clear open-source positioning across the project, marketing site, documentation, and authenticated app.
- Made the project-owned Devenv/direnv workflow durable across NAS/Hermes reboots with a committed environment lock, repo-local caches, frozen installs, non-destructive dotenv setup, explicit command gates, a tracked fast pre-push lint gate, and no shell execution of dotenv data.
- Documented the intended web, CLI, MCP, and HTTP API surface boundaries, corrected stale marketing automation examples, scoped heavy uploader styles to the uploader itself, and lazy-loaded the documentation API explorer outside its dedicated route.
- Added mixed-media carousel publishing for Threads and aligned public-media constraints with the publishing modes supported by Threads, Facebook, Instagram, and TikTok.
- Collapsed the MCP model-facing catalog from 24 operation descriptors to four compact tools (`search`, guaranteed read-only `query`, mutation-only `execute`, and the scheduler widget), with on-demand schema discovery, server-enforced safety routing, and compatibility for cached direct operation calls.
- Pointed marketing self-hosting CTAs at the dedicated self-hosting docs and exposed user/developer docs links separately.
- Split the docs sidebar into user, self-hosting, and development navigation groups with cleaner section labels.
- Corrected stale CLI/config/provider/settings/production-readiness docs so the documented automation env vars, file-backed config behavior, provider-app management paths, MCP setup/tool lists, callback URL guidance, frontend route docs, README/platform lists, homepage/media/scheduling/thread wording, provider capability notes, binary install steps, and cloud-readiness status match the current codebase.
- Added Windows amd64 server binary release support and documented Windows single-binary setup.
- Removed social media sets from the app, API, CLI, MCP tools, and docs; posting schedules now resolve at the workspace/account level with a migration that drops the legacy set tables.
- Updated CLI and MCP publication workflows for current post types, explicit account targeting, media roles, YouTube title/description/privacy, TikTok settings, and publication schedule/publish actions.
- Included the CLI in the repository's normal build, lint, test, and verification gates.
- Brought CLI and MCP format-first workflows to parity with the app by adding publication reads/updates, rendition replacement, explicit rendition replies, and provider comment reply/hide/delete actions.

### Fixed

- Made the documentation link check validate the generated `/openapi.json` route against its tracked source in clean CI checkouts.
- Fixed the scheduling dialog so its title and actions remain reachable while scrolling on mobile browsers.
- Aligned the product platform declaration with the responsive web app and Capacitor Android wrapper already shipped from the shared frontend.
- Rebuilt Studio editing around stable in-place canvas updates, serialized autosaves, reliable inline text persistence, current previews, correct Back navigation, resizable desktop panels, and an inspector that stays within the viewport.
- Scoped sidebar planner hover states to the exact calendar link or draft row so unrelated icons keep their color and only the active draft reveals its delete action.
- Restored the Schedule split button so its side action schedules the next free slot, or submits the selected date and time when one is already set.
- Routed linked Post and Thread publications back to the text-and-thread composer, removed their duplicate sidebar entries, and added quick draft deletion from the draft list.
- Resolved empty media-first drafts against their chosen Story or video format, and collapsed their shared media requirement into one clear composer warning instead of marking every destination as incompatible.
- Let the desktop draft list use and scroll through all available space above the fixed Workspace actions.
- Prevented repeated destination validation issues from crashing the Video and Short video composers and leaving their loading skeleton visible.
- Prevented focused publication drafts from reusing client placeholder segment IDs, remapped destination segments to server-owned IDs, and stopped exposing raw database errors when creation fails.
- Unified publish, delete, scheduling, and validation controls across both composer styles; restored deletion for Story and video drafts; and replaced the focused media prompt with a larger native drop zone.
- Captured feedback screenshots without the feedback dialog's dark, blurred backdrop.
- Kept generated embedded frontend output out of version control.
- Updated `brace-expansion` to its patched release after a new production dependency advisory.
- Stopped permanent validation, authentication, permission, billing, and duplicate-content failures from consuming generic job retries while preserving bounded retries and uploaded-media state for transient failures.
- Updated SvelteKit, PostCSS, and node-tar to patched releases after new production dependency advisories.
- Kept generic provider quota caveats from marking connected accounts as needing attention in the composer.
- Stopped unavailable X settings from requesting unsupported account-option endpoints and replaced their empty controls with concise availability details.
- Restored the compact Post and Thread controls, drag-and-drop editing, automatic drafts, full schedule picker, and next-queue action; made polls optional and removable; added an optional link field; preserved scoped destination settings through text-and-thread composer saves; accepted exact local ISO schedule input; and kept mobile media actions at 44px.
- Restored publication autosave, safe workspace switching, next-slot scheduling, legacy draft redirects, and canonical publication drafts in the planner after the composer update.
- Preserved segment and destination state through legacy draft migration and retries, and aligned X, Meta, LinkedIn, Mastodon, Bluesky, YouTube, and TikTok request payloads with their declared setting contracts.
- Sent the YouTube synthetic-media disclosure selected in composer settings with the video upload metadata.
- Prevented YouTube accounts from being selected for text, thread, link, image, carousel, or Story posts; YouTube remains available for Shorts and video uploads.
- Displayed connected account handles with exactly one `@` prefix, including YouTube handles that already include it.
- Clarified temporary account-selection deadlines, made empty Facebook and Instagram account results explain the Page requirements, and stopped requesting unused Instagram and TikTok permissions.
- Gave production frontend builds enough bounded Node heap to finish static asset generation on release runners.
- Loaded the embedded product video only after the tour opens and removed it again when the dialog closes.
- Kept keyboard focus inside the product-video dialog and returned it to the play control when the dialog closes.
- Aligned the Starter, Creator, and Pro seat entitlements with the public pricing catalog.
- Matched provider media validation and support copy to the implemented publishing paths.
- Corrected stale security and posting-schedule field descriptions.
- Kept legal acceptance copy in a natural inline reading flow on account review and registration screens instead of splitting each phrase into a separate flex column.
- Kept contract checks valid in clean CI checkouts by excluding ignored documentation build copies from tracked-file freshness checks.
- Made MCP tool discovery and execution agent-safe and protocol-correct with complete parameter documentation and examples, runtime input/output schema enforcement, refusal for out-of-scope searches, standard stdio framing, protocol-version forwarding, origin and request guards, and actionable scope errors.
- Kept password-reset responses enumeration-safe, reset all sessions after recovery, preserved only the current session after a password change, excluded shared workspace content from personal exports, and transferred shared organization ownership safely during deletion.
- Made custom composer destinations visible from the account picker, aligned selection marks with the shared checkbox style, and confirmed destructive custom-content resets and removals.
- Simplified the composer destination menu with a quieter icon summary, compact account rows, and one contextual menu for per-account content actions.
- Kept REST and MCP publication scheduling atomic and future-only, preserved reply/job history during reschedules, and made schedule clearing return publications and renditions to draft without erasing unrelated fields.
- Made built-in prompt seeding concurrency-safe and idempotent so simultaneous prompt and category requests cannot fail a fresh workspace.
- Enforced workspace-scoped token boundaries on post and calendar reads, and derived default calendar months and UTC bounds from each workspace timezone.
- Interpreted composer schedules, calendar grouping, drag-rescheduling, and date-filtered post queries in the active workspace timezone, including daylight-saving transitions and local-day UTC bounds.
- Separated onboarding and invitation recovery from creation and acceptance, and added portrait-calendar creation for empty dates in the displayed month.
- Kept developer-token and social-account/provider load failures distinct from real empty states, with localized retry controls.
- Kept the calendar in an agenda layout until the content pane is wide enough, replaced its per-cell loading storm with one stable placeholder, and restored a single page-heading scale.
- Made media selection and actions persistently reachable without hover, localized account callback and media workflows, and prevented stale or duplicate media, account, and Settings requests from winning after workspace or filter changes.
- Replaced clipped portrait Settings tabs and posting-schedule grids with a section picker and touch-safe schedule cards, while keeping save feedback above the mobile navigation safe area.
- Restored workspace switching in the mobile More menu, clarified icon-only schedule controls for assistive technology, and revealed desktop media actions on keyboard focus.
- Validated scheduled destination captions independently of publication profiles, kept X scheduling conservatively aligned at 280 characters without a verified premium entitlement, preserved comma-containing CLI media filenames, and kept direct-upload response metadata consistent for new and deduplicated media.
- Opened an existing post on its actual destination rendition when every destination is customized, restoring provider-specific character limits and rendition-only media; media upload responses now include the persisted alt text and original filename.
- Unified new and persisted draft composing: the first autosave now establishes the draft URL, draft editing keeps the normal schedule/publish controls, deletion lives in the composer toolbar, and the sidebar brand becomes the contextual New post action away from an empty homepage.
- Unified every composer format under the same compact publishing toolbar, removed duplicate workspace controls, kept the authenticated app shell mounted during navigation, restored the collapsed-sidebar logo, and tightened the Social accounts layout.
- Kept the active Settings section visible in the mobile tab strip, removed repeated section headings, and made status notifications properly announced and dismissible.
- Restored Link, Image, Carousel, and Story to the composer post-type picker, with grouped descriptions that keep all eight formats easy to distinguish on desktop and mobile.
- Documented the required R2 bucket CORS policy for direct browser media uploads.
- Bound MCP OAuth tokens to the MCP resource, protected remote client metadata fetches from SSRF, serialized first-admin bootstrap on PostgreSQL, and moved web sessions from persistent browser storage to revocable HttpOnly cookies.
- Made multi-worker job claims race-safe, kept long-running job locks alive, rejected unknown job types, and indexed due-job polling.
- Batched media-usage analysis and made reference deletion transactional before best-effort blob cleanup so media lists scale without leaving database records pointed at missing files.
- Kept the project Devenv shell evaluable on macOS by only adding the declarative Chromium test runtime on Linux, restoring cross-platform CLI release builds.
- Kept English and Portuguese message catalogs in lockstep with a build-time parity check, aligned PWA/browser colors with the product theme, and added global reduced-motion and coarse-pointer accessibility safeguards.
- Restricted workspace-scoped checkout and billing-portal mutations to workspace administrators.
- Stopped server startup when database schema initialization fails instead of serving against a partially initialized database.
- Allowed cross-origin `PATCH` requests so browser-based update flows work with configured external frontend origins.
- Rejected undocumented MCP operation arguments and surfaced failures to persist MCP tool-call audit records in server logs.
- Enforced workspace roles across mutations so viewers remain read-only, editors can manage publishing content and connected accounts, and workspace configuration stays admin-only.
- Made remote MCP `GET /mcp` return HTTP 405 instead of falling through to SPA HTML, restoring Streamable HTTP compatibility with clients such as Hermes.
- Added the frontend account-selection step for Facebook and Instagram OAuth callbacks so pending page/account choices are completed before showing success.
- Preserved finalized `Location` headers on Meta OAuth callback redirects by setting redirect targets before Huma commits the 307 status.
- Registered persisted and newly added dynamic Mastodon instance adapters with publishing and token refresh so custom instances can publish without manual server restarts.
- Centralized frontend bearer-token access so profile avatar uploads, removal, authentication restoration, and logout stay synchronized with the shared API client.
- Made failed-post activity explain every destination outcome and provider reason, with a credential-safe diagnostic report that users can copy for support.
- Removed redundant healthy-state copy from social account cards, surfaced developer shortcuts and Mastodon servers, widened the desktop sidebar calendar, tightened footer rhythm, and translated the redesigned publishing surfaces in English and Portuguese.

## [1.0.40] - 2026-07-06

### Changed

- Moved the composer post-type picker into the composer control row and made calendar-created posts prefill their schedule date.

### Fixed

- Aligned the composer Schedule/Publish actions with the app button system, made the split-arrow schedule the next free queue slot, and added a per-post random-delay override in the schedule dialog.
- Fixed the fullscreen calendar platform filter, day-level create actions, sidebar fullscreen shortcut, and dark-mode workspace filter styling.
- Updated composer e2e coverage for the post-type selector so release preflight follows the new UI.
- Kept release server-binary jobs out of the full frontend devenv shell after frontend assets are already built.

## [1.0.36] - 2026-07-06

### Changed

- Reworked the text-and-thread composer schedule control into a dialog with natural-language time input, quick picks, timezone context, and the existing calendar/time selector.
- Renamed the default composer mode to Post and kept the mode picker in sync when users add or remove thread posts.

### Fixed

- Detected X Premium long-post limits from account capabilities and metadata instead of relying only on a manual limit profile flag.

## [1.0.34] - 2026-07-06

### Changed

- Made commit and push hooks faster by keeping pre-commit to lightweight checks and trimming pre-push to backend format/lint plus frontend lint.
- Added the format-first publication/rendition publishing model, capability registry, composer, CLI/MCP publication commands, and profile-aware Facebook, Instagram, YouTube, and TikTok publishing paths.
- Added media analysis/public URL validation metadata and provider-readiness diagnostics for format-first publishing.
- Switched YouTube publishing to resumable uploads with retry/resume handling, thumbnail upload, playlist insertion, and post-upload processing-status checks.
- Added X quote-post, poll, reply-setting, paid-partnership, and AI-disclosure publishing settings with validation for mutually exclusive attachment modes.
- Added Mastodon visibility, content-warning, sensitive-media, language, poll, and native scheduling settings with poll/media conflict validation.
- Added Bluesky video capability metadata plus rich-text facets, external link cards, quote posts, quote-with-media embeds, and self-label settings.
- Added LinkedIn document/PDF carousel capability metadata and document upload/publishing support via the LinkedIn Documents API.
- Added TikTok Upload/Inbox video support with `FILE_UPLOAD` initialization and chunk transfer while keeping Direct Post on verified public media URLs.
- Added rendition comment inbox/moderation API routes with opaque OpenPost comment IDs, Facebook/Instagram/LinkedIn/Threads comment adapters, and explicit unsupported-provider responses.
- Added MCP provider-readiness, publication-validation, media-analysis metadata, publication lifecycle, and rendition comment workflows for automation clients.
- Added workspace image URLs and moved workspace-scoped navigation into the workspace switcher menu.
- Added a fullscreen month calendar with workspace/platform filtering, account badges, publication sets, and drag-and-drop rescheduling.
- Replaced the route-level unified composer with a focused old-shell composer picker that defaults to Short text and uses explicit output-role labels for rich publication modes.

### Fixed

- Made provider readiness use the effective registered provider adapters so env-configured X, LinkedIn, and Threads credentials are not reported as missing.
- Fixed Postgres migration normalization for numeric boolean defaults so hosted databases can apply the format-first schema migrations.
- Reworked existing-post editing so posts open in the full composer with explicit save/cancel controls instead of prompt-based rescheduling.
- Made publication rendition saves replace omitted account outputs instead of leaving stale renditions behind.
- Rendered a success page for completed OAuth account callbacks before returning users to Accounts.
- Stopped showing checkout CTAs for other plans when an organization already has an active hosted plan.

## [1.0.30] - 2026-07-03

### Fixed

- Removed the obsolete provider-app admin E2E coverage after the admin UI moved out of the app.

## [1.0.29] - 2026-07-03

### Changed

- Moved shared post scheduling, media validation, thread-draft, and thread cascade helpers out of the post API handler for reuse by MCP and tests.
- Made the account provider catalog UI consume the generated API type instead of maintaining a fallback provider list in the page.
- Extracted composer platform character-limit helpers into a tested compose module.
- Removed the in-app provider-app admin panel and sidebar shortcut so provider credentials stay operator-managed through deployment configuration.
- Removed the redundant schedule label above the sidebar calendar.

### Fixed

- Blocked social account connection attempts before provider redirects when the workspace has no remaining social-account entitlement.
- Corrected the frontend test command in the contributor guide.

## [1.0.28] - 2026-07-03

### Changed

- Replaced the marketing site with a minimal static SvelteKit index that reuses the main app theme and shared UI components.
- Removed the old marketing content routes from the public sitemap.

### Fixed

- Bridged the Paraglide Vite plugin type for the frontend Vite 7 config.
- Kept authenticated sidebar navigation inside the app shell without re-running the full onboarding loading state on every section change.
- Redirected OAuth callback failures back to Accounts with user-safe error messages instead of raw callback JSON pages.
- Encoded LinkedIn OAuth scopes with percent-escaped spaces so LinkedIn does not reject the scope string.
- Reused X OAuth request-token metadata through the callback token exchange so approved X connections can be saved.
- Dropped the legacy one-active-social-account workspace index from older databases.

## [1.0.26] - 2026-07-03

### Changed

- Moved Accounts, Media, Prompts, and Activity into the primary sidebar as workspace content and narrowed the avatar menu to account/session actions.
- Reworked settings entry points so Account, Workspace, Organization, and Instance Admin render as scoped destinations instead of sibling tabs.
- Clarified Mastodon provider app copy so normal users connect by entering an instance domain while manual provider credentials remain an instance-admin fallback.

### Fixed

- Loaded Uppy core, dashboard, webcam, and image editor styles globally so the profile picture picker renders with the expected uploader styling.
- Matched the theme toggle icon color to the rest of the avatar menu icons.

## [1.0.25] - 2026-07-03

### Fixed

- Made Postgres migration normalization use `ADD COLUMN IF NOT EXISTS` so fresh cloud databases created from models can still record column-add migrations cleanly.

## [1.0.24] - 2026-07-03

### Changed

- Aligned OpenPost Cloud plan links, environment examples, docs, and landing-page pricing with the full Starter/Creator/Pro/Team/Agency billing catalog.
- Switched OpenPost Cloud public and in-app pricing from dollar-denominated display to Euro source prices with locale-aware formatting.

### Fixed

- Fixed the pre-push lint hook's tag-push detection and no-devenv fallback directory handling.

## [1.0.23] - 2026-07-01

### Fixed

- Preserved safe same-origin login redirects after authentication so settings deep links survive the authenticated route guard.
- Made the workspace-switcher e2e test match the footer switcher behavior for alphabetically selected workspaces.

## [1.0.22] - 2026-07-01

### Added

- Added organization-backed workspace ownership, team listing APIs, organization-scoped billing routes, and team/agency Polar plan configuration for hosted accounts.
- Added authenticated profile updates and avatar upload/removal endpoints backed by existing media storage.
- Added an Account settings profile UI with Uppy-powered avatar upload/camera capture.

### Changed

- Removed the user-facing Publications surface from the web app, CLI, public API, MCP tools, and docs so drafts/posts plus per-platform renditions remain the canonical workflow.
- Split Settings into Workspace, Account, Organization, and Admin tabs so user-owned and workspace-owned preferences are clearer.
- Clarified user, self-hosting, and developer docs around Settings ownership, provider app management, and organization billing.
- Moved workspace switching into the sidebar footer and clarified Provider Apps settings around Mastodon custom instances and optional provider OAuth key overrides.
- Made billing subscription snapshots organization-scoped while preserving legacy workspace billing metadata for compatibility.

### Fixed

- Replaced raw browser User-Agent strings in active sessions with readable browser/device labels.

## [1.0.21] - 2026-07-01

### Fixed

- Installed Playwright Chromium in local, CI, and release frontend test gates before browser-backed Vitest and E2E checks run.

## [1.0.20] - 2026-07-01

### Fixed

- Fixed backend lint configuration drift between local macOS and Linux release runners by excluding noisy `goconst` findings.

## [1.0.19] - 2026-07-01

### Fixed

- Fixed release preflight backend lint failures in MCP and billing error responses.

## [1.0.18] - 2026-07-01

### Added

- Added `OPENPOST_POLAR_API_BASE_URL` and strict cloud-mode Polar billing config validation for hosted checkout, portal, and webhook readiness.
- Added a production-readiness implementation plan covering OpenPost Cloud, Postgres/S3 drivers, Polar billing, provider readiness, the publication model, MCP/ChatGPT app work, marketing/SEO, and verification.
- Rebuilt `marketing-site/` as a SvelteKit landing page for OpenPost Cloud with an agentic scheduler position, demo slot, pricing direction, platform grid, FAQ, and lower-page open-core trust section.
- Added backend edition, database-driver, and storage-driver configuration primitives, including Postgres Bun driver initialization and S3-compatible storage settings for upcoming cloud storage work.
- Added an S3-compatible media storage driver behind the `BlobStorage` interface for OpenPost Cloud and R2/S3-backed deployments.
- Added an entitlement service contract with self-hosted unlimited defaults and static plan-limit decisions for upcoming Polar billing and quota enforcement.
- Added Playwright smoke coverage for the OpenPost Cloud marketing landing page across desktop and mobile Chrome.
- Added an authenticated `/mcp` JSON-RPC foundation with MCP `initialize`, `tools/list`, and a read-only `list_workspaces` tool backed by existing Bearer JWT/API-token authentication.
- Added monthly `usage_counters` storage plus a usage accounting service for hosted quotas, and enforced the first entitlement boundary on workspace creation while keeping self-hosted defaults unlimited.
- Added media upload quota enforcement for monthly uploaded bytes and total stored media bytes, with successful new uploads recorded into monthly usage counters.
- Added scheduled-post quota enforcement for single posts and threads, with successful scheduled creates recorded into monthly usage counters.
- Added social account connection quota enforcement in the shared account saver used by OAuth and app-password provider flows.
- Added MCP `list_accounts` and `create_draft` tools so authenticated assistants can inspect connected accounts and create workspace-scoped draft posts.
- Added publishing-worker usage accounting for successful published posts and provider publish write calls.
- Added Polar billing webhook configuration, signature verification, idempotent webhook event storage, and local subscription snapshot tables for OpenPost Cloud.
- Added a subscription-backed entitlement service for cloud-mode workspace quotas using local Polar subscription snapshots.
- Added authenticated Polar checkout and customer portal API endpoints for OpenPost Cloud billing.
- Added a workspace billing status API and settings UI summary for current plans and monthly usage.
- Added publishing-worker quota enforcement for monthly published posts and provider write calls.
- Added a Playwright app smoke suite that boots the Go server and verifies the authenticated billing settings surface.
- Added MCP `schedule_post`, `get_post_status`, and `cancel_post` tools with workspace/account validation, scheduled-post quota enforcement, and publish-job queue integration.
- Added MCP `suggest_next_slot` so assistants can pick the next free configured posting slot before scheduling.
- Added an `openpost-mcp` CLI stdio proxy that reuses OpenPost CLI profiles and tokens to connect desktop MCP clients to the authenticated remote `/mcp` endpoint.
- Added MCP `upload_media_from_url` with shared media ingestion, upload quota accounting, dedupe, and private/local-address SSRF protection.
- Added persistent MCP tool-call auditing with user/workspace scope, status, error message, duration, and migration coverage.
- Added an authenticated MCP activity API and settings panel so users can inspect recent assistant/CLI tool calls, failures, durations, and workspace scope.
- Added Apps SDK-facing MCP protected-resource metadata, OAuth scope descriptors, and bearer challenges for ChatGPT/App client account-linking readiness.
- Added dedicated `mcp:full` API-token creation in settings and enforced MCP-compatible token scopes on `/mcp` while preserving existing CLI proxy tokens.
- Added a structured provider app registry that normalizes legacy provider env vars and optional `OPENPOST_PROVIDER_APPS` JSON before building platform adapters.
- Added database-backed provider app registry loading so hosted/operator deployments can keep OAuth app credentials encrypted in `provider_apps` rows while retaining env and JSON bootstrap config.
- Added instance-admin provider app registry APIs for listing, saving, and deleting encrypted provider app credentials without exposing stored secrets.
- Added an instance-admin Settings panel for managing database-backed provider app credentials and restart-required state.
- Added provider-readiness catalog details to `openpost instance diagnostics` support snapshots.
- Added billing plan and usage details to authenticated `openpost instance diagnostics` support snapshots.
- Added `openpost billing status`, `openpost billing checkout`, and `openpost billing portal` for hosted workspace billing flows from the CLI.
- Added an authenticated account-provider discovery endpoint so clients can distinguish configured provider apps from unavailable providers.
- Added provider-discovery rendering on the Accounts page, including unavailable states for provider apps that still need operator configuration.
- Added MCP `list_scheduled_posts` so assistant clients can inspect the upcoming publishing queue before scheduling or canceling posts.
- Added DB-backed dynamic Mastodon app registration so hosted and self-hosted deployments can connect user-supplied Mastodon instances without preconfigured server entries.
- Added Accounts UI support for custom Mastodon instance connection, including OOB exchange persistence and Playwright coverage.
- Added MCP `set_post_renditions` so assistants can write destination-specific post variants for draft and scheduled posts.
- Added MCP `list_drafts`, `update_draft`, and `schedule_draft` so assistant clients can review, revise, and queue existing draft posts without creating duplicates.
- Added MCP client attribution for tool-call activity by storing API-token client ID, name, scope, and token prefix and surfacing the client label in Settings.
- Added MCP OAuth authorization-code + PKCE account linking for ChatGPT-style clients, including authorization-server metadata, browser approval, client metadata redirect validation, and audience-bound MCP tokens.
- Added MCP prompt templates for common agentic scheduling workflows: planning a social post, adapting platform renditions, and reviewing the publishing queue.
- Added Apps SDK-friendly MCP tool invocation metadata and output schemas so ChatGPT-style clients can render progress states and validate structured tool results.
- Added direct browser-to-S3 media upload sessions with pending media reservations, presigned PUT targets, completion finalization, dedupe, and quota accounting.
- Wired web media uploads through direct S3 upload sessions with automatic multipart fallback for local/self-hosted storage.
- Added provider launch-status metadata to account-provider discovery, including Instagram, Facebook, YouTube, and TikTok entries for web, CLI, MCP, and ChatGPT App clients.
- Added MCP `list_provider_catalog` so assistant clients can inspect available, unconfigured, and planned social providers before choosing destinations.
- Added MCP `list_media` plus source `media_ids` support on draft and scheduling tools so assistant clients can reuse existing workspace media or attach uploaded assets to posts.
- Added MCP `ping` and Streamable HTTP notification handling, with `openpost-mcp` suppressing empty stdio frames for accepted notifications.
- Added an MCP Apps scheduler widget resource and `render_scheduler_widget` tool so ChatGPT-style clients can render OpenPost workspaces, accounts, media, providers, drafts, and queue data.
- Added the first Publication model schema foundation with `publications`, `publication_assets`, and optional `posts.publication_id` links for the upcoming source-idea → rendition workflow.
- Added MCP `list_publications` and `create_publication` tools so assistants can work from source ideas and assets before creating platform-specific drafts.
- Added authenticated publication API endpoints for creating, listing, reading, and updating source publications with media attachments.
- Linked source publications to post creation/update, thread creation, CLI API structs, and MCP draft/schedule workflows through `publication_id`.
- Added CLI publication commands plus `--publication` linking for post and thread workflows.
- Added a web Publications page for source ideas, source media, status changes, and handoff into the composer.
- Added user-facing web-app Publications docs that distinguish the UI workflow from CLI and MCP publication workflows.
- Added user-facing MCP docs and reorganized the docs navigation around user docs, self-hosting docs, and developer docs.
- Added a backend OpenAPI generator command so docs builds regenerate the checked-in Huma spec from the same route registrar used by the server.
- Added hosted pricing handoff from landing-page plan CTAs through registration, onboarding, and the app billing checkout flow.
- Added account-specific platform preview cards for Instagram, Facebook, YouTube, and TikTok compose views.
- Added a compact settings section navigator with stable anchors for billing, security, tokens, schedules, and workspace defaults.
- Added server-backed web session tracking with Settings UI revocation and Playwright coverage for active browser sessions.
- Added dedicated docs overview pages that separate user-facing web/CLI/MCP docs, self-hosting operations docs, and developer implementation docs.
- Added marketing SEO pages for free social post tools and publishing tips, including interactive character counting, thread splitting, and platform previews.
- Added a UTM campaign-link builder to the marketing tools page with Playwright coverage for generated tracking URLs.
- Added a source-publication context panel in the composer, including source brief metadata, source reuse, and publication media metadata hydration.
- Added crawlable marketing blog and comparison pages for agentic social media scheduling and publication-first workflows.
- Added static marketing-site `robots.txt` and `sitemap.xml` routes for the landing, tools, and tips pages.
- Added a cloud bootstrap entitlement so hosted users can create one workspace before checkout while paid workspace expansion uses active subscription snapshots.
- Added a database-backed `/api/v1/ready` endpoint for deployment readiness checks while keeping `/api/v1/health` as a liveness probe.
- Added `openpost instance health` for unauthenticated CLI liveness and readiness checks against the active instance.
- Added production-operator checklist coverage for self-hosted storage, cloud Postgres/S3/Polar readiness, provider launch gates, backup restores, and CLI readiness probes.
- Added stricter Apps SDK metadata coverage for the MCP scheduler widget, including standard `_meta.ui` CSP keys, legacy ChatGPT aliases, and model-only render-tool visibility.
- Added Playwright docs E2E coverage that verifies the user-facing, self-hosting, and developer docs entry points stay distinct and reachable.
- Added the docs E2E suite to CI and release preflight gates so docs audience separation stays verified automatically.
- Added the app Playwright E2E suite to CI and release preflight gates for billing, MCP, provider, and publication workflows.
- Added Playwright app E2E coverage for browser registration, first-workspace onboarding, and login redirects.
- Added Playwright app E2E coverage for media-library upload and listing through the local-storage multipart fallback.
- Added Playwright app E2E coverage for composer scheduling through suggested posting slots.
- Added the backend OAuth account-selection foundation for page/channel providers, including encrypted pending selection storage and completion APIs used by Facebook and Instagram plus future YouTube adapters.
- Added a first TikTok adapter slice with OAuth, provider discovery, one-video direct publishing through public HTTPS media URLs, media validation, app UI connection wiring, and provider docs.
- Added a first Facebook Pages adapter slice with Meta OAuth, Page account selection, Page-token saving, text/single-media publishing through public HTTPS media URLs, provider discovery, and docs.
- Added a first Instagram Business adapter slice with Meta OAuth, account selection, image/Reel publishing through public HTTPS media URLs, provider discovery, app UI wiring, and docs.
- Added a first YouTube adapter slice with Google OAuth, channel selection, refresh-token support, private one-video uploads, media validation, provider discovery, app UI wiring, and docs.
- Added destination-scoped provider media-state tracking so publish retries reuse already uploaded provider media without caching expiring public media URLs.
- Added optional workspace-scoped API and MCP OAuth tokens so ChatGPT/App clients, MCP clients, and automation can be limited to a single workspace.
- Added workspace team invitations with copyable accept links, authenticated accept/revoke APIs, Settings team management, and team-member quota enforcement that counts active members plus pending invites.
- Added shared frontend provider-media capability rules with tested composer warnings, size-aware metadata hydration, and provider-limited video labels in the media library.
- Added optional deployment/provider context and a redacted last-100-line log tail to `openpost instance diagnostics` support snapshots.
- Added provider-specific troubleshooting docs and docs E2E coverage for OAuth, permission, media URL, and publishing failure paths.
- Added offset pagination metadata for background jobs, including Activity load-more UI, CLI `jobs list --offset`, backend regression tests, and Playwright coverage.
- Added offset pagination metadata for post lists, including CLI `post list --offset` and backend regression coverage.
- Added release artifacts for the `openpost-mcp` stdio proxy alongside the main `openpost` CLI, with both binaries stamped with the release tag version.
- Added file-backed env var support through `<VARIABLE>_FILE` for cloud secrets, provider JSON bootstrap config, legacy aliases, and deploy-managed secret files.
- Added `--with-mcp` support to the release installer so desktop MCP clients can install `openpost` and `openpost-mcp` together.

### Changed

- Migrated from openpost.rgo.pt to app.openpost.social (app), docs.openpost.social (docs), and openpost.social (landing page).
- Enabled registrations on hosted instance.
- Updated all doc links from op.rgo.pt to docs.openpost.social.
- Added marketing-site/ — minimal Astro landing page at openpost.social.
- Moved docs and marketing site deployment from VPS/GitHub Pages to Cloudflare Pages.
- Moved the JavaScript workspace to pnpm workspaces with Turborepo orchestration across the web app, docs site, and marketing site.
- Tightened cloud-mode CORS defaults so hosted deployments allow only `OPENPOST_APP_URL` plus explicit extra origins, while self-hosted installs keep local development and Capacitor defaults.
- Clarified developer and configuration docs so database, jobs, and media storage descriptions distinguish SQLite/local self-host defaults from Postgres/S3 cloud deployments.
- Added concise MCP server instructions during initialization and made the ChatGPT Apps widget render standard `ui/notifications/tool-input` events as well as tool results.
- Split settings-page static data and DTO types into a route-local module, reducing the Svelte page script and removing a mutable `Map` derived value from the posting-schedule grid.

### Fixed

- Made background-job workspace scoping, publish-job cancellation, MCP scheduling cleanup, stale processing-job recovery, and schedule overview date aggregation use database-portable expressions for Postgres-backed cloud deployments.
- Rejected MCP `schedule_post` and `schedule_draft` requests with provider/media combinations that cannot publish, including inherited draft media.
- Rejected scheduled posts and threads with provider/media combinations that cannot publish, while still allowing incomplete drafts to autosave.
- Hardened user-supplied remote URL fetches for dynamic Mastodon registration and MCP media uploads with shared private-address validation and guarded dial-time checks.
- Normalized embedded database migrations for Postgres so cloud deployments do not execute SQLite-only `BLOB`, `DATETIME`, or boolean predicates.
- Made the frontend instance connection check use the database-backed readiness probe instead of accepting liveness-only health responses.
- Return service-unavailable billing API errors for missing Polar server configuration instead of classifying operator setup problems as bad client requests.
- Enforced cloud-mode runtime validation so hosted deployments must boot with Postgres and S3-compatible media storage instead of local SQLite/filesystem defaults.
- Made app Playwright E2E runs start a freshly built Go server by default instead of silently reusing stale local servers.
- Removed duplicate Huma route registration from the Go binary startup path so app E2E runs and production boot no longer panic on repeated operation IDs.
- Wrapped the docs API reference OpenAPI renderer in client-only rendering so VitePress builds no longer emit a nonfatal SSR TypeError.
- Fixed release CLI cross-compilation by keeping `GOOS` and `GOARCH` out of `devenv` shell evaluation and applying them only to the Go build commands.

## [1.0.17] - 2026-06-27

## [1.0.16] - 2026-06-23

### Fixed

- Build release frontend assets once on Ubuntu and reuse them for server binary packaging, avoiding the macOS runner's post-build Node/libuv abort.

## [1.0.15] - 2026-06-23

### Fixed

- Run frontend unit tests from the devenv pre-push lint chain and trigger the Vitest pre-commit hook for frontend dependency/config changes.
- Pin `estree-walker` at the frontend root to the CommonJS-compatible version required by Rollup plugin utilities during the SvelteKit production build.

## [1.0.14] - 2026-06-23

### Fixed

- Pin `svelte-toolbelt` at the frontend root so `bits-ui` resolves the export required by the production build in CI.

## [1.0.13] - 2026-06-23

### Fixed

- Track the frontend Bun lockfile so CI and local hooks use the same formatter/build dependency graph.

## [1.0.12] - 2026-06-23

### Fixed

- Added the frontend production build to devenv-managed pre-commit and pre-push checks so Vite compiler failures are caught before release tags are pushed.
- Avoided optional-parameter syntax in the composer account loader to keep the Vite/PWA release build parser path happy.

## [1.0.11] - 2026-06-23

### Fixed

- Kept LinkedIn account icons clickable in the composer while moving the thread-reply warning to publish-time validation.

## [1.0.10] - 2026-06-17

### Added

- Scaffold for a new `cli/` Go module (`github.com/openpost/cli`) — a standalone HTTP client for a running OpenPost instance. Includes the config layer (XDG config dir, profile precedence, flag > env > file), the OS keyring token store with an explicit --insecure-storage fallback, a typed API client, a JSON/table output printer, an account-picker that resolves `--accounts x,x:@main,mastodon:server.example` to social_account IDs, a schedule parser that handles RFC3339 / absolute layouts / natural-language ("tomorrow 2pm", "in 3 hours", "next monday 9am") / `now` / `draft`, and Cobra-based `root` and `completion` commands. The CLI does not embed the server, does not open SQLite, and does not import `backend/internal/...`.
- First-class API tokens for the CLI and other long-lived automation clients. `api_tokens` table stores sha256-hashed opaque tokens with the format `op_cli_<8-hex-prefix>_<base64url-secret>`; the JWT web path is unchanged. New `Authenticator` interface and `CompositeService` (JWT → API token fallback) wrap the existing `*auth.Service`. Huma handlers now accept the interface; the Echo `JWTMiddleware` is preserved. `GET /api/v1/api-tokens`, `POST /api/v1/api-tokens`, and `DELETE /api/v1/api-tokens/{id}` let users manage tokens from web/CLI; the raw token is returned exactly once on create.
- `cli_auth_sessions` table for the device-flow authorization flow that will land in the next phase (RFC 8628-style). Both device code and user code are stored as sha256 hashes; only the plain user_code ever leaves the server. Migration 008 and 009 are idempotent and auto-applied on startup, matching the 007 pattern.
- CLI device-flow authorization endpoints under `/api/v1/cli/auth/`: `POST /start` (opens a session, returns device_code + user_code + verification_url, rate-limited per client IP), `POST /poll` (1 req/s minimum, slow-down + retry-after), `GET /session?user_code=…` (the web approval page), `POST /approve` (mints an `APIToken` via the existing apitokens service, raw token returned once), `POST /deny`. New `internal/services/cli_auth` package wraps the session lifecycle and `CleanupExpired`. The CLI never handles the user's password, TOTP, or passkey — the user approves in the web UI.
- `/cli/authorize` web page that gates on auth, fetches the pending session, and shows the client identity, requested scopes, and Approve/Deny buttons. Same-origin `?redirect=` support on `/login` so the page round-trips through login when needed. New shadcn-style `Badge` primitive used by the requested-scopes chips.
- CLI skeleton: `openpost auth login|status|logout`, `openpost auth token list|revoke`, `openpost instance add|list|use|remove`, `openpost workspace list|use|create`. Login flows through the device-flow endpoints (browser-open by default, `--device` for SSH/headless, `--with-token` for stdin paste, `--insecure-storage` to opt out of the OS keyring). Config lives in `~/.config/openpost/config.toml` (XDG-aware); tokens live in the OS keyring by default. `--json`, `--quiet`, `--yes`, `--no-color`, and shell completions for `bash`, `zsh`, `fish`, and `powershell` are wired in. The CLI does not embed the server, does not open SQLite, and does not import `backend/internal/...`.
- CLI account and media commands: `openpost account list|disconnect` and `openpost media upload|list`. The `--accounts` picker resolves platform aliases (`x`, `linkedin`, `x:@username`) and account IDs against the workspace's social accounts, with a friendly disambiguation hint when a platform has multiple accounts. Accountpicker has table-driven unit tests covering the empty / single / multiple-match paths.
- CLI posting commands: `openpost post create|list|view|update|delete` and `openpost thread create <file>`. `--schedule` accepts RFC3339, `now`, `draft`, or natural language (`tomorrow 2pm`, `in 3 hours`, `next monday 9am`) and resolves against the workspace's timezone with a friendly confirmation prompt for natural-language inputs. `--accounts` resolves platform aliases via the picker. `--media` accepts existing media IDs or local file paths (uploaded first). Thread files use front matter for metadata and `---` separators between posts; the splitter has table-driven tests for front-matter, embedded dashes, empty segments, and mixed CRLF/LF. `openpost jobs list` surfaces the server's job queue.
- Release artifacts and documentation for the CLI: GitHub releases now build `openpost-cli-*` binaries for Linux, macOS, and Windows alongside the unchanged `openpost-server-*` artifacts; `scripts/install-cli.sh` installs the latest release binary with `curl | sh`; and new CLI docs cover installation, authentication, posting, and automation.
- Generated CLI reference docs from the Cobra command tree. `scripts/sync-docs-openapi.mjs` now copies the Huma OpenAPI spec and regenerates `docs-site/reference/cli.md`, so command usage and flags stay in sync with the implementation.
- CLI social set management via `openpost set list|create|rename|default|add|remove|delete`. `post create`, `post update`, and `thread create` now accept `--set <name-or-id>`; `post create` and `thread create` fall back to the workspace default social set when neither `--accounts` nor `--set` is provided.
- CLI posting commands now accept `--schedule next-slot` (also `next slot` or `slot`) to schedule at the next available server-side posting slot. When a social set is selected or inherited as the default, the CLI passes that set to the next-slot lookup.
- Docs-site now has a full CLI section for installation, authentication, posting/social sets, automation, and command reference, plus a dedicated Android app installation/build page.
- Settings UI for CLI devices and API tokens, including token creation, one-time raw token display, token prefix/last-used metadata, and revocation. CLI device-flow approvals and manually-created automation tokens now share one visible management surface.
- Account slug management in the web Accounts page, backed by persisted `social_accounts.slug` values and a new `PATCH /api/v1/accounts/{account_id}` endpoint.
- Pre-commit hooks for the `cli/` Go module: `cli-gofmt`, `cli-golangci-lint`, and `cli-go-test` mirror the existing `backend/` hooks via the same `devenv`-generated `pre-commit-config.json` and run only for changes under `cli/`. The CLI's gofmt and golangci-lint were not previously gated at commit time; they are now.

### Changed

- Moved thread draft state out of `posts.content` (where it lived as a `__openpost_thread__:` JSON blob) into a dedicated `thread_drafts` table. The composer now sends the encoded draft as a typed `thread_draft` field on the create/update POST/PATCH and reads it back from the same field on get. The blob-in-content path is preserved as a fallback for data that was saved before the migration. Migration 007 is idempotent and runs automatically on startup.
- Replaced the `WHERE payload LIKE '%<uuid>%'` job-cancellation query in `posts.go` with a `type = 'publish_post' AND json_extract(payload, '$.post_id') = ?` match, so cancelling one post's jobs can no longer accidentally cancel other jobs (e.g. `media_cleanup`, `refresh_token`) whose payload happened to contain the post ID as a substring. Added a regression test in `posts_cancellation_test.go`.
- Made OAuth callback redirects absolute: the `Location` header on error and success paths now uses the configured `OPENPOST_APP_URL` as the base, so the redirect works correctly behind subpath reverse proxies and non-root mounts.
- Aligned the Go config's `*_REDIRECT_URI` defaults with `.env.example`: when an env var is unset the value is now derived from `OPENPOST_APP_URL` (with `urn:ietf:wg:oauth:2.0:oob` for Mastodon, matching the documented example).
- The Go binary now panics loudly at startup with a clear message if the embedded `index.html` is missing or empty. Previously a build that skipped the frontend step would silently serve a blank HTML page with HTTP 200.

### Removed

- Deleted the dead `frontend/messages/es.json` stub. Spanish was listed as a supported language in the docs and the ROADMAP, but the locale wasn't registered in Paraglide and the file only contained a single placeholder key. Both `frontend/README.md` and `ROADMAP.md` now reflect that Spanish is not yet shipped.
- Dropped `openpost account connect <platform>` from the CLI. Account connection is web-UI-only: provider credentials live on the server, the OAuth/Bluesky-app-password dance is server-side, and the CLI's only account-management surface is `list` and `disconnect`. The `account` cobra group has a `Long:` description pointing at `<instance>/accounts`, and `account list` against an empty workspace prints the URL to the web UI so the path stays discoverable. Unit tests cover the URL-construction and empty-state helpers.

### Fixed

- Fixed `GET /api/v1/posts` ordering so the Bun query builder treats `COALESCE(scheduled_at, created_at) DESC` as a SQL expression instead of parsing `created_at) DESC` as an invalid sort direction. This removes the `unsupported sort direction sort_dir="CREATED_AT) DESC"` backend log and preserves newest-first dashboard/post list ordering.
- CLI list/single-resource endpoints (`ListAccounts`, `ListMedia`, `ListPosts`, `ListJobs`, `GetWorkspaceSettings`, `CreatePost`, `GetPost`, `CreateAPIToken`) used to decode Huma responses into a `struct{ Body T }` envelope. Huma v2 flattens the `Body` field on the wire, so the decode failed with `cannot unmarshal array into Go value of type struct { Body … }` and the CLI silently lost media data on `media list` (decoding `null` into a nil slice, then rendering "no media uploaded"). All endpoints now decode the flat wire format directly. 8 new `httptest`-backed regression tests in `cli/internal/api/client_test.go` lock the format for the next refactor.
- Legacy Echo media routes (`/api/v1/media/upload`, `/api/v1/media/batch-upload`, `/api/v1/media/metadata`) only accepted JWT web sessions because they wired `middleware.JWTMiddleware(h.auth)`. CLI users got a 401 (`invalid or expired token`) on every upload. New `middleware.BearerMiddleware(Authenticator)` is the Echo-shaped counterpart of `AuthMiddleware` and accepts both JWT and `op_cli_…` tokens via the unified `CompositeService`. The three legacy routes now use it. The bare `"Bearer"` literal was lifted to a `bearerPrefix` const to satisfy `goconst` across all three middleware implementations. 4 new `httptest` tests in `backend/internal/api/middleware/auth_test.go` cover success, missing header, malformed header, and rejected-token paths.
- Fixed the account slug backend contract used by `openpost account rename`: social accounts now have migrated/backfilled slugs, list responses include `slug`, and duplicate active slugs are rejected per workspace.
- Fixed `POST /api/v1/sets` so the response includes the initial accounts supplied during creation, matching list/get/update responses and making CLI set summaries accurate.

### Changed

- Expanded the README launch messaging around the Typefully-like workflow, target users, support snapshot, and current limitations.
- Filled in the thin operator docs with a more complete quickstart, single-binary install guide, backup and restore process, provider support matrix, and stronger security guidance.

## [1.0.9] - 2026-05-16

### Fixed

- Corrected Bluesky video service auth to use the user's PDS DID from the access JWT audience instead of assuming `bsky.social`.
- Corrected LinkedIn video status polling to percent-encode video URNs as Rest.li path variables.

## [1.0.8] - 2026-05-16

### Changed

- Media library deletion now allows media that is unused or only attached to already published posts, while still blocking media needed by draft, scheduled, publishing, or failed posts.

### Added

- Added a media library download action for saved images and videos.

## [1.0.7] - 2026-05-16

### Fixed

- Corrected Bluesky video service auth to use the documented GET query endpoint, parse wrapped video job responses, and poll video jobs with the service token.
- Prevented LinkedIn video posts from sending image-only media overrides and waited for finalized videos to become available before creating the post.
- Allowed dropdown sub-menus to overflow the quick-settings menu surface so the language picker is not clipped in production builds.

## [1.0.6] - 2026-05-14

### Changed

- Clarified the README and docs to reflect the actual provider-by-provider video implementation state instead of treating video support as universally absent.

### Fixed

- Corrected the launch TODO and public docs after auditing the current X, Mastodon, Bluesky, LinkedIn, and Threads video code paths.
- Reduced repeated backend string literals called out by `golangci-lint` `goconst` checks so local Go linting passes again.
- Added a real Bluesky video embed path, MIME-aware Threads media publishing, and LinkedIn video upload finalization with required file sizes.
- Updated composer and social previews to render attached videos as videos and warn about provider-specific media limitations.

## [1.0.5] - 2026-05-10

### Changed

- Refactored composer preview rendering so desktop and mobile previews share the same derived Svelte state model.
- Extended account-specific post variants to track media attachments independently from the synced post media.

### Fixed

- Fixed stale composer preview and textarea sizing when switching between synced and account-specific social media variants.
- Prevented media that is only attached to account-specific variants from being deleted as unused media.

## [1.0.4] - 2026-05-09

### Added

- Documentation page explaining why to self-host OpenPost, plus clearer provider/platform limitations coverage.
- Capacitor app asset generation and refreshed Android launcher/splash assets derived from the project brand icon.
- PWA manifest configuration for the frontend build.

### Changed

- Refreshed launch messaging across the README and docs site around the self-hosted Buffer/Hootsuite positioning, target users, and current product limitations.
- Android release builds now use the consolidated `build:capacitor` flow so frontend build, Capacitor sync, and mobile asset generation stay in one path.
- Asset sync now prepares the frontend logo source used by Capacitor asset generation.

### Fixed

- Stopped tracking the repository root `TODO.md` while ignoring the local file, so personal launch notes can remain in the working directory without showing up in git.
- Corrected Bluesky token expiry handling by deriving expiry times from the JWT on login and refresh, which keeps automatic refresh jobs scheduled correctly instead of relying on a hardcoded login window or stale timestamps.

## [1.0.3] - 2026-05-04

### Fixed

- Restored authenticated media rendering in the frontend by allowing media image requests to authorize with the current JWT and updating UI image URLs to include that access token.

## [1.0.2] - 2026-05-04

### Fixed

- Restored Mastodon OAuth validation and callback state handling so missing `server_name` requests fail cleanly and browser redirects can complete without requiring the callback query to repeat the server selection.
- Corrected workspace-scoped job listing to apply visibility filtering before `limit`, so non-admin users get full pages of jobs from accessible workspaces.
- Signed Threads media URLs now target the app media endpoint by media ID instead of the underlying file basename.

## [1.0.1] - 2026-05-03

### Fixed

- Docker release builds now copy the repo `scripts/` directory so the frontend asset-sync step works in GitHub Actions and container releases complete successfully.

## [1.0.0] - 2026-05-03

### Added

- Account-level MFA with QR-based TOTP enrollment, passkey registration, and step-up login verification, plus settings UI for managing both methods.
- VitePress documentation site scaffold under `docs-site/`, including landing page, sidebar/navigation config, OpenPost-themed styling, and first-pass operator/contributor docs.
- Shared asset sync pipeline that copies canonical repo assets into frontend and docs public directories.
- GitHub Pages workflow for building and deploying the docs site.
- Token refresh job scheduling plus backend tests covering queued refresh execution and provider-specific refresh credentials.
- Dedicated account-connection success callback page for returning OAuth users to `/accounts`.
- Workspace migration scaffold for configurable draft gap minutes.
- Workspace setting for `draft_gap_minutes`, used by suggested queue times when a day's configured schedule slots are already occupied.

### Changed

- Settings now include account-security controls, while login can require a second factor when TOTP or passkeys are enabled.
- Optimized GitHub Actions CI by priming a shared Nix store cache before lint/test jobs, caching Go/lint/Bun dependencies, skipping unaffected backend/frontend jobs, and moving Go race tests off pull request runs.
- README reduced to a shorter front door that points detailed setup and operations content at the docs site.
- Docs site base-path handling now defaults to `/` for custom-domain hosting, with `OPENPOST_DOCS_BASE` available as an explicit override for repository-path deployments like `/openpost/`.
- README docs links now point at the custom docs domain `https://op.rgo.pt`.
- Docs now include a Nix module deployment page backed by a build-time sync of the production module from `rodrgds/nix-config`.
- Token refresh handling now declares platform capabilities explicitly, retries publish attempts on any supported expired account, and routes OAuth success redirects through the new callback screen.
- Workspace settings no longer auto-overwrite shared timezone and week-start values from the first browser locale that opens a workspace.
- Posting schedule settings now use a local-time weekly grid with per-day toggles and row-based time management instead of a flat UTC slot list.
- Suggested posting times now consider already scheduled posts and fall back to the configured minimum draft gap when a day has no unused schedule slots left.
- Weekly posting schedules now preserve the configured workspace-local time across DST changes instead of drifting by the current UTC offset.

### Fixed

- Mastodon accounts now persist their configured `instance_url` as the canonical provider key, avoiding publish/token-refresh mismatches after OAuth connection.
- The default Mastodon callback URI now matches the documented backend callback endpoint on `localhost:8080`.
- Mastodon server listings now avoid duplicate entries when adapters are registered with both UI labels and canonical instance-url keys.

## [0.4.4] - 2026-04-19

Changes since `v0.4.3`.

### Added

- X OAuth request store handler for temporary request-state persistence.
- Frontend OpenAPI snapshot and generated API TypeScript declarations tracked in-repo for CI consistency.
- Placeholder file in embedded web public directory to keep `go:embed` stable in clean checkouts.

### Changed

- X OAuth handler and platform integration flow refinements.
- Backend model and database updates supporting the latest auth/request-state behavior.
- Frontend pre-commit/devenv validation flow now runs deterministic generation/check steps for i18n and OpenAPI types.
- Frontend dashboard and media routes fixed strict TypeScript nullability errors found in CI.
- Frontend ignore/format rules adjusted to avoid generated-file drift during hooks.

## [0.4.3] - 2026-04-19

Changes since `v0.4.2`.

### Added

- Prompt management backend API (`/prompts`, `/prompts/random`, `/prompts/categories`, create/delete custom prompts).
- Built-in prompt catalog seeding and prompt category support.
- Posting schedule backend API (`/posting-schedules` list/create/update/delete).
- Prompt browsing UI at `/prompts` with category filtering, random prompt selection, and custom prompt creation.
- Compose flow integration for using prompts directly in new posts.
- Settings UI support for posting schedule slot management.

### Changed

- Post handler logic expanded for improved post management and scheduling workflows.
- Media handler behavior updated for media lifecycle and cleanup flow alignment.
- Authentication middleware updated for request auth handling refinements.
- Database/model layer updated with new scheduling and prompt entities.
- Queue worker updated to process scheduling-related jobs.
- Frontend layout refactors for improved page consistency (`PageContainer`, `EmptyState`, sidebar and dashboard updates).
- Favicon assets refreshed.

### Project And Docs

- Frontend page layout refactor and onboarding/UI refinements.
- Added AI agent skill definitions and repo agent guideline updates.
- Added/expanded roadmap and planning documentation updates.

### Commit Summary Since v0.4.2

- `681e3ab` refactor(frontend): unify page layouts with PageContainer and EmptyState components
- `bde9cc1` docs(agents): add conventional commits and branches requirement
- `a6f60ee` feat(frontend): add onboarding page and UI refinements
- `a53ef22` feat(agents): add AI agent skill definitions
- `7289963` feat: implement Phase 3 - Media Management & Cleanup
- `87a1901` feat: implement Phase 2 - Platform Customization & Social Media Sets
- `80c302c` feat: enhance post management features
- `cb8a110` feat: add comprehensive roadmap for OpenPost features and priorities
