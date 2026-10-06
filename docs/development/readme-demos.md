# Refresh the README demos

The README has three scripted captures of the real OpenPost interface: publishing,
thumbnail design, and video editing. Run them against the local browser-test app:

```sh
devenv shell -- bun run capture:product-demos
```

This builds the frontend, starts an isolated test server, creates disposable users,
and records the scenarios in `tests/app/product-demos.spec.ts`. The scenes declare
their caption, browser actions, and reading time. Edit those scenes to change the
story. The fixture data is shared with product stills through
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

The GIFs use 800px width, 8 frames per second, normal playback speed and a shared
128-color palette per clip. The browser also captures PNG frames with timestamps,
preserving unchanged pixels for GIF compression. Gifsicle removes redundant pixels
without further quality loss. Keep
readable holds around the result of each action. Cut idle time and unnecessary
steps before reducing resolution. Keep captions large enough to follow when the
README scales down on a phone.

The README retains still-image sources for reduced motion. It also links each demo
to the relevant product. Keep useful alt text and verify the README on desktop and
at 390px and 320px widths in both schemes.

## Tool choice

[Playwright's Screencast API](https://playwright.dev/docs/api/class-screencast) records
chosen sections of a flow and renders an animated pointer. OpenPost already uses
Playwright 1.61, so no recorder dependency or separate application is needed.
[FFmpeg](https://ffmpeg.org/ffmpeg-filters.html#palettegen) supplies palette generation
and GIF encoding. [Gifsicle](https://www.lcdf.org/gifsicle/) optimizes the result.
Both tools come from the project Devenv environment.

The video scenario reuses the existing
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
