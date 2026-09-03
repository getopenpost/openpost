package themes

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const (
	DefaultThemePageLimit = 20
	MaxThemePageLimit     = 100
	maxThemeCursorLength  = 1024

	themeCursorVersion    = 1
	cursorSegmentBuiltIn  = "built_in"
	cursorSegmentCustom   = "custom"
	cursorSegmentRevision = "revision"
	cursorSegmentAsset    = "asset"
)

type PageOptions struct {
	Limit  int
	Cursor string
}

type themePageCursor struct {
	Version        int       `json:"v"`
	Scope          string    `json:"s"`
	Segment        string    `json:"g"`
	BuiltInIndex   int       `json:"p,omitempty"`
	NormalizedName string    `json:"n,omitempty"`
	CreatedAt      time.Time `json:"t,omitempty"`
	ID             string    `json:"i,omitempty"`
	Revision       int       `json:"r,omitempty"`
}

func normalizePageOptions(options PageOptions) (PageOptions, error) {
	options.Cursor = strings.TrimSpace(options.Cursor)
	if options.Limit == 0 {
		options.Limit = DefaultThemePageLimit
	}
	if options.Limit < 1 || options.Limit > MaxThemePageLimit {
		return PageOptions{}, fmt.Errorf("%w: limit must be between 1 and %d", ErrInvalidInput, MaxThemePageLimit)
	}
	if len(options.Cursor) > maxThemeCursorLength {
		return PageOptions{}, fmt.Errorf("%w: invalid pagination cursor", ErrInvalidInput)
	}
	return options, nil
}

func themeCursorScope(kind, scopeID string) string {
	digest := sha256.Sum256([]byte("openpost:theme-page:" + kind + ":" + scopeID))
	return hex.EncodeToString(digest[:16])
}

func encodeThemeCursor(cursor themePageCursor) string {
	cursor.Version = themeCursorVersion
	encoded, _ := json.Marshal(cursor)
	return base64.RawURLEncoding.EncodeToString(encoded)
}

func decodeThemeCursor(raw, scope string, allowedSegments ...string) (themePageCursor, error) {
	if raw == "" {
		return themePageCursor{}, nil
	}
	cursor, err := decodeThemeCursorEnvelope(raw, scope)
	if err != nil || !themeCursorSegmentAllowed(cursor.Segment, allowedSegments) || !validThemeCursor(cursor) {
		return themePageCursor{}, invalidThemeCursor()
	}
	cursor.CreatedAt = cursor.CreatedAt.UTC()
	return cursor, nil
}

func decodeThemeCursorEnvelope(raw, scope string) (themePageCursor, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil || base64.RawURLEncoding.EncodeToString(decoded) != raw {
		return themePageCursor{}, invalidThemeCursor()
	}
	var cursor themePageCursor
	if json.Unmarshal(decoded, &cursor) != nil || cursor.Version != themeCursorVersion || cursor.Scope != scope {
		return themePageCursor{}, invalidThemeCursor()
	}
	return cursor, nil
}

func themeCursorSegmentAllowed(segment string, allowedSegments []string) bool {
	for _, allowed := range allowedSegments {
		if segment == allowed {
			return true
		}
	}
	return false
}

func validThemeCursor(cursor themePageCursor) bool {
	switch cursor.Segment {
	case cursorSegmentBuiltIn:
		return validBuiltInThemeCursor(cursor)
	case cursorSegmentCustom:
		return validCustomThemeCursor(cursor)
	case cursorSegmentRevision:
		return validRevisionThemeCursor(cursor)
	case cursorSegmentAsset:
		return validAssetThemeCursor(cursor)
	default:
		return false
	}
}

func validBuiltInThemeCursor(cursor themePageCursor) bool {
	return cursor.BuiltInIndex >= 0 && cursor.BuiltInIndex < len(builtInOrder) &&
		cursor.NormalizedName == "" && cursor.CreatedAt.IsZero() && cursor.ID == "" && cursor.Revision == 0
}

func validRevisionThemeCursor(cursor themePageCursor) bool {
	return cursor.Revision >= 1 && cursor.BuiltInIndex == 0 && cursor.NormalizedName == "" && cursor.CreatedAt.IsZero() && cursor.ID == ""
}

func validAssetThemeCursor(cursor themePageCursor) bool {
	return cursor.BuiltInIndex == 0 && cursor.NormalizedName == "" && !cursor.CreatedAt.IsZero() &&
		cursor.ID != "" && len(cursor.ID) <= 256 && cursor.Revision == 0
}

func validCustomThemeCursor(cursor themePageCursor) bool {
	if cursor.Revision != 0 {
		return false
	}
	if cursor.NormalizedName == "" && cursor.CreatedAt.IsZero() && cursor.ID == "" {
		return cursor.BuiltInIndex == 0
	}
	return cursor.NormalizedName != "" && len([]rune(cursor.NormalizedName)) <= 80 && !cursor.CreatedAt.IsZero() && cursor.ID != "" && len(cursor.ID) <= 256 && cursor.BuiltInIndex == 0
}

func invalidThemeCursor() error {
	return fmt.Errorf("%w: invalid pagination cursor", ErrInvalidInput)
}

func customThemeCursor(scope string, row customSummaryRow) string {
	return encodeThemeCursor(customThemeCursorValue(scope, row))
}

func customThemeCursorValue(scope string, row customSummaryRow) themePageCursor {
	return themePageCursor{
		Scope:          scope,
		Segment:        cursorSegmentCustom,
		NormalizedName: row.NormalizedName,
		CreatedAt:      row.SortAt.UTC(),
		ID:             row.ThemeID,
	}
}
