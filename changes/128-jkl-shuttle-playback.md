### Added

- FreeCut 4d62e80 J/K/L shuttle parity across program and source monitors with editable `SHUTTLE_FORWARD` (`l`), `SHUTTLE_REVERSE` (`j`), and `SHUTTLE_PAUSE` (`k`) commands, saved remaps, repeat suppression, editable-field guards, and localized labels in all ten editor locales.

### Changed

- Extended `Clock` to support signed transport rates with FreeCut-accurate ceil/floor framing, precise `[start, end)` range boundaries, forward and reverse looping, pause-and-restore range semantics, one animation-frame loop across wraps, and a hard stop at timeline zero. Successive J/L presses advance `1x`/`2x`/`4x` and direction changes reset to `1x`; negative `playbackRate` never reaches `HTMLMediaElement.playbackRate`.
- Program preview now shows real reverse frame progression via the Clock frame queue and schedules short decoded reverse-audio grains through the existing track, clip, fade, and master gain paths. Media elements stay paused and are driven by drift-checked seeks; the stacked compositor and prewarm paths remain unchanged.
- Source Monitor now owns hover and focus routing, uses native positive `playbackRate` where browser audio stays safe, and falls back to exact frame-by-frame `requestAnimationFrame` seeking plus reverse-audio grains for reverse shuttle with correct `in`/`out` clamping. `K` pauses only the active monitor and leaves the other transport untouched.
- Added a compact localized shuttle indicator (`J`/`L` with direction arrow and speed) for transient shuttle mode, including the first `1x` press, with subtle styling at `1x` and highlighted styling at `2x`/`4x`. Normal play and every explicit pause reset the transport to `1x` normal mode.

### Fixed

- Verified cleanup and unmount paths clear shuttle timers, animation frames, and Clock listeners, and that rapid direction changes and repeated presses do not create duplicate rAF loops or stacked renders.

### Tests

- Added deterministic Clock tests for negative-rate ceil semantics, range start/end boundaries, single-loop scheduling, zero clamping, successive J/L speeds and direction changes, and throttled `timeupdate`; exact reverse-audio sample, rate, envelope, cleanup, and boundary tests; shortcut and ownership tests; and Chromium coverage for the localized shuttle indicator and its 320px fit.
