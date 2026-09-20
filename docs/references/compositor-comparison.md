# Compositor and the OpenPost Image Editor

Reviewed 2026-09-20. This is a source comparison and a proposal for improvements, not a claim that the native application or its benchmarks were tested here.

## Sources and scope

- [Compositor](https://github.com/robbietilton/Compositor/tree/a19db9011282399785dc18efcfded904627bdcc2), revision `a19db9011282399785dc18efcfded904627bdcc2`, shallow checkout at `docs/references/compositor/`.
- [MIT license](https://github.com/robbietilton/Compositor/blob/a19db9011282399785dc18efcfded904627bdcc2/LICENSE), copyright 2026 Wonder Assembly LLC. Retain its copyright and permission notice for copied or substantially derived code. No source was copied into OpenPost in this review.
- OpenPost source baseline: `4d59a4f6fb14eb5b11418cab14781ded56443fb6`. The earlier live Image Editor audit exercised v5.1.2, revision `9fa320ee373a28ccb1db18c1e310aca06c67fdab`. Source changes since that deployment do not prove the deployed bugs are fixed.
- Compositor is a native, raster-first macOS 26 application using SwiftUI, AppKit, Core Image, Vision, and Metal. OpenPost is a browser-based, mixed vector/raster, multi-page social-image editor. Compare behavior and algorithms; preserve OpenPost's document, media, history, and publishing boundaries.

Compositor complements miniPaint. Use miniPaint for browser-oriented tools and Compositor for mask semantics, transform sessions, raster editing, and rendering correctness. Neither is an architectural replacement for OpenPost.

## Recommended order

First prove project identity, selection transforms, crop geometry, and preview/export agreement. Those foundations matter more than another filter. Then add the missing compositing operations, improve interactive previews, and extend retouching. Large renderer changes need measured browser evidence.

| Priority | Improvement                   | OpenPost today                                                                                                                                                        | Useful Compositor approach                                                                                                                                                                                                                           |
| -------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First    | Collective numeric transforms | Pointer transforms use Fabric's collective selection, but numeric X/Y/size/rotation/flip writes the same value to each selected root. Setting X can collapse spacing. | Model one selection bounding box with each member's original transform. Numeric and pointer operations should preserve relative positions. Keep any “set each” behavior explicit.                                                                    |
| Next     | Editable raster layer masks   | Geometric shape masks and erase strokes/spans exist. There is no separately selectable grayscale mask with reveal/hide painting.                                      | Separate image and mask targets, mask thumbnail, reveal/hide all, create from selection, paint, invert, enable/disable. Let background removal produce an editable mask.                                                                             |
| Next     | Selection refinement          | Rectangle, ellipse, freehand lasso, magic selection, Boolean modes, tolerance, contiguous/all-layer sampling, and floating pixel transforms already exist.            | Add expand/contract/invert, load layer alpha or mask as selection, anti-alias control, and polygonal lasso. Feathering is also useful, building on Compositor's mask feathering rather than assuming its path selections implement every refinement. |
| Next     | Rasterize and merge           | Group/ungroup and pixel extraction exist; the command registry has no rasterize, merge down, merge selected, or flatten-page command.                                 | Bake the selected result with its masks, opacity, blend modes, and adjustments; preserve parent/insertion point; commit one undo step. Make loss of text/shape editability explicit.                                                                 |
| Next     | Encoded export preview        | PNG/JPEG/WebP, quality, and JPEG transparency matte already exist. The export dialog does not show the encoded result and byte count before export.                   | Preview the actual encoded image, display exact bytes, debounce setting changes, discard stale results, and export the same bytes that were previewed.                                                                                               |
| Later    | Clone stamp and spot healing  | Retouch offers crop, eraser, magic eraser, and background removal.                                                                                                    | Start with explicit source selection, aligned/fixed source, current/composite sampling, and size/hardness/opacity. Add healing after raster patches and undo are sound.                                                                              |
| Later    | Free distort/perspective      | Persisted transforms support position, dimensions, rotation, and flips.                                                                                               | Useful for product mockups, but requires a new transform contract and matching masks, selection, preview, export, and undo. Follow collective-transform fixes.                                                                                       |

Feature owners:

- OpenPost: [`types.ts`](../../apps/web/src/lib/image-editor/types.ts), [`commands.ts`](../../apps/web/src/lib/image-editor/commands.ts), [`editor.svelte.ts`](../../apps/web/src/lib/image-editor/editor.svelte.ts) (`updateSelectedTransform`), [`properties-panel.svelte`](../../apps/web/src/lib/image-editor/components/properties-panel.svelte), [`image-editor-canvas.svelte`](../../apps/web/src/lib/image-editor/components/image-editor-canvas.svelte), and [`image-editor-shell.svelte`](../../apps/web/src/lib/image-editor/components/image-editor-shell.svelte).
- Compositor: [`LayerMask.swift`](https://github.com/robbietilton/Compositor/blob/a19db9011282399785dc18efcfded904627bdcc2/Compositor/Document/LayerMask.swift), [`Selection.swift`](https://github.com/robbietilton/Compositor/blob/a19db9011282399785dc18efcfded904627bdcc2/Compositor/Document/Selection.swift), [`LayerMerge.swift`](https://github.com/robbietilton/Compositor/blob/a19db9011282399785dc18efcfded904627bdcc2/Compositor/Document/LayerMerge.swift), [`LayerTransform.swift`](https://github.com/robbietilton/Compositor/blob/a19db9011282399785dc18efcfded904627bdcc2/Compositor/Document/LayerTransform.swift), [`CloneStamp.swift`](https://github.com/robbietilton/Compositor/blob/a19db9011282399785dc18efcfded904627bdcc2/Compositor/Document/CloneStamp.swift), and [`JPEGExportSheet.swift`](https://github.com/robbietilton/Compositor/blob/a19db9011282399785dc18efcfded904627bdcc2/Compositor/UI/JPEGExportSheet.swift).

## Interaction and visual lessons

Compositor's context controls are useful references for reducing discovery work: selection refinement beside selection tools, shared size/hardness/opacity across brush tools, and explicit image-versus-mask targeting in the layer row. OpenPost should keep common photo adjustments immediately accessible, expose alignment when multiple layers are selected, and clearly distinguish Page, Layer, and Mask targets. These recommendations also address the earlier live audit's buried alignment and crowded Color controls.

Use an explicit preview session for a destructive filter or complex transform: transient updates, Apply, Cancel/Escape, and one committed history entry. Do not add confirmation steps to every ordinary edit. Keep keyboard shortcuts out of focused text and numeric fields, and retain visible focus and touch-sized controls on coarse pointers.

Do not copy Compositor's native desktop layout wholesale. OpenPost must still work on narrow screens, preserve the live canvas, and use its shared editor controls and theme. These are source-informed design recommendations, not results from a new live Compositor usability test.

## Performance approaches worth adapting

### Smaller interactive previews and latest-wins scheduling

Compositor's [`Filters.swift`](https://github.com/robbietilton/Compositor/blob/a19db9011282399785dc18efcfded904627bdcc2/Compositor/Document/Filters.swift) bounds most filter previews to a 2048-pixel longest edge. Noise, grain, content-aware fill, and background removal are exceptions. It runs one preview job and retains only the newest pending settings, allowing the current job to finish so dragging continues to show progress.

OpenPost's [`fabric-adapter.ts`](../../apps/web/src/lib/image-editor/fabric-adapter.ts) grades full intrinsic-size sources. Budget interactive grade renders by displayed pixels and device scale, while keeping original sources and full-resolution export. Scale-dependent effects need separate treatment. Verify preview/export equivalence at representative zooms before adopting a lower resolution.

The existing [`preview-queue.ts`](../../apps/web/src/lib/image-editor/preview-queue.ts) already bounds concurrency, and page thumbnails use visibility and stale-result guards. Improve it by coalescing pending work for the same page and passing cancellation into render setup. Do not merely increase concurrency or repeatedly cancel work so nothing completes.

### Image pyramids and dirty regions, only after profiling

Compositor's [`DownsampleCache.swift`](https://github.com/robbietilton/Compositor/blob/a19db9011282399785dc18efcfded904627bdcc2/Compositor/Rendering/DownsampleCache.swift) caches successive half-size images and selects a level by display scale. A browser equivalent could cache bounded `ImageBitmap` levels by media identity, grade fingerprint, and scale. Do not copy its approximately 400 MB native cache allowance into a browser tab.

Its [`EditorCanvas.swift`](https://github.com/robbietilton/Compositor/blob/a19db9011282399785dc18efcfded904627bdcc2/Compositor/Rendering/EditorCanvas.swift) redraws changed visible regions, particularly during brush strokes, and separates cursor/handle overlays. Other state changes can still invalidate the full canvas. OpenPost already retains unchanged Fabric objects and uses SVG feedback for active paint strokes. Extend those seams before considering a Fabric fork or replacement. Profile zoomed-out panning, transforms, and grading to establish whether raster redraw is actually the bottleneck.

### Sparse raster patches for large brushes and masks

Compositor's [`RasterSnapshot.swift`](https://github.com/robbietilton/Compositor/blob/a19db9011282399785dc18efcfded904627bdcc2/Compositor/Rendering/RasterSnapshot.swift) shares unchanged tiles, commits replacement patches, and materializes contiguous pixels only when needed. OpenPost currently rasterizes a document-sized byte array at stroke completion and converts it to spans. That can make mouse-up cost scale with canvas area.

If 4K browser profiling confirms stalls, move rasterization to a worker, then consider immutable 256/512-pixel patches behind the existing paint layer interface. Keep mask/image assets behind media storage rather than embedding full raster arrays in document JSON. Design autosave, portable-project packaging, migration, export, and history eviction before changing storage.

The upstream [brush benchmark](https://github.com/robbietilton/Compositor/blob/a19db9011282399785dc18efcfded904627bdcc2/docs/brush-performance.md) reports native synchronous CPU timings. It is not an input-to-photon benchmark, a browser measurement, or evidence that OpenPost will achieve those numbers. No benchmark was rerun for this review.

## Correctness lessons before optimization

1. **Project identity is a session invariant.** Compositor's [`ProjectWorkspace.swift`](https://github.com/robbietilton/Compositor/blob/a19db9011282399785dc18efcfded904627bdcc2/Compositor/Document/ProjectWorkspace.swift) gives each project a separate session; validated content and destination are installed together. OpenPost's current route clears a different design before loading the next, and async mutations capture identity. Prove the exact live-audit failure with a browser regression: import A, navigate to B, edit/save B, reload both, assert IDs and content. Source changes alone do not close a wrong-document-write report.
2. **Preview must agree with export.** Borrow the assertions in [`TiledLayerTests.swift`](https://github.com/robbietilton/Compositor/blob/a19db9011282399785dc18efcfded904627bdcc2/CompositorTests/TiledLayerTests.swift) and [`RasterSnapshotTests.swift`](https://github.com/robbietilton/Compositor/blob/a19db9011282399785dc18efcfded904627bdcc2/CompositorTests/RasterSnapshotTests.swift): rotation, masks, transparency, tile boundaries, consecutive strokes, save/reopen, and undo. Add browser pixel comparisons for OpenPost's transforms, crop, gradients, masks, paint, and export before changing rendering.
3. **Keep immutable history.** OpenPost already has structural sharing, gesture coalescing, and bounded history. Improve estimates for large paint/erase deltas if needed; do not replace that design with native image-pointer accounting.
4. **Validate complete projects before installation.** Compositor's [project format](https://github.com/robbietilton/Compositor/blob/a19db9011282399785dc18efcfded904627bdcc2/docs/project-format.md) rejects unsafe asset paths, invalid references, unsupported versions, and excessive resource sizes. Extend OpenPost's existing portable-project validation when adding masks or distortion. Image export must remain distinct from saving an editable project.

## Keep the scope focused

OpenPost already has nested groups, blend modes, opacity, snapping, rulers, guides, alignment/distribution, advanced pixel selection, browser-local ML background removal, wheels, curves, scopes, looks, and before/after comparison. It also has multi-page social formats, templates, brand kits, workspace media, stock search, cloud revisions, portable projects, and publishing handoffs. These are not missing because Compositor implements related concepts.

Compositor's deterministic content-aware fill and healing are worth later evaluation, but should not be described as generative AI. Apple Vision background removal is not a browser-portable upgrade to OpenPost's existing model. Do not prioritize native tabs, print-resolution controls, liquify, or a wholesale renderer replacement without evidence of demand in OpenPost's social-image workflow.

A new raster mask must compose with saved geometric and erase masks. A rasterize/merge command must be explicit and undoable. Every new feature must preserve editable text/shapes unless the user requests baking them, respect locked layers, and share exact preview/export semantics.
