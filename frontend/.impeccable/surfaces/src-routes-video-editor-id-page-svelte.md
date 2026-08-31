---
version: 1
slug: 'src-routes-video-editor-id-page-svelte'
primary_target: 'src/routes/video-editor/[id]/+page.svelte'
related_targets:
  [
    'src/lib/video-editor/components/timeline-panel.svelte',
    'src/lib/video-editor/components/color-grading-dock.svelte',
    'src/lib/video-editor/components/color-mini-timeline.svelte',
    'src/lib/video-editor/components/motion-workspace-panel.svelte'
  ]
---

# Video Editor full editor

- Scope and mode: `src/routes/video-editor/[id]/+page.svelte`; Operate surface for focused multi-track editing. Quick Cut remains the separate no-transcode workflow.
- Audience and job: creators importing local media, assembling visual, audio, and caption tracks, grading and animating the result, then exporting without learning OpenPost-specific layout conventions.
- Primary task and proof: seek and select directly in the timeline, keep the program monitor dominant, expose task-specific controls, preserve project state when switching workspaces, and keep Export visible.
- Constraints: Svelte 5 and shared controls; static adapter; local-first media; keyboard and coarse-pointer access; functional 320px layout; preserve autosave, revisions, cloud sync, preview truth, export truth, and distinct media tracks.
- Direction: a FreeCut-fluent warm-black editor with dedicated Edit, Color, and Motion workspaces. Color removes the default sidebars and timeline, then uses program plus scopes, a source-start filmstrip with live GPU grading, and a 10:3:7 grading, effects, and keyframes dock. Motion keeps shared project context while replacing the timeline with layer and keyframe controls. Orange is limited to action, selection, and the playhead.
- Memorable moment: Color follows the playhead to the best visible gradeable clip while its actual graded source frame, scopes, wheels, curves, effects, and keyframes stay in one scan path.
- Current status: FreeCut's scrubbable master and RGB wheel fields are implemented with live preview, one commit per gesture, Shift precision, keyboard editing, and wheel-channel round trips. The source-level Edit, Color, Motion, and Quick Cut audits have no known applicable parity gaps; new gaps must cite a concrete reference behavior and an observable OpenPost failure.
