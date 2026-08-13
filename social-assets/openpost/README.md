# OpenPost social kit

This folder contains ready-to-use OpenPost assets built from the canonical logo, Geist type, warm canvas, carbon ink, Workshop Orange, and the publishing activity grid.

## Start here

- X: `banners/x-converge-slogan-dark-imagegen.png` at 1500 x 500
- LinkedIn profile: `banners/linkedin-profile-converge-slogan-dark-imagegen.png` at 1584 x 396
- Ten additional X and LinkedIn pairs: `banners/converge-series/`
- Converge series overview: `banners/converge-series/contact-sheet.png`
- LinkedIn Page: `banners/linkedin-page-paper.png` at 4200 x 700
- Profile image: `profile/avatar-800.png`
- Full overview: `preview/contact-sheet.png` or `preview/index.html`
- Ready-to-post copy: `captions.md`

The recommended `converge-slogan-dark-imagegen` headers pair a tactile, image-generated Converge environment with the exact vector OpenPost lockup and the line “Turn what you’re building into content. Publish it everywhere.” Separate X and LinkedIn compositions keep the copy clear at each platform's crop. The original no-slogan `converge-dark-imagegen` pair remains available. The ten-pair `converge-series` explores signal fields, a night publishing district, a physical control board, routing rails, an editorial worktable, a quiet orbit, folded paper, a signal wall, an in-the-wild tram, and a gallery monument. Their background artwork was generated separately, then finished with the exact vector OpenPost lockup. The `paper` banners combine an AI-generated tactile background with deterministic OpenPost typography and the real vector logo. The `workshop` alternatives are fully deterministic and available in light and dark versions.

## Included formats

| Folder       | Use                                 | Formats                              |
| ------------ | ----------------------------------- | ------------------------------------ |
| `banners/`   | X and LinkedIn headers              | Converge dark, paper, workshop light, workshop dark |
| `profile/`   | Account avatar                      | 400 x 400 and 800 x 800              |
| `posts/`     | X, LinkedIn, and general feed posts | Square, portrait, and landscape      |
| `carousel/`  | LinkedIn document carousel          | Five 1080 x 1350 slides              |
| `stories/`   | Stories and vertical posts          | Light and dark 1080 x 1920           |
| `templates/` | Reusable blank layouts              | Square and portrait, light and dark  |

Each deterministic PNG has a matching SVG source. `manifest.json` records those generated assets, their dimensions, and alt text. The image-generated headers are final PNG artwork and stay outside the deterministic generator.

## Safe placement

X can crop about 60 pixels from the top and bottom of a 1500 x 500 header. Keep important content inside the middle band. LinkedIn moves and crops cover images across devices, and profile photos overlap the left side. The supplied profile banners reserve that area and keep essential copy near the center.

## Regenerate

From the repository root:

```sh
bun run generate:social-assets
```

The generated background source lives at `source/generated/activity-paper-field.png`. The renderer in `source/generate.mjs` composes that background with deterministic brand elements and creates the complete kit.

## Website social previews

Marketing and documentation pages do not use this download kit for their Open Graph cards. Their static metadata points to the versioned `/og` Cloudflare Pages function, which creates each 1200 x 630 card on demand from the shared declarative metadata in `packages/social-images`.
