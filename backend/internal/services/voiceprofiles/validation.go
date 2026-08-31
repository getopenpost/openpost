package voiceprofiles

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	maxNameCharacters          = 80
	maxDefinitionBytes         = 64 * 1024
	maxIdentityCharacters      = 1200
	maxLanguageCharacters      = 80
	maxShortItems              = 40
	maxShortItemCharacters     = 200
	maxOpinionCharacters       = 600
	maxBoundaryCharacters      = 400
	maxExamples                = 20
	maxExampleCharacters       = 4000
	maxExampleReasonCharacters = 500
	maxCorrections             = 20
	maxCorrectionCharacters    = 3000
	maxCorrectionLesson        = 600
	maxInterviewAnswers        = 20
	maxInterviewQuestion       = 500
	maxInterviewAnswer         = 4000
)

func normalizeName(value string) (string, string, error) {
	name, err := normalizeText(value, maxNameCharacters, false)
	if err != nil || name == "" {
		return "", "", fmt.Errorf("%w: name is required and must contain at most %d characters", ErrInvalidInput, maxNameCharacters)
	}
	return name, strings.ToLower(name), nil
}

//nolint:gocyclo // Voice definitions have independent bounded fields that remain explicit for schema review.
func normalizeDefinition(input Definition) (Definition, string, error) {
	var out Definition
	var err error
	if out.IdentitySummary, err = normalizeText(input.IdentitySummary, maxIdentityCharacters, true); err != nil {
		return Definition{}, "", invalidDefinition("identity_summary")
	}
	if out.PreferredLanguage, err = normalizeText(input.PreferredLanguage, maxLanguageCharacters, false); err != nil {
		return Definition{}, "", invalidDefinition("preferred_language")
	}
	if out.Traits, err = normalizeList(input.Traits, maxShortItemCharacters); err != nil {
		return Definition{}, "", invalidDefinition("traits")
	}
	if out.Vocabulary, err = normalizeList(input.Vocabulary, maxShortItemCharacters); err != nil {
		return Definition{}, "", invalidDefinition("vocabulary")
	}
	if out.RecurringExpressions, err = normalizeList(input.RecurringExpressions, maxShortItemCharacters); err != nil {
		return Definition{}, "", invalidDefinition("recurring_expressions")
	}
	if out.Expertise, err = normalizeList(input.Expertise, maxShortItemCharacters); err != nil {
		return Definition{}, "", invalidDefinition("expertise")
	}
	if out.Opinions, err = normalizeList(input.Opinions, maxOpinionCharacters); err != nil {
		return Definition{}, "", invalidDefinition("opinions")
	}
	if out.Humor, err = normalizeText(input.Humor, maxBoundaryCharacters, true); err != nil {
		return Definition{}, "", invalidDefinition("humor")
	}
	if out.Formality, err = normalizeText(input.Formality, maxBoundaryCharacters, true); err != nil {
		return Definition{}, "", invalidDefinition("formality")
	}
	if out.Boundaries, err = normalizeList(input.Boundaries, maxBoundaryCharacters); err != nil {
		return Definition{}, "", invalidDefinition("boundaries")
	}
	if out.ForbiddenPhrases, err = normalizeList(input.ForbiddenPhrases, maxShortItemCharacters); err != nil {
		return Definition{}, "", invalidDefinition("forbidden_phrases")
	}
	if out.DislikedPatterns, err = normalizeList(input.DislikedPatterns, maxBoundaryCharacters); err != nil {
		return Definition{}, "", invalidDefinition("disliked_patterns")
	}
	if out.Examples, err = normalizeExamples(input.Examples); err != nil {
		return Definition{}, "", err
	}
	if out.Corrections, err = normalizeCorrections(input.Corrections); err != nil {
		return Definition{}, "", err
	}
	if out.InterviewAnswers, err = normalizeInterviewAnswers(input.InterviewAnswers); err != nil {
		return Definition{}, "", err
	}
	encoded, err := json.Marshal(out)
	if err != nil || len(encoded) > maxDefinitionBytes {
		return Definition{}, "", fmt.Errorf("%w: definition exceeds the %d byte limit", ErrInvalidInput, maxDefinitionBytes)
	}
	return out, string(encoded), nil
}

func normalizeExamples(values []Example) ([]Example, error) {
	if len(values) > maxExamples {
		return nil, fmt.Errorf("%w: examples may contain at most %d entries", ErrInvalidInput, maxExamples)
	}
	out := make([]Example, 0, len(values))
	for _, value := range values {
		text, err := normalizeText(value.Text, maxExampleCharacters, true)
		if err != nil || text == "" {
			return nil, fmt.Errorf("%w: each example needs text of at most %d characters", ErrInvalidInput, maxExampleCharacters)
		}
		platform, err := normalizeText(value.Platform, 80, false)
		if err != nil {
			return nil, invalidDefinition("examples.platform")
		}
		why, err := normalizeText(value.WhyItFits, maxExampleReasonCharacters, true)
		if err != nil {
			return nil, invalidDefinition("examples.why_it_fits")
		}
		out = append(out, Example{Text: text, Platform: platform, WhyItFits: why})
	}
	return out, nil
}

func normalizeCorrections(values []Correction) ([]Correction, error) {
	if len(values) > maxCorrections {
		return nil, fmt.Errorf("%w: corrections may contain at most %d entries", ErrInvalidInput, maxCorrections)
	}
	out := make([]Correction, 0, len(values))
	for _, value := range values {
		original, err := normalizeText(value.Original, maxCorrectionCharacters, true)
		if err != nil || original == "" {
			return nil, fmt.Errorf("%w: each correction needs original text", ErrInvalidInput)
		}
		preferred, err := normalizeText(value.Preferred, maxCorrectionCharacters, true)
		if err != nil || preferred == "" {
			return nil, fmt.Errorf("%w: each correction needs preferred text", ErrInvalidInput)
		}
		lesson, err := normalizeText(value.Lesson, maxCorrectionLesson, true)
		if err != nil {
			return nil, invalidDefinition("corrections.lesson")
		}
		out = append(out, Correction{Original: original, Preferred: preferred, Lesson: lesson})
	}
	return out, nil
}

func normalizeInterviewAnswers(values []InterviewAnswer) ([]InterviewAnswer, error) {
	if len(values) > maxInterviewAnswers {
		return nil, fmt.Errorf("%w: interview_answers may contain at most %d entries", ErrInvalidInput, maxInterviewAnswers)
	}
	out := make([]InterviewAnswer, 0, len(values))
	for _, value := range values {
		question, err := normalizeText(value.Question, maxInterviewQuestion, true)
		if err != nil || question == "" {
			return nil, fmt.Errorf("%w: each interview answer needs a question", ErrInvalidInput)
		}
		answer, err := normalizeText(value.Answer, maxInterviewAnswer, true)
		if err != nil || answer == "" {
			return nil, fmt.Errorf("%w: each interview answer needs an answer", ErrInvalidInput)
		}
		out = append(out, InterviewAnswer{Question: question, Answer: answer})
	}
	return out, nil
}

func normalizeList(values []string, maxCharacters int) ([]string, error) {
	if len(values) > maxShortItems {
		return nil, fmt.Errorf("too many entries")
	}
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		normalized, err := normalizeText(value, maxCharacters, true)
		if err != nil {
			return nil, err
		}
		if normalized == "" {
			continue
		}
		key := strings.ToLower(normalized)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, normalized)
	}
	return out, nil
}

func normalizeText(value string, maxCharacters int, multiline bool) (string, error) {
	if !utf8.ValidString(value) {
		return "", fmt.Errorf("text is not valid UTF-8")
	}
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) > maxCharacters {
		return "", fmt.Errorf("text is too long")
	}
	for _, char := range value {
		if char == '\n' && multiline {
			continue
		}
		if unicode.IsControl(char) {
			return "", fmt.Errorf("text contains a control character")
		}
	}
	return value, nil
}

func invalidDefinition(field string) error {
	return fmt.Errorf("%w: definition field %s is invalid", ErrInvalidInput, field)
}
