package publicationdiscovery

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/netguard"
)

const (
	maxResultLimit             = 8
	maxFocusCharacters         = 1_000
	maxAudienceCharacters      = 500
	maxVoiceContextBytes       = 64 * 1_024
	maxRecentPublications      = 30
	maxRecentSummaryCharacters = 800
	maxTopicCharacters         = 120
	maxGeneratedOutputBytes    = 128 * 1_024
	maxOpportunityTitle        = 160
	maxOpportunityReason       = 600
	maxHookCharacters          = 280
	minAngles                  = 3
	maxAngles                  = 5
	maxAngleLabel              = 100
	maxAngleText               = 500
	maxSources                 = 5
	maxSourceTitle             = 240
	maxSourcePublisher         = 160
	maxSourceSupport           = 500
	maxSourceURL               = 2_048
	maxTreatmentText           = 500
	maxSignalAgeDays           = 30
)

var nativePlatforms = map[string]struct{}{
	capabilities.ProviderLinkedIn: {},
	capabilities.ProviderX:        {},
	capabilities.ProviderMastodon: {},
	capabilities.ProviderBluesky:  {},
	capabilities.ProviderThreads:  {},
}

//nolint:gocyclo // Discovery input has independent privacy, freshness, and platform bounds.
func validateAndNormalizeInput(input Input, now time.Time) (Input, error) {
	input.Platforms = append([]string(nil), input.Platforms...)
	input.RecentPublications = append([]RecentPublicationSummary(nil), input.RecentPublications...)
	for index := range input.RecentPublications {
		input.RecentPublications[index].Platforms = append([]string(nil), input.RecentPublications[index].Platforms...)
		input.RecentPublications[index].Topics = append([]string(nil), input.RecentPublications[index].Topics...)
	}
	input.Focus = strings.TrimSpace(input.Focus)
	input.Audience = strings.TrimSpace(input.Audience)
	input.Voice.Name = strings.TrimSpace(input.Voice.Name)
	if input.Voice.Name == "" {
		return Input{}, invalidInput("voice name is required")
	}
	if utf8.RuneCountInString(input.Focus) > maxFocusCharacters {
		return Input{}, invalidInput("focus exceeds 1000 characters")
	}
	if utf8.RuneCountInString(input.Audience) > maxAudienceCharacters {
		return Input{}, invalidInput("audience exceeds 500 characters")
	}
	voice, err := json.Marshal(input.Voice)
	if err != nil || len(voice) > maxVoiceContextBytes {
		return Input{}, invalidInput("voice context exceeds its safe limit")
	}
	if input.Limit == 0 {
		input.Limit = defaultResultLimit
	}
	if input.Limit < 1 || input.Limit > maxResultLimit {
		return Input{}, invalidInput("limit must be between 1 and 8")
	}
	if len(input.Platforms) == 0 || len(input.Platforms) > len(nativePlatforms) {
		return Input{}, invalidInput("platforms must contain 1 to 5 native destinations")
	}
	seenPlatforms := make(map[string]struct{}, len(input.Platforms))
	for index, platform := range input.Platforms {
		platform = strings.ToLower(strings.TrimSpace(platform))
		if _, supported := nativePlatforms[platform]; !supported {
			return Input{}, invalidInput("platforms contain an unsupported destination")
		}
		if _, duplicate := seenPlatforms[platform]; duplicate {
			return Input{}, invalidInput("platforms must be unique")
		}
		seenPlatforms[platform] = struct{}{}
		input.Platforms[index] = platform
	}
	if len(input.RecentPublications) > maxRecentPublications {
		return Input{}, invalidInput("recent_publications exceeds 30 items")
	}
	for index := range input.RecentPublications {
		recent := &input.RecentPublications[index]
		recent.Summary = strings.TrimSpace(recent.Summary)
		if recent.PublishedAt.IsZero() || recent.PublishedAt.After(now.Add(24*time.Hour)) {
			return Input{}, invalidInput("recent_publications contains an invalid published_at")
		}
		if recent.Summary == "" || utf8.RuneCountInString(recent.Summary) > maxRecentSummaryCharacters {
			return Input{}, invalidInput("recent_publications contains an invalid summary")
		}
		var err error
		recent.Platforms, err = normalizeRecentValues(recent.Platforms, maxTopicCharacters, true)
		if err != nil {
			return Input{}, err
		}
		recent.Topics, err = normalizeRecentValues(recent.Topics, maxTopicCharacters, false)
		if err != nil {
			return Input{}, err
		}
	}
	return input, nil
}

func normalizeRecentValues(values []string, maxCharacters int, platforms bool) ([]string, error) {
	seen := make(map[string]struct{}, len(values))
	for index, value := range values {
		value = strings.TrimSpace(value)
		if platforms {
			value = strings.ToLower(value)
			if _, supported := nativePlatforms[value]; !supported {
				return nil, invalidInput("recent_publications contains an unsupported platform")
			}
		}
		if value == "" || utf8.RuneCountInString(value) > maxCharacters {
			return nil, invalidInput("recent_publications contains invalid context")
		}
		key := strings.ToLower(value)
		if _, duplicate := seen[key]; duplicate {
			return nil, invalidInput("recent_publications context values must be unique")
		}
		seen[key] = struct{}{}
		values[index] = value
	}
	return values, nil
}

func decodeStrictOutput(text string, target any) error {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" || len(trimmed) > maxGeneratedOutputBytes {
		return ErrInvalidOutput
	}
	decoder := json.NewDecoder(bytes.NewBufferString(trimmed))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return ErrInvalidOutput
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return ErrInvalidOutput
	}
	return nil
}

//nolint:gocyclo // Every opportunity is untrusted model output with independent structural checks.
func validateAndNormalizeOutput(output generatedResult, input Input, now time.Time) ([]Opportunity, error) {
	if len(output.Opportunities) == 0 || len(output.Opportunities) > input.Limit {
		return nil, invalidOutput("opportunities must contain 1 to the requested limit")
	}
	wantedPlatforms := make(map[string]struct{}, len(input.Platforms))
	for _, platform := range input.Platforms {
		wantedPlatforms[platform] = struct{}{}
	}
	seenTitles := make(map[string]struct{}, len(output.Opportunities))
	seenSourceURLs := make(map[string]struct{}, webSearchMaxTotalResults)
	opportunities := make([]Opportunity, 0, len(output.Opportunities))
	for opportunityIndex, generated := range output.Opportunities {
		title, err := requiredText(generated.Title, maxOpportunityTitle)
		if err != nil {
			return nil, invalidOutput("opportunity title is missing or too long")
		}
		titleKey := strings.ToLower(title)
		if _, duplicate := seenTitles[titleKey]; duplicate {
			return nil, invalidOutput("opportunity titles must be unique")
		}
		seenTitles[titleKey] = struct{}{}
		whyItFits, err := requiredText(generated.WhyItFits, maxOpportunityReason)
		if err != nil {
			return nil, invalidOutput("opportunity why_it_fits is missing or too long")
		}
		whyNow, err := requiredText(generated.WhyNow, maxOpportunityReason)
		if err != nil {
			return nil, invalidOutput("opportunity why_now is missing or too long")
		}
		hook, err := requiredText(generated.Hook, maxHookCharacters)
		if err != nil {
			return nil, invalidOutput("opportunity hook is missing or too long")
		}
		signalDate, err := currentDate(generated.SignalDate, now)
		if err != nil {
			return nil, invalidOutput("opportunity signal_date is outside the current window")
		}
		angles, err := normalizeAngles(generated.Angles)
		if err != nil {
			return nil, err
		}
		sources, err := normalizeSources(generated.Sources, now)
		if err != nil {
			return nil, err
		}
		for _, source := range sources {
			seenSourceURLs[source.URL] = struct{}{}
		}
		if len(seenSourceURLs) > webSearchMaxTotalResults {
			return nil, invalidOutput("opportunities cite more sources than the bounded search returned")
		}
		treatments, err := normalizeTreatments(generated.PlatformTreatments, input.Platforms, wantedPlatforms)
		if err != nil {
			return nil, err
		}
		opportunities = append(opportunities, Opportunity{
			ID: fmt.Sprintf("opportunity-%d", opportunityIndex+1), Title: title,
			WhyItFits: whyItFits, WhyNow: whyNow, SignalDate: signalDate, Hook: hook,
			Angles: angles, Sources: sources, PlatformTreatments: treatments,
		})
	}
	return opportunities, nil
}

func normalizeAngles(generated []generatedAngle) ([]Angle, error) {
	if len(generated) < minAngles || len(generated) > maxAngles {
		return nil, invalidOutput("every opportunity requires 3 to 5 angles")
	}
	seen := make(map[string]struct{}, len(generated))
	angles := make([]Angle, 0, len(generated))
	for index, generatedAngle := range generated {
		label, labelErr := requiredText(generatedAngle.Label, maxAngleLabel)
		thesis, thesisErr := requiredText(generatedAngle.Thesis, maxAngleText)
		approach, approachErr := requiredText(generatedAngle.Approach, maxAngleText)
		if labelErr != nil || thesisErr != nil || approachErr != nil {
			return nil, invalidOutput("angle fields are missing or too long")
		}
		key := strings.ToLower(label)
		if _, duplicate := seen[key]; duplicate {
			return nil, invalidOutput("angle labels must be unique")
		}
		seen[key] = struct{}{}
		angles = append(angles, Angle{ID: fmt.Sprintf("angle-%d", index+1), Label: label, Thesis: thesis, Approach: approach})
	}
	return angles, nil
}

func normalizeSources(generated []SourceCitation, now time.Time) ([]SourceCitation, error) {
	if len(generated) == 0 || len(generated) > maxSources {
		return nil, invalidOutput("every opportunity requires 1 to 5 source citations")
	}
	seen := make(map[string]struct{}, len(generated))
	sources := make([]SourceCitation, 0, len(generated))
	hasRecentPrimary := false
	for _, source := range generated {
		title, titleErr := requiredText(source.Title, maxSourceTitle)
		publisher, publisherErr := requiredText(source.Publisher, maxSourcePublisher)
		supports, supportsErr := requiredText(source.Supports, maxSourceSupport)
		if titleErr != nil || publisherErr != nil || supportsErr != nil {
			return nil, invalidOutput("source citation fields are missing or too long")
		}
		sourceURL, err := normalizeCitationURL(source.URL)
		if err != nil {
			return nil, invalidOutput("source citation URL must be a safe absolute HTTP or HTTPS URL")
		}
		if _, duplicate := seen[sourceURL]; duplicate {
			return nil, invalidOutput("source citation URLs must be unique")
		}
		seen[sourceURL] = struct{}{}
		publishedAt, err := parseDate(source.PublishedAt)
		if err != nil || publishedAt.After(startOfDay(now)) {
			return nil, invalidOutput("source citation published_at must be a valid date")
		}
		if source.Primary && !publishedAt.Before(startOfDay(now).AddDate(0, 0, -maxSignalAgeDays)) {
			hasRecentPrimary = true
		}
		sources = append(sources, SourceCitation{
			Title: title, URL: sourceURL, Publisher: publisher,
			PublishedAt: publishedAt.Format(time.DateOnly), Supports: supports, Primary: source.Primary,
		})
	}
	if !hasRecentPrimary {
		return nil, invalidOutput("every opportunity requires a recent primary source")
	}
	return sources, nil
}

func normalizeTreatments(
	generated []PlatformTreatment,
	platformOrder []string,
	wanted map[string]struct{},
) ([]PlatformTreatment, error) {
	if len(generated) != len(wanted) {
		return nil, invalidOutput("every selected platform requires one treatment")
	}
	seen := make(map[string]struct{}, len(generated))
	treatmentByPlatform := make(map[string]PlatformTreatment, len(generated))
	for _, treatment := range generated {
		platform := strings.ToLower(strings.TrimSpace(treatment.Platform))
		if _, allowed := wanted[platform]; !allowed {
			return nil, invalidOutput("platform treatment selected an unsupported platform")
		}
		if _, duplicate := seen[platform]; duplicate {
			return nil, invalidOutput("platform treatments must be unique")
		}
		seen[platform] = struct{}{}
		objective, objectiveErr := requiredText(treatment.Objective, maxAngleLabel)
		format, formatErr := requiredText(treatment.Format, maxAngleLabel)
		rationale, rationaleErr := requiredText(treatment.Rationale, maxTreatmentText)
		media, mediaErr := requiredText(treatment.Media, maxTreatmentText)
		if objectiveErr != nil || formatErr != nil || rationaleErr != nil || mediaErr != nil {
			return nil, invalidOutput("platform treatment fields are missing or too long")
		}
		treatmentByPlatform[platform] = PlatformTreatment{
			Platform: platform, Objective: objective, Format: format, Rationale: rationale, Media: media,
		}
	}
	treatments := make([]PlatformTreatment, 0, len(platformOrder))
	for _, platform := range platformOrder {
		treatments = append(treatments, treatmentByPlatform[platform])
	}
	return treatments, nil
}

func currentDate(raw string, now time.Time) (string, error) {
	date, err := parseDate(raw)
	if err != nil {
		return "", err
	}
	today := startOfDay(now)
	if date.Before(today.AddDate(0, 0, -maxSignalAgeDays)) || date.After(today) {
		return "", errors.New("date is not current")
	}
	return date.Format(time.DateOnly), nil
}

func parseDate(raw string) (time.Time, error) {
	return time.Parse(time.DateOnly, strings.TrimSpace(raw))
}

func startOfDay(value time.Time) time.Time {
	value = value.UTC()
	return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, time.UTC)
}

//nolint:gocyclo // URL normalization deliberately fails closed across every unsafe host and scheme form.
func normalizeCitationURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > maxSourceURL || strings.IndexFunc(raw, unicode.IsControl) >= 0 {
		return "", errors.New("invalid URL")
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Hostname() == "" || parsed.User != nil {
		return "", errors.New("invalid URL")
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", errors.New("invalid URL")
	}
	if port := parsed.Port(); port != "" && (parsed.Scheme != "http" || port != "80") && (parsed.Scheme != "https" || port != "443") {
		return "", errors.New("invalid URL")
	}
	host := strings.ToLower(strings.TrimSuffix(parsed.Hostname(), "."))
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") || strings.HasSuffix(host, ".home.arpa") {
		return "", errors.New("invalid URL")
	}
	if ip := net.ParseIP(host); ip != nil && !netguard.IsPublicAddress(ip) {
		return "", errors.New("invalid URL")
	}
	parsed.Fragment = ""
	return parsed.String(), nil
}

func requiredText(value string, maxCharacters int) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || utf8.RuneCountInString(value) > maxCharacters {
		return "", errors.New("invalid text")
	}
	return value, nil
}

func invalidInput(message string) error {
	return fmt.Errorf("%w: %s", ErrInvalidInput, message)
}

func invalidOutput(message string) error {
	return fmt.Errorf("%w: %s", ErrInvalidOutput, message)
}
