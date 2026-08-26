---
issue: 128
type: fixed
area: video-editor
---

Keyframe value graph now matches FreeCut 4d62e80: frame, value, and neighbor snapping with live guides that honor the shared snap setting and Ctrl/Cmd bypass; per-segment easing for the outgoing key (linear, hold, ease-in/out/in-out, cubic-bezier with 8 presets, spring with tension/friction/mass) with live curve preview, one undo per gesture, and Escape/pointercancel restore via captured originals; direct Bezier handle editing with linked adjacent tangents committed in one undo; atomic setKeyframeEasings keeping ids/values/easings/easingConfigs aligned; keyboard commands for selection, deletion, and base or fast nudging; Escape cancelling an active drag before clearing selection; a compact responsive header; direct pointer and keyboard access to every segment even when dense labels collapse; fully localized segment, snap, and spring strings in all 10 locales; and Chromium interaction coverage for drag, snap, undo, segment menus, spring edits, shortcuts, dense graphs, keyboard focus, and the open menu at 320px.
