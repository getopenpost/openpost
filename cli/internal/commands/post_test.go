package commands

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveMediaInputsPreservesExistingCommaFilenameAndOriginalAltIndex(t *testing.T) {
	path := filepath.Join(t.TempDir(), "launch,final.png")
	if err := os.WriteFile(path, []byte("image"), 0o600); err != nil {
		t.Fatal(err)
	}

	got := resolveMediaInputs([]string{path}, []string{"Launch card"})
	if len(got) != 1 || got[0].value != path || got[0].alt != "Launch card" || !got[0].localFile {
		t.Fatalf("inputs = %#v", got)
	}
}

func TestResolveMediaInputsExpandsCSVMediaIDsWithoutBorrowingOriginalAlt(t *testing.T) {
	got := resolveMediaInputs([]string{"med_one, med_two"}, []string{"not for expanded IDs"})
	if len(got) != 2 || got[0].value != "med_one" || got[1].value != "med_two" {
		t.Fatalf("inputs = %#v", got)
	}
	if got[0].alt != "" || got[1].alt != "" || got[0].localFile || got[1].localFile {
		t.Fatalf("expanded inputs must remain ID-only without alt text: %#v", got)
	}
}

func TestResolveMediaInputsClassifiesCSVLocalFilesWithoutAlt(t *testing.T) {
	dir := t.TempDir()
	first := filepath.Join(dir, "first.png")
	second := filepath.Join(dir, "second.png")
	for _, path := range []string{first, second} {
		if err := os.WriteFile(path, []byte("image"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	got := resolveMediaInputs([]string{first + "," + second}, []string{"not for expanded files"})
	if len(got) != 2 || got[0].value != first || got[1].value != second {
		t.Fatalf("inputs = %#v", got)
	}
	if !got[0].localFile || !got[1].localFile || got[0].alt != "" || got[1].alt != "" {
		t.Fatalf("expanded local files must not receive alt text: %#v", got)
	}
}

func TestParseThreadMarkdown(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantFM   threadFrontMatter
		wantBody []string
		wantErr  string
	}{
		{
			name:  "front-matter plus three posts",
			input: "---\nworkspace: personal\naccounts: x,linkedin\nschedule: tomorrow 2pm\nrandom_delay: 7\n---\nOne\n---\nTwo\n---\nThree\n",
			wantFM: threadFrontMatter{
				Workspace:   "personal",
				Accounts:    "x,linkedin",
				Schedule:    "tomorrow 2pm",
				RandomDelay: 7,
			},
			wantBody: []string{"One", "Two", "Three"},
		},
		{
			name:     "no front-matter plus two posts",
			input:    "One\n---\nTwo\n",
			wantBody: []string{"One", "Two"},
		},
		{
			name:     "embedded dashes inside post body",
			input:    "One --- still one\n---\nTwo\n",
			wantBody: []string{"One --- still one", "Two"},
		},
		{
			name:    "empty segment rejected",
			input:   "One\n---\n \n---\nThree\n",
			wantErr: "thread segment 2 is empty",
		},
		{
			name:     "mixed CRLF and LF",
			input:    "One\r\n---\nTwo\r\n---\nThree",
			wantBody: []string{"One", "Two", "Three"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotFM, gotBody, err := parseThreadMarkdown(tt.input)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("error = %v, want containing %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if gotFM != tt.wantFM {
				t.Fatalf("frontmatter = %#v, want %#v", gotFM, tt.wantFM)
			}
			if strings.Join(gotBody, "\n---\n") != strings.Join(tt.wantBody, "\n---\n") {
				t.Fatalf("segments = %#v, want %#v", gotBody, tt.wantBody)
			}
		})
	}
}
