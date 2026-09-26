# Fixed

- Announced the source audio waveform slider position as formatted time (for example `0:50.0`, or `1:02:05.5` past an hour) through `aria-valuetext`, instead of exposing only raw seconds to assistive technology. The text comes from a new `formatSourceWaveformTime` helper beside the existing waveform seek math and updates as the playhead moves.
