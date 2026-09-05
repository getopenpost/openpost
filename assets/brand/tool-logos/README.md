# OpenPost tool logos

Four proposed tool identities: Composer, Image Editor, Video Editor, and Recorder. These assets are not wired into the application.

Open `preview.html` in a browser to inspect the SVGs, light/dark appearance, small sizes, monochrome marks, and a transition from Converge. The preview is self-contained apart from sibling assets and the original parent logo.

## Files

- `<tool>.svg`: colored tile with white geometry, 160 × 160 viewBox.
- `<tool>-mono.svg`: transparent symbol using `currentColor`, with a brand-color default. Override CSS `color` when inlining; an SVG loaded through `<img>` does not inherit the host page's color.
- `<tool>.png`: 1024 px transparent-corner export from the SVG.
- `openpost.svg` and `openpost-mono.svg`: the exact existing Converge symbol geometry in the same coordinate system and padding as the tools. This tile presentation differs from the canonical application icon's padding.
- `concept-*.png`: generated exploration images, not vector source artwork.
- `preview-*.png`: browser captures of the final SVGs.
- `family.svg` and `family.png`: presentation sheet of the final vectors.

The canonical parent sources remain `../logo.svg` and `../icon.svg`. They already are SVGs and were not changed.

## Construction and motion

All symbols use the parent's 128-unit coordinate system, translated by 16 units into a 160-unit canvas. The lower modules keep compatible path commands with Converge. `module-sw` and `module-se` can interpolate between the parent and tool coordinates. `background`, `symbol`, `tool-field`, and `detail-*` identify the other parts.

The preview demonstrates lower-module path interpolation, background-color interpolation, and an upper-artwork crossfade. It does not claim a continuous path morph for the upper artwork, whose topology differs between tools. Motion runs only on request; reduced-motion users jump to the endpoint. The exported SVGs contain no scripts, animation, fonts, raster images, masks, or external dependencies. Namespace their IDs if embedding multiple copies inline.

Composer uses Workshop Orange `#B74C05`. The media tools share `#7952B3`. These are identity colors, not action, selection, or status tokens. Use these marks on branded tool cards, headers, and marketing. Keep navigation on the active theme icon pack. Preserve existing specialized editor glyphs.

Prefer the full marks at 32 px and above. The 16/24 px samples are stress checks, not replacements for small theme icons.

## Validation

Inspected the rendered vectors in light and dark appearances at desktop, 390 px, and 320 px. Checked horizontal overflow, all four transition endpoints, reduced-motion behavior, and browser script errors. PNG exports come directly from the final SVGs.
