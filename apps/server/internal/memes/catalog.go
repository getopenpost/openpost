package memes

import (
	"unicode"
	"unicode/utf8"
)

const MaxCaptionCharacters = 200

// ValidateCaption keeps stored and rendered text bounded while allowing the
// full Unicode captions supported by the built-in renderer.
func ValidateCaption(caption string) error {
	if !utf8.ValidString(caption) || utf8.RuneCountInString(caption) > MaxCaptionCharacters {
		return ErrInvalidRequest
	}
	for _, current := range caption {
		if current == '\x00' || (unicode.IsControl(current) && current != '\n' && current != '\r' && current != '\t') {
			return ErrInvalidRequest
		}
	}
	return nil
}

func cloneTemplates(source []Template) []Template {
	result := make([]Template, 0, len(source))
	for _, template := range source {
		result = append(result, cloneTemplate(template))
	}
	return result
}

func cloneTemplate(source Template) Template {
	source.Styles = append([]string(nil), source.Styles...)
	source.Keywords = append([]string(nil), source.Keywords...)
	source.SearchTerms = append([]string(nil), source.SearchTerms...)
	source.Example.Text = append([]string(nil), source.Example.Text...)
	source.Semantic = cloneTemplateSemantic(source.Semantic)
	return source
}
