# OpenPost Studio

Studio is OpenPost's still-image editor for social posts, carousel pages, and slideshow images. Open it from **Media → Create → Create design**, from a Media asset's detail view, or from the composer's media picker.

## Create and edit

Start with a social preset, an original OpenPost starter template, a workspace template, or an existing image. A design can contain up to 35 ordered pages. Each page has a solid background and ordered text, image, shape, and group layers.

Desktop Studio provides the canvas, asset and brand panes, Layers, Properties, and the page strip at the same time. On a phone, use the bottom tool rail and open one editing sheet at a time. The mobile editor supports adding and transforming layers, crop and image adjustments, text and shape properties, layer order and visibility, page management, undo and redo, background removal, and export.

Studio saves after 750ms of inactivity. The top bar shows the current save state. Unsynced changes are also written to this browser for seven days. If another browser changes the same design, Studio does not overwrite it; reload the server version, save the local version as a copy, or continue locally until you decide.

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
