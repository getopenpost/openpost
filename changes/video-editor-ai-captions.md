### Added

- Video Editor now has a first-class persisted `ai-captions` caption source distinct from `transcript`, `subtitle-import`, and `embedded-subtitles`. Local scene analysis output (LFM vision model via the existing `sceneCaptionProvider` / `analyzeSceneContent` stack, no new model layer) can create an editable subtitle layer without replacing transcript captions; the layer is previewed and burned/embedded/sidecar exported through the shared subtitle pipeline, is correctable in the transcript panel, undoes atomically, and repeats by replacing only its own previous `ai-captions` item while leaving transcript captions untouched.
- The timeline tools panel now exposes direct AI caption entry with progress, cancel, and error states using shared media-tasks and shared UI primitives, with responsive, accessible controls and per-clip coexistence and split handling.

### Fixed

- Splitting a clip that owns transcript or AI captions now slices both caption types alongside their source, keeping cues aligned.
