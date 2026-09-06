# Third-Party Notices

OpenPost dependency licenses remain available through their upstream packages and lockfiles. OpenPost Image Editor adds:

- Fabric.js 7.4.0
- IMG.LY Background Removal 1.7.0
- ONNX Runtime Web 1.21.0
- fflate 0.8.2

The bundled background-removal runtime, quantized model, content-addressed resource filenames, source reference, and full notices are in `apps/web/static/image-editor-models/`. Redistributors must keep those notices with the corresponding assets.

OpenPost Image Editor is an original implementation. It does not redistribute the commercial shadcn Designer package, its components, its CSS, or its generated utilities.

OpenPost social image layouts adapt the Grid and ShadcnRegistry6 components from [ogimagecn](https://github.com/shadcn-labs/ogimagecn) at commit `8e385d1c914fd7dc04bc0cba6dbcad86ca58271d`, Copyright (c) 2026 Shadcn Labs, under the MIT License. See `licenses/OGIMAGECN.txt`.

OpenPost Meme Maker includes a pinned catalog snapshot from Memegen at commit `aa0fc3af4dd1c669cc35039a7d8efcca7d4eb98a`, Copyright (c) 2015 Jace Browning, under the MIT License. The bundled source notice is in `apps/server/internal/memes/catalog/LICENSE-MEMEGEN.txt`. Bundled fonts retain their SIL Open Font License notices in `apps/server/internal/memes/catalog/fonts/`.

Template source links provide provenance only. Rights in photos, characters, trademarks, and other depicted material can differ by template and use. Redistributors and users must confirm their own right to publish a chosen template.

OpenPost Video Editor includes adapted source from:

- FreeCut, Copyright (c) 2025 FreeCut, under the MIT License. See `licenses/FREECUT.txt`.
- SoundTouch JS v0.2.3, Copyright Olli Parviainen, Ryan Berdeen, Jakub Fiala, and Steve 'Cutter' Blades, under LGPL-2.1-or-later. OpenPost keeps the adapted TypeScript source separate at `apps/web/src/lib/video-editor/audio/time-stretch.ts`; see `licenses/SOUNDTOUCH-LGPL-2.1.txt`.
- Paper Shaders, Copyright Lost Coast Labs, Inc., under the Apache License 2.0. See `licenses/PAPER_SHADERS.txt` and `licenses/PAPER_SHADERS_NOTICE.txt`.
- Kokoro 82M under Apache License 2.0 and Supertonic 3 under its OpenRAIL terms. These models download on demand for local voice generation and are not part of the application binary.
- The MOSS Nano browser pipeline, including its SentencePiece runtime, under the MIT and Apache License 2.0 terms recorded in `apps/web/static/moss-tts/THIRD_PARTY_LICENSES.md`. The two on-demand model revisions are pinned there and are not part of the application binary.
- Anime4K CNN 2x model weights from bloc97/Anime4K and sb2702/websr under the MIT License. The bundled models and retained notices are in `apps/web/src/lib/video-editor/media/processing/upscale/models/`.
- The `walterlow/RIFE_fp32_timestep` frame-interpolation model at revision `ee09066f9822f8b28b8477a1b4cc30f19d607590` under the MIT License. It downloads on demand and is not part of the application binary.
- `ai-music-js` 0.5.0 under the MIT License, including its bundled ONNX Runtime Web, Transformers.js, and fflate browser workers. OpenPost retains the required MIT notices in `licenses/AI_MUSIC_JS.txt`; Apache-licensed parts use `licenses/APACHE-2.0.txt`, and the dependency carries its full upstream third-party notice set.
- ACE-Step 1.5 XL Turbo browser graphs from `emb1ter/ACE-Step-v1.5-XL-Turbo-ONNX-WebGPU` at revision `cf185389395b3a725d948a59262f3ab4be4b0ad8` under the ACE-Step MIT terms in `licenses/AI_MUSIC_JS.txt`. Shared browser conversion assets come from `shreyask/ACE-Step-v1.5-ONNX` at revision `bdabfb5684fd70fcc76f98cbb51bb9ebc47ee342` under Apache License 2.0. Model weights download on demand and are not part of the application binary.
- `@lottiefiles/dotlottie-web` 0.76.0 under the MIT License. Public animations imported from LottieFiles remain subject to the license stored with each media record and are not bundled with OpenPost.
- Microsoft Fluent Emoji Flat under the MIT License, distributed through `@iconify-json/fluent-emoji-flat` 1.2.5 for the local sticker browser. OpenPost records the source and license on each imported sticker. See `licenses/FLUENT_EMOJI.txt`.

Microsoft and Fluent are trademarks of the Microsoft group of companies. Their use here does not imply endorsement or sponsorship.
