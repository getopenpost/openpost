package platform

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestProviderTimeAcceptsEveryProviderLayout(t *testing.T) {
	want := time.Date(2026, 10, 26, 21, 1, 0, 0, time.UTC)
	values := map[string]string{
		"graph colonless offset": "2026-10-26T21:01:00+0000",
		"rfc 3339":               "2026-10-26T21:01:00Z",
		"offset with colon":      "2026-10-26T23:01:00+02:00",
		"fractional seconds":     "2026-10-26T21:01:00.000Z",
		"fractional colonless":   "2026-10-26T21:01:00.000+0000",
		"missing zone":           "2026-10-26T21:01:00",
		"surrounding whitespace": " 2026-10-26T21:01:00+0000 ",
	}
	for name, value := range values {
		t.Run(name, func(t *testing.T) {
			require.True(t, ProviderTime(value).Equal(want), "ProviderTime(%q)", value)
		})
	}
	for _, value := range []string{"", "   ", "not a time", "2026-10-26"} {
		t.Run("unparsed "+value, func(t *testing.T) {
			require.True(t, ProviderTime(value).IsZero())
		})
	}
}
