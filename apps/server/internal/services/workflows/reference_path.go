package workflows

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

const referenceRoot = `[a-zA-Z][a-zA-Z0-9_-]*`
const referenceComponent = `(?:\.[a-zA-Z0-9_-]+|\[(?:"(?:\\.|[^"\\])*"|[0-9]+)\])`

var referenceSyntax = regexp.MustCompile(`^` + referenceRoot + referenceComponent + `*$`)
var referencePart = regexp.MustCompile(`^(?:([a-zA-Z][a-zA-Z0-9_-]*)|\.([a-zA-Z0-9_-]+)|\[("(?:\\.|[^"\\])*"|[0-9]+)\])`)

func referenceParts(reference string) ([]string, error) {
	if !referenceSyntax.MatchString(reference) {
		return legacyReferenceParts(reference)
	}
	var parts []string
	for rest := reference; rest != ""; {
		match := referencePart.FindStringSubmatch(rest)
		if match == nil {
			return nil, invalid("invalid field reference")
		}
		part := match[1]
		if part == "" {
			part = match[2]
		}
		if part == "" {
			part = match[3]
			if strings.HasPrefix(part, `"`) {
				if err := json.Unmarshal([]byte(part), &part); err != nil {
					return nil, invalid("invalid field reference")
				}
			}
		}
		if part == "__proto__" || part == "constructor" || part == "prototype" {
			return nil, invalid("invalid field reference")
		}
		parts = append(parts, part)
		rest = rest[len(match[0]):]
	}
	if len(parts) > 8 {
		return nil, fmt.Errorf("%w: field reference exceeds eight components", ErrInvalid)
	}
	return parts, nil
}

func legacyReferenceParts(reference string) ([]string, error) {
	// Older whole-value references allowed raw property names after dots.
	parts := strings.Split(reference, ".")
	if len(parts) < 2 || len(parts) > 8 || !stepIDPattern.MatchString(parts[0]) {
		return nil, invalid("invalid field reference")
	}
	for _, part := range parts {
		if part == "" || part == "__proto__" || part == "constructor" || part == "prototype" {
			return nil, invalid("invalid field reference")
		}
	}
	return parts, nil
}

var referenceKey = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

func appendReferencePath(parent, key string) string {
	if referenceKey.MatchString(key) {
		if parent == "" {
			return key
		}
		return parent + "." + key
	}
	quoted, _ := json.Marshal(key)
	return parent + "[" + string(quoted) + "]"
}

func formatReferenceParts(parts []string) string {
	result := parts[0]
	for _, part := range parts[1:] {
		result = appendReferencePath(result, part)
	}
	return result
}
