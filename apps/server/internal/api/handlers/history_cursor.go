package handlers

import (
	"errors"
	"strings"
	"time"
)

var errInvalidHistoryCursor = errors.New("invalid pagination cursor")

type timestampIDCursor struct {
	Timestamp time.Time
	ID        string
}

func encodeTimestampIDCursor(timestamp time.Time, id string) string {
	return timestamp.UTC().Format(time.RFC3339Nano) + "|" + id
}

func parseTimestampIDCursor(value string) (timestampIDCursor, error) {
	parts := strings.SplitN(strings.TrimSpace(value), "|", 2)
	if len(parts) != 2 || strings.TrimSpace(parts[1]) == "" {
		return timestampIDCursor{}, errInvalidHistoryCursor
	}
	timestamp, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return timestampIDCursor{}, errInvalidHistoryCursor
	}
	return timestampIDCursor{Timestamp: timestamp.UTC(), ID: parts[1]}, nil
}

func parseOptionalRFC3339(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, nil
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}, err
	}
	return parsed.UTC(), nil
}
