# Feature marks

The SVG files here are the shipped artwork. Each mark pairs one fixed color and pictogram with OpenPost's envelope frame. Keep the frame on the 112px grid and leave white space between the pictogram, rim, and fold.

Use marks beside visible feature names. App titles use `FeatureMark` through the shared page header. Navigation, actions, provider marks, and status glyphs keep their own icon systems. Use the same artwork in light and dark.

| Feature      | Mark                                                       | Color     |
| ------------ | ---------------------------------------------------------- | --------- |
| Compose      | <img src="compose.svg" alt="" width="48" height="48">      | `#C25406` |
| Image Editor | <img src="image-editor.svg" alt="" width="48" height="48"> | `#8045AE` |
| Video Editor | <img src="video-editor.svg" alt="" width="48" height="48"> | `#7146B4` |
| Calendar     | <img src="calendar.svg" alt="" width="48" height="48">     | `#2862BC` |
| Analytics    | <img src="analytics.svg" alt="" width="48" height="48">    | `#287D59` |
| Media        | <img src="media.svg" alt="" width="48" height="48">        | `#167D8D` |
| Inbox        | <img src="inbox.svg" alt="" width="48" height="48">        | `#B53F68` |
| Accounts     | <img src="accounts.svg" alt="" width="48" height="48">     | `#4F5DB5` |
| Recorder     | <img src="recorder.svg" alt="" width="48" height="48">     | `#BD493F` |
| Ideas        | <img src="ideas.svg" alt="" width="48" height="48">        | `#A97816` |
| Automation   | <img src="automation.svg" alt="" width="48" height="48">   | `#4B708F` |
| Grow         | <img src="grow.svg" alt="" width="48" height="48">         | `#527F3C` |
| Repost       | <img src="repost.svg" alt="" width="48" height="48">       | `#7B792C` |
| Workspaces   | <img src="workspaces.svg" alt="" width="48" height="48">   | `#916047` |
| Meme Maker   | <img src="memes.svg" alt="" width="48" height="48">        | `#A24491` |

## Generation references

The 2026-09-10 additions and Analytics redesign began with the built-in image generation tool. [The exact prompts](source/generation.json) and WebP copies of those concepts are kept in `source/`. Generated texture, uneven frames, and simulated transparency are reference artifacts. The SVGs were redrawn to preserve the family geometry and remain sharp at small sizes.

Distribute artwork through `scripts/asset-surfaces.ts` and `bun scripts/sync-assets.mjs`. Source references stay out of deployed asset lists.
