// Package textshaping holds shaping corrections shared by the server's
// image renderers.
package textshaping

import (
	"unicode"

	textfont "github.com/go-text/typesetting/font"
	"github.com/go-text/typesetting/shaping"
	"golang.org/x/image/math/fixed"
)

// NormalizeFallbackSpaces gives spaces carried into an emoji or CJK fallback
// run the primary font's advance. The go-text segmenter keeps whitespace in
// the current face, and those fonts draw a full-em space that leaves wide
// gaps after every emoji.
func NormalizeFallbackSpaces(run *shaping.Output, text []rune, primary *textfont.Face, size fixed.Int26_6) {
	if run.Face == primary || primary == nil {
		return
	}
	space, ok := primary.NominalGlyph(' ')
	if !ok {
		return
	}
	advance := fixed.Int26_6(primary.HorizontalAdvance(space) * float32(size) / float32(primary.Upem()))
	changed := false
	for index := range run.Glyphs {
		glyph := &run.Glyphs[index]
		if glyph.RunesCount() == 1 && glyph.TextIndex() >= 0 && glyph.TextIndex() < len(text) && unicode.Is(unicode.Zs, text[glyph.TextIndex()]) {
			glyph.Advance = advance
			changed = true
		}
	}
	if changed {
		run.RecomputeAdvance()
	}
}
