package usernames

import (
	"fmt"
	"regexp"
	"strings"
)

const (
	MinLength = 3
	MaxLength = 30
)

var (
	validPattern   = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$`)
	nonSlugPattern = regexp.MustCompile(`[^a-z0-9_-]+`)
	separatorRun   = regexp.MustCompile(`[-_]{2,}`)
	reserved       = map[string]struct{}{
		"admin": {}, "api": {}, "app": {}, "auth": {}, "login": {}, "openpost": {},
		"register": {}, "settings": {}, "support": {}, "www": {},
	}
)

func Normalize(value string) string {
	return strings.ToLower(strings.TrimPrefix(strings.TrimSpace(value), "@"))
}

func Validate(value string) error {
	if len(value) < MinLength || len(value) > MaxLength {
		return fmt.Errorf("username must be between %d and %d characters", MinLength, MaxLength)
	}
	if !validPattern.MatchString(value) {
		return fmt.Errorf("username can use lowercase letters, numbers, hyphens, and underscores, and must start and end with a letter or number")
	}
	if _, blocked := reserved[value]; blocked {
		return fmt.Errorf("username is reserved")
	}
	return nil
}

func Suggest(displayName, email string) string {
	base := strings.TrimSpace(displayName)
	if base == "" {
		base = strings.Split(strings.TrimSpace(email), "@")[0]
	}
	base = strings.ToLower(base)
	base = strings.NewReplacer(" ", "-", ".", "-", "/", "-").Replace(base)
	base = nonSlugPattern.ReplaceAllString(base, "")
	base = separatorRun.ReplaceAllString(base, "-")
	base = strings.Trim(base, "-_")
	if len(base) > MaxLength {
		base = strings.Trim(base[:MaxLength], "-_")
	}
	if len(base) < MinLength || Validate(base) != nil {
		return "user"
	}
	return base
}

func Candidate(base, stableID string, attempt int) string {
	if attempt == 0 {
		return base
	}
	suffixSource := nonSlugPattern.ReplaceAllString(strings.ToLower(stableID), "")
	if len(suffixSource) > 6 {
		suffixSource = suffixSource[:6]
	}
	if suffixSource == "" {
		suffixSource = fmt.Sprintf("%d", attempt+1)
	} else if attempt > 1 {
		suffixSource += fmt.Sprintf("%d", attempt)
	}
	maxBase := MaxLength - len(suffixSource) - 1
	trimmed := strings.Trim(base, "-_")
	if len(trimmed) > maxBase {
		trimmed = strings.Trim(trimmed[:maxBase], "-_")
	}
	if len(trimmed) < MinLength {
		trimmed = "user"
	}
	return trimmed + "-" + suffixSource
}
