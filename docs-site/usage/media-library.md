# Media

Media keeps your files, Studio designs, templates, and brand items in one place.

## Assets

The Assets view contains uploads, camera photos, Studio exports, edited copies, and images with the background removed. Search names and alt text. Filter by type, source, size, shape, collection, tag, or date.

Select files to add a collection or tag, mark favorites, or delete a group. Deleting a collection or tag does not delete its files.

Open a file to see its preview, type, size, source, date, alt text, collections, tags, original file, design, and where it is used. Editing an image makes a new Studio design or a new copy. It never replaces the original.

OpenPost will not delete a file while a post, design, template, brand item, font, preview, or export still uses it. The file page shows each use so you can remove it first. Cleanup uses the same rules.

## Add media to a post

Each post editor uses the same media picker:

- **Library** uses a saved file without uploading another copy.
- **Upload** adds a file from your device.
- **Camera** captures a still image after browser permission.
- **Create** saves your post and opens [OpenPost Studio](/usage/studio).

OpenPost keeps files in the order you choose. It checks the file types and count against the rules for all selected accounts.

## Prepare and edit video

OpenPost checks a video in your browser before upload. It keeps a compatible H.264/AAC MP4 as it is. If needed, it changes or shrinks the video to fit the selected accounts. The strictest size, length, file type, and shape rules apply.

For one video, you can trim the start and end, preview the result, and crop it for the selected accounts. Drag the crop area or move it with the arrow keys. Use zoom to choose what stays in view. Some browsers can trim a compatible file but cannot crop it.

Video changes happen in your browser. The upload view shows progress and lets you cancel. After upload, the server checks the file and makes a poster image. You cannot schedule or publish the video until this check passes. A failed check stays in Media with the error and a retry button.

OpenPost then sends the video in the way each social network requires. Threads, Facebook, Instagram, and some TikTok posts download the file from a public HTTPS link.

## Storage and source files

Uploads, camera photos, exports, edited copies, brand files, and custom fonts count toward the workspace storage limit. Hidden design and template previews do not count.

Each edited copy keeps a link to its source file and Studio page when relevant. Deleting a design does not delete its exports. You can delete an original only after nothing else uses it. Saved edited copies remain.

Keep media available until posts to Threads, Facebook, Instagram, and some TikTok accounts finish. If you run OpenPost with S3 or R2, see [Media Storage](/configuration/media-storage) for the browser upload rule.
