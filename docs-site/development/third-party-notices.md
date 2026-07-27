# Third-Party Notices

OpenPost Studio uses these pinned runtime dependencies:

- **Fabric.js 7.4.0** for interactive canvas objects, transforms, filters, and offscreen rendering. OpenPost persists its own versioned document schema rather than Fabric JSON.
- **IMG.LY Background Removal 1.7.0** for local background removal.
- **ONNX Runtime Web 1.21.0** for WebGPU and CPU inference.
- **fflate 0.8.2** for multi-page ZIP downloads.

The quantized background-removal model, WASM files, and their notices ship under `frontend/static/studio-models/`. `ThirdPartyLicenses.json`, the model license, content-addressed resource filenames, and the source URL used for the pinned artifact are kept beside the files. Operators that set `OPENPOST_STUDIO_MODEL_BASE_URL` must serve the matching release assets and preserve their notices.

OpenPost does not include or import code, styles, utilities, or components from the commercial shadcn Designer package.
