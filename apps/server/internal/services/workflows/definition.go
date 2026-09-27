package workflows

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"strings"
)

var stepIDPattern = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`)
var repositoryPattern = regexp.MustCompile(`^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$`)
var fieldToken = regexp.MustCompile(`\{\{\s*([a-zA-Z][a-zA-Z0-9_.-]*)\s*\}\}`)

func Validate(def Definition, complete bool) error {
	if def.Schema != SchemaVersion {
		return invalid("unsupported workflow schema")
	}
	raw, err := json.Marshal(def)
	if err != nil || len(raw) > 256*1024 {
		return invalid("workflow is too large")
	}
	if !slices.Contains([]string{"manual", "github_release", "rss", "rendition_published"}, def.Source.Kind) {
		return invalid("choose a supported source")
	}
	if complete {
		if err := validateSource(def.Source); err != nil {
			return err
		}
		if len(def.Steps) == 0 {
			return invalid("add at least one step")
		}
	}
	validator := definitionValidator{seen: map[string]bool{"source": true}, complete: complete}
	return validator.walk(def.Steps, map[string]bool{"source": true}, 0)
}
func validateSource(source Source) error {
	switch source.Kind {
	case "github_release":
		if !repositoryPattern.MatchString(source.Repository) {
			return invalid("GitHub repository must be owner/repository")
		}
	case "rss":
		u, err := url.Parse(source.URL)
		if err != nil || u.Hostname() == "" || u.User != nil || (u.Scheme != "https" && u.Scheme != "http") {
			return invalid("enter an HTTP or HTTPS feed URL without credentials")
		}
	}
	return nil
}

type definitionValidator struct {
	seen     map[string]bool
	count    int
	complete bool
}

func (v *definitionValidator) walk(steps []Step, available map[string]bool, depth int) error {
	if depth > MaxDepth {
		return invalid("branches are nested too deeply")
	}
	for _, step := range steps {
		v.count++
		if v.count > MaxSteps {
			return invalid("a workflow can contain at most 40 steps")
		}
		if !stepIDPattern.MatchString(step.ID) || v.seen[step.ID] {
			return invalid("each step needs a unique, stable ID")
		}
		v.seen[step.ID] = true
		if err := validateStep(step, available, v.complete); err != nil {
			return err
		}
		available[step.ID] = true
		if err := v.walk(step.Then, cloneSet(available), depth+1); err != nil {
			return err
		}
		if err := v.walk(step.Else, cloneSet(available), depth+1); err != nil {
			return err
		}
	}
	return nil
}
func validateStep(step Step, available map[string]bool, complete bool) error {
	if !slices.Contains([]string{KindDraft, KindBuild, KindApproval, KindSchedule, KindReply, KindWait, KindCondition, KindMetrics}, step.Kind) {
		return invalid("unsupported step kind")
	}
	if len(step.Name) > 100 || len(step.Inputs) > 20 {
		return invalid("step configuration is too large")
	}
	if step.Kind != KindCondition && (len(step.Then) > 0 || len(step.Else) > 0) {
		return invalid("only conditions can contain branches")
	}
	for name, binding := range step.Inputs {
		if err := validateBinding(binding, available); err != nil {
			return fmt.Errorf("%s: %s: %w", step.Name, name, err)
		}
	}
	if complete {
		return validateRequiredInputs(step)
	}
	return nil
}
func validateBinding(binding Value, available map[string]bool) error {
	if binding.Reference != "" {
		if binding.Literal != nil {
			return invalid("a field cannot contain both a value and a reference")
		}
		if err := validateReference(binding.Reference, available); err != nil {
			return err
		}
	}
	text, ok := binding.Literal.(string)
	if !ok {
		return nil
	}
	if len(text) > MaxTextBytes {
		return invalid("field text is too long")
	}
	for _, match := range fieldToken.FindAllStringSubmatch(text, -1) {
		if err := validateReference(match[1], available); err != nil {
			return err
		}
	}
	return nil
}

var requiredInputs = map[string][]string{
	KindDraft: {"text"}, KindBuild: {"text"}, KindApproval: {"publication_id"}, KindSchedule: {"publication_id", "revision", "minutes"},
	KindReply: {"rendition_id", "text"}, KindWait: {"minutes"}, KindCondition: {"left", "operator", "right"}, KindMetrics: {"rendition_id"},
}

func validateRequiredInputs(step Step) error {
	for _, field := range requiredInputs[step.Kind] {
		binding, exists := step.Inputs[field]
		if !exists || (binding.Reference == "" && (binding.Literal == nil || isEmptyText(binding.Literal))) {
			return invalid(step.Name + ": configure " + field)
		}
	}
	return nil
}

func invalid(message string) error { return fmt.Errorf("%w: %s", ErrInvalid, message) }
func cloneSet(values map[string]bool) map[string]bool {
	result := make(map[string]bool, len(values))
	for key, value := range values {
		result[key] = value
	}
	return result
}
func validateReference(ref string, available map[string]bool) error {
	parts := strings.Split(ref, ".")
	if len(parts) < 2 || len(parts) > 8 || !available[parts[0]] {
		return invalid("field references must point to a preceding step on this path")
	}
	for _, part := range parts {
		if part == "" || part == "__proto__" || part == "constructor" || part == "prototype" {
			return invalid("invalid field reference")
		}
	}
	return nil
}

func resolveInputs(step Step, values map[string]any) (map[string]any, error) {
	result := make(map[string]any, len(step.Inputs))
	for field, binding := range step.Inputs {
		if binding.Reference != "" {
			value, err := resolveReference(binding.Reference, values)
			if err != nil {
				return nil, err
			}
			result[field] = value
			continue
		}
		text, ok := binding.Literal.(string)
		if !ok {
			result[field] = binding.Literal
			continue
		}
		var resolveErr error
		result[field] = fieldToken.ReplaceAllStringFunc(text, func(token string) string {
			ref := fieldToken.FindStringSubmatch(token)[1]
			value, err := resolveReference(ref, values)
			if err != nil {
				resolveErr = err
				return ""
			}
			switch v := value.(type) {
			case string:
				return v
			case float64, int, bool:
				return fmt.Sprint(v)
			default:
				resolveErr = fmt.Errorf("field %s is not text; choose a text field", ref)
				return ""
			}
		})
		if resolveErr != nil {
			return nil, resolveErr
		}
	}
	return result, nil
}
func resolveReference(ref string, values map[string]any) (any, error) {
	var current any = values
	for _, part := range strings.Split(ref, ".") {
		object, ok := current.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("field %s is unavailable", ref)
		}
		current, ok = object[part]
		if !ok || current == nil {
			return nil, fmt.Errorf("field %s is missing", ref)
		}
	}
	return current, nil
}

func isEmptyText(value any) bool {
	text, ok := value.(string)
	return ok && strings.TrimSpace(text) == ""
}
