# OpenPost launch film

An 87-second, 1920x1080, 60 fps launch film made in code. A founder ships, the work of telling everyone floods in and
drags them under, and OpenPost pulls them back up. The rest shows what that buys them: posts that write themselves,
perfect versions for every network, visuals and video, one-click scheduling, and knowing what to do next.

```sh
devenv shell -- bun run render:launch-film
```

The render writes `tmp/launch-film/openpost-launch.mp4`. Each step can be rerun alone:

| Step               | Command                                                    | Output in `tmp/launch-film/`                          |
| ------------------ | ---------------------------------------------------------- | ----------------------------------------------------- |
| Render the picture | `bun apps/marketing/launch-film/render.mjs`                | `picture.mp4`, `cues.json`                            |
| Mix the sound      | `uv run apps/marketing/launch-film/mix.py tmp/launch-film` | `sounds/`, `soundtrack.wav`, stems, `mix-report.json` |

Useful while editing:

```sh
bun apps/marketing/launch-film/render.mjs --stills 4.2,11,28.6 --samples 12   # stills, also writes cues.json
bun apps/marketing/launch-film/render.mjs --from 14 --to 16 --samples 16 --out tmp/clip.mp4
```

The film renders on macOS with Metal and takes about 12 minutes on an M4 at 32 samples per frame.

## The story

Everything sits on the 120 BPM bar grid of the music. `timeline.js` holds the times.

1. **You shipped (0:00).** A caret on warm paper. The line types itself, the camera drifting behind it, then its full
   stop falls and hits a liquid floor. The Todoist release rises through the ripple.
2. **The flood (0:08).** "Now tell everyone." Bubbles fill the frame above and in front of the line, then demands land
   all over it on the bar, doubling every two bars from two to sixteen per bar: real tasks first, then what each network
   rejects. The sky bruises, the swell rises, the camera shakes and sways, and words slam into the lens until a wall of
   water takes it.
3. **Under (0:18).** The score closes to a muffled pulse. Everything on your plate sinks past in a dithered teal
   world, and the only line left is "You're a team of one...", its dots landing one by one on the beat. Four lights
   come down and lock into the mark.
4. **Up (0:22).** The filter opens as the camera climbs, the score drops out for one gasp, and the waterline crosses
   the lens on the drop. The mark steps left, "Meet your content team." writes itself beside it, is erased, and
   "OpenPost" is typed in the same place.
5. **The product (0:30).** The camera dives through the mark into a workflow, where a glowing line runs one readable
   step at a time. Build draft opens in place and every step shows its work: notes pop in, the post streams, network
   marks land, and each drawn check throws its own burst. The review node opens into a composer that stays still while
   the post writes itself. Approval spins a jackpot reel of native cards that lands on X, and the too-long post
   becomes a short one in a magic move: its overflow is marked the way X marks it, cut words dissolve, kept words travel,
   new ones rise in. The camera slides down the card onto its picture, which comes apart by layers in the image editor,
   then plays out through a fade to black in the video editor. One click drops the post on the month, a dithered chart
   climbs to the launch with measured insights and Repurpose, and one inbox collects the replies.
6. **The end (1:15).** A prism of everything else turns on the beat. All sixteen networks burst into a tilted ring
   around the line on a run of bells, then spiral down into the 3D mark, which turns once and becomes the real logo.
   "Your socials, on steroids." loses its full stop, which falls off the line and lands as the dot of openpo.st.

## How it fits together

- `timeline.js` owns the clock: the bar grid, scene times, sound cues and the score. Picture and sound read the same
  numbers, so sync never drifts.
- `engine.js` is a WebGL2 renderer. Every output frame averages many renders across the shutter, each jittered over a
  lens disc and a pixel, so motion blur, depth of field and anti-aliasing all come from one accumulation buffer. It
  has a raymarched liquid surface with ripples, planar reflections and shadows, an extruded signed-distance Converge
  mark, and a post pass for bloom, colour split, lens beads, the underwater look and Bayer dither.
- `surfaces.js` holds the interface as real DOM, rebuilt close to the app's light Dither UI. HTML-in-Canvas
  (`texElementImage2D`, behind Chromium's `CanvasDrawElement` flag) draws those elements straight onto bent geometry,
  live, so UI text stays real and sharp. Static surfaces upload once; live ones repaint when their DOM changes.
- `kit.js` holds the motion math and the per-sample scene list. `opening.js` is acts one to four and `product.js` is
  the rest. Every frame is a pure function of time, so a render can start anywhere.
- Acts five and six share one layout. Lines use `heading()`, centred 150px down the frame, and content stays in the
  band from y = 255 to y = 975. At `PIXEL_D` one world unit is one pixel, so scenes are authored in frame coordinates.
  Hands take their targets from the DOM through `anchorOf`.
- The orange drop belongs to the two full stops, the first and the last. Only the first lands in water.
- The sample disclosure and "You're a team of one..." are printed on the finished frame in the final pass, so depth of
  field, shake and dither never touch them.
- `HOLDS` in `timeline.js` inserts whole bars into the picture and the score together. Use it to give a scene more time.
- `script.json` holds the sample product, post and replies. The launch picture and network pictures use real Todoist
  material from `todoist/`; see `todoist/SOURCES.md`.
- Character limits come from `@openpost/platform-text`: X 280, Bluesky 300, Threads and Mastodon 500, LinkedIn 3,000.

## The score

The music is arranged to the picture rather than played under it, which is how the reference films work.

`mix.py` separates the track into stems once with Demucs, then follows `score` in `timeline.js`: each span plays chosen
stems from its own source bar and shapes them. Lowpass and highpass sweeps run in the STFT domain, so the underwater
section stays muffled but audible on laptop speakers, and the X close-up dips the same way. It chops the vocal into stutters
for the build, adds a sub that follows the source's bass notes and a kick for modern weight, pumps the bed against the
kick, and gives each dropout a real silence.

`sounds.json` lists every recording: page, preview URL, sha256, licence as read on the sound's own page, and trims.
Effects are placed on their measured onset, peak or end, set against the music bed, and heard through the same water
as the score while the camera is under. The master is -14 LUFS with true peak at or below -1.5 dBTP.

## Credits and provenance

Publish this line with the film (the track's licence requires it):

> Music: "Dances With Koalas" by Coruscate (https://ccmixter.org/files/Coruscate/61129), featuring Calyman and
> Psubhashish, licensed under CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/). Rearranged to picture: stems
> separated, cut, filtered and layered with a sub and kick.

- Sound effects are CC0 recordings from Freesound, listed in `sounds.json`.
- The Todoist update is invented for the demo. Accounts, analytics and replies are sample data. The "Viral hit" sticker is a film
  graphic, not product UI. Todoist owns its name, logo and artwork in `todoist/`. Get its permission before publishing
  the film outside review.
- Integration marks come from `assets/postiz-socials/`, the set the README uses.

## Checking the sound

You can't judge the soundtrack by reading code. Measure it with earshot after a change:

```sh
E='uvx --python 3.12 --from earshot@git+https://github.com/Leonxlnx/earshot@591fa3e028032e6dce56620a20e932e35667e8d8 earshot'
$E critique tmp/launch-film/openpost-launch.mp4
$E sheet tmp/launch-film/openpost-launch.mp4 -o tmp/launch-film/sheet.png --cues tmp/launch-film/cues.json
$E realness tmp/launch-film/music-stem.wav tmp/launch-film/effects-stem.wav
```

To replace the track, keep the licence rule (CC0 or CC BY only, read on the sound's own page), measure its bar grid,
and set `grid_origin` in `sounds.json` so the score's source bars land on its downbeats.
