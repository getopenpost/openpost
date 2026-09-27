### Changed

- Reduce repeated GPU texture uploads when video and image edits use multiple Curves, LUT, gradient-map, or ASCII effects. Keep texture reuse bounded by count and memory.
- Reuse color-effect buffers during preview and export to reduce per-frame allocations.

### Fixed

- Refresh an imported LUT when its dimensions change, so stale colors cannot survive a dimension mismatch.
