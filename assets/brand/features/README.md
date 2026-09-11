# Feature icons

These transparent SVG icons are public artwork for README feature tiles, public feature sections, and customer guides. Each icon uses a simple, recognizable pictogram on a 24px grid, with sparse square dither pixels near the edge. The artwork is identical in light and dark themes, so its midtone colors and pale accents are chosen to stay legible on both.

Use icons beside visible feature names. App controls, navigation, provider marks, status glyphs, and the protected OpenPost Converge mark keep their own icon systems. Do not use these feature icons in authenticated app chrome.

| Feature      | Icon                                                       | Palette              |
| ------------ | ---------------------------------------------------------- | -------------------- |
| Compose      | <img src="compose.svg" alt="" width="24" height="24">      | `#c96d32`, `#ffad66` |
| Image Editor | <img src="image-editor.svg" alt="" width="24" height="24"> | `#477d62`, `#72d18d` |
| Video Editor | <img src="video-editor.svg" alt="" width="24" height="24"> | `#526fa0`, `#ffd45c` |
| Calendar     | <img src="calendar.svg" alt="" width="24" height="24">     | `#477d62`, `#72d18d` |
| Analytics    | <img src="analytics.svg" alt="" width="24" height="24">    | `#477d62`, `#72d18d` |
| Media        | <img src="media.svg" alt="" width="24" height="24">        | `#397b86`, `#72d18d` |
| Inbox        | <img src="inbox.svg" alt="" width="24" height="24">        | `#a84b5b`, `#ffad66` |
| Accounts     | <img src="accounts.svg" alt="" width="24" height="24">     | `#4770a0`, `#9fc3e4` |
| Recorder     | <img src="recorder.svg" alt="" width="24" height="24">     | `#ad4e42`, `#ffad66` |
| Ideas        | <img src="ideas.svg" alt="" width="24" height="24">        | `#a97925`, `#ffd45c` |
| Automation   | <img src="automation.svg" alt="" width="24" height="24">   | `#4770a0`, `#9fc3e4` |
| Grow         | <img src="grow.svg" alt="" width="24" height="24">         | `#477d62`, `#72d18d` |
| Repost       | <img src="repost.svg" alt="" width="24" height="24">       | `#667633`, `#ffd45c` |
| Workspaces   | <img src="workspaces.svg" alt="" width="24" height="24">   | `#875d3e`, `#ffad66` |
| Meme Maker   | <img src="memes.svg" alt="" width="24" height="24">        | `#a24d89`, `#ffd45c` |

The SVGs are hand-authored and remain sharp at small sizes. Distribute public artwork through `scripts/asset-surfaces.ts` and `bun scripts/sync-assets.mjs` when a consuming surface changes.
