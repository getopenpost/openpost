---
version: 1
slug: 'src-routes-video-studio-page-svelte'
primary_target: 'src/routes/video-studio/+page.svelte'
related_targets:
  ['src/routes/video-studio/new/+page.svelte', 'src/routes/video-studio/[id]/+page.svelte']
---

# OpenPost Video Studio

- Scope and mode: Operate surface spanning `/video-studio`, `/video-studio/new`, and `/video-studio/[id]`; public local-first workbench with optional signed-in cloud handoff.
- Audience and job: Social creators need to import or record short footage, make one clear edit, adapt it to four social formats, export locally, and choose when any file reaches OpenPost.
- Primary action and proof: Start a local project. A visible autosave state, recoverable local sources, shared timing across variants, and incremental export prove the privacy and reliability claims.
- Direction: A focused dark pasteboard framed by compact OpenPost controls. One primary sequence leads; contextual tools stay shallow. Orange marks selection or the next action, never decoration.
- Constraints: Desktop Chromium owns full editing. Mobile offers project preview and composer handoff. No hidden uploads, watermark, server render, AI download before consent, hover-only action, untranslated copy, or full-output memory buffer.
