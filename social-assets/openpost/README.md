# OpenPost social kit

This folder contains ready-to-use OpenPost assets built from the canonical logo, Geist type, warm canvas, carbon ink, Workshop Orange, and the publishing activity grid.

## Start here

- X: `banners/x-paper.png` at 1500 x 500
- LinkedIn profile: `banners/linkedin-profile-paper.png` at 1584 x 396
- LinkedIn Page: `banners/linkedin-page-paper.png` at 4200 x 700
- Profile image: `profile/avatar-800.png`
- Full overview: `preview/contact-sheet.png` or `preview/index.html`
- Ready-to-post copy: `captions.md`

The `paper` banners combine an AI-generated tactile background with deterministic OpenPost typography and the real vector logo. The `workshop` alternatives are fully deterministic and available in light and dark versions.

## Included formats

| Folder       | Use                                 | Formats                              |
| ------------ | ----------------------------------- | ------------------------------------ |
| `banners/`   | X and LinkedIn headers              | Paper, workshop light, workshop dark |
| `profile/`   | Account avatar                      | 400 x 400 and 800 x 800              |
| `posts/`     | X, LinkedIn, and general feed posts | Square, portrait, and landscape      |
| `carousel/`  | LinkedIn document carousel          | Five 1080 x 1350 slides              |
| `stories/`   | Stories and vertical posts          | Light and dark 1080 x 1920           |
| `templates/` | Reusable blank layouts              | Square and portrait, light and dark  |

Each PNG has a matching SVG source. `manifest.json` records dimensions and alt text.

## Safe placement

X can crop about 60 pixels from the top and bottom of a 1500 x 500 header. Keep important content inside the middle band. LinkedIn moves and crops cover images across devices, and profile photos overlap the left side. The supplied profile banners reserve that area and keep essential copy near the center.

## Regenerate

From the repository root:

```sh
pnpm generate:social-assets
```

The generated background source lives at `source/generated/activity-paper-field.png`. The renderer in `source/generate.mjs` composes that background with deterministic brand elements and creates the complete kit.

## Website social previews

Marketing and documentation pages do not use this download kit for their Open Graph cards. Their static metadata points to the versioned `/og` Cloudflare Pages function, which creates each 1200 x 630 card on demand from the shared declarative metadata in `packages/social-images`.
