### Fixed

- Keep the Image Editor stable when merging or flattening animated layers.
- Preserve source text and selected mentions when editing or resetting joined video captions.
- Update Go HTML and JOSE dependencies to address reported security vulnerabilities.
- Include required model assets in public-site CI checks and isolate the file-watcher regression probe from dependency scanning.
- Retain hidden discovery files when reusing public-site CI artifacts, and update the patched query-string dependency. Keep the unpatched deepmerge advisory confined to the reviewed development graph, with checks against dependency drift and runtime imports.
- Prebundle GIF encoding before component tests so dependency discovery cannot reload an active test runner.
- Isolate route tests from media component tests in bounded browser sessions.
