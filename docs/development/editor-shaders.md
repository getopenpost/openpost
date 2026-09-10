# Video Editor shader backgrounds

Backgrounds contains six animated presets powered by `@paper-design/shaders` 0.0.80: Aurora, Dusk, Ribbons, Monochrome, Clouds, and Neural. Existing gradients and patterns remain available below them. Select a preset to insert a three-second background at the playhead, then edit its colors, speed, starting phase, detail, and geometry in the inspector. Set speed to zero to hold a still frame.

## Library review

Reviewed the [shaders.com guide](https://shaders.com/docs/guide), [its license](https://shaders.com/license), the [Paper gallery](https://shaders.paper.design), and [Paper's published source and license](https://github.com/paper-design/shaders) on 2026-09-10.

| Library / group                                                                                            | Fit for OpenPost                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shaders.com                                                                                                | Composable WebGPU effects with a Svelte integration. Its license excludes design editors and SaaS integration without a separate OEM agreement. No code or presets from this library are included.       |
| Paper mesh gradients, swirls, Perlin noise, neural noise                                                   | Useful motion backgrounds behind titles and footage. The first six presets use these four shaders.                                                                                                       |
| Paper static gradients, waves, dot grids                                                                   | Overlap with existing still gradients and patterns. Keep the existing controls and saved appearance.                                                                                                     |
| Paper warp, grain, orbiting dots, simplex noise, Voronoi, borders, metaballs, smoke, rays, panels, spirals | Possible additional backgrounds. This first catalog concentrates on six distinct looks with a small set of understandable controls.                                                                      |
| Paper fluted glass, water, dithering, halftone, paper texture, lens distortion                             | Belong with clip or image effects. The Video Editor already includes fluted glass and halftone adaptations. Adding these again as backgrounds would duplicate controls or misrepresent what they affect. |
| Paper heatmap, liquid metal, gem smoke                                                                     | Require logo/image preparation and masking. They need a separate asset workflow before becoming editor presets.                                                                                          |

The Image Editor remains unchanged in this pass. Its still backgrounds and image effects have a separate document and Fabric rendering contract.

## Rendering contract

`backgrounds/shaders.ts` owns the curated presets. The project stores their full parameters, not a reference to mutable preset defaults. Project schema 8 adds shader backgrounds without changing existing content. Older editor versions cannot render these backgrounds. `clampBackground` normalizes saved state, and the existing background commands own insertion, updates, undo and redo.

`ShaderBackgroundRenderer` consumes Paper's public fragment shaders through a WebGL 2 adapter compatible with `OffscreenCanvas`. It has no DOM mount, requestAnimationFrame loop, image fetch, or wall clock. Its coordinates use a fixed design height so output resolution changes preserve composition.

The compositor passes sequence time in seconds. Shader time is `phase + sequenceTime * speed`, so scrubbing is deterministic and cuts stay continuous. Cache keys include shader time. A zero-speed background stays fixed even during playback. Transforms, blending, masks, clip effects, and sequence grading continue through their existing owners.

A compositor owns and disposes its shader context and compiled programs. Thumbnail contexts are released after drawing still previews. Rendering failures use the existing exact-render error path; export must fail rather than save a substituted or blank shader background. The Backgrounds gallery explains unavailable WebGL 2 support and disables shader insertion.

The dependency is pinned because Paper uses breaking 0.0.x releases. Retain its Apache license and NOTICE in source and distributed assets. Verify real pixels, seeking, still mode, serialization, undo, a rendered export, and responsive controls before updating it.
