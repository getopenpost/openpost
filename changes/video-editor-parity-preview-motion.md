# Video editor transition prearm + reverse planner + perf diagnostics (preview-motion)

- Paused transition hold: while paused inside a transition window, participant
  lanes keep their transition-relative decoded frame (0.001s settle epsilon,
  ramp-owned dataset flags) instead of cold-seeking on every scrub tick —
  matching FreeCut's paused-lane prearm behavior.
- Fast reverse (>1x) uses FreeCut's 20-sample decode-window plan
  (stride = rate*fps/60, 60% refill rule): the clock skips intermediate
  authored frames and the lane holds its last decode, with skips counted in
  diagnostics.
- Diagnostics gain render-source, transition session (count on rising edge),
  and reverse-skip counters in the panel, the copyable report, and a new
  Alt+Shift+P performance-overlay toggle.
