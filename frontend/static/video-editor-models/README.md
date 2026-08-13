# OpenPost Video Editor local models

These model files are fetched from immutable upstream revisions by
`scripts/fetch-video-editor-models.mjs`. The editor does not download them until a user
starts transcription or voice analysis. `manifest.json` records every source URL,
byte size, and SHA-256 digest.

- Whisper Tiny multilingual ONNX conversion: Apache-2.0 model repository.
- Silero VAD 6.2: MIT.

See `THIRD_PARTY_LICENSES.md` before redistributing these files.
