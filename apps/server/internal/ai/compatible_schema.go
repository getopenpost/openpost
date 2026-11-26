package ai

import (
	"fmt"
	"maps"
	"strconv"
	"strings"
)

// maxCompatibleEnumValues is the largest enum kept in a compatible endpoint's
// strict schema. Gateways backed by Gemini reject large enums as too much
// branching, so larger sets become instructions and callers validate natively.
const maxCompatibleEnumValues = 32

// compatibleResponseSchema preserves bounds and large enums as instructions for
// gateways that reject those keywords, or schemas that large, in strict
// structured output.
func compatibleResponseSchema(schema map[string]any) map[string]any {
	result := maps.Clone(schema)
	moveCompatibleSchemaBounds(result)

	for _, key := range []string{"properties", "$defs", "definitions"} {
		if children, ok := schema[key].(map[string]any); ok {
			copy := maps.Clone(children)
			for name, child := range children {
				if child, ok := child.(map[string]any); ok {
					copy[name] = compatibleResponseSchema(child)
				}
			}
			result[key] = copy
		}
	}
	for _, key := range []string{"items", "anyOf", "allOf", "oneOf"} {
		switch children := schema[key].(type) {
		case map[string]any:
			result[key] = compatibleResponseSchema(children)
		case []any:
			copy := append([]any(nil), children...)
			for index, child := range children {
				if child, ok := child.(map[string]any); ok {
					copy[index] = compatibleResponseSchema(child)
				}
			}
			result[key] = copy
		}
	}
	return result
}

func moveCompatibleSchemaBounds(schema map[string]any) {
	description, _ := schema["description"].(string)
	notes := []string{description}
	for _, bound := range []struct{ key, instruction string }{
		{"minimum", "Value must be at least %v."},
		{"maximum", "Value must be at most %v."},
		{"minItems", "Use at least %v items."},
		{"maxItems", "Use at most %v items."},
		{"minLength", "Use at least %v characters."},
		{"maxLength", "Use at most %v characters."},
	} {
		value, present := schema[bound.key]
		if !present {
			continue
		}
		if bound.key == "minItems" || bound.key == "minLength" {
			count, err := strconv.ParseFloat(fmt.Sprint(value), 64)
			if err == nil && count >= 0 && count <= 1 {
				continue
			}
		}
		delete(schema, bound.key)
		notes = append(notes, fmt.Sprintf(bound.instruction, value))
	}
	if enumSize(schema["enum"]) > maxCompatibleEnumValues {
		delete(schema, "enum")
		notes = append(notes, "Use only an identifier listed in the instructions.")
	}
	if len(notes) > 1 {
		schema["description"] = strings.TrimSpace(strings.Join(notes, " "))
	}
}

func enumSize(value any) int {
	switch values := value.(type) {
	case []string:
		return len(values)
	case []any:
		return len(values)
	}
	return 0
}
