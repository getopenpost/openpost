package posttext

import (
	"strings"
	"unicode/utf8"
)

// ValidateProfiles bounds a saved snapshot and keeps native identities under
// the same rules as direct provider selections. Snapshots never nest.
func ValidateProfiles(target MentionTarget) error {
	if target.Provider != "workspace" || target.Kind != "profile" || target.ID == "" || len(target.ID) > 2048 || target.Authority != "" || target.Handle != "" || len(target.Profiles) == 0 || len(target.Profiles) > 32 {
		return ErrInvalid
	}
	seen := map[string]bool{}
	for _, profile := range target.Profiles {
		if err := validateMentionProfile(profile); err != nil {
			return err
		}
		key := profile.Provider + "\x00" + Authority(profile.Authority)
		if seen[key] {
			return ErrInvalid
		}
		seen[key] = true
	}
	return nil
}

// ForDestination replaces only selected snapshot spans. Ordinary @text is never
// a template, and library changes cannot affect a previously inserted snapshot.
func ForDestination(body, provider, authority string, projection *Projection) (string, *Projection, error) {
	if projection == nil {
		return body, nil, nil
	}
	if err := Validate(body, &projection.Mentions); err != nil {
		return "", nil, err
	}
	output := &Projection{Mentions: Mentions{Version: 1, Spans: []MentionSpan{}}}
	var text strings.Builder
	position := 0
	type shift struct{ end, delta int }
	shifts := []shift{}
	for _, span := range projection.Spans {
		text.WriteString(body[position:span.Start])
		replacement := span.Text
		var target *MentionTarget
		if span.Target.Provider != "workspace" {
			copy := span.Target
			target = &copy
		} else {
			if profile, ok := destinationProfile(span.Target.Profiles, provider, authority); ok {
				replacement = profile.Text
				if profile.Target != nil {
					copy := profile.Target.authored()
					target = &copy
				}
			}
		}
		start := text.Len()
		text.WriteString(replacement)
		if target != nil {
			output.Spans = append(output.Spans, MentionSpan{Start: start, End: text.Len(), Text: replacement, Target: *target})
		}
		shifts = append(shifts, shift{span.End, len(replacement) - len(span.Text)})
		position = span.End
	}
	text.WriteString(body[position:])
	mapOffset := func(offset int) int {
		result := offset
		for _, s := range shifts {
			if offset >= s.end {
				result += s.delta
			}
		}
		return result
	}
	for _, window := range projection.LegacyRanges {
		output.LegacyRanges = append(output.LegacyRanges, ByteRange{Start: mapOffset(window.Start), End: mapOffset(window.End)})
	}
	return text.String(), output, ValidateDestination(text.String(), provider, authority, &output.Mentions)
}

func (target NativeMentionTarget) authored() MentionTarget {
	return MentionTarget{Provider: target.Provider, Kind: target.Kind, ID: target.ID, Authority: target.Authority, Handle: target.Handle}
}

// ProjectEquivalentText keeps a mirrored caption's own outer whitespace while
// applying the same selected replacements as its authored body.
func ProjectEquivalentText(field, authored, projected string) string {
	if field == authored {
		return projected
	}
	text := strings.TrimSpace(field)
	if text == "" || text != strings.TrimSpace(authored) {
		return field
	}
	start := strings.Index(field, text)
	return field[:start] + strings.TrimSpace(projected) + field[start+len(text):]
}

func validateMentionProfile(profile MentionProfile) error {
	if profile.Provider == "" || len(profile.Provider) > 40 || profile.Provider == "workspace" || strings.ContainsAny(profile.Provider, " \t\r\n") || strings.TrimSpace(profile.Text) == "" || utf8.RuneCountInString(profile.Text) > 512 || !utf8.ValidString(profile.Text) {
		return ErrInvalid
	}
	if profile.Authority != "" && Authority(profile.Authority) == "" {
		return ErrInvalid
	}

	if profile.Target != nil {
		if profile.Target.Provider != profile.Provider || Authority(profile.Target.Authority) != Authority(profile.Authority) {
			return ErrInvalid
		}
		if err := ValidateDestination(profile.Text, profile.Provider, profile.Authority, &Mentions{Version: 1, Spans: []MentionSpan{{Start: 0, End: len(profile.Text), Text: profile.Text, Target: profile.Target.authored()}}}); err != nil {
			return err
		}
	}
	return nil
}

// destinationProfile prefers a profile bound to the destination's exact
// authority and falls back to a provider-wide profile, independent of the
// order the author stored them in.
func destinationProfile(profiles []MentionProfile, provider, authority string) (MentionProfile, bool) {
	fallback, found := MentionProfile{}, false
	for _, profile := range profiles {
		if profile.Provider != provider {
			continue
		}
		if profile.Authority == "" {
			if !found {
				fallback, found = profile, true
			}
			continue
		}
		if Authority(profile.Authority) == Authority(authority) {
			return profile, true
		}
	}
	return fallback, found
}
