---
issue: 128
type: added
scope: video-editor
---

Timeline clips now expose direct audio and video fade controls with FreeCut 4d62e80 behavior.

- Video and composition clips draw their fade envelope over the clip. Audio clips draw their shaped gain envelope and expose curve and bias controls for each end.
- Fade-in and fade-out stay independent. Either fade may span the full clip, and overlapping fades use the same preview and export math instead of forcing their durations to fit side by side.
- Pointer edits preview live and create one undo entry on release. Escape, pointer cancellation, lost capture, track locking, tool changes, and unmount restore only the fields owned by the active gesture.
- Duration and curve controls support keyboard edits, localized values, double-click reset, visible focus, disabled lock state, and 44 px targets. Density rules keep handles out of clips that are too short to edit safely.
- Focused geometry tests and real Chromium tests cover pointer ownership, live paths, overlapping fades, undo, every cancellation path, keyboard controls, locked tracks, linked clips, and 320 px layout.
