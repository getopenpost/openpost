// Package publicationpoll resolves authored polls into provider post content.
package publicationpoll

import (
	"encoding/json"
	"fmt"
	"maps"
	"strings"

	"github.com/openpost/backend/internal/capabilities"
)

const SettingsKey = "poll"

type Option struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

type Content struct {
	Question        string   `json:"question"`
	Options         []Option `json:"options"`
	DurationSeconds int      `json:"duration_seconds"`
	Multiple        bool     `json:"multiple,omitempty"`
	HideTotals      bool     `json:"hide_totals,omitempty"`
}

type Mode string

const (
	ModeNative Mode = "native"
	ModeText   Mode = "text"
	ModeOmit   Mode = "omit"
	ModeCustom Mode = "custom"
	ModeLegacy Mode = "legacy"
)

type Destination struct {
	Mode Mode     `json:"mode"`
	Poll *Content `json:"poll,omitempty"`
}

// Draft belongs to canonical segment settings. Choices are independent of body/media overrides.
type Draft struct {
	Content
	Destinations map[string]Destination `json:"destinations"`
}

func Decode(settings map[string]any) (*Draft, error) {
	raw, ok := settings[SettingsKey]
	if !ok || raw == nil {
		return nil, nil
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid poll: %w", err)
	}
	var draft Draft
	if err := json.Unmarshal(data, &draft); err != nil {
		return nil, fmt.Errorf("invalid poll: %w", err)
	}
	return &draft, nil
}

// Resolve is used for persisted output, validation and delivery. It never changes authored input.
func Resolve(source map[string]any, accountID, provider, outputProfile, body string, settings map[string]any) (string, map[string]any, error) {
	draft, err := Decode(source)
	if err != nil || draft == nil {
		return body, settings, err
	}
	if draft.Destinations[accountID].Mode == ModeLegacy {
		return body, settings, nil
	}
	values := maps.Clone(settings)
	if values == nil {
		values = map[string]any{}
	}
	for key := range values {
		if strings.HasPrefix(key, "poll_") {
			delete(values, key)
		}
	}
	choice := draft.Destinations[accountID]
	content := draft.Content
	switch choice.Mode {
	case ModeOmit:
		return body, values, nil
	case ModeCustom:
		if choice.Poll == nil {
			return body, values, fmt.Errorf("choose a poll for this destination")
		}
		content = *choice.Poll
	case ModeNative, ModeText:
	default:
		return body, values, fmt.Errorf("choose a poll version for this destination")
	}
	answers, err := pollAnswers(content)
	if err != nil {
		return body, values, err
	}
	question := strings.TrimSpace(content.Question)
	if choice.Mode == ModeText {
		lines := []string{question}
		for i, answer := range answers {
			lines = append(lines, fmt.Sprintf("%d. %s", i+1, answer))
		}
		return appendText(body, strings.Join(lines, "\n")), values, nil
	}
	return resolveNative(content, answers, provider, outputProfile, body, values)
}

func pollAnswers(content Content) ([]string, error) {
	if strings.TrimSpace(content.Question) == "" {
		return nil, fmt.Errorf("add a poll question")
	}
	if len(content.Options) < 2 {
		return nil, fmt.Errorf("add at least two poll answers")
	}
	answers := make([]string, 0, len(content.Options))
	seen := map[string]bool{}
	for _, option := range content.Options {
		answer := strings.TrimSpace(option.Text)
		if answer == "" || strings.ContainsAny(answer, "\r\n") {
			return nil, fmt.Errorf("each poll answer must contain text on one line")
		}
		if option.ID == "" || seen[option.ID] {
			return nil, fmt.Errorf("poll answers need unique IDs")
		}
		seen[option.ID] = true
		answers = append(answers, answer)
	}
	return answers, nil
}

func resolveNative(content Content, answers []string, provider, outputProfile, body string, values map[string]any) (string, map[string]any, error) {
	question := strings.TrimSpace(content.Question)
	capability, found := capabilities.FindOutput(provider, outputProfile)
	fields := map[string]capabilities.SettingDefinition{}
	if found {
		for _, field := range capability.Settings {
			fields[field.Key] = field
		}
	}
	field, supported := fields["poll_options"]
	if !supported || field.UnavailableReason != "" {
		return body, values, fmt.Errorf("this destination cannot publish a native poll. Choose a text version or post without the poll")
	}
	values["poll_options"] = strings.Join(answers, "\n")
	if _, ok := fields["poll_question"]; ok {
		values["poll_question"] = question
	} else {
		body = appendText(body, question)
	}
	if err := resolveDuration(content.DurationSeconds, fields, values); err != nil {
		return body, values, err
	}
	for key, enabled := range map[string]bool{"poll_multiple": content.Multiple, "poll_hide_totals": content.HideTotals} {
		if !enabled {
			continue
		}
		if _, ok := fields[key]; !ok {
			return body, values, fmt.Errorf("this destination does not support %s. Customize its poll", strings.ReplaceAll(strings.TrimPrefix(key, "poll_"), "_", " "))
		}
		values[key] = true
	}
	return body, values, nil
}

func resolveDuration(seconds int, fields map[string]capabilities.SettingDefinition, values map[string]any) error {
	if seconds <= 0 {
		return fmt.Errorf("choose a poll duration")
	}
	if _, ok := fields["poll_duration_minutes"]; ok {
		if seconds%60 != 0 {
			return fmt.Errorf("this poll duration must use whole minutes")
		}
		values["poll_duration_minutes"] = seconds / 60
	}
	if _, ok := fields["poll_expires_in_seconds"]; ok {
		values["poll_expires_in_seconds"] = seconds
	}
	if _, ok := fields["poll_duration"]; ok {
		duration := map[int]string{86400: "ONE_DAY", 259200: "THREE_DAYS", 604800: "SEVEN_DAYS", 1209600: "FOURTEEN_DAYS"}[seconds]
		if duration == "" {
			return fmt.Errorf("choose 1, 3, 7 or 14 days for this poll")
		}
		values["poll_duration"] = duration
	}
	return nil
}

func appendText(body, text string) string {
	if strings.TrimSpace(body) == "" {
		return text
	}
	return strings.TrimSpace(body) + "\n\n" + text
}

// ResolveJoined keeps explicit omissions and text versions when a destination combines a thread.
func ResolveJoined(sources []map[string]any, accountID, provider, outputProfile, body string, settings map[string]any) (string, map[string]any, error) {
	for _, source := range sources {
		draft, err := Decode(source)
		if err != nil {
			return body, settings, err
		}
		if draft == nil {
			continue
		}
		mode := draft.Destinations[accountID].Mode
		if mode == ModeNative || mode == ModeCustom || mode == ModeLegacy {
			return body, settings, fmt.Errorf("native polls in a thread need separate destination posts. Choose a thread format or a text version")
		}
		body, settings, err = Resolve(source, accountID, provider, outputProfile, body, settings)
		if err != nil {
			return body, settings, err
		}
	}
	return body, settings, nil
}
