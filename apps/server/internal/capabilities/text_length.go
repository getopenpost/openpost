package capabilities

import (
	"strings"
	"unicode/utf8"

	"github.com/rivo/uniseg"
	"golang.org/x/text/unicode/norm"
	"mvdan.cc/xurls/v2"
)

const xTransformedURLLength = 23

var xURLPattern = xurls.Relaxed()

// TextLength returns the provider's effective length for a post body.
// X normalizes text to NFC, shortens every URL to 23 characters, weights
// selected Unicode ranges as one character, and weights the rest as two.
func TextLength(provider, text string) int {
	if strings.EqualFold(strings.TrimSpace(provider), ProviderX) {
		return xWeightedTextLength(norm.NFC.String(text))
	}
	return utf8.RuneCountInString(text)
}

func xWeightedTextLength(text string) int {
	length := 0
	cursor := 0
	for _, match := range xURLPattern.FindAllStringIndex(text, -1) {
		length += xWeightedTextSegmentLength(text[cursor:match[0]])
		length += xTransformedURLLength
		cursor = match[1]
	}
	return length + xWeightedTextSegmentLength(text[cursor:])
}

func xWeightedTextSegmentLength(text string) int {
	length := 0
	graphemes := uniseg.NewGraphemes(text)
	for graphemes.Next() {
		cluster := graphemes.Runes()
		if isXEmojiSequence(cluster) {
			length += 2
			continue
		}
		for _, codePoint := range cluster {
			length += xCodePointWeight(codePoint)
		}
	}
	return length
}

func isXEmojiSequence(cluster []rune) bool {
	if len(cluster) < 2 {
		return false
	}
	regionalIndicators := 0
	for _, codePoint := range cluster {
		switch {
		case codePoint == '\u200d',
			codePoint == '\ufe0f',
			codePoint == '\u20e3',
			codePoint >= '\U0001f3fb' && codePoint <= '\U0001f3ff',
			codePoint >= '\U000e0020' && codePoint <= '\U000e007f':
			return true
		case codePoint >= '\U0001f1e6' && codePoint <= '\U0001f1ff':
			regionalIndicators++
		}
	}
	return regionalIndicators >= 2
}

func xCodePointWeight(codePoint rune) int {
	switch {
	case codePoint >= 0 && codePoint <= 0x10ff,
		codePoint >= 0x2000 && codePoint <= 0x200d,
		codePoint >= 0x2010 && codePoint <= 0x201f,
		codePoint >= 0x2032 && codePoint <= 0x2037:
		return 1
	default:
		return 2
	}
}
