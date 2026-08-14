# Third-Party Notices

This page is for operators and contributors reviewing vendored browser assets and their licences.

OpenPost Image Editor uses these pinned runtime dependencies:

- **Fabric.js 7.4.0** for interactive canvas objects, transforms, filters, and offscreen rendering. OpenPost persists its own versioned document schema rather than Fabric JSON.
- **IMG.LY Background Removal 1.7.0** for local background removal.
- **ONNX Runtime Web 1.21.0** for WebGPU and CPU inference.
- **fflate 0.8.2** for multi-page ZIP downloads.

The quantized background-removal model, WASM files, and their notices ship under `frontend/static/image-editor-models/`. `ThirdPartyLicenses.json`, the model license, content-addressed resource filenames, and the source URL used for the pinned artifact are kept beside the files. Operators that set `OPENPOST_IMAGE_EDITOR_MODEL_BASE_URL` must serve the matching release assets and preserve their notices.

OpenPost Video Editor uses:

- **Mediabunny 1.51.x** for media inspection, bounded sample access, demuxing, and streaming MP4/WebM muxing.
- **Transformers.js 3.8.1** and **ONNX Runtime Web 1.21.0** for local worker-based analysis.
- **Whisper Tiny multilingual**, pinned to the exact model commit listed in `frontend/static/video-editor-models/THIRD_PARTY_LICENSES.md`, for local transcription under Apache License 2.0.
- **Silero VAD 6.2** for local voice-activity detection under the MIT License.

The model files, hashes, source revisions, and notices ship under `frontend/static/video-editor-models/`. Operators that set `OPENPOST_VIDEO_MODEL_BASE_URL` must serve the matching content and keep those notices. The checked-in mastered audio assets and machine-readable hashes under `frontend/static/video-editor-audio/` are dedicated under CC0 1.0 as stated beside the files.

OpenPost does not include or import code, styles, utilities, or components from the commercial shadcn Designer package.
