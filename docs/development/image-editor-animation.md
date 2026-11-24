# Image Editor GIF animation and lens effects

Use the Image Editor for GIF layers and frame timing. Video timelines and keyframe animation belong to the Video Editor.

## Keep the original GIF

`ImageEditorImageValue.animation` stores an ordered list of source frame indexes and durations, the source frame count, and the GIF repeat count. Duplicating or deleting a frame changes this list. It never rewrites the source file. Portable projects and cloud designs retain the original through the existing image media reference.

Frame durations use GIF's 10 ms units, with a 20 ms minimum. Missing or zero source delays become 100 ms. Repeat is `-1` for once, `0` for forever, or a positive repeat count. The loop checkbox chooses once or forever; imported finite repeat counts remain intact until changed.

The frame strip selects a device-local frame override. Playback uses a device-local page clock. Neither changes authored document state or save revisions. Static image exports use the first authored frame. GIF exports merge visible layers' frame boundaries. Identical cycle lengths and repeat counts retain their loop setting. Infinite loops with different periods use their least common cycle; finite animations with different periods expand through their final frame and play once. Exports reject a mix of infinite and finite playback because a GIF cannot repeat only part of its sequence. Composition must stay within the output frame, duration and pixel limits.

`gif-source.worker.ts` parses and decodes GIFs with gifuct-js. Frames are composited with source offsets, transparency, restore-background and restore-previous disposal. `gif-encode.worker.ts` quantizes each complete page frame with gifenc, reserves a transparent palette entry, and uses restore-background disposal. Both workers terminate on cancellation, timeout, or teardown. Export renders and transfers one page frame at a time.

| Limit                                   | Value                          |
| --------------------------------------- | ------------------------------ |
| Source file                             | 20 MB                          |
| Source dimensions                       | 2048 px per side               |
| Source or authored frames               | 200                            |
| Decoded source pixels per active canvas | 16 million, 64 MB of RGBA      |
| Authored duration                       | 60 seconds                     |
| Frame duration                          | 20 to 10,000 ms in 10 ms steps |
| Output dimensions                       | 2048 px per side               |
| Composited output frames                | 200                            |
| Rendered output pixels                  | 100 million                    |
| Encoded output                          | 50 MB                          |

GIF uses at most 256 colors and one-bit transparency. Export alpha below 128 becomes transparent. Overlapping frame boundaries must stay at least 20 ms apart; align timings or export layers separately when that is impossible. Decode and encode work stays off the UI thread. AI image editing and background removal require still images; export a PNG to edit one frame with those tools.

## Render lens effects through one owner

`ImageEditorImageValue.lens_effect` stores the effect kind, strength, highlight threshold, normalized size, angle, and aperture blade count. The property controller uses the normal undo owner. Go and TypeScript validate the same finite bounds.

`lens-effects.ts` analyzes at most 256 pixels per side, selects at most 48 separated highlight points in a stable order, and draws the selected effect. Flare and starburst draw directional rays, mist draws soft halos, prism separates colored highlights, and bokeh draws aperture polygons. These effects respond to bright image content rather than replacing the existing tonal filters.

The Fabric adapter applies the effect after grading and blur, before crop, masks and layer effects. Lens rendering preserves source alpha. Lens previews retain the same full-source coordinates as export so cropping does not move the light sources. Compare canvas and exported pixels when changing this order.

## Verify changes

Use the configured frontend Vitest projects for `commands.test.ts` and `portable-project.test.ts`, which round-trips animated image frames through local projects. The `image editor animation` block in `tests/app/image-editor.spec.ts` covers touch GIF edits that persist across reload and download as an animated GIF, at 390 px and 320 px in both schemes.

The keyboard owner falls back to physical `KeyA` through `KeyZ` positions only for unmodified non-Latin tool keys. Typed Latin keys retain their layout mapping. Ctrl/Cmd, Alt, composition and dead keys keep their existing behavior. Input fields and Fabric text editing remain guarded by the shell's editable-target check.
