# Media

Media is the workspace hub for reusable assets, editable Studio designs, templates, and the brand kit.

## Assets

The Assets view contains uploads, camera captures, Studio exports, edited derivatives, and background-removal results. Search filenames and alt text, filter by type, source, dimensions, aspect, collection, tag, or date, and sort by recency, name, size, or recent use.

Select assets in order to apply a collection or tag, change favorites, or delete a safe batch. Collections and tags organize files; deleting either never deletes its assets.

Open an asset to inspect its preview, type, dimensions, source, creation time, alt text, collections, tags, original/derivative link, editable design, and usage. Image editing creates a Studio design or a new derivative. It never overwrites the original.

Deletion is blocked while a post, publication, design, template, brand asset, brand font, preview, or export still refers to the file. The detail view lists those references so you can remove the correct dependency first. Scheduled cleanup follows the same reference rules.

## Shared media picker

Every web composer media entry point uses one picker:

- **Library** reuses existing workspace assets without uploading another copy.
- **Upload** uses direct object-storage upload when configured and falls back to multipart upload.
- **Camera** captures a still image after browser permission.
- **Create** saves composer recovery state and opens [OpenPost Studio](/usage/studio).

Selection remains ordered. The picker applies the MIME, count, and purpose constraints resolved from the currently selected provider accounts rather than using one fixed four-item limit.

## Video preparation and editing

The Media upload dialog and every video-capable composer use the same client-side pipeline. OpenPost inspects the selected file in the browser, keeps a compatible H.264/AAC MP4 unchanged, remuxes compatible tracks without re-encoding, or transcodes and compresses the video when the selected destinations require it. The strictest size, duration, format, and aspect constraints from all selected accounts apply to the shared upload.

For a single video, the editor can trim to exact in and out points, preview the selected range, and crop with destination-aware aspect presets. Drag the crop window or move it with the arrow keys, then use crop zoom to choose the visible region. OpenPost tests a real H.264 frame encode before it enables cropping. Browsers that cannot encode H.264 can still trim compatible files without re-encoding.

Conversion and editing stay in the browser. The upload view reports separate inspection, remux, conversion, transfer, finalization, and server-check stages and lets you cancel the active work. After transfer, a durable server job verifies the real container, codecs, dimensions, duration, frame rate, rotation, pixel format, audio, and bitrate and creates a poster. A video cannot be scheduled or published until that check succeeds. Failed checks remain visible in Media with the server error and a retry action.

Provider transfer remains provider-specific after preparation: X uses chunked media upload, Mastodon uses asynchronous media processing, Bluesky uses its video service and job polling, LinkedIn initializes and finalizes video upload ranges, TikTok uses its direct or inbox transfer path, YouTube uses resumable upload, and public-URL providers fetch the stored video over HTTPS.

## Storage and provenance

Uploaded files, captures, exports, derivatives, brand assets, and custom fonts count toward workspace media storage. Internal design and template previews are hidden from the library and excluded from the displayed quota total.

Each derivative records its source, parent asset when applicable, and Studio design/page origin. Deleting a design never deletes its exports. Deleting an original is allowed only after all active references are removed; parent links on surviving derivatives then become empty.

For providers that fetch media by URL, such as Threads, keep the exported asset available until publication completes. S3/R2 direct browser uploads also require a bucket CORS rule for the OpenPost app origin.
