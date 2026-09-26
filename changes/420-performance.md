### Changed

- Image Editor exports package pages and project media without blocking the editor on large ZIP compression or recompressing encoded images and video.
- Image Editor selection moves, paint erasing, and selected-layer color sampling use the affected pixels instead of scanning or reading the full canvas.

### Fixed

- Guest Image Editor releases local media URLs when their last open view closes, while keeping images available across overlapping views.
