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

## Storage and provenance

Uploaded files, captures, exports, derivatives, brand assets, and custom fonts count toward workspace media storage. Internal design and template previews are hidden from the library and excluded from the displayed quota total.

Each derivative records its source, parent asset when applicable, and Studio design/page origin. Deleting a design never deletes its exports. Deleting an original is allowed only after all active references are removed; parent links on surviving derivatives then become empty.

For providers that fetch media by URL, such as Threads, keep the exported asset available until publication completes. S3/R2 direct browser uploads also require a bucket CORS rule for the OpenPost app origin.
