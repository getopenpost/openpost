---
version: 1
slug: 'src-routes-video-editor-page-svelte'
primary_target: 'src/routes/video-editor/+page.svelte'
related_targets:
  ['src/routes/video-editor/new/+page.svelte', 'src/routes/video-editor/[id]/+page.svelte']
---

# OpenPost Video Editor

- Scope and mode: Operate surface spanning `/video-editor`, `/video-editor/new`, and `/video-editor/[id]`; public local-first workbench with optional signed-in cloud handoff.
- Audience and job: Social creators need to import or record short footage, make one clear edit, adapt it to four social formats, export locally, and choose when any file reaches OpenPost.
- Primary action and proof: Start a local project. A visible autosave state, recoverable local sources, shared timing across variants, and incremental export prove the privacy and reliability claims.
- Direction: A focused dark pasteboard framed by compact OpenPost controls. One primary sequence leads; contextual tools stay shallow. Orange marks selection or the next action, never decoration.
- Responsive model: Desktop uses the four-zone workbench. Phones retain the same project and export model through a compact touch timeline, a bottom tool dock, and contextual bottom sheets; controls must remain reachable at 320 px without hover.
- Constraints: Current Chrome or Edge must provide WebCodecs, origin-private file storage, and WebGL2. No hidden uploads, watermark, server render, AI download before consent, hover-only action, untranslated copy, silent stream loss, or full-output memory buffer.
