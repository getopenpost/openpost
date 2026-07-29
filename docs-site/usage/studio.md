# OpenPost Studio

Studio is OpenPost's still-image editor for social posts, carousel pages, and slideshow images. Use the free public editor at [app.openpost.social/studio](https://app.openpost.social/studio), or open the workspace version from **Media → Create → Create design**, from a Media asset's detail view, or from the composer's media picker.

## Use Studio without an account

The public editor works without signing in and adds no watermark. Start with a social format, an original OpenPost template, or a PNG, JPEG, or WebP image. Designs and imported images stay in that browser, using persistent browser storage when available. Clearing site data, using private browsing, or browser storage eviction can remove local work.

You can return to local designs on the same device and export PNG, JPEG, or WebP files at any time. **Save to OpenPost** creates an account or uses your current account, uploads the local images, and copies the editable design into your workspace. The local copy remains available in the original browser.

## Create and edit

Start with a social preset, an original OpenPost starter template, a workspace template, or an existing image. A design can contain up to 35 ordered pages. Each page has a solid background and ordered text, image, shape, and group layers.

Desktop Studio provides the canvas, asset and brand panes, Layers, Properties, and the page strip at the same time. On a phone, use the bottom tool rail and open one editing sheet at a time. The mobile editor supports adding and transforming layers, crop and image adjustments, text and shape properties, layer order and visibility, page management, undo and redo, background removal, and export.

Studio saves after 750ms of inactivity. Public designs are saved on the current device. Workspace designs are saved to OpenPost, and unsynced workspace changes are also written to this browser for seven days. If another browser changes the same workspace design, Studio does not overwrite it; reload the server version, save the local version as a copy, or continue locally until you decide.

## Versions and templates

Open **File → Version history** to restore a recovery version or create a named checkpoint. Recovery versions are retained for up to 30 days; named checkpoints remain until removed. Restoring creates a new head revision and keeps prior history intact.

Editors can save a design as a new workspace template or deliberately replace an existing workspace template. Instantiating a template creates independent page and layer IDs. Later template or brand-kit changes never silently modify existing designs.

## Brand assets

Manage the workspace brand kit from **Settings → Brand**. It can hold named colors, default page backgrounds, logos and marks, whole-layer text styles, and custom WOFF2, TTF, or OTF fonts.

Custom font upload requires a license acknowledgement. OpenPost checks the selected file in the browser, previews it with the browser font engine, and validates its WOFF2, TrueType, or OpenType signature and size on the server. A font cannot be removed while a design or template still refers to it. Applying a brand style copies its current font, color, and text settings into the selected layer.

## Background removal

Select an image layer and choose **Remove background**. OpenPost loads its bundled model only when requested and processes source pixels in the browser through WebGPU when available, with a CPU fallback. Pixels are not sent to a background-removal service.

The result is a transparent PNG derivative in Media. The original remains unchanged, and replacing the selected layer is one undoable action. Large inputs can use an optimized temporary processing copy without changing the original file.

## Export and composer return

Export the active page or every page in page-strip order as PNG, JPEG, or WebP. Multi-page downloads use a ZIP. Export to Media records the design and page provenance for each output.

When Studio opens from a composer, OpenPost saves a local recovery snapshot and uses a one-time two-hour return token. **Export and attach** returns the ordered outputs to the exact post, thread segment, or thumbnail field and rechecks the current account limits. If return restoration fails, the exported files remain in Media.

## Current scope

Studio edits raster still images only. It does not provide video editing, animation, arbitrary SVG or remote URL layers, mixed-style text inside one layer, drawing tools, CMYK or print units, multiplayer editing, or low-level MCP editing tools.
