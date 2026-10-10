### Fixed

- Video transitions and image or video color scopes fall back to CPU rendering when a graphics driver exposes WebGPU but cannot upload canvas images. Transitions also verify rendered pixels before enabling acceleration and recover from a lost GPU device, preventing blank output.
