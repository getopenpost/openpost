package providerlimits

// Server text counting and text limits shared by capability validation and
// delivery-side publishing validators.
//
// capabilities.TextLength is the canonical server counter API and delegates
// to TextLength here, while platform adapters call TextLength directly, so
// the publisher cannot drift from capability validation. The numbers below
// describe provider behavior, not OpenPost policy: do not change them without
// re-verifying against the provider. The cross-language guard is
// packages/platform-text/conformance/fixtures.json, asserted by the
// capabilities conformance test and scripts/check-platform-text-conformance.mjs.

import (
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/rivo/uniseg"
	"golang.org/x/text/unicode/norm"
	"mvdan.cc/xurls/v2"
)

const (
	// XStandardTextLimit is the X post limit without a premium subscription.
	XStandardTextLimit = 280
	// XPremiumTextLimit is the X post limit with Basic/Premium/Premium+.
	XPremiumTextLimit = 25_000
	// BlueskyPostMaxGraphemes is the post length the relay enforces.
	BlueskyPostMaxGraphemes = 300
	// BlueskyPostMaxBytes is the UTF-8 byte ceiling the relay enforces.
	BlueskyPostMaxBytes = 3000
	// XTransformedURLLength is the length X counts every URL as.
	XTransformedURLLength = 23
	// MastodonCountedURLLength is the length Mastodon counts every link as.
	MastodonCountedURLLength = 23
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
// as its username. Threads counts each grapheme as one character, except a
// grapheme that is an emoji (see isThreadsEmoji), which
// counts as its UTF-8 byte length. YouTube descriptions count UTF-8 bytes.
func TextLength(provider, text string) int {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "x":
		return xWeightedTextLength(norm.NFC.String(text))
	case "bluesky":
		return uniseg.GraphemeClusterCount(text)
	case "mastodon":
		return utf8.RuneCountInString(mastodonCountableText(text))
	case "youtube":
		return len(strings.TrimSpace(text))
	case "threads":
		return threadsTextLength(text)
	}
	return utf8.RuneCountInString(text)
}

// threadsTextLength follows Meta's rule that text posts are limited to 500
// characters and "emojis are counted as the number of UTF-8 bytes"
// (developers.facebook.com/documentation/threads/posts, Limitations).
// Other text counts one per grapheme.
func threadsTextLength(text string) int {
	length := 0
	graphemes := uniseg.NewGraphemes(text)
	for graphemes.Next() {
		if isThreadsEmoji(graphemes.Runes()) {
			length += len(graphemes.Str())
			continue
		}
		length++
	}
	return length
}

// isThreadsEmoji reports whether a grapheme is an emoji for Threads: it holds
// an Extended_Pictographic code point, is a flag (a pair of regional
// indicators), or is a keycap sequence (ends in U+20E3).
func isThreadsEmoji(cluster []rune) bool {
	regionalIndicators := 0
	for _, codePoint := range cluster {
		if codePoint == '\u20e3' {
			return true
		}
		if codePoint >= '\U0001f1e6' && codePoint <= '\U0001f1ff' {
			regionalIndicators++
		}
	}
	if regionalIndicators >= 2 {
		return true
	}
	for _, codePoint := range cluster {
		i := sort.Search(len(extendedPictographic), func(i int) bool { return extendedPictographic[i][1] >= codePoint })
		if i < len(extendedPictographic) && extendedPictographic[i][0] <= codePoint {
			return true
		}
	}
	return false
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
		return strings.Repeat("x", MastodonCountedURLLength)
	})
	return mastodonRemoteMentionPattern.ReplaceAllString(text, "${1}@${2}")
}

func xWeightedTextLength(text string) int {
	length := 0
	cursor := 0
	for _, match := range xURLPattern.FindAllStringIndex(text, -1) {
		length += xWeightedTextSegmentLength(text[cursor:match[0]])
		length += XTransformedURLLength
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
