# Video Editor shaders

The Video Editor includes all 30 families in [Paper's catalogue](https://shaders.paper.design), using the pinned `@paper-design/shaders` 0.0.80 package. Backgrounds and Effects both support search.

| Location                           | Families                                                                                                                                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backgrounds                        | Mesh gradient, static mesh gradient, static radial gradient, dithering, grain gradient, dot orbit, dot grid, warp, spiral, swirl, waves, neuro noise, Perlin noise, simplex noise, Voronoi, pulsing border, metaballs, color panels, smoke ring, god rays |
| Effects → Shaders                  | Paper texture, fluted glass, water, image dithering, halftone dots, halftone CMYK, lens distortion                                                                                                                                                        |
| Effects → Shaders, logo animations | Heatmap, liquid metal, gem smoke                                                                                                                                                                                                                          |

The six original background presets, Aurora, Dusk, Ribbons, Monochrome, Clouds, and Neural, retain their saved appearance and controls. They remain alongside the 20 complete Paper background definitions and the existing eight gradients and patterns. Existing fluted-glass and halftone effects retain their identifiers and rendering; the Shaders group provides the current Paper versions separately.

Insert a background at the playhead, then edit its palette, pattern, motion, and placement in the inspector. Animated shaders have speed and starting-phase controls. Set speed to zero to hold a still frame. Static shaders omit motion controls. Image filters and logo animations operate on the current clip, including preceding effects. Logo source selects transparency, dark areas, or light areas, so both transparent logos and artwork on an opaque background are usable.

The Image Editor has a separate Fabric document and rendering contract. This integration belongs to the Video Editor.

## Rendering and persistence

`effects/paper/` owns the complete catalogue, parameter schemas, shared WebGL adapter, noise samples, and logo preparation. Background controls reuse the same parameter primitives as GPU effects. Each editor command stores authored parameters, with normalization at the project boundary. Schema 9 adds the complete catalogue without changing older content; older editor versions treat these projects as a newer schema. Background commands and effect commands retain ownership of insertion, edits, undo, and redo.

`ShaderBackgroundRenderer` preserves the original four shader implementations and delegates the new definitions to `PaperShaderRenderer`. `GpuCompositor` delegates Paper effect passes to that same adapter in its existing context, then continues the effect chain and blend operation. Paper's premultiplied fragment output is converted to the editor's straight-alpha contract. Resource ownership stays with the compositor.

The adapter uses Paper's public fragment shaders and an attributed adaptation of its vertex stage. It uses `OffscreenCanvas` in preview and export workers, with no DOM mount, animation loop, remote image fetch, or wall clock. Shader time is `phase + sequenceSeconds * speed`. A fixed logical design size preserves composition across preview and export sizes. The built-in Backgrounds and Effects galleries use shipped WebP posters, so opening or scrolling them does not compile shaders. Hover or keyboard focus activates one preview after 180 ms. Live previews stop when offscreen, when the page is hidden, or when reduced motion is enabled. Background previews release their contexts when stopped; effect previews share one compositor. User-created effect presets retain the queued poster cache. Logo thumbnails use a bundled transparent sample and catalogue-only settings; authored effects keep their defaults.

Logo preparation samples the preceding effect pass into an aspect-preserving mask with a 512-pixel longest edge. Paper's heatmap blur channels and red-black Poisson solver are adapted to operate on those pixels synchronously. Each logo effect caches the prepared mask until the source pixels, dimensions, or mask choice change. No derived mask is embedded in the project or fetched during export. The bounded mask resolution limits fine logo-edge detail and keeps moving sources practical.

Heatmap uses the clip's existing bounds, so the adapter removes Paper's padding compensation from its image coordinates. A real-pixel regression preserves logo size and placement at both image edges.

Paper 0.0.80's Simplex Noise calls a derivative helper inside a nonuniform color branch. The adapter evaluates that blend before the branch, because [GLSL derivatives in nonuniform control flow are undefined](https://registry.khronos.org/OpenGL/specs/es/3.2/GLSL_ES_Specification_3.20.html). A real-pixel regression checks repeated frames and seeking.

Rendering failures propagate through the existing exact-render failure path. Export must stop rather than save a substituted or blank shader frame. The background gallery disables unavailable graphics support and individual shaders that fail to render.

## Library and license boundaries

Reviewed the [shaders.com guide](https://shaders.com/docs/guide), [its license](https://shaders.com/license), the Paper catalogue, and [Paper's published source and license](https://github.com/paper-design/shaders) on 2026-09-10. shaders.com excludes design editors and SaaS integration without a separate OEM agreement. No code or presets from that library are included.

Paper permits commercial app and video use under Apache 2.0. Its exact LICENSE and NOTICE ship under `static/licenses/paper-shaders/`. The copied vertex stage, decoded noise data, and adapted logo preparation retain source attribution. Keep the package pinned because Paper uses breaking 0.0.x releases. Before updating, verify every catalogue family with real pixels, input dependence, repeated-frame seeking, still mode, saved controls, undo, rendered exports, and responsive editor interactions.

## Updating catalog posters

Start the frontend with `bun run dev -- frontend`, then run `bun scripts/generate-video-editor-posters.mjs` in Devenv. `OPENPOST_PREVIEW_URL` selects a different development URL. The script captures the same background and effect renderers used by the editor, at fixed sequence time, into `apps/web/static/video-editor-previews/`. Regenerate and commit these assets when built-in presets or their rendering change.
