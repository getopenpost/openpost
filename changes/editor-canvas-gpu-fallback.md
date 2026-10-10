### Fixed

- Video transitions and image or video color scopes fall back to CPU rendering when a graphics driver exposes WebGPU but cannot upload canvas images. Transitions also verify rendered pixels before enabling acceleration and recover from a lost GPU device, preventing blank output.
- Grid scopes keep drawing when graphics acceleration starts or falls back to CPU, including when the first image sample arrives after initialization.
- Disposed effect renderers release their native graphics contexts so repeated editing sessions cannot exhaust the browser's context limit and interrupt an active preview.
