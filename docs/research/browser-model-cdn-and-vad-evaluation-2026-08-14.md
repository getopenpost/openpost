# Browser model delivery and voice detection

Date: 2026-08-14

## Decision

Use an OpenPost-controlled CDN or object-storage origin for browser models on managed hosting, but do not make that CDN a requirement for portable self-hosting. Publish immutable, release-pinned model roots and omit those files from the managed frontend and Go binary. Keep a complete self-hosted artifact, or a separately downloadable model bundle that an operator can serve from the same origin.

Keep Silero VAD as the default detector for finding pauses between spoken phrases. A simple amplitude detector is useful as an optional fast mode for clean recordings or when the user wants every audible sound to count as activity. Before judging or replacing Silero, fix OpenPost's v6.2 integration and benchmark both modes on representative creator recordings.

## CDN assessment

OpenPost already advertises operator-controlled model roots through `OPENPOST_IMAGE_EDITOR_MODEL_BASE_URL` and `OPENPOST_VIDEO_MODEL_BASE_URL`. The video downloader fetches on demand, supports partial downloads, stores completed files in the browser Cache API, and checks their byte length and SHA-256 digest. The image and video model directories currently total about 174 MiB.

Changing those environment variables alone does not reduce builds or binaries. The directories remain under `apps/web/static`, the frontend build copies them, and `apps/server/cmd/openpost/web_embedded.go` embeds all of `public`. Managed packaging must exclude the local model directories as well as point clients at the CDN. The video editor's ONNX Runtime WASM files are emitted application assets, not files under `OPENPOST_VIDEO_MODEL_BASE_URL`; moving or reducing those is separate work. ONNX Runtime officially supports an absolute `wasmPaths` CDN URL, conditional imports, and custom runtime builds. [ONNX Runtime Web deployment](https://onnxruntime.ai/docs/tutorials/web/deploy.html)

### Managed hosting

A CDN-backed model origin is the better default because one pinned copy can serve many application releases and app instances. It removes about 174 MiB from each managed apps/web/embedded binary before any separate ONNX Runtime optimization, reduces build copying and Turbo snapshot size, and moves large-download traffic away from the Go process. It does not reduce a user's first model download or inference cost.

Use an OpenPost-controlled origin rather than fetching GitHub, Hugging Face, jsDelivr, or another package CDN directly at runtime. That keeps availability, retention, license notices, cache policy, and rollout under OpenPost control. Inference remains in the browser and audio/images need not leave the device, although the asset host still receives ordinary request metadata such as IP address and requested model path.

Each release should advertise a versioned root such as `/browser-models/v1/<manifest-fingerprint>/`. Never replace bytes at an existing URL. Serve versioned responses with a long freshness lifetime and `immutable`; RFC 8246 defines that directive for representations that will not change during their freshness lifetime and describes versioned URLs as the matching pattern. [RFC 8246](https://www.rfc-editor.org/rfc/rfc8246.html)

The cross-origin host must support:

- CORS for the application origins. OpenPost reads response bodies and headers, so opaque `no-cors` responses are not sufficient. [WHATWG Fetch CORS protocol](https://fetch.spec.whatwg.org/#http-cors-protocol)
- `Range`, `If-Range`, `ETag`, and `206 Partial Content` for resumable downloads; expose `ETag` to browser code and allow the non-safelisted request headers during preflight. HTTP defines range and `If-Range` behavior in its range-request section. [RFC 9110, Range Requests](https://www.rfc-editor.org/rfc/rfc9110.html#name-range-requests)
- Stable identity encoding for resumable model files. OpenPost hashes decoded bytes and resumes at a decoded-byte offset, so transparent CDN compression can make byte ranges inconsistent. Model binaries should use `Content-Encoding: identity` unless the downloader is changed to account for encoded ranges.
- The correct model/WASM MIME types, a restrictive CSP-compatible deployment, and retained third-party license notices. ONNX Runtime documents the required model, WASM, worker, secure-context, and cross-origin deployment behavior. [ONNX Runtime Web deployment](https://onnxruntime.ai/docs/tutorials/web/deploy.html)

The current video integrity chain needs hardening before treating the CDN as untrusted. The client verifies each file against hashes supplied by the downloaded manifest, but it does not recompute the manifest's aggregate fingerprint before comparing it with the backend-advertised value. A replaced manifest can therefore keep the advertised aggregate string while substituting its own per-file hashes. Bind the entire canonical manifest to a compiled or API-advertised digest, then verify each file. The image model loader should receive equivalent explicit integrity coverage rather than relying only on hash-shaped filenames.

### Self-hosting and offline use

The default self-hosted release should remain complete and should not call an OpenPost CDN. Air-gapped and private deployments are part of portability. Operators may opt into their own model origin through the existing environment variables; a separate signed model archive or OCI layer would avoid forcing every operator to rebuild the app.

A CDN also cannot provide cold-start offline use. After a successful download, Cache API and origin-private storage can retain model data, and OpenPost already offers a persistent-storage request. Browser storage is otherwise `best-effort` and can be evicted under storage pressure; the Storage Standard reserves stronger retention for origins granted persistent storage. [WHATWG Storage Standard](https://storage.spec.whatwg.org/)

OpenPost's video loader currently fetches `manifest.json` before consulting cached model files, so a network failure prevents reuse even when all model bytes are cached. A true offline-after-first-use flow needs a verified cached manifest and an offline fallback. Cache API data is also origin-scoped and separate from the HTTP cache. [Service Workers specification, Cache objects](https://w3c.github.io/ServiceWorker/#cache-objects)

## Silero VAD versus Auto-Editor amplitude detection

These detectors answer different questions:

- Silero estimates whether a 32 ms audio window contains human speech. It is a learned, recurrent acoustic classifier; it does not transcribe or understand words.
- Auto-Editor's `audio` method asks whether any PCM sample in a timeline-frame bucket is loud enough. Its default threshold is `0.04` of full scale, and its default analysis timebase is 30 buckets per second. It uses the maximum absolute sample across selected channels, with SIMD implementations where available. [Auto-Editor method definition](https://github.com/WyattBlue/auto-editor/blob/b9e915716c6fd4e196605a5df353212f073762c3/src/editmethods.nim#L31-L39), [peak implementation](https://github.com/WyattBlue/auto-editor/blob/b9e915716c6fd4e196605a5df353212f073762c3/src/analyze/audio.nim#L183-L276)

| Recording                                                      | Auto-Editor-style amplitude                         | Silero VAD                                                                                                        |
| -------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Clean talking head with stable levels                          | Usually adequate after threshold tuning             | Usually adequate; extra model cost may not buy much                                                               |
| Quiet, muted, or level-varying speech                          | Can miss anything below the fixed threshold         | Better fit; Silero v6.2 specifically claims improvements for muted and unusual voices                             |
| Fan, traffic, clicks, keyboard, or impacts                     | Keeps noise whenever its peak crosses the threshold | More likely to reject non-speech noise                                                                            |
| Instrumental music                                             | Active whenever loud enough                         | Often rejectable, but not guaranteed                                                                              |
| Vocals, voice-like instruments, laughter, breaths, or applause | Keeps them when audible                             | May classify them as speech or reject intentional non-speech sound; either result can be wrong for editing intent |

Auto-Editor's method is smaller, faster, deterministic, and easy to explain. It needs no model and is essentially one maximum-amplitude pass after audio decoding. Its weakness is not implementation quality: amplitude alone contains no information that distinguishes speech from another equally loud sound.

Silero adds a 2,327,524-byte model and OpenPost declares a 12,666,427-byte WASM runtime for it. Silero reports that a 30+ ms chunk takes less than 1 ms on one native CPU thread. Its first-party v6 quality table reports multi-domain ROC-AUC of `0.97` and accuracy of `0.92`, but these are vendor-reported results, not an independent OpenPost benchmark. Silero also documents noise and voice-like instruments as remaining hard cases. [Silero repository](https://github.com/snakers4/silero-vad), [Silero quality metrics](https://github.com/snakers4/silero-vad/wiki/Quality-Metrics)

For OpenPost's pause-removal feature, false speech rejection is more damaging than retaining a little extra silence: a bad cut can remove a quiet word. That makes Silero the safer default once integrated correctly. Amplitude mode is still useful when the editor should preserve non-speech sounds or when a user prefers a zero-download detector and can tune the threshold.

## Current Silero integration finding

OpenPost pins the exact official `v6.2` `silero_vad.onnx` file: its local SHA-256 matches the tagged upstream artifact. It sends 16 kHz mono audio in 512-sample windows, retains the recurrent state, starts speech at probability `0.5`, and waits 250 ms below `0.5` before ending a region.

However, the official v6.2 wrapper prepends 64 samples of previous audio context to every 512-sample window before ONNX inference. OpenPost passes only the current 512 samples. The official segmenter also uses a lower default exit threshold of `0.35`, discards speech shorter than 250 ms, and defaults to 100 ms release plus 30 ms padding. OpenPost uses `0.5` for entry and exit, does not filter minimum speech duration, and applies different release and padding rules. [Silero v6.2 ONNX wrapper](https://github.com/snakers4/silero-vad/blob/v6.2/src/silero_vad/utils_vad.py#L51-L92), [official segmenter](https://github.com/snakers4/silero-vad/blob/v6.2/src/silero_vad/utils_vad.py#L210-L283)

A local differential check replayed Silero's own 60-second `tests/data/test.wav` fixture through the pinned model. The current OpenPost feed produced `0/1,875` windows at or above `0.5`; the upstream context-preserving feed produced `1,452/1,875`. Mean absolute probability difference was `0.778`. This is one diagnostic fixture, not a general accuracy benchmark, but it is strong evidence that current OpenPost results cannot be compared with Silero's published quality. [Silero v6.2 test fixture](https://github.com/snakers4/silero-vad/blob/v6.2/tests/data/test.wav)

Fix the wrapper first: preserve the 64-sample context exactly as upstream does, implement the intended entry/exit hysteresis and minimum-duration rules, bump the cached algorithm fingerprint, and add a fixture test that compares the browser loop with the upstream wrapper's expected speech probabilities or regions. Then measure Silero and amplitude detection on the same labeled creator clips, including quiet speech, background music, room noise, breaths, and deliberate non-speech sounds.
