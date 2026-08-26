---
issue: 128
type: fixed
area: video-editor
---

Keyframe value graph now matches FreeCut 4d62e80: frame, value, and neighbor snapping with live guides that honor the shared snap setting and Ctrl/Cmd bypass; per-segment easing for the outgoing key (linear, hold, ease-in/out/in-out, cubic-bezier with 8 presets, spring with tension/friction/mass) with live curve preview, one undo per gesture, and Escape/pointercancel restore via captured originals; direct bezier handle editing without implicit neighbor rewriting; atomic setKeyframeEasings keeping ids/values/easings/easingConfigs aligned and single-undo; keyboard via the command catalog (select-all, clear-selection, delete, base/fast nudge) and Escape cancelling active drag before clearing selection; compact responsive header and bounded segment pills that stay readable with dense keyframes and at 320px; fully localized segment, snap, and spring strings in all 10 locales; and Chromium interaction coverage for drag/snap/undo, snap enable/disable/bypass, segment menu persistence, spring atomicity/cancel, base/fast shortcuts, Escape, dense graph, keyboard focus, and 320px layout.
