package diagnostics

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	defaultIngestPerMinute              = 30
	defaultIngestPerInstallationPerHour = 60
	defaultForwardConcurrency           = 8
	maxIngestInstallations              = 10_000
	forwardTimeout                      = 8 * time.Second
	discordTitleLimit                   = 256
	discordDescriptionLimit             = 4096
	discordFieldLimit                   = 1024
)

// IngestConfig gates the public cross-instance receiver. The Discord webhook
// URL is a secret: it comes only from the environment and is never logged,
// exposed in API responses, or committed.
type IngestConfig struct {
	Enabled           bool
	DiscordWebhookURL string
	// PerMinute caps accepted reports globally across installations.
	// PerInstallationPerHour caps accepted reports per installation ID.
	// Zero values select defaults.
	PerMinute              int
	PerInstallationPerHour int
	HTTPClient             *http.Client
	Now                    func() time.Time
}

// Ingester validates inbound cross-instance reports, applies abuse quotas,
// and forwards accepted reports to the maintainer Discord channel without
// blocking the request path. The zero value is disabled.
type Ingester struct {
	mu          sync.Mutex
	config      IngestConfig
	minuteStart time.Time
	minuteCount int
	hourStart   time.Time
	perInstall  map[string]int
	sem         chan struct{}
	client      *http.Client
	now         func() time.Time
}

// NewIngester builds an ingester. A nil or disabled config yields an
// ingester that rejects everything.
func NewIngester(config IngestConfig) *Ingester {
	now := config.Now
	if now == nil {
		now = time.Now
	}
	client := config.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: forwardTimeout}
	}
	perMinute := config.PerMinute
	if perMinute <= 0 {
		perMinute = defaultIngestPerMinute
	}
	perInstall := config.PerInstallationPerHour
	if perInstall <= 0 {
		perInstall = defaultIngestPerInstallationPerHour
	}
	return &Ingester{
		config: IngestConfig{
			Enabled:                config.Enabled && strings.TrimSpace(config.DiscordWebhookURL) != "",
			DiscordWebhookURL:      strings.TrimSpace(config.DiscordWebhookURL),
			PerMinute:              perMinute,
			PerInstallationPerHour: perInstall,
		},
		perInstall: make(map[string]int),
		sem:        make(chan struct{}, defaultForwardConcurrency),
		client:     client,
		now:        now,
	}
}

// IngestEnabled reports whether the public receiver accepts reports.
func (in *Ingester) IngestEnabled() bool {
	if in == nil {
		return false
	}
	in.mu.Lock()
	defer in.mu.Unlock()
	return in.config.Enabled
}

// Accept validates one inbound report and applies abuse quotas. It returns
// false for invalid, over-quota, or disabled ingest without logging the
// report contents.
func (in *Ingester) Accept(report Report) bool {
	if in == nil {
		return false
	}
	if err := ValidateReport(report); err != nil {
		return false
	}
	now := in.now().UTC()
	in.mu.Lock()
	defer in.mu.Unlock()
	if !in.config.Enabled {
		return false
	}
	if now.Sub(in.minuteStart) >= time.Minute {
		in.minuteStart = now.Truncate(time.Minute)
		in.minuteCount = 0
	}
	if in.minuteCount >= in.config.PerMinute {
		return false
	}
	if now.Sub(in.hourStart) >= time.Hour {
		in.hourStart = now.Truncate(time.Hour)
		clear(in.perInstall)
	}
	if in.perInstall[report.InstallationID] >= in.config.PerInstallationPerHour {
		return false
	}
	if len(in.perInstall) >= maxIngestInstallations {
		if _, known := in.perInstall[report.InstallationID]; !known {
			return false
		}
	}
	in.minuteCount++
	in.perInstall[report.InstallationID]++
	return true
}

// ForwardAsync delivers an accepted report to Discord without blocking the
// caller. Delivery is best-effort: saturation and failures drop the report.
// The webhook URL never appears in logs.
func (in *Ingester) ForwardAsync(report Report) {
	if in == nil {
		return
	}
	select {
	case in.sem <- struct{}{}:
	default:
		return
	}
	go func() {
		defer func() { <-in.sem }()
		ctx, cancel := context.WithTimeout(context.Background(), forwardTimeout)
		defer cancel()
		if err := postDiscordReport(ctx, in.client, in.webhookURL(), report); err != nil {
			log.Printf("diagnostics discord delivery failed: %v", err)
		}
	}()
}

func (in *Ingester) webhookURL() string {
	in.mu.Lock()
	defer in.mu.Unlock()
	return in.webhookURLLocked()
}

func (in *Ingester) webhookURLLocked() string {
	return in.config.DiscordWebhookURL
}

func postDiscordReport(ctx context.Context, client *http.Client, webhookURL string, report Report) error {
	if strings.TrimSpace(webhookURL) == "" {
		return fmt.Errorf("diagnostics discord webhook is not configured")
	}
	body, err := FormatDiscordPayload(report)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, webhookURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build diagnostics discord request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("deliver diagnostics discord report: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("diagnostics discord receiver returned %d", response.StatusCode)
	}
	return nil
}

type discordDiagnosticsPayload struct {
	Username string                    `json:"username,omitempty"`
	Embeds   []discordDiagnosticsEmbed `json:"embeds"`
}

type discordDiagnosticsEmbed struct {
	Title       string                         `json:"title"`
	Description string                         `json:"description"`
	Fields      []discordDiagnosticsEmbedField `json:"fields,omitempty"`
}

type discordDiagnosticsEmbedField struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Inline bool   `json:"inline,omitempty"`
}

// FormatDiscordPayload renders one accepted report as a Discord webhook
// payload. It is pure and bounded: every string is truncated to Discord's
// limits, and only allowlisted report fields are rendered.
func FormatDiscordPayload(report Report) ([]byte, error) {
	fields := []discordDiagnosticsEmbedField{
		{Name: "Surface", Value: clip(report.Surface, discordFieldLimit), Inline: true},
		{Name: "Operation", Value: clip(report.Operation, discordFieldLimit), Inline: true},
		{Name: "Occurrences", Value: fmt.Sprintf("%d", max(report.OccurrenceCount, 1)), Inline: true},
	}
	if report.ErrorKind != "" {
		fields = append(fields, discordDiagnosticsEmbedField{Name: "Error kind", Value: clip(report.ErrorKind, discordFieldLimit), Inline: true})
	}
	if report.HTTPMethod != "" {
		fields = append(fields, discordDiagnosticsEmbedField{Name: "HTTP method", Value: clip(report.HTTPMethod, discordFieldLimit), Inline: true})
	}
	build := strings.TrimSpace(strings.TrimSpace(report.Version) + " " + strings.TrimSpace(report.Revision))
	if build == "" {
		build = "unknown build"
	}
	fields = append(fields, discordDiagnosticsEmbedField{Name: "Build", Value: clip(build, discordFieldLimit), Inline: true})
	if report.Provider != "" {
		fields = append(fields, discordDiagnosticsEmbedField{Name: "Provider", Value: clip(report.Provider, discordFieldLimit), Inline: true})
	}
	if report.HTTPStatus != 0 {
		fields = append(fields, discordDiagnosticsEmbedField{Name: "HTTP status", Value: fmt.Sprintf("%d", report.HTTPStatus), Inline: true})
	}
	if report.RetryCount != 0 || report.AttemptCount != 0 {
		fields = append(fields, discordDiagnosticsEmbedField{
			Name: "Retries", Value: fmt.Sprintf("retry %d / attempt %d", report.RetryCount, report.AttemptCount), Inline: true,
		})
	}
	if report.DBDriver != "" || report.StorageDriver != "" {
		fields = append(fields, discordDiagnosticsEmbedField{
			Name: "Drivers", Value: clip("db "+report.DBDriver+" / storage "+report.StorageDriver, discordFieldLimit), Inline: true,
		})
	}
	if len(report.Frames) > 0 {
		var frames strings.Builder
		for i, frame := range report.Frames {
			if i > 0 {
				frames.WriteString("\n")
			}
			fmt.Fprintf(&frames, "%s %s:%d", frame.Function, frame.Module, frame.Line)
			if frame.Column > 0 {
				fmt.Fprintf(&frames, ":%d", frame.Column)
			}
			if frames.Len() > discordFieldLimit-32 {
				frames.WriteString("\n…")
				break
			}
		}
		const codeFenceCharacters = len("```\n\n```")
		fields = append(fields, discordDiagnosticsEmbedField{
			Name: "Frames", Value: "```\n" + clip(frames.String(), discordFieldLimit-codeFenceCharacters) + "\n```",
		})
	}
	fields = append(fields, discordDiagnosticsEmbedField{
		Name: "Installation", Value: clip(report.InstallationID, discordFieldLimit), Inline: true,
	})
	payload := discordDiagnosticsPayload{
		Username: "OpenPost diagnostics",
		Embeds: []discordDiagnosticsEmbed{{
			Title:       clip(report.ErrorCode, discordTitleLimit),
			Description: clip(windowDescription(report), discordDescriptionLimit),
		}},
	}
	payload.Embeds[0].Fields = fields
	return json.Marshal(payload)
}

func windowDescription(report Report) string {
	if report.FirstSeen.IsZero() || report.LastSeen.IsZero() {
		return "Accepted diagnostic report."
	}
	return fmt.Sprintf(
		"Accepted diagnostic report. First seen %s, last seen %s.",
		report.FirstSeen.UTC().Format(time.RFC3339),
		report.LastSeen.UTC().Format(time.RFC3339),
	)
}

func clip(value string, limit int) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "—"
	}
	runes := []rune(value)
	if len(runes) > limit {
		return string(runes[:limit-1]) + "…"
	}
	return value
}
