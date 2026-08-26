### Added

- FreeCut 4d62e80 J/K/L shuttle parity across program and source monitors with editable `SHUTTLE_FORWARD` (`l`), `SHUTTLE_REVERSE` (`j`), and `SHUTTLE_PAUSE` (`k`) commands, saved remaps, repeat suppression, editable-field guards, and localized labels in all ten editor locales.

### Changed

- Extended `Clock` to support signed transport rates with FreeCut-accurate ceil/floor framing, precise `[start, end)` range boundaries, forward and reverse looping, pause-and-restore range semantics, and negative-rate audio muting. Successive J/L presses advance `1x`/`2x`/`4x` and direction changes reset to `1x`; negative `playbackRate` never reaches `HTMLMediaElement.playbackRate`.
- Program preview now shows real reverse frame progression via the Clock frame queue and muted preview audio, preserving clip-speed sync while reverse. Media elements stay paused and are driven by drift-checked seeks; the stacked compositor and prewarm paths remain unchanged.
- Source Monitor now owns hover and focus routing, uses native positive `playbackRate` where browser audio stays safe, and falls back to exact frame-by-frame `requestAnimationFrame` seeking for reverse shuttle with correct `in`/`out` clamping. `K` pauses only the active monitor and leaves the other transport untouched.
- Added a compact localized shuttle indicator (`J`/`L` with direction arrow and speed) that appears only when useful (`playing` and (`rate < 0` or `|rate| > 1`)), with subtle styling at `1x` reverse and highlighted styling at `2x`/`4x`.

### Fixed

- Verified cleanup and unmount paths clear shuttle timers, animation frames, and Clock listeners, and that rapid direction changes and repeated presses do not create duplicate rAF loops or stacked renders.

### Tests

- Added deterministic Clock tests for negative-rate ceil semantics, range start/end boundaries, reverse looping, successive J/L speeds and direction changes, throttled `timeupdate`, and duplicate-loop guards; shuttle helper tests; and JKL integration tests covering key routing, repeat suppression, remaps, editable-field guards, source vs program ownership, reverse frames, and 320px indicator fit.
