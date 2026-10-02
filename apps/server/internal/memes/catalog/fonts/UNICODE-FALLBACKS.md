# Unicode caption fallbacks

Meme captions use the catalog font for established Latin text. Complex scripts and missing glyphs use go-text shaping, bidirectional ordering and per-run fallback. Parsed fonts are immutable; each render creates its own faces and shaping caches.

Additional fonts come from Google Fonts commit `9710da1eacb3be272583c3224dcb70f9da6eadbb`:

- `NotoSansArabic.ttf`: `ofl/notosansarabic/NotoSansArabic[wdth,wght].ttf`, SIL Open Font License, retained in `OFL-NotoSansArabic.txt`.
- `NotoEmoji.ttf`: `ofl/notoemoji/NotoEmoji[wght].ttf`, SIL Open Font License, retained in `OFL-NotoEmoji.txt`. Emoji are monochrome, matching caption ink and outline.

Source: https://github.com/google/fonts/tree/9710da1eacb3be272583c3224dcb70f9da6eadbb/ofl

Japanese and Hebrew fallback use the existing pinned catalog fonts. This collection is not a guarantee that every Unicode code point has a glyph.
