### Added

- Rasterize a layer or group, merge adjacent layers, or flatten a page into an image with one undo step. These commands bake the pixels inside the page and keep source media unchanged.
- Prevent merges that would change backdrop-dependent blending, and reject completed renders when the design has changed.

### Changed

- Keep only the newest pending thumbnail render for each preview, without interrupting running work or mixing different preview instances.
