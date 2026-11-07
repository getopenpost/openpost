package main

import (
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

// The Media Library guide must not restate the server's enforced uploader
// limits by hand: those numbers live in
// apps/server/internal/api/handlers/media.go and are published through the
// generated media-limits guide. See issue #437.
func TestMediaLibraryGuideDerivesUploadLimits(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate test source file")
	}
	guide := filepath.Join(filepath.Dir(file), "..", "..", "..", "docs", "content", "docs", "guides", "media-library.mdx")
	content, err := os.ReadFile(guide)
	if err != nil {
		t.Fatalf("read media library guide: %v", err)
	}
	for _, pattern := range []string{`64\s*million`, `50\s*MB`, `64_?000_?000`, `52428800`} {
		if matched, _ := regexp.MatchString(pattern, string(content)); matched {
			t.Errorf("media library guide restates an enforced upload limit by hand (matched %q); link to /guides/media-limits instead", pattern)
		}
	}
	if !strings.Contains(string(content), "/guides/media-limits") {
		t.Error("media library guide must link to the generated media-limits guide for upload numbers")
	}
}

func mustConstValue(t *testing.T, source, name string) string {
	t.Helper()
	pattern := regexp.MustCompile(`(?m)^\s*` + name + `\s+int64\s*=\s*(.+?)\s*$`)
	match := pattern.FindStringSubmatch(source)
	if match == nil {
		t.Fatalf("constant %s not found in media handler source", name)
	}
	value := int64(1)
	for _, part := range strings.Split(match[1], "*") {
		literal := strings.ReplaceAll(strings.TrimSpace(part), "_", "")
		parsed, err := strconv.ParseInt(literal, 10, 64)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}
		value *= parsed
	}
	return strconv.FormatInt(value, 10)
}
