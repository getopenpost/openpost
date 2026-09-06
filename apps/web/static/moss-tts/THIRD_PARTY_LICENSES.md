# MOSS TTS browser runtime notices

OpenPost ships the small browser storage and SentencePiece runtime files in this directory. It downloads the large model files in the browser only when a user selects MOSS Nano.

## Ported runtime source

- Source: FreeCut commit `4d62e8082c5eb387a96275bcbd323d28f6e41a62`
- License: MIT
- Retained license: `licenses/FREECUT.txt` at the repository root
- Changes: OpenPost naming, fixed model revisions, Vite-managed ONNX Runtime, worker cancellation, and shared OpenPost audio contracts

## SentencePiece JavaScript

`tokenizer_sandbox.js` contains the SentencePiece JavaScript and WebAssembly runtime used by the ported MOSS browser pipeline.

- Upstream: `sctg-development/sentencepiece-js`
- License: Apache License 2.0
- Retained license: `licenses/APACHE-2.0.txt` at the repository root
- The generated bundle also retains its own MIT and BSD-3-Clause notices for `buffer` and `ieee754`.

## ONNX Runtime Web

The MOSS worker uses the CPU-only ONNX Runtime Web 1.26 development build under `vendor/ort/`, matching FreeCut's tested browser runtime. OpenPost keeps it separate from the larger WebGPU/JSEP binary because MOSS is CPU-only.

- License: MIT
- Upstream package: `onnxruntime-web`

## Downloaded MOSS models

Both model repositories declare Apache License 2.0. OpenPost pins their exact revisions and stores the downloaded files in origin-private browser storage.

| Model | Revision | Download size |
| --- | --- | ---: |
| `OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX` | `f52645cb467506d8e18e746ddd59482685b74e58` | 672,619,352 bytes |
| `OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX` | `ceff0d0749bfb3fa2d61149794ec6feef0d1e1ae` | 90,572,161 bytes |

OpenPost does not check these model files into the repository or application binary. The browser downloads them from Hugging Face after the user starts MOSS generation.
