# miniPaint and OpenPost Image Editor comparison

Reviewed: 2026-08-07

Reference snapshot: miniPaint 4.14.3 at `a79733eb803fc97084ef0ee4faa96b031e69e1c0`

This is a source-grounded parity ledger for the Git-ignored checkout in
`references/miniPaint/`. It is not a requirement to copy miniPaint. OpenPost's
versioned document, managed media, accessibility, mobile support, social output,
and save/recovery rules remain authoritative.

## How to use this ledger

- **OpenPost** means the current Image Editor has the stronger implementation.
- **miniPaint** means miniPaint has the stronger implementation or the feature is
  absent from OpenPost.
- **Split** means each editor solves a different part well.
- **Partial** means OpenPost has data structures or a related control, but not the
  expected complete editor interaction.
- Recheck both sources before implementing a listed gap. The reference checkout
  can change independently of this review.

## Product model

miniPaint is a local, single-document raster editor. It favors direct image
manipulation, broad file support, many small tools, and a familiar desktop image
editor layout. Most state is held in global mutable objects and many operations
replace raster pixels.

OpenPost Image Editor is a structured multi-page design editor for social media.
It favors editable objects, reusable media, templates, brand resources,
autosave, recovery, and returning ordered exports to a post. Guests use
IndexedDB and OPFS; signed-in workspaces use versioned server documents and
managed media.

Neither product is a strict superset of the other. miniPaint is broader as a
general image utility. OpenPost is stronger as a durable design and publishing
workflow.

## Complete capability ledger

### Document, pages, and persistence

| Capability                    | miniPaint                                                  | OpenPost                                                                    | Lead and notes      |
| ----------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------- |
| Layered editable document     | Local JSON with raster data, guides, fonts, and migrations | Typed schema with frontend and backend validation                           | OpenPost            |
| Multiple canvases/pages       | No                                                         | Up to 35 ordered pages                                                      | OpenPost            |
| Page duplicate/delete/reorder | No                                                         | Mouse, touch, and keyboard                                                  | OpenPost            |
| Social size presets           | General canvas presets                                     | Seven social presets plus custom size                                       | OpenPost            |
| Starter templates             | One test template                                          | Fifteen public templates, including multi-page carousels                    | OpenPost            |
| Workspace templates           | No                                                         | Create, replace, instantiate, and delete                                    | OpenPost            |
| Guest persistence             | Five-megabyte localStorage quicksave plus JSON files       | IndexedDB documents and OPFS media                                          | OpenPost            |
| Autosave                      | No                                                         | Debounced local/cloud save                                                  | OpenPost            |
| Offline recovery              | Manual quicksave/project file                              | Seven-day local recovery for unsynced cloud work                            | OpenPost            |
| Concurrent-edit protection    | No                                                         | Expected-revision compare-and-swap with reload/copy/continue options        | OpenPost            |
| Revision history              | Undo stack only                                            | Thirty-day recovery revisions and named checkpoints                         | OpenPost            |
| Portable project file         | miniPaint JSON import/export                               | Validated `.openpost-image` ZIP with document, manifest, and remapped media | OpenPost for safety |
| Guest-to-account migration    | No account model                                           | Copies editable documents and media into the workspace                      | OpenPost            |
| Asset reference integrity     | Layer-embedded data                                        | Managed references, provenance, deletion guards, and soft deletion          | OpenPost            |

### Layer and object operations

| Capability                     | miniPaint                                      | OpenPost                                                       | Lead and notes                         |
| ------------------------------ | ---------------------------------------------- | -------------------------------------------------------------- | -------------------------------------- |
| Layer types                    | Image, text, shapes, and tool-specific objects | Text, image, shape, paint, and group                           | OpenPost                               |
| Multi-selection                | No                                             | Canvas and layer tree                                          | OpenPost                               |
| Range/toggle selection         | No                                             | Shift range and Command/Control toggle                         | OpenPost                               |
| Groups and hierarchy           | No true groups                                 | Nested group layers                                            | OpenPost                               |
| Locking                        | No                                             | Layer locking                                                  | OpenPost                               |
| Visibility                     | Yes                                            | Yes                                                            | Tie                                    |
| Rename                         | Double-click/dialog                            | Inline and F2                                                  | OpenPost                               |
| Duplicate                      | Yes                                            | Command/Control+J and Alt-drag ghost                           | OpenPost                               |
| Reorder                        | One step up/down                               | Drag, touch, keyboard, front/forward/back/backward             | OpenPost                               |
| Align                          | No                                             | Six edge/center operations                                     | OpenPost                               |
| Distribute                     | No                                             | Horizontal and vertical                                        | OpenPost                               |
| Merge/flatten                  | Merge down and flatten                         | Export flattens; document layers remain structured             | miniPaint for explicit raster workflow |
| Rasterize                      | Explicit conversion for unsupported operations | Paint/export rendering without a general rasterize command     | miniPaint                              |
| Clear layer                    | Yes                                            | Delete or erase; no distinct clear command                     | miniPaint                              |
| Difference against lower layer | Dedicated Differences Down command             | No                                                             | miniPaint                              |
| Blend modes                    | About 29 Canvas composition modes              | Normal, multiply, screen, overlay, darken, lighten, soft light | miniPaint for breadth                  |
| Structured clipboard           | Active layer is generally rasterized           | Custom editable layer MIME plus in-session fallback            | OpenPost                               |

### Selection and hit testing

| Capability                    | miniPaint                               | OpenPost                                                                            | Lead and notes |
| ----------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------- | -------------- |
| Object selection              | Single layer                            | Single or multiple layers                                                           | OpenPost       |
| Transparent-pixel hit testing | Per-pixel up to about 5 MP, then bounds | Alpha-aware transformed image and paint candidates                                  | OpenPost       |
| Rectangular pixel selection   | Yes                                     | Yes                                                                                 | Tie            |
| Ellipse selection             | No                                      | Yes                                                                                 | OpenPost       |
| Lasso                         | No                                      | Yes                                                                                 | OpenPost       |
| Magic selection               | No                                      | Tolerance, contiguous/global, active/all layers                                     | OpenPost       |
| Boolean selection modes       | No                                      | Replace, add, subtract, intersect, toggle                                           | OpenPost       |
| Selection modifiers           | Limited                                 | Shift, Alt, and Shift+Alt modes                                                     | OpenPost       |
| Selection-constrained paint   | Limited active-layer selection          | Pencil, erase, fill, and gradient honor the mask                                    | OpenPost       |
| Move selection mask           | Source marks translation as not working | Arrow-key and pointer mask movement                                                 | OpenPost       |
| Move selected pixels          | Source marks translation as unreliable  | Pointer/keyboard floating move, commit/cancel/delete, and structured copy/cut/paste | OpenPost       |
| New layer from selection      | Yes                                     | Promote selection to a new paint layer with a transparent source hole               | OpenPost       |

### Painting, fill, and cleanup

| Capability                    | miniPaint                                          | OpenPost                                                                     | Lead and notes                 |
| ----------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------ |
| Brush                         | Antialiased, speed-sensitive fallback, pressure    | No separate soft brush                                                       | miniPaint                      |
| Pencil                        | Size and pressure                                  | Size, roughness, opacity, compact spans                                      | Split                          |
| Brush hardness/shape          | Hard/soft and circle/square through eraser options | No hardness or brush-tip selector                                            | miniPaint                      |
| Normal eraser                 | Hard/soft circle/square; raster restrictions       | Paint subtraction and non-destructive image strokes                          | Split                          |
| Magic eraser                  | Tolerance and antialiasing                         | Tolerance, contiguous region, non-destructive image spans                    | OpenPost for model/correctness |
| Bucket                        | Tolerance, antialiasing, contiguous option         | Tolerance, contiguous/global, active/all sampling, opacity                   | OpenPost for model/correctness |
| Gradient                      | Linear and radial, two colors                      | Linear, radial, angle, reflected, diamond, reverse, selection-aware          | OpenPost                       |
| Clone stamp                   | Current/previous layer source                      | No                                                                           | miniPaint                      |
| Local blur brush              | Yes                                                | No                                                                           | miniPaint                      |
| Local sharpen brush           | Yes                                                | No                                                                           | miniPaint                      |
| Local desaturate brush        | Yes                                                | No                                                                           | miniPaint                      |
| Bulge/pinch                   | Yes                                                | No                                                                           | miniPaint                      |
| Replace color                 | RGB and HSL-oriented modes                         | No                                                                           | miniPaint                      |
| Color to alpha                | Yes                                                | No                                                                           | miniPaint                      |
| Restore alpha                 | Yes                                                | No                                                                           | miniPaint                      |
| Background removal            | External remove.bg link only                       | Local ML worker with progress, cancel, GPU/CPU fallback, and size safeguards | OpenPost                       |
| Content-aware fill/inpainting | No; Content Fill extends or blurs edges            | No                                                                           | Missing in both                |
| Edge-extension backgrounds    | Three Content Fill modes                           | Image page background can cover/contain/stretch, but no edge cloning         | miniPaint                      |

miniPaint's fill and magic-erase source deserves special caution. The branch
named `contiguous === false` performs the local flood fill, while the other
branch performs a global scan. That is the reverse of the visible option's
usual meaning. The global scan also contains unusual shifted pixel indexing.
OpenPost's tested `magicPixelMask` should remain the basis for these tools.

### Shapes and text

| Capability            | miniPaint                                                                                                 | OpenPost                                            | Lead and notes      |
| --------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------- |
| Basic shapes          | Line, arrow, rectangle, ellipse                                                                           | Line, rectangle, rounded rectangle, ellipse         | Split               |
| Extended shapes       | Triangles, rhombus, parallelogram, trapezoid, plus, polygons, star, heart, cog, callout, Bézier, and more | No                                                  | miniPaint           |
| Shape constraints     | Square/circle and tool-specific parameters                                                                | Shift constraint through canvas interactions        | Split               |
| Rich text spans       | Bold, italic, underline, strike, fill/stroke ranges                                                       | Whole-layer bold/italic/underline/strike; no spans  | miniPaint for spans |
| Font sources          | System, user upload, Google Fonts                                                                         | Bundled and licensed workspace uploads              | Split               |
| Weight/style          | Bold/italic and ranges                                                                                    | Weights 100-900 and normal/italic                   | OpenPost            |
| Kerning/leading       | Manual kerning and leading                                                                                | Letter spacing and line height                      | Split               |
| Text wrapping         | Dynamic/box bounds, word or word+letter                                                                   | Exposed automatic and fixed-width wrapping          | Split               |
| Text stroke/highlight | Stroke                                                                                                    | Stroke and highlight                                | OpenPost            |
| Text shadows          | Common layer shadow                                                                                       | Structured text/layer shadow controls               | OpenPost            |
| Curved text           | No                                                                                                        | Arc up/down, wave, circle, ellipse                  | OpenPost            |
| Vertical/RTL text     | Data/UI placeholders, but hidden as future work                                                           | No dedicated controls                               | Missing in both     |
| Brand text styles     | No brand model                                                                                            | Direct whole-layer and multi-text-layer application | OpenPost            |

### Image adjustments and effects

| Capability               | miniPaint                                                                                             | OpenPost                                                                                                | Lead and notes        |
| ------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------- |
| Basic adjustments        | Brightness, contrast, saturation, hue, luminance, RGB                                                 | Brightness, exposure, contrast, highlights, shadows, temperature, tint, vibrance, saturation, hue, blur | OpenPost              |
| Preset looks             | Nine Instagram-style filters                                                                          | Original, Crisp, Warm, Cool, Mono                                                                       | miniPaint for breadth |
| Editable filters         | Nine CSS-like layer filters                                                                           | Structured image adjustments and layer effects                                                          | Split                 |
| Artistic effects         | More than twenty effects including oil, pencil, mosaic, emboss, dither, vignette, vintage, tilt shift | No equivalent gallery                                                                                   | miniPaint             |
| Effect previews          | Thumbnail effect browser and modal previews                                                           | Live canvas/property changes                                                                            | Split                 |
| Masks                    | No general structured shape mask                                                                      | Rectangle, rounded rectangle, circle, ellipse, diamond                                                  | OpenPost              |
| Borders                  | Destructive border effect                                                                             | Editable inside/center/outside stroke                                                                   | OpenPost              |
| Drop shadow              | Common filter                                                                                         | Editable drop shadow                                                                                    | OpenPost              |
| Inner shadow             | No                                                                                                    | Editable inner shadow                                                                                   | OpenPost              |
| Non-destructive workflow | Some common filters only                                                                              | Adjustments, masks, borders, shadows, image crop, erase masks                                           | OpenPost              |

### Canvas and image utilities

| Capability                   | miniPaint                                              | OpenPost                                                          | Lead and notes                  |
| ---------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------- |
| Interactive crop             | Yes; rotated layers must first be rasterized           | Non-destructive frame/image modes, presets, keyboard, rotate/flip | OpenPost                        |
| Trim transparent/white edges | Active/all layers with tolerance                       | No                                                                | miniPaint                       |
| Canvas resize                | Units, resolution, anchors, presets, autoresize        | Pixel dimensions and presets                                      | miniPaint                       |
| Resample image               | Basic, Hermite, and Pica/Lanczos with optional sharpen | Object transform/export interpolation                             | miniPaint                       |
| Arbitrary image rotation     | Image command                                          | Per-layer transform rotation                                      | Split                           |
| Flip                         | Image command                                          | Per-layer horizontal/vertical transform flags                     | Split                           |
| Translate                    | Dedicated image command                                | Layer transform/nudge                                             | OpenPost for normal design work |
| Histogram                    | Yes                                                    | No                                                                | miniPaint                       |
| EXIF inspection              | Yes                                                    | No                                                                | miniPaint                       |
| Color palette extraction     | Yes                                                    | Recent and brand colors, no extraction                            | miniPaint                       |
| Decrease color depth         | Yes                                                    | No                                                                | miniPaint                       |
| Auto color adjustment        | Yes                                                    | No one-click auto adjustment                                      | miniPaint                       |
| Sprite-sheet layout          | Packs visible trimmed layers with a gap                | No                                                                | miniPaint                       |
| Key-point visualization      | Home-grown SIFT-like analysis into a layer             | No                                                                | miniPaint, but niche            |
| Layer animation preview      | Cycles layer visibility                                | No still-image animation                                          | miniPaint, but limited          |

### Assets and import

| Capability             | miniPaint                                           | OpenPost                                                                         | Lead and notes |
| ---------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- | -------------- |
| File picker            | Multiple browser-decodable images and JSON          | PNG, JPEG, WebP entry flow; broader managed image picker after upload conversion | Split          |
| Directory import       | `webkitdirectory` and recursive dropped directories | No                                                                               | miniPaint      |
| External OS drag/drop  | Global window drop                                  | Direct canvas drop through guest/cloud media lifecycle                           | Tie            |
| Exact drop placement   | No; imports become layers without pointer placement | External, Library, and stock drops use document coordinates with ordered cascade | OpenPost       |
| Clipboard image        | Yes                                                 | Yes, with managed/local persistence                                              | OpenPost       |
| Clipboard text         | No dedicated editable text creation                 | Creates a text layer                                                             | OpenPost       |
| Webcam/camera          | Webcam dialog                                       | Shared camera capture and media lifecycle                                        | OpenPost       |
| URL/data URL import    | Both                                                | No arbitrary remote URL or data URL                                              | miniPaint      |
| Stock media            | Pixabay with safe-search setting                    | Configured providers, filters, provenance, and managed save                      | OpenPost       |
| Asset search/tags/sort | No persistent library                               | Library search, tags, sort, favorites, recent, and provenance                    | OpenPost       |
| Replace selected image | Open new layer                                      | Replace through asset panel while retaining layer structure                      | OpenPost       |
| Background image       | Imported layer                                      | Structured page background image                                                 | OpenPost       |
| Upload lifecycle       | Browser-local                                       | Library retention and workspace-scoped media                                     | OpenPost       |

### Export and delivery

| Capability             | miniPaint                                              | OpenPost                                                  | Lead and notes   |
| ---------------------- | ------------------------------------------------------ | --------------------------------------------------------- | ---------------- |
| PNG/JPEG/WebP          | Yes                                                    | Yes                                                       | Tie              |
| GIF                    | Visible layers become frames                           | No                                                        | miniPaint        |
| BMP/TIFF               | Yes, subject to browser/library support                | No                                                        | miniPaint        |
| AVIF                   | Code path present but disabled                         | No                                                        | Neither ships it |
| Quality control        | JPEG/WebP                                              | JPEG/WebP                                                 | Tie              |
| File-size preview      | Optional, normally under 1 MP                          | Output count and pixel summary, not encoded byte estimate | miniPaint        |
| Transparency/matte     | Transparent setting; JPEG/nontransparent becomes white | Explicit matte color for non-alpha output                 | OpenPost         |
| Selected-layer export  | Yes                                                    | No direct command                                         | miniPaint        |
| Separated-layer export | Yes, including original-type inference                 | No                                                        | miniPaint        |
| Multi-page export      | No pages; GIF uses layers                              | Ordered files or ZIP                                      | OpenPost         |
| Data URL               | Open and save                                          | No                                                        | miniPaint        |
| Print                  | Yes                                                    | No                                                        | miniPaint        |
| Save to managed media  | No                                                     | Yes, with design/page provenance                          | OpenPost         |
| Return to post         | No                                                     | Two-hour token and ordered attachment workflow            | OpenPost         |

### Precision, movement, and navigation

| Capability              | miniPaint                                     | OpenPost                                              | Lead and notes                        |
| ----------------------- | --------------------------------------------- | ----------------------------------------------------- | ------------------------------------- |
| Move snapping           | Canvas, layer, and manual-guide edges/centers | Canvas, object, guide, and grid candidates            | OpenPost                              |
| Resize snapping         | Limited                                       | Object, guide, and grid candidates                    | OpenPost                              |
| Rotation snapping       | No                                            | 15-degree increments while Shift is held              | OpenPost                              |
| Stable screen threshold | Threshold scales with document dimensions     | Ten screen pixels adjusted by zoom                    | OpenPost                              |
| Snap setting            | Global enable/disable                         | Persistent View/mobile toggle                         | Tie                                   |
| Temporary snap bypass   | Shift or Control/Command                      | Command/Control during transform                      | Tie                                   |
| Manual guides           | Insert, update, remove                        | Drag from rulers plus validated numeric guide dialog  | OpenPost                              |
| Rulers                  | Yes                                           | Toggleable rulers with live coordinates               | Tie                                   |
| Grid                    | Yes                                           | Persistent toggle with snapping                       | Tie                                   |
| Arrow nudge             | 10 px; Shift 1 px; Control/Command 50 px      | 1 px; Shift 10 px                                     | Split                                 |
| Pointer-anchored zoom   | Wheel                                         | Control/Command-wheel                                 | OpenPost avoids accidental wheel zoom |
| Pan                     | Preview navigator and scroll layout           | Wheel, Shift-wheel, space, middle button, hand, touch | OpenPost                              |
| Pinch zoom              | No complete gesture found                     | Two-finger anchored pinch and pan                     | OpenPost                              |
| Fit/100%                | Yes                                           | Yes                                                   | Tie                                   |
| Zoom range              | Very broad internal range                     | Practical 10%-400%                                    | Split                                 |

### Keyboard, menus, and small interactions

| Capability                  | miniPaint                                     | OpenPost                                                                                             | Lead and notes        |
| --------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------- |
| Command menus               | File/Edit/View/Image/Layer/Effects/Tools/Help | Compact File/Edit/View and contextual tool UI                                                        | miniPaint for breadth |
| Tool hotkeys                | Limited tool keys; H opens shapes             | V/L/W/B/P/E/Shift+E/G/Shift+G/T/H/Z/U/M/Shift+M                                                      | OpenPost              |
| Common edit keys            | Undo/redo/copy/paste/select all/delete        | Adds cut, duplicate, group, ungroup, deselect                                                        | OpenPost              |
| Shortcut help               | Lists about 22 shortcuts                      | Complete platform-aware list generated from typed commands                                           | OpenPost              |
| Search commands             | F3/Command+F search                           | No command palette                                                                                   | miniPaint             |
| Repeated arrow history      | Consecutive movement is bundled               | Normal history coalescing                                                                            | Split                 |
| Alt-drag duplicate          | No                                            | Yes, with ghost preview                                                                              | OpenPost              |
| Layer/page keyboard reorder | No                                            | Alt+arrow                                                                                            | OpenPost              |
| Inline layer rename         | Double-click opens rename                     | Inline and F2                                                                                        | OpenPost              |
| Recent colors               | Basic swatches                                | Eight local recent colors plus brand colors                                                          | OpenPost              |
| Screen eyedropper           | Canvas sampler copies hex                     | Browser picker plus active/composite canvas sampler, 9x9 grid, keyboard cursor, and explicit targets | OpenPost              |
| Leave-page protection       | Optional exit confirmation                    | Unsaved-change/recovery integration                                                                  | OpenPost              |
| Full screen                 | Yes                                           | Browser/application layout only                                                                      | miniPaint             |

### Responsive design, accessibility, and localization

| Capability                | miniPaint                                  | OpenPost                                         | Lead and notes        |
| ------------------------- | ------------------------------------------ | ------------------------------------------------ | --------------------- |
| Phone layout              | Off-canvas sidebars                        | Dedicated bottom actions and editing sheets      | OpenPost              |
| Tablet layout             | Responsive canvas/sidebar behavior         | Horizontal tool rail and content-safe panels     | OpenPost              |
| Touch targets             | Mixed                                      | Shared mobile-size controls                      | OpenPost              |
| Semantic tool controls    | Tool spans lack button semantics/tab stops | Buttons, labels, tree roles, status regions      | OpenPost              |
| Keyboard layer management | Limited                                    | Selection, rename, reorder, visibility, grouping | OpenPost              |
| User page zoom            | Viewport disables browser zoom             | Browser zoom remains enabled                     | OpenPost              |
| Languages                 | English plus 15 translation files          | English and Portuguese                           | miniPaint for breadth |
| Themes                    | Dark, light, green                         | Application light/dark theme                     | Split                 |

## Important miniPaint implementation constraints

- Crop rejects rotated layers until they are rasterized.
- Clone and several local brushes reject resized or rotated objects until they
  are rasterized.
- Selection translation is explicitly short-circuited in the source.
- Automatic transparent-pixel layer selection falls back to rectangles above
  about five megapixels.
- Text rotation has acknowledged metric/selection limitations.
- Vertical alignment and text direction controls are hidden future work.
- Many artistic operations permanently replace pixel data and depend on undo for
  recovery.
- Content Fill is edge expansion, edge cloning, or a stretched blurred
  background. It is not semantic fill or inpainting.
- Key-Points is a home-grown feature-point visualization, not object recognition
  or an intelligent editing primitive.
- The application uses global mutable configuration and singleton services. It
  is useful as behavioral reference code, not as architecture to transplant.

## Important OpenPost implementation constraints

- Alpha hit testing uses fingerprinted adaptive masks, Alt-click cycling, and a
  visible Select layer menu without miniPaint's fixed five-megapixel quality cliff.
- Pixel selection can cut, delete, promote, copy, paste, move, resize, rotate,
  and duplicate floating content with one commit/cancel history boundary.
- Brand backgrounds and whole-layer text styles include missing-asset recovery,
  mixed values, compatible multi-apply, and partial-application feedback.
- External drops are exact, bounded, page-targeted, and failure-isolated;
  signed-in project import is cancellable and resumes completed work. A single
  guest OPFS write still cannot be interrupted once the browser starts it.
- Guides, rulers, grid, crop handles, gradient endpoints, object transforms, and
  temporary bypass share a high-DPI and CSS-zoom-safe screen-space contract.
- Typed commands drive dispatch, desktop/mobile placement, labels, shortcut help,
  tooltips, handlers, checked state, and disabled explanations.
- A 25 MP full-resolution selection mask and composited sampling can be costly.
- History restores page, object/pixel selection, tool, zoom, and pan and avoids a
  redundant post-command clone, but full snapshots can still be expensive for
  very large multi-page paint documents.
- Portable project files validate archive paths and sizes and remap media into a
  new design, but licensed-font transfer remains.

## Recommended adoption sequence

### P0: expected editor behavior

Completed:

- [x] Finish image-within-frame repositioning and crop-local rotate/flip controls.
- [x] Add a true pixel-grid eyedropper magnifier and keyboard sampling cursor.
- [x] Add bounded mixed-file import, per-file failure recovery, full-pasteboard
      feedback, and stable page targeting.
- [x] Apply one zoom-correct snap contract to object transforms, crop handles,
      guides, and gradient endpoints.

- [x] Generate menus, tooltips, mobile actions, handlers, checked states, and
      disabled explanations from the typed command registry.
- [x] Cache adaptive alpha masks and add Alt-click cycling plus Select layer.
- [x] Add resize, rotation, and duplicate controls to floating pixel selections.
- [x] Complete missing brand-asset recovery and mixed-value/partial application.
- [x] Add high-DPI/browser-zoom coordinate proof, touch/stylus coverage, and
      signed-in cancellable/resumable project import.

### P1: creative depth

1. Complete hardness, spacing, and alternate brush tips; pressure, smoothing,
   and stylus palm rejection are now available.
2. Add a non-destructive clone/heal workflow.
3. Add localized blur, sharpen, and desaturate tools.
4. Add replace-color and color-to-alpha operations.
5. Expand the structured shape catalog before considering arbitrary paths.
6. Add more portable blend modes with renderer/export parity tests.
7. Add rich text spans and vertical alignment; underline, strike, and explicit
   wrapping are now available at whole-layer scope.
8. Complete licensed-font portability and output-pixel tests for the validated
   `.openpost-image` archive format.

### P2: specialist utilities

1. Trim transparent or near-solid page edges.
2. Add histogram, palette extraction, and safe EXIF inspection.
3. Offer high-quality raster resampling and optional post-resize sharpening.
4. Add a non-destructive creative-effect gallery.
5. Add selected-layer/separated-layer export where it supports asset workflows.
6. Consider layer-frame GIF export only if animation becomes a supported product
   goal.

## Behaviors not to copy

- Do not adopt miniPaint's global singleton state or direct cross-module mutation.
- Do not make destructive pixel replacement the default effect model.
- Do not copy the current contiguous/global bucket branches.
- Do not scale snap sensitivity from canvas dimensions.
- Do not disable browser zoom or expose non-semantic icon spans as tools.
- Do not call edge extension "Content Fill" without making its limited behavior
  explicit.
- Do not use a fixed five-megapixel cliff for hit-testing quality; use cached
  masks, candidate limits, or adaptive work instead.
- Do not move OpenPost recovery back to a small localStorage-only quicksave.

## Verification from this review

- miniPaint `npm ci` completed.
- miniPaint `npm run build` completed. The single bundle was about 1.29 MiB and
  produced size warnings.
- miniPaint has no automated test or lint script. Its full install audit reported
  15 advisories; the production-only audit reported one moderate `uuid` advisory.
- OpenPost's focused Image Editor unit run passed 130 tests across 23 files.
- OpenPost's focused Image Editor browser suite now covers twelve scenarios,
  including renderer sampling, signed-in import cancellation/resume, keyboard-only
  export, Portuguese at 200%, pinch zoom, stylus palm rejection, 320 px, and
  short landscape.
- The repository-owned `devenv shell -- verify` gate passed checks, lint, all
  tests, frontend/marketing/docs builds, and generated-contract validation.
- The Svelte analyzer reported no component errors across the Image Editor
  components. Its remaining suggestions concerned effects and element bindings,
  not invalid syntax.
