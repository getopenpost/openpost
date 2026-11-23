package ai

import (
	"fmt"
	"maps"
	"strconv"
	"strings"
)

// compatibleResponseSchema preserves bounds as instructions for gateways that
// reject those keywords in strict structured output.
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
	} {
		value, present := schema[bound.key]
		if !present {
			continue
		}
		if bound.key == "minItems" {
			count, err := strconv.ParseFloat(fmt.Sprint(value), 64)
			if err == nil && count >= 0 && count <= 1 {
				continue
			}
		}
		delete(schema, bound.key)
		notes = append(notes, fmt.Sprintf(bound.instruction, value))
	}
	if len(notes) > 1 {
		schema["description"] = strings.TrimSpace(strings.Join(notes, " "))
	}
}
