# OpenPost Image Editor

OpenPost Image Editor is OpenPost's still-image editor for social posts, carousel pages, and slideshow images. Use the free public editor at [app.openpost.social/image-editor](https://app.openpost.social/image-editor), or open the workspace version from **Media → Create → Create design**, from a Media asset's detail view, or from the composer's media picker.

## Use OpenPost Image Editor without an account

The public editor works without sign-in and adds no watermark. Start with a social format, an OpenPost template, or a PNG, JPEG, or WebP image. Designs and imported images stay in that browser. Clearing site data, using private browsing, or letting the browser clear old data can remove local work.

You can return to local designs on the same device and export PNG, JPEG, or WebP files at any time. **Save to OpenPost** creates an account or uses your current account, uploads the local images, and copies the editable design into your workspace. The local copy remains available in the original browser.

## Create and edit

Start with a social preset, an original OpenPost starter template, a workspace template, or an existing image. A design can contain up to 35 ordered pages. Each page has a solid, transparent, gradient, or image background and ordered text, image, shape, paint, and group layers.

Desktop OpenPost Image Editor provides the canvas, asset and brand panes, Layers, Properties, and the page strip at the same time. On a phone, use the bottom tool rail and open one editing sheet at a time. The mobile editor supports adding and transforming layers, crop and image adjustments, text and shape properties, layer order and visibility, page management, undo and redo, background removal, and export.

OpenPost Image Editor saves soon after you stop editing. Public designs stay on the current device. Workspace designs are saved to OpenPost. Changes that have not reached the server also stay in this browser for seven days. If another browser changes the same design, OpenPost Image Editor does not overwrite it. You can reload the saved version, save your local work as a copy, or keep editing locally.

## Versions and templates

Open **File → Version history** to inspect an earlier workspace version or save a named version. The list shows when each version was saved and who saved it. Select a version to load its preview and a summary of material page, layer, guide, title, size, export, and cover changes. OpenPost does not fetch the full version until you select it. Choose **Load more** to reach older named versions when the design has more history than the first page.

OpenPost keeps at most 20 automatic recovery versions for up to 30 days. Named versions and restore points do not expire automatically; they remain with the design. Before restoring, OpenPost confirms that it will save the exact current design as a restore point. The target pages and cover then replace the current head in one revision-checked transaction. Media referenced only by the target version is recovered from workspace trash as part of that transaction. If target media is missing or belongs to another workspace, the restore stops before changing the design. You can restore the automatic **Before restore** version to return to the prior head.

If the design changes in another browser before the transaction commits, the restore stops without changing the design or its trashed media. Reload the current OpenPost version before trying again, or preserve the browser's unsaved work as a separate design. Restoring one version does not delete the other named versions or restore points.

You can save a design as a new workspace template or replace a template. A design made from a template is its own copy. Later changes to the template or brand kit do not change that design.

## Brand assets

Manage the workspace brand kit from **Settings → Brand**. It can hold named colors, default page backgrounds, whole-layer text styles, and custom WOFF2, TTF, or OTF fonts.

You must confirm that you can use a custom font before upload. OpenPost previews it in the browser and checks its file type and size on the server. You cannot remove a font while a design or template uses it. The Image Editor exposes saved brand colors and fonts. Saved page backgrounds and whole-layer text styles remain available in the brand kit but do not yet have direct apply actions in the editor.

## Background removal

Select an image layer and choose **Remove background**. OpenPost loads this feature only when you use it and works on the image in your browser. It uses your graphics hardware when available and your processor when needed. It does not send the image to another background-removal service.

The result is a new transparent PNG in Media. The original stays unchanged, and you can undo the layer change. OpenPost may use a smaller temporary copy for a large image without changing the original.

## Export and composer return

Export the current page or every page in order as PNG, JPEG, or WebP. A multi-page download uses a ZIP file. Media keeps the source design and page with each export.

When OpenPost Image Editor opens from a post, OpenPost saves a local recovery copy and a return link that works for two hours. **Export and attach** adds the files in order to the same post, thread part, or thumbnail field and checks the account limits again. If OpenPost cannot return to the post, the exported files stay in Media.

## What OpenPost Image Editor supports

OpenPost Image Editor edits still images only. It does not edit video, make animations, add any SVG or remote link as a layer, mix text styles in one layer, use CMYK or print units, let several people edit at once, or offer MCP editing tools.
