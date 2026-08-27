### Added

- PNG, JPEG, and WebP image-sequence export for full project, in/out range, and marker batches with exact frame counts, deterministic zero-padded names, and preserved FPS, dimensions, and effects.
- Alpha behavior: PNG and WebP preserve transparent backgrounds; JPEG flattens to the project background. WebP has explicit capability detection with honest fallback/error copy and no silent conversion.
- Bounded directory output via File System Access and ZIP fallback, with streaming/batched worker artifacts and accurate progress, cancellation, and cleanup.
- Worker and main-thread ownership with queue support for image sequences.
