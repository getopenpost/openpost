# Refresh the README demos

The README has three scripted captures of the real OpenPost interface: publishing,
thumbnail design, and video editing. Run them against the local browser-test app:

```sh
devenv shell -- bun run capture:product-demos
```

This builds the frontend, starts an isolated test server, creates disposable users,
and records the scenarios in `tests/app/product-demos.spec.ts`, `product-demo-image.ts`, and
`product-demo-video.ts`. Each scene declares its caption, browser actions, total
`seconds`, and final `hold` in milliseconds. Edit those scenes to change the story.
The fixture data is shared with product stills through
`tests/app/product-capture-fixtures.ts`.

The accounts, provider capabilities, schedule response, analytics and inbox are
sample data. Meme rendering, image editing, video editing and the scheduling
celebration use the application UI. These recordings do not prove provider approval
or live publishing. No social account credentials are needed.

## Outputs and limits

Raw WebM recordings, lossless PNG frames, compressed MP4 copies and the exported
thumbnail go into ignored `tmp/product-demos/`. The encoder writes the three README GIFs to
`assets/demos/`. Each GIF must stay below 2,000,000 bytes. The encoding command fails
when a clip exceeds that budget. Check the entire loop before keeping its output.

```sh
# Re-encode existing footage without running the browser again.
devenv shell -- bun scripts/encode-product-demos.mjs
```

The publishing GIF uses the original 1280px width so it stays sharp across the
desktop README. The smaller editor demos use 800px width. Each clip has one palette. Publishing and video editing
use 8 frames per second; the thumbnail edit uses 6. Palettes use 96 to 128
colors, with per-clip settings in `scripts/encode-product-demos.mjs`.
The browser captures PNG frames with timestamps, preserving unchanged pixels for
GIF compression. The recorder fits each scene's actions into its allotted time
and preserves a separate reading pause. GIF and MP4 exports use the same timeline,
so browser or machine speed does not set the playback pace. The raw WebM keeps the
original capture timing.

Captions use the repository's Geist font in a band below the app. Keep them short
and readable when the README scales down on a phone. They must not cover editor
controls or the timeline. Gifsicle removes redundant pixels without further
quality loss. Cut idle time and unnecessary steps before reducing resolution.

Keep the publishing demo near the introduction and the smaller editor demos beside
their feature descriptions below the feature list. Each demo uses one still-image
source with only `(prefers-reduced-motion: reduce)`. GitHub rewrites color-scheme
queries to match its selected theme and drops other conditions in the same query,
which can replace an animated demo with a still even when motion is enabled.
Verify playback while signed in with an explicit GitHub theme, as well as signed out.
The README also links each demo
to the relevant product. Keep useful alt text and verify the README on desktop and
at 390px and 320px widths in both schemes.

## Tool choice

[Playwright's Screencast API](https://playwright.dev/docs/api/class-screencast) records
chosen sections of a flow and renders an animated pointer. OpenPost already uses
Playwright 1.61, so no recorder dependency or separate application is needed.
[FFmpeg](https://ffmpeg.org/ffmpeg-filters.html#palettegen) supplies palette generation
and GIF encoding. [Gifsicle](https://www.lcdf.org/gifsicle/) optimizes the result.
Both tools come from the project Devenv environment.

The image scenario rebuilds Rodrigo's RISC-V thumbnail reference using Bangers,
a cropped logo, and separate text layers. Import, sizing, and placement use the
editor's drag controls; font style and colors use the inspector. Font attribution
and the supplied reference are in `tests/app/fixtures/product-demos/`.

The video scenario adds an animated opening and title, original instrumental
music, title entrance and exit animations, a cut with a dissolve, two effects, and
color wheel and curve adjustments.
GIFs and screen-capture MP4s are silent. The project includes the music track.
It reuses the existing
[Study SOS demo footage](https://www.youtube.com/watch?v=-m-ea3jfRpo) from the product
screenshot fixtures.

Other tools considered on 6 October 2026:

- [programatic-demo](https://github.com/ashrafchowdury/programatic-demo) adds automatic
  zooms and a Remotion camera to declarative Playwright flows. It fits longer launch
  films, but adds a render pipeline these README loops do not need.
- [VHS](https://github.com/charmbracelet/vhs) is declarative and exports GIFs, but is
  designed for terminal demos.
- [OpenScreen](https://getopenscreen.com/alternatives/screen-studio/) is an option for
  manually recorded walkthroughs. Scripted browser flows fit repeatable README
  updates better.

Keep the scenes and compression settings in this repository. A separate recorder
project is unnecessary while maintained tools cover the capture requirements.
