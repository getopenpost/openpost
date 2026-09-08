### Fixed

- Fixed Video Editor cloud saves failing on reactive project state, screen recordings rejected for missing WebM duration metadata, and anonymous camera or microphone choices crashing the recorder.
- Browser Stop sharing now imports the finished recording. Failed imports remain recoverable, and a late upload cannot insert clips into a different project.
- Kept canvas text entry local until commit, preserved spaces while typing, corrected zoom and volume icons, and made project metadata and recording setup fit narrow screens.
- Kept cloud exports and render queues in browser storage, separate from local workspace folders. Cloud save status now names OpenPost.
- Preserved public Svelte error codes in telemetry while continuing to redact URL parameters.
