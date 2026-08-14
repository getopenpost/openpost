# Media

This page is for people organizing reusable media and editor assets in a Workspace.

Media keeps your files, OpenPost Image Editor designs, templates, and brand items in one place.

## Assets

The Assets view contains image, video, and audio uploads, camera photos, generated memes, OpenPost Image Editor exports, edited copies, and images with the background removed. Search names, alt text, and tag names. Filter by one or more tags, untagged assets, media type, source, size, shape, or date.

Use tags for flexible organization: one file can have several tags, and choosing several tag filters shows files that have all of them. Select files to add or remove a tag, mark favorites, or delete a group. Deleting a tag does not delete its files.

Open a file to see its preview, type, size, source, date, alt text, tags, original file, design, and where it is used. Editing an image makes a new OpenPost Image Editor design or a new copy. It never replaces the original.

New uploads remain untagged until you add tags. When one tag filter is active in Media or a media picker, files uploaded there can be added directly to that active tag. Composer paste and drop uploads remain untagged.

OpenPost will not delete a file while a post, design, template, brand item, font, preview, or export still uses it. The file page shows each use so you can remove it first. Cleanup uses the same rules.

## Media lifecycle

OpenPost uses one fixed cleanup policy. Post-specific temporary media moves to Trash after its final successful publication or after 14 days without use. Favorites, tags, collections, brand files, active drafts and schedules, retryable work, source relationships, and live OpenPost Image Editor or Video Editor projects keep their media safe.

Items stay in Trash for seven days before permanent removal. Restoring an item restarts its unused period. You cannot change or disable either period in workspace settings.

## Add media to a post

Each post editor uses the same media picker:

- **Library** uses a saved file without uploading another copy.
- **Upload** adds a file from your device.
- **Camera** captures a still image after browser permission.
- **Meme** searches the configured Memegen catalog, lets you fill every caption and replaceable image slot, and saves the rendered result in Media.
- **Create** saves your post and opens [OpenPost Image Editor](/usage/image-editor).

OpenPost keeps files in the order you choose. It checks the file types and count against the rules for all selected accounts.

If AI suggestions are configured, describe the joke and choose a tone to get several editable template and caption options. OpenPost sends only the idea and a bounded template shortlist to the configured model. Rendering uses the configured Memegen service. Review the result, alt text, template source, and your right to publish the template before attaching it. Instance setup and external-processing details are in [Environment Variables](/configuration/environment-variables#meme-generator).

### Automatic alt text

If your instance operator has configured OpenRouter, adding an image with no saved alt text to the text-and-thread composer asks OpenPost to draft shared alt text. The server sends a 400px JPEG thumbnail and, when present, up to 1,000 characters of the current relevant post or thread segment to OpenRouter and an eligible provider that declares it does not collect request data. OpenPost treats the text as untrusted context for better disambiguation, not as model instructions. It does not send the original image for this task.

OpenPost saves the caption only while the shared alt text is still blank, so existing text and edits made while the request runs always win. Review the result and adjust it before publishing. You can also customize alt text for a specific account. A missing API key or a captioning error does not stop the image from being attached or published.

The thumbnail and any relevant segment text leave the OpenPost instance for this external processing. Instance operators can review the full privacy boundary and setup in [Environment Variables](/configuration/environment-variables#automatic-image-alt-text).

## Prepare and edit video

OpenPost checks a video in your browser before upload. It keeps a compatible H.264/AAC MP4 as it is. If needed, it changes or shrinks the video to fit the selected accounts. Audio files upload directly when the active composer accepts them. The strictest size, length, file type, and shape rules apply.

For one video, you can trim the start and end, preview the result, and crop it for the selected accounts. Drag the crop area or move it with the arrow keys. Use zoom to choose what stays in view. Some browsers can trim a compatible file but cannot crop it.

Video changes happen in your browser. The upload view shows progress and lets you cancel. After upload, the server checks the file and makes a poster image. You cannot schedule or publish the video until this check passes. A failed check stays in Media with the error and a retry button.

OpenPost then sends the video in the way each social network requires. Threads, Facebook, Instagram, and some TikTok posts download the file from a public HTTPS link.

## Storage and source files

Uploads, camera photos, exports, edited copies, brand files, and custom fonts count toward the workspace storage limit. Hidden design and template previews do not count.

Each edited copy keeps a link to its source file and OpenPost Image Editor page when relevant. Deleting a design does not delete its exports. You can delete an original only after nothing else uses it. Saved edited copies remain.

Keep media available until posts to Threads, Facebook, Instagram, and some TikTok accounts finish. If you run OpenPost with S3 or R2, see [Media Storage](/configuration/media-storage) for the browser upload rule.
