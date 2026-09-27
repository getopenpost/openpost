# Profiling OpenPost

## Record an editor operation

1. Append `?profile=1` to the app URL, or `&profile=1` if it already has a query, and reload. The choice lasts for that page session, including client navigation.
2. Open Chrome or Brave DevTools, select **Performance**, and start a recording.
3. Perform one operation, such as exporting a timeline, scrubbing a clip, or exporting an image. Stop recording after it finishes.
4. Expand the **OpenPost** custom tracks. Save the recording from DevTools to compare it with another revision.

The tracks cover video decoding, frame composition, encoder submission and backpressure, export finalization, proxy generation, filmstrip loading, Quick Cut preflight/export, and the Image Editor's load, canvas, save, preview, background removal, and export metrics. Video export workers inherit the page's profiling choice. Worker entries appear on their own thread in the recording.

Composition includes its decode waits. Encoder submission includes both native encoder and output-writer backpressure. These overlapping durations are not additive, and they are not measurements of GPU kernel time. Use the browser's main-thread, worker, GPU, and network tracks to investigate the remaining time. The Video Editor also has an existing **Toggle performance overlay** command for preview frame rate and dropped frames.

Remove `profile=1` and reload to disable tracing. Normal use creates no profiling spans. Enabled spans use fixed operation names and contain no project names, media paths, or user content. They stay local and are cleared from the Performance Timeline after delivery to DevTools and PerformanceObserver, so a long export does not accumulate entries in app memory. Browser recordings themselves can contain URLs and screenshots; inspect them before sharing.

## Find repeated Svelte updates

On the development server, add `renderScan=1` to the URL and reload. The floating eye button toggles [Svelte Render Scan](https://github.com/khromov/svelte-render-scan), which outlines changed DOM elements throughout the app. It is dynamically loaded only in development with that explicit query. Production builds exclude the scanner.

The scanner observes DOM mutations. It does not count component executions or measure canvas drawing, decoding, or encoding. Keep it off during throughput measurements. For the reactive cause of an update, temporarily put [`$inspect.trace('operation')`](https://svelte.dev/docs/svelte/$inspect) first inside the relevant `$effect` or `$derived` function; remove it after diagnosis.

## Add a measurement

Use the shared adapter at the owning operation, including its failure and cancellation path:

```ts
import { startProfileSpan } from "$lib/performance/profiling";

const finishProfile = startProfileSpan("Media", "Load waveform");
try {
  await loadWaveform();
} finally {
  finishProfile?.();
}
```

Use fixed area and operation names. Keep file names, URLs, IDs, text, and media out of profiling metadata. Reuse an existing operation metric where one exists. Worker jobs pass the explicit choice through their message contract and call `configureProfiling` before doing work. The adapter uses standard User Timing with [Chrome's custom-track metadata](https://developer.chrome.com/docs/devtools/performance/extension), so existing browser tools can consume it without a separate profiler service.

## Compare export performance

Use a disposable local copy of a real project with original media, several cuts, effects, transitions, and retained audio. Record its duration, frame rate, dimensions, codec, bitrate, browser version, and revision. Time asset loading separately from rendering, encoding, and finalization.

Alternate baseline and candidate runs in the same browser and repeat each at least twice. Keep other exports and test suites idle. Report the individual results and median; do not count a warm cache or a browser change as a code improvement. Run Chrome and Brave separately. Measure throughput with tracing and the DOM scanner off, then capture a diagnostic recording to explain the result.

Validate decoded output dimensions, duration, frame count, audio channels and amplitude, plus representative frames around cuts and transitions. A faster export with dropped frames or changed quality is not an equivalent result. Keep private project inputs, media, traces, and benchmark output under the ignored `tmp/` directory.

## Isolate encoder overhead

Prepare one corpus of rendered project frames before timing. Include motion, text, effects, and transitions. Feed identical pixel buffers, timestamps, and keyframe requests to the normal export library, direct WebCodecs, and, when available, the platform encoder. Match dimensions, frame rate, profile, bitrate mode, bitrate, color space, range, frame reordering, and latency settings. Confirm the native encoder's hardware status rather than inferring it from a requested hint.

Keep input preparation and final file writing outside the encoder comparison, and report startup separately. Validate every decoded output frame against the other paths, not just compressed file sizes. Container metadata can change file hashes without changing the video. A short repeated corpus isolates encoder overhead; it does not establish a throughput ceiling for a complete project. Follow it with alternating full-project exports through the production renderer.
