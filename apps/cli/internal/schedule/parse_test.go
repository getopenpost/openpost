package schedule

import (
	"testing"
	"time"
)

func TestParseNaturalLanguageSchedule(t *testing.T) {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 6, 15, 10, 30, 45, 0, loc)

	tests := []struct {
		name    string
		input   string
		want    time.Time
		source  string
		wantErr bool
	}{
		{
			name:   "tomorrow 2pm",
			input:  "tomorrow 2pm",
			want:   time.Date(2026, 6, 16, 14, 0, 0, 0, loc),
			source: "natural",
		},
		{
			name:   "in 3 hours",
			input:  "in 3 hours",
			want:   now.Add(3 * time.Hour),
			source: "natural",
		},
		{
			name:   "next monday 9am",
			input:  "next monday 9am",
			want:   time.Date(2026, 6, 22, 9, 0, 0, 0, loc),
			source: "natural",
		},
		{
			name:   "RFC3339 passthrough",
			input:  "2026-06-20T14:00:00-04:00",
			want:   time.Date(2026, 6, 20, 14, 0, 0, 0, loc),
			source: "absolute",
		},
		{
			name:   "now alias",
			input:  "now",
			want:   now.Truncate(time.Minute).Add(time.Minute),
			source: "alias",
		},
		{
			name:   "draft alias",
			input:  "draft",
			want:   time.Time{},
			source: "alias",
		},
		{
			name:    "past time rejected",
			input:   "2026-06-14T14:00:00-04:00",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Parse(tt.input, Options{Now: now, WorkspaceTimezone: "America/New_York"})
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got.Source != tt.source {
				t.Fatalf("source = %q, want %q", got.Source, tt.source)
			}
			if !got.Time.Equal(tt.want) {
				t.Fatalf("time = %s, want %s", got.Time, tt.want)
			}
		})
	}
}
