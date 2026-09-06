package logging

import (
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"regexp"
	"strings"
)

const redactedValue = "[REDACTED]"

var (
	credentialAssignmentPattern = regexp.MustCompile(`(?i)\b(?:[a-z0-9.-]+[_-])?(?:password|passwd|passphrase|secret|token|credential|api[_-]?key|access[_-]?key|private[_-]?key|encryption[_-]?key|database[_-]?url|dsn)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)`)
	authorizationPattern        = regexp.MustCompile(`(?i)\b(?:authorization|proxy-authorization)\s*[:=]\s*[^\s,;]+(?:\s+[^\s,;]+)?`)
	cookiePattern               = regexp.MustCompile(`(?i)\b(?:cookie|set-cookie)\s*[:=]\s*[^\r\n]+`)
	uriPattern                  = regexp.MustCompile(`[A-Za-z][A-Za-z0-9+.-]*://[^\s"'<>\[\]{}]+`)
)

type Logger struct {
	logger *slog.Logger
}

func New(output io.Writer, service, revision string) *Logger {
	handler := slog.NewJSONHandler(output, &slog.HandlerOptions{ReplaceAttr: replaceAttribute})
	return &Logger{logger: slog.New(handler).With(
		"service", strings.TrimSpace(service),
		"revision", normalizedRevision(revision),
	)}
}

func (l *Logger) Info(event string, args ...any) {
	l.logger.Info(strings.TrimSpace(event), args...)
}

func (l *Logger) LegacyWriter() io.Writer {
	return legacyWriter{logger: l}
}

type legacyWriter struct {
	logger *Logger
}

func (w legacyWriter) Write(contents []byte) (int, error) {
	for _, line := range strings.Split(string(contents), "\n") {
		message := strings.TrimSpace(line)
		if message != "" {
			w.logger.Info("legacy_log", "message", message)
		}
	}
	return len(contents), nil
}

func replaceAttribute(_ []string, attribute slog.Attr) slog.Attr {
	switch attribute.Key {
	case slog.TimeKey:
		attribute.Key = "timestamp"
	case slog.LevelKey:
		attribute.Key = "severity"
	case slog.MessageKey:
		attribute.Key = "event"
	}
	if sensitiveKey(attribute.Key) {
		return slog.String(attribute.Key, redactedValue)
	}
	value := attribute.Value.Resolve()
	switch value.Kind() {
	case slog.KindString:
		attribute.Value = slog.StringValue(Redact(value.String()))
	case slog.KindAny:
		if value.Any() != nil {
			attribute.Value = slog.StringValue(Redact(fmt.Sprint(value.Any())))
		}
	}
	return attribute
}

func sensitiveKey(key string) bool {
	normalized := strings.NewReplacer("-", "_", ".", "_").Replace(strings.ToLower(key))
	for _, suffix := range []string{
		"authorization",
		"cookie",
		"password",
		"passwd",
		"passphrase",
		"secret",
		"token",
		"credential",
		"api_key",
		"access_key",
		"private_key",
		"encryption_key",
		"database_url",
		"dsn",
	} {
		if normalized == suffix || strings.HasSuffix(normalized, "_"+suffix) {
			return true
		}
	}
	return false
}

func Redact(value string) string {
	redacted := uriPattern.ReplaceAllStringFunc(value, redactURI)
	redacted = cookiePattern.ReplaceAllString(redacted, "cookie="+redactedValue)
	redacted = authorizationPattern.ReplaceAllString(redacted, "authorization="+redactedValue)
	return credentialAssignmentPattern.ReplaceAllStringFunc(redacted, func(match string) string {
		separator := strings.IndexAny(match, ":=")
		if separator < 0 {
			return redactedValue
		}
		return strings.TrimSpace(match[:separator]) + "=" + redactedValue
	})
}

func redactURI(candidate string) string {
	trimmed, suffix := trimURISuffix(candidate)
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return candidate
	}
	parsed.User = nil
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String() + suffix
}

func trimURISuffix(candidate string) (string, string) {
	trimmed := strings.TrimRight(candidate, ".,;:)")
	return trimmed, candidate[len(trimmed):]
}

func normalizedRevision(revision string) string {
	if revision = strings.TrimSpace(revision); revision != "" {
		return revision
	}
	return "unknown"
}
