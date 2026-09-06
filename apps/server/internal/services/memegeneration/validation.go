package memegeneration

import (
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/language"
)

var templateIDPattern = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_-]*$`)

type normalizedInput struct {
	Idea           string
	Tone           string
	Language       string
	CandidateCount int
	Templates      []Template
}

//nolint:gocyclo // Strict boundary validation keeps every untrusted prompt field independently bounded.
func normalizeInput(input Input) (normalizedInput, error) {
	idea, err := normalizeInputText(input.Idea, MaxIdeaCharacters, true)
	if err != nil || idea == "" {
		return normalizedInput{}, invalidInput("idea is required and must be at most %d characters", MaxIdeaCharacters)
	}
	tone, err := normalizeInputText(input.Tone, MaxToneCharacters, false)
	if err != nil {
		return normalizedInput{}, invalidInput("tone must be at most %d characters", MaxToneCharacters)
	}
	if tone == "" {
		tone = "witty"
	}
	switch tone {
	case "witty", "balanced", "dry", "sarcastic", "playful":
	default:
		return normalizedInput{}, invalidInput("tone must be witty, balanced, dry, sarcastic, or playful")
	}

	languageValue := strings.TrimSpace(input.Language)
	if languageValue == "" {
		languageValue = "en"
	}
	languageTag, err := language.Parse(languageValue)
	if err != nil {
		return normalizedInput{}, invalidInput("language must be a valid BCP 47 tag")
	}

	if len(input.Templates) == 0 || len(input.Templates) > MaxCandidateTemplates {
		return normalizedInput{}, invalidInput("templates must contain between 1 and %d entries", MaxCandidateTemplates)
	}
	count := input.CandidateCount
	if count == 0 {
		count = DefaultCandidateCount
		if count > len(input.Templates) {
			count = len(input.Templates)
		}
	}
	if count < 1 || count > MaxCandidateCount || count > len(input.Templates) {
		return normalizedInput{}, invalidInput("candidate count must be between 1 and %d and not exceed the template count", MaxCandidateCount)
	}

	templates := make([]Template, 0, len(input.Templates))
	seenIDs := make(map[string]struct{}, len(input.Templates))
	for _, value := range input.Templates {
		template, err := normalizeTemplate(value)
		if err != nil {
			return normalizedInput{}, err
		}
		if _, exists := seenIDs[template.ID]; exists {
			return normalizedInput{}, invalidInput("template IDs must be unique")
		}
		seenIDs[template.ID] = struct{}{}
		templates = append(templates, template)
	}

	return normalizedInput{
		Idea:           idea,
		Tone:           tone,
		Language:       languageTag.String(),
		CandidateCount: count,
		Templates:      templates,
	}, nil
}

//nolint:gocyclo // Template metadata has independent structural and text bounds by design.
func normalizeTemplate(input Template) (Template, error) {
	id := strings.TrimSpace(input.ID)
	if utf8.RuneCountInString(id) == 0 || utf8.RuneCountInString(id) > MaxTemplateIDCharacters || !templateIDPattern.MatchString(id) {
		return Template{}, invalidInput("template ID is invalid")
	}
	name, err := normalizeInputText(input.Name, MaxTemplateNameCharacters, false)
	if err != nil || name == "" {
		return Template{}, invalidInput("template name is required and must be at most %d characters", MaxTemplateNameCharacters)
	}
	if input.LineCount < 1 || input.LineCount > MaxTemplateLines {
		return Template{}, invalidInput("template line count must be between 1 and %d", MaxTemplateLines)
	}
	if input.OverlayCount < 0 || input.OverlayCount > MaxTemplateOverlays {
		return Template{}, invalidInput("template overlay count must be between 0 and %d", MaxTemplateOverlays)
	}
	if len(input.Keywords) > MaxTemplateKeywords {
		return Template{}, invalidInput("template keywords must contain at most %d entries", MaxTemplateKeywords)
	}

	keywords := make([]string, 0, len(input.Keywords))
	seenKeywords := make(map[string]struct{}, len(input.Keywords))
	for _, value := range input.Keywords {
		keyword, err := normalizeInputText(value, MaxKeywordCharacters, false)
		if err != nil {
			return Template{}, invalidInput("template keyword must be at most %d characters", MaxKeywordCharacters)
		}
		if keyword == "" {
			continue
		}
		key := strings.ToLower(keyword)
		if _, exists := seenKeywords[key]; exists {
			continue
		}
		seenKeywords[key] = struct{}{}
		keywords = append(keywords, keyword)
	}
	if len(input.ExampleLines) != 0 && len(input.ExampleLines) != input.LineCount {
		return Template{}, invalidInput("template example lines must be empty or match its line count")
	}
	exampleLines := make([]string, 0, len(input.ExampleLines))
	for _, value := range input.ExampleLines {
		line, err := normalizeInputText(value, MaxExampleLineCharacters, false)
		if err != nil {
			return Template{}, invalidInput("template example lines must contain at most %d characters", MaxExampleLineCharacters)
		}
		exampleLines = append(exampleLines, line)
	}

	meaning, err := normalizeInputText(input.Semantics.Meaning, MaxSemanticCharacters, true)
	if err != nil {
		return Template{}, invalidInput("template meaning must be at most %d characters", MaxSemanticCharacters)
	}
	visual, err := normalizeInputText(input.Semantics.Visual, MaxVisualCharacters, false)
	if err != nil {
		return Template{}, invalidInput("template visual must be at most %d characters", MaxVisualCharacters)
	}
	mechanism, err := normalizeInputText(input.Semantics.Mechanism, MaxMechanismCharacters, false)
	if err != nil {
		return Template{}, invalidInput("template mechanism must be at most %d characters", MaxMechanismCharacters)
	}
	roles := make([]string, 0, len(input.Semantics.CaptionRoles))
	if len(input.Semantics.CaptionRoles) != 0 && len(input.Semantics.CaptionRoles) != input.LineCount {
		return Template{}, invalidInput("template caption roles must be empty or match its line count")
	}
	for _, value := range input.Semantics.CaptionRoles {
		role, err := normalizeInputText(value, MaxCaptionRoleCharacters, false)
		if err != nil || role == "" {
			return Template{}, invalidInput("template caption roles must be non-empty and at most %d characters", MaxCaptionRoleCharacters)
		}
		roles = append(roles, role)
	}
	if len(input.Semantics.Tags) > MaxSemanticTags {
		return Template{}, invalidInput("template semantic tags must contain at most %d entries", MaxSemanticTags)
	}
	tags := make([]string, 0, len(input.Semantics.Tags))
	seenTags := make(map[string]struct{}, len(input.Semantics.Tags))
	for _, value := range input.Semantics.Tags {
		tag, tagErr := normalizeInputText(value, MaxSemanticTagCharacters, false)
		if tagErr != nil {
			return Template{}, invalidInput("template semantic tag must be at most %d characters", MaxSemanticTagCharacters)
		}
		key := strings.ToLower(tag)
		if tag == "" {
			continue
		}
		if _, exists := seenTags[key]; exists {
			continue
		}
		seenTags[key] = struct{}{}
		tags = append(tags, tag)
	}

	return Template{
		ID:           id,
		Name:         name,
		LineCount:    input.LineCount,
		OverlayCount: input.OverlayCount,
		Keywords:     keywords,
		ExampleLines: exampleLines,
		Semantics: SemanticHint{
			Visual:       visual,
			Meaning:      meaning,
			Mechanism:    mechanism,
			CaptionRoles: roles,
			Tags:         tags,
		},
	}, nil
}

type providerResponse struct {
	Candidates []Candidate `json:"candidates"`
}

//nolint:gocyclo // Provider JSON is validated field-by-field before any candidate reaches rendering.
func parseAndValidateResponse(value string, input normalizedInput) ([]Candidate, error) {
	if strings.TrimSpace(value) == "" {
		return nil, invalidResponse("provider returned an empty response")
	}
	if utf8.RuneCountInString(value) > maxResponseCharacters {
		return nil, invalidResponse("provider response exceeded the size limit")
	}

	decoder := json.NewDecoder(strings.NewReader(value))
	decoder.DisallowUnknownFields()
	var response providerResponse
	if err := decoder.Decode(&response); err != nil {
		return nil, invalidResponse("provider response was not the required JSON object")
	}
	if err := ensureJSONEnd(decoder); err != nil {
		return nil, invalidResponse("provider response contained trailing data")
	}
	// The prompt permits an empty list as the single safe refusal shape. It is
	// returned to the UI as “no usable ideas” instead of misclassifying a valid
	// refusal as a broken provider response.
	if len(response.Candidates) == 0 {
		return []Candidate{}, nil
	}
	if len(response.Candidates) != input.CandidateCount {
		return nil, invalidResponse("provider returned the wrong number of candidates")
	}

	templates := make(map[string]Template, len(input.Templates))
	for _, template := range input.Templates {
		templates[template.ID] = template
	}
	seenTemplates := make(map[string]struct{}, len(response.Candidates))
	for index := range response.Candidates {
		candidate := &response.Candidates[index]
		candidate.TemplateID = strings.TrimSpace(candidate.TemplateID)
		template, exists := templates[candidate.TemplateID]
		if !exists {
			return nil, invalidResponse("provider selected a template outside the candidate set")
		}
		if _, duplicate := seenTemplates[candidate.TemplateID]; duplicate {
			return nil, invalidResponse("provider selected the same template more than once")
		}
		seenTemplates[candidate.TemplateID] = struct{}{}

		if len(candidate.CaptionLines) != template.LineCount {
			return nil, invalidResponse("provider returned the wrong caption line count")
		}
		for lineIndex := range candidate.CaptionLines {
			line, err := normalizeOutputText(candidate.CaptionLines[lineIndex], MaxCaptionLineCharacters)
			if err != nil || line == "" {
				return nil, invalidResponse("provider returned an invalid caption line")
			}
			candidate.CaptionLines[lineIndex] = line
		}

		candidate.Rationale, _ = normalizeOutputText(candidate.Rationale, MaxRationaleCharacters)
		if candidate.Rationale == "" || utf8.RuneCountInString(candidate.Rationale) > MaxRationaleCharacters || hasDisallowedControl(candidate.Rationale, false) {
			return nil, invalidResponse("provider returned an invalid rationale")
		}
		candidate.AltText, _ = normalizeOutputText(candidate.AltText, MaxAltTextCharacters)
		if candidate.AltText == "" || utf8.RuneCountInString(candidate.AltText) > MaxAltTextCharacters || hasDisallowedControl(candidate.AltText, false) {
			return nil, invalidResponse("provider returned invalid alt text")
		}
	}

	return response.Candidates, nil
}

func ensureJSONEnd(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return fmt.Errorf("extra JSON value")
		}
		return err
	}
	return nil
}

func normalizeInputText(value string, limit int, allowLineBreaks bool) (string, error) {
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) > limit || hasDisallowedControl(value, allowLineBreaks) {
		return "", fmt.Errorf("text is outside its accepted bounds")
	}
	return value, nil
}

func normalizeOutputText(value string, limit int) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || utf8.RuneCountInString(value) > limit || hasDisallowedControl(value, false) {
		return "", fmt.Errorf("text is outside its accepted bounds")
	}
	return value, nil
}

func hasDisallowedControl(value string, allowLineBreaks bool) bool {
	for _, current := range value {
		if !unicode.IsControl(current) {
			continue
		}
		if allowLineBreaks && (current == '\n' || current == '\r' || current == '\t') {
			continue
		}
		return true
	}
	return false
}

func invalidInput(message string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalidInput, fmt.Sprintf(message, args...))
}

func invalidResponse(message string) error {
	// Never attach the provider's raw response or prompts to an error. They can
	// contain unpublished post text and adversarial template metadata.
	return fmt.Errorf("%w: %s", ErrInvalidResponse, message)
}
