package capabilities

import (
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/rivo/uniseg"
	"golang.org/x/text/unicode/norm"
	"mvdan.cc/xurls/v2"
)

const (
	xTransformedURLLength = 23
	mastodonURLLength     = 23
)

var (
	xURLPattern                  = xurls.Relaxed()
	mastodonURLPattern           = xurls.Strict()
	mastodonRemoteMentionPattern = regexp.MustCompile(`(?i)(^|[^/\w])@([a-z0-9_]+)@[a-z0-9.-]+[a-z0-9]+`)
	// mastodonLinkHost accepts an http(s) link whose host ends in a dot and a
	// top-level domain, the part of twitter-text's validDomain Mastodon relies
	// on to decide what counts as a link at all.
	mastodonLinkHost = regexp.MustCompile(`(?i)^https?://(?:[^/?#@\s]*@)?[^/?#:\s]+\.(?:\p{L}{2,}|xn--[a-z0-9-]+)(?::\d+)?(?:[/?#]|$)`)
)

// TextLength returns the provider's effective length for a post body.
// X normalizes text to NFC, shortens every URL to 23 characters, weights
// selected Unicode ranges as one character, and weights the rest as two.
// Bluesky counts grapheme clusters, the unit its 300-character post limit
// uses, Mastodon counts every link as 23 characters and every remote mention
// as its username, and Threads counts UTF-8 bytes.
func TextLength(provider, text string) int {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case ProviderX:
		return xWeightedTextLength(norm.NFC.String(text))
	case ProviderBluesky:
		return uniseg.GraphemeClusterCount(text)
	case ProviderMastodon:
		return utf8.RuneCountInString(mastodonCountableText(text))
	case ProviderThreads:
		return len(text)
	}
	return utf8.RuneCountInString(text)
}

// mastodonCountableText applies the substitutions Mastodon makes before it
// measures a status (countableText in its composer, StatusLengthValidator on
// the server): each http(s) link becomes 23 characters and each
// @user@domain mention becomes @user.
func mastodonCountableText(text string) string {
	text = mastodonURLPattern.ReplaceAllStringFunc(text, func(link string) string {
		if !mastodonLinkHost.MatchString(link) {
			return link
		}
		return strings.Repeat("x", mastodonURLLength)
	})
	return mastodonRemoteMentionPattern.ReplaceAllString(text, "${1}@${2}")
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
