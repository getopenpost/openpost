# OpenPost Image Editor background-removal assets

This directory contains the self-hosted runtime files and quantized `isnet_quint8`
model used by `@imgly/background-removal` 1.7.0. OpenPost ships only the resource
chunks required by that model plus its WebAssembly CPU/WebGPU runtimes.

The files come from `@imgly/background-removal-data` 1.7.0. See `LICENSE.md` and
`ThirdPartyLicenses.json` in this directory for license notices.

When upgrading the runtime, replace the manifest and required chunks together,
update the `openpost-image-editor-models-*` cache name in `frontend/vite.config.ts`, and
run the browser background-removal tests in both GPU and CPU modes.
