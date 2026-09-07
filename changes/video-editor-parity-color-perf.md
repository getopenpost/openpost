# Video editor color-scope parity (color-perf)

- Scope capture now uses FreeCut's cadence: 256x144 samples at ~15fps while
  playing, 384x216 samples every 220ms while paused.
- Scope dock renders CPU scopes at most every 220ms (scrub storms coalesce to
  the latest sample) and falls back to CPU scopes if WebGPU setup wedges past
  one second instead of leaving the dock blank.
- CPU scope path documents the full/legal range contract (`normalizeScopeValue`,
  default full-range BT.709 matching FreeCut); the IRE 0-100 grid was already
  at parity.
- User effect presets and grade presets stay browser-wide in localStorage
  (shared across every project/workspace on the device) — documented as
  intentional in both preset modules rather than migrating to FreeCut's
  workspace-file pattern.
