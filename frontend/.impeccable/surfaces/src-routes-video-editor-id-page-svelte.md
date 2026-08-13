---
version: 1
slug: 'src-routes-video-editor-id-page-svelte'
primary_target: 'src/routes/video-editor/[id]/+page.svelte'
related_targets: ['src/lib/video-editor/components/timeline.svelte']
---

# Video Editor Full Editor

- Scope and mode: `src/routes/video-editor/[id]/+page.svelte`; Operate surface for focused timeline editing. Quick Cut remains the separate no-transcode workflow.
- Audience and job: creators importing local media, composing a multi-track edit, adjusting the current selection, and exporting without learning OpenPost-specific layout conventions.
- Primary task and proof: select or seek directly in the timeline, work on the dominant preview, expose only the selected object's relevant properties, and keep Export persistently visible.
- Constraints: Svelte 5 and shared controls; static adapter; keyboard and coarse-pointer access; one contextual sheet on phones; functional 320px layout; preserve local autosave, revisions, cloud sync, export behavior, and distinct visual, audio, and caption tracks.
- Direction: a CapCut-fluent four-zone warm-black workspace with seven grouped creation families, a central canvas, horizontal inspector tabs, and a full-width expandable timeline. The ordered primary sequence and global markers stay semantic rails while real visual, audio, and caption tracks render as dynamic rows. Orange is limited to action, selection, and the playhead.
- Memorable moment: the timeline ruler is visibly the transport—clicking, dragging, or using arrow keys moves the orange playhead across every track without a duplicate progress slider.
- Unresolved: richer media thumbnails and a dedicated effects browser can extend the left asset panel later without changing the spatial model.
