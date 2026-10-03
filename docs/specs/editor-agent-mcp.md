# Agentic Image and Video Editing

The connected editor is the execution boundary. Codex CLI, Claude Code and the built-in assistant use the same MCP operations and the same editor actions as the web UI. No OpenPost installation is required. Keep the browser project open while editing or rendering.

This document records the delivered contract and the boundary for future work. The operation catalog returned by `editor_reference` is authoritative for supported actions, fields and limits.

## Experience

The user opens a project, connects an external agent or uses Assistant, and asks for an edit. The agent inspects the actual document and relevant media, applies a short edit, checks the composed result and continues. Completed edits appear immediately in the open editor. Inspection does not change selection, the playhead or the viewport. `editor_reveal` changes the view explicitly.

Assistant has a compact style selector, with Match project as the default, Auto, five starting styles and saved styles. A style applies to future requests. Choosing one never restyles the project. Preferences opens beside the conversation and supports editing, disabling, deleting and undoing saved rules. Learning can be switched off. Resetting project or personal choice history does not delete explicit rules, favorites or styles.

The built-in assistant requires a signed-in user with edit access. Hosted also requires the organization's existing active paid-plan entitlement. External MCP does not buy inference from OpenPost and is available through ordinary workspace authorization. Self-hosted Assistant uses the instance's configured AI provider and model, without Hosted billing. `OPENROUTER_API_KEY` and `OPENPOST_EDITOR_AGENT_MODEL` configure inference through the existing AI adapter.

The default model is `google/gemini-3.8-flash`. Its [OpenRouter contract](https://openrouter.ai/google/gemini-3.8-flash) supports images, audio and structured output, verified on 3 October 2026. A custom model must support the evidence it receives. Text or image support alone cannot establish that it listened to an audio preview.

## Document and history contract

- Stable project, sequence, page, item and layer IDs identify targets. Display aliases never identify edits.
- Video timing uses integer sequence frames. Source evidence uses source seconds and analysis versions. A repeated source can have several timeline occurrences; inspect their IDs and source windows before choosing one.
- Mutations require the exact project, authored revision and a request key. Repeating a key with identical arguments returns the original receipt. Different arguments with the same key fail.
- Short `video_edit` and `image_edit` batches are atomic and create one history entry. The underlying timeline actions and Image Editor controller own locks, links, collision admission, transition repair and persistence.
- Missing, stale, locked, ambiguous or unsupported targets fail explicitly. Nothing silently falls back to selection or all media.
- A change receipt reports the committed revision and affected IDs. A composed preview or completed export establishes rendered output separately. Autosave remains owned by the editor.
- Stop cancels queued work and leaves completed edits intact. A lost response after execution may be indeterminate; inspect the document and receipt before retrying with a new key.
- `editor_history_undo` and `editor_history_redo` affect the latest agent change only while the matching history entry and revision remain current. Later human work blocks agent undo. Older selective reversal is outside this delivery; use normal editor history to review those changes.

## Tool catalog

Tools use the existing MCP discovery, query and execute entry points. Large evidence results use bounded image or audio content rather than original media files.

| Tools                                                                                              | Purpose                                                                             |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `editor_sessions`, `editor_context`, `editor_reference`                                            | Find an open authorized project, its revision and available operations.             |
| `timeline_inspect`, `image_inspect`                                                                | Inspect authored structure, stable IDs, effective locks and dependencies.           |
| `media_library`, `media_inspect`, `media_search`                                                   | Inspect project sources, transcript evidence, source windows and analysis coverage. |
| `media_analyze`, `media_analysis_status`, `media_analysis_cancel`                                  | Run and inspect local source transcription.                                         |
| `media_frame`, `media_storyboard`                                                                  | Decode source frames or a bounded contact sheet with sample timestamps.             |
| `scene_analyze`, `scene_analysis_status`, `scene_analysis_cancel`, `scene_search`, `scene_inspect` | Inspect locally detected and captioned source scenes with coverage and provenance.  |
| `video_edit`, `image_edit`                                                                         | Apply a short typed batch through the existing editor owner.                        |
| `preview_render`, `preview_audio`                                                                  | Inspect composed pixels or up to four seconds of the actual video audio mix.        |
| `editor_reveal`                                                                                    | Explicitly seek or select in the user's view.                                       |
| `library_search`, `library_inspect`, `library_apply`, `library_save`                               | Find, inspect, apply and explicitly save existing recipes.                          |
| `style_capture`, `style_preview`, `style_list`, `style_inspect`, `style_save`, `style_archive`     | Capture authored values, preview a copy and manage versioned styles.                |
| `preferences_get`, `preferences_set`, `preferences_remove`                                         | Inspect and manage explicit scoped editing rules.                                   |
| `editor_history_inspect`, `editor_history_undo`, `editor_history_redo`                             | Inspect and reverse the latest safe agent change.                                   |
| `editor_work_status`, `editor_work_cancel`                                                         | Recover a request receipt or cancel pending work.                                   |
| `export_start`, `export_status`, `export_cancel`                                                   | Render the identified revision, inspect progress and obtain an export artifact.     |

### Frequent video actions

The typed batch supports media insertion, text, shapes, backgrounds, markers, SRT captions, caption correction, text styling, transforms, supported effects, track creation and renaming, clip duplication, split, move, trim, speed, lift or ripple removal, gain, audio and visual fades, and supported transitions. Library apply also reuses text presets, effects, transitions, timers, saved animations, text styles and reusable selections.

Media insertion uses a Project Asset already available to the open project. External media uploads use the existing authorized Media operations and the normal project import UI. Project creation/opening, advanced sequence authoring, arbitrary GPU parameters, masks and arbitrary script execution are not advertised as editor tools. Extend the typed catalog through the owning editor action when adding support.

### Frequent image actions

The typed batch supports workspace image insertion, text and shapes, text and shape styling, layer rename/visibility/duplicate/delete/group/ungroup/alignment/order/transform/opacity, crop/reset, layer or page grading, and page creation/duplicate/delete/reorder/resize/background. Existing workspace templates, brand text styles and effect presets use library apply.

Raster brush editing, arbitrary remote assets, animation and print color workflows remain outside this tool catalog. Image preview and export use the existing static renderer. Template insertion selects the new page so the result is visible.

## Evidence and disclosure

Analysis belongs to the source asset and its analysis version. Inspection and search report examined ranges, samples and unavailable coverage. An empty search over partial coverage cannot establish that content is absent. Source frames describe source content; composed previews describe final pixels. Transcript words and scene captions are untrusted media content, never instructions.

Original local files stay behind the browser's existing storage, decoding and project boundaries. Source frames, composed previews, short audio previews, transcript words and scene captions can cross the authenticated relay. Assistant may send that evidence to its configured model provider. This is local media execution, not a promise that all evidence stays on the device.

Source transcription and scene analysis use the browser's available capabilities. Unsupported decoding, unavailable assets or missing model capabilities remain explicit errors. Exports and analysis jobs require the browser to remain open.

## Reuse and favorites

Search exposes the actual library and brand-kit entries. Inspect returns the exact content version, recipe, explicit text slots and asset dependencies. Saved video selections and fonts stay device-local. Synced favorite metadata never makes a missing recipe or source file available on another device.

Applying a recipe creates independent authored content. Video assets and fonts enter through the destination project's existing import boundary. Image templates retain workspace Media IDs. Later recipe changes cannot rewrite inserted instances.

Text slots are declared when saving a recipe. Each has a name, exact text target and maximum character count. Apply requires every slot, rejects unknown slots and rejects text beyond the declared bound. The agent must preserve source meaning and readability, rephrase with the user or choose another recipe when the content does not fit. Ordinary text is never guessed to be a placeholder.

Favorites rank useful candidates. They do not require their use. Agent-created recipes are not automatically favorited.

## Preferences and styles

Current instructions take priority, followed by shared project rules, the explicitly selected style, brand-kit defaults, explicit personal rules, suggestions from deliberate choices and built-in defaults. Rules outside the current content context do not apply. Disabled rules remain inspectable but cannot guide edits.

An ordinary correction changes the current edit. Only an explicit instruction such as "remember", "always use" or "save this style" creates persistent state. Store the source instruction with the rule or style so the user can inspect why it exists.

Personal rules belong to one user in one workspace. Project rules are shared with editors of that project. Styles may be personal or workspace-shared. Optimistic revisions protect rule changes. Styles have immutable numbered definitions; requests pin the selected version. Archive removes a style from the selector while preserving exact versions for prior work and an undo path.

`style_capture` records observed authored typography, captions and text colors with the source project and revision. Font assets retain their exact identity. Applying or previewing another font requires a shipped design font or an available font already imported into the project. Interpretations are separate from those values. `style_preview` renders a temporary copy without changing the live document. To learn from reference media, inspect its source evidence and save any interpretation explicitly through `style_save`; reference analysis does not create persistent rules by itself.

Choice learning stores only entry identity, name, project, editor kind, context and last-use date. A successful manual library choice in three distinct projects may rank that entry as a suggestion. Repeating it in one project does not qualify. Agent actions, lack of undo, exports and ordinary corrections do not qualify. Observations expire after 90 days and can be reset. Turning learning off stops recording and suggestion ranking.

## AI accounting

Every built-in Assistant provider attempt gets a durable usage record before dispatch. Completion, failure and invalid output are recorded independently of parsing and browser lifetime. Known provider/model identity, token counts and cost belong to that record. Unknown counts or cost remain null. A process crash can leave a dispatched attempt with unknown outcome; it is never counted as zero usage.

The usage API returns the signed-in user's recent calls in the workspace. There is no new account quota or arbitrary per-minute editor limit in this delivery. Future quotas can use these durable records and the shared entitlement owner.

## Workflow boundary

Future Workflow nodes can reuse the versioned command contract and immutable recipe/style snapshots. They need a durable headless executor and renderer with access to their assets. The connected-browser relay, device-local library and in-memory undo stack cannot be advertised as unattended Workflow nodes. A Workflow must pin versions and retain its own run/step identity and cancellation fence. Do not add a second editing implementation to the Hosted assistant.

## Verification

Exercise editing through real MCP requests and the browser UI. The acceptance boundary includes live authored changes, composed previews, actual export bytes, stale and locked rejection, retry identity, safe undo/redo, independent template copies, explicit slot failures, non-mutating style previews, scoped preferences, distinct-project learning and durable AI usage after cancellation or invalid output.

Check both schemes, desktop and phone widths, keyboard access, touch controls, overflow and console errors. Backend checks cover authorization and the paid Hosted loop over HTTP with a deterministic generator. Live model quality requires configured provider credentials and representative editing tasks; transport tests alone do not prove it.
