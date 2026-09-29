package workflows

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"strconv"
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
	if !slices.Contains([]string{"manual", "github_release", "rss", "rendition_published", "interval", "publication_created", "rendition_failed"}, def.Source.Kind) {
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
	case "interval":
		if source.IntervalMinutes < 5 || source.IntervalMinutes > 43200 {
			return invalid("choose an interval between 5 minutes and 30 days")
		}
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
		for _, field := range outputFields(step) {
			available[step.ID+"."+field] = true
		}
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
	if !slices.Contains([]string{KindDraft, KindBuild, KindApproval, KindSchedule, KindReply, KindWait, KindCondition, KindMetrics, KindHTTP, KindCode, KindAIText, KindAIDecision, KindFields, KindText, KindJSON, KindFilter, KindSort, KindLimit, KindMerge, KindDate, KindURL, KindFeed}, step.Kind) {
		return invalid("unsupported step kind")
	}
	if len(step.Name) > 100 || len(step.Inputs) > 20 {
		return invalid("step configuration is too large")
	}
	if step.Kind != KindCondition && step.Kind != KindAIDecision && (len(step.Then) > 0 || len(step.Else) > 0) {
		return invalid("only conditions can contain branches")
	}
	for name, binding := range step.Inputs {
		if err := validateStepBinding(step.Kind, name, binding, available, complete); err != nil {
			return fmt.Errorf("%s: %s: %w", step.Name, name, err)
		}
	}
	if !complete {
		return nil
	}
	if err := validateJSONInputs(step); err != nil {
		return err
	}
	if err := validateHTTPAuthentication(step); err != nil {
		return err
	}
	return validateRequiredInputs(step)
}
func validateStepBinding(kind, name string, binding Value, available map[string]bool, complete bool) error {
	if kind == KindCode && name == "code" {
		code, ok := binding.Literal.(string)
		if !ok || binding.Reference != "" || len(code) > MaxTextBytes {
			return invalid("JavaScript must be authored directly, with data passed through Input")
		}
		return nil
	}
	if name == "connection_id" && (binding.Reference != "" || strings.Contains(fmt.Sprint(binding.Literal), "{{")) {
		return invalid("choose a saved connection directly")
	}
	if complete && jsonInput(kind, name) && binding.Reference == "" {
		if text, ok := binding.Literal.(string); ok {
			if err := json.Unmarshal([]byte(text), &binding.Literal); err != nil {
				return invalid("must be valid JSON")
			}
		}
	}
	return validateBinding(binding, available, complete)
}
func validateJSONInputs(step Step) error {
	for name, binding := range step.Inputs {
		if jsonInput(step.Kind, name) && binding.Reference == "" {
			value := binding.Literal
			if text, ok := value.(string); ok && json.Unmarshal([]byte(text), &value) != nil {
				return invalid(step.Name + ": " + name + " must be valid JSON")
			}
			if (name == "headers" || name == "query" || name == "fields") && value != nil {
				if _, ok := value.(map[string]any); !ok {
					return invalid(step.Name + ": " + name + " must be a JSON object")
				}
			}
		}
	}
	return nil
}
func validateHTTPAuthentication(step Step) error {
	if step.Kind == KindHTTP && step.Inputs["headers"].Reference == "" {
		headers, err := stringMap(step.Inputs["headers"].Literal)
		if err != nil {
			return invalid(err.Error())
		}
		for name := range headers {
			if secretHeader(name) {
				return invalid("store authentication in Connections instead of the workflow")
			}
		}
	}
	return nil
}

func validateBinding(binding Value, available map[string]bool, complete bool) error {
	if binding.Reference != "" {
		if binding.Literal != nil {
			return invalid("a field cannot contain both a value and a reference")
		}
		if err := validateReference(binding.Reference, available); complete && err != nil {
			return err
		}
	}
	switch value := binding.Literal.(type) {
	case map[string]any:
		for _, child := range value {
			if err := validateBinding(Value{Literal: child}, available, complete); err != nil {
				return err
			}
		}
		return nil
	case []any:
		for _, child := range value {
			if err := validateBinding(Value{Literal: child}, available, complete); err != nil {
				return err
			}
		}
		return nil
	}
	text, ok := binding.Literal.(string)
	if !ok {
		return nil
	}
	return validateTextBinding(text, available, complete)
}
func validateTextBinding(text string, available map[string]bool, complete bool) error {
	if len(text) > MaxTextBytes {
		return invalid("field text is too long")
	}
	if !complete {
		return nil
	}
	remainder := fieldToken.ReplaceAllString(text, "")
	if strings.Contains(remainder, "{{") || strings.Contains(remainder, "}}") {
		return invalid("variable syntax must be {{step.field}}")
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
	KindHTTP: {"url", "method"}, KindCode: {"code"}, KindAIText: {"text"}, KindAIDecision: {"text", "instructions"}, KindFields: {"fields"}, KindText: {"text", "operation"}, KindJSON: {"text"}, KindFilter: {"items", "field", "operator", "right"}, KindSort: {"items", "field"}, KindLimit: {"items", "limit"}, KindMerge: {"first", "second"}, KindDate: {"date", "format"}, KindURL: {"url", "campaign", "source", "medium"}, KindFeed: {"url"},
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
	if parts[0] != "source" && !available[ref] {
		for i := 2; i <= len(parts); i++ {
			if available[strings.Join(parts[:i], ".")+".*"] {
				return nil
			}
		}
		return invalid("field " + ref + " does not exist on that step")
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
		if step.Kind == KindCode && field == "code" {
			result[field] = binding.Literal
			continue
		}
		literal := binding.Literal
		if jsonInput(step.Kind, field) {
			if text, ok := literal.(string); ok {
				if err := json.Unmarshal([]byte(text), &literal); err != nil {
					return nil, invalid("invalid JSON in " + field)
				}
			}
		}
		value, err := resolveLiteral(literal, values)
		if err != nil {
			return nil, err
		}
		result[field] = value
	}
	return result, nil
}
func resolveLiteral(value any, values map[string]any) (any, error) {
	switch data := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(data))
		for key, child := range data {
			resolved, err := resolveLiteral(child, values)
			if err != nil {
				return nil, err
			}
			result[key] = resolved
		}
		return result, nil
	case []any:
		result := make([]any, len(data))
		for i, child := range data {
			resolved, err := resolveLiteral(child, values)
			if err != nil {
				return nil, err
			}
			result[i] = resolved
		}
		return result, nil
	case string:
		var failure error
		text := fieldToken.ReplaceAllStringFunc(data, func(token string) string {
			reference := fieldToken.FindStringSubmatch(token)[1]
			resolved, err := resolveReference(reference, values)
			if err != nil {
				failure = err
				return ""
			}
			switch resolved.(type) {
			case string, float64, int, bool:
				return fmt.Sprint(resolved)
			default:
				failure = fmt.Errorf("field %s is not text; choose a whole-value reference", reference)
				return ""
			}
		})
		return text, failure
	default:
		return value, nil
	}
}

var stepOutputFields = map[string][]string{
	KindDraft:      {"id", "revision", "text", "title", "status", "usage.*"},
	KindBuild:      {"id", "revision", "text", "title", "status", "usage.*"},
	KindApproval:   {"publication_id", "revision", "text", "title", "approved"},
	KindMetrics:    {"likes", "comments", "impressions", "observed_at"},
	KindCondition:  {"matched"},
	KindAIText:     {"text", "usage.*"},
	KindAIDecision: {"matched", "probability", "reason", "usage.*"},
	KindHTTP:       {"status", "body.*", "headers.*"},
	KindCode:       {"data.*"},
	KindJSON:       {"data.*"},
	KindMerge:      {"data.*"},
	KindFilter:     {"items.*", "count"},
	KindSort:       {"items.*", "count"},
	KindLimit:      {"items.*", "count"},
	KindFeed:       {"items.*", "count"},
	KindText:       {"text", "length"},
	KindDate:       {"text", "timestamp"},
	KindURL:        {"url"},
	KindSchedule:   {"publication_id", "job_id", "scheduled_at", "status", "renditions.*"},
	KindReply:      {"rendition_id", "job_id", "status"},
	KindWait:       {"until"},
}

func outputFields(step Step) []string {
	if step.Kind != KindFields {
		return stepOutputFields[step.Kind]
	}
	fields, ok := step.Inputs["fields"].Literal.(map[string]any)
	if !ok {
		_ = json.Unmarshal([]byte(fmt.Sprint(step.Inputs["fields"].Literal)), &fields)
	}
	keys := make([]string, 0, len(fields))
	for key := range fields {
		keys = append(keys, key+".*")
	}
	return keys
}

func resolveReference(ref string, values map[string]any) (any, error) {
	var current any = values
	for _, part := range strings.Split(ref, ".") {
		if list, ok := current.([]any); ok {
			index, err := strconv.Atoi(part)
			if err != nil || index < 0 || index >= len(list) {
				return nil, fmt.Errorf("field %s is unavailable", ref)
			}
			current = list[index]
			continue
		}
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

func jsonInput(kind, field string) bool {
	return kind == KindFields && field == "fields" || kind == KindHTTP && (field == "headers" || field == "query") || kind == KindCode && field == "data" || slices.Contains([]string{KindFilter, KindSort, KindLimit}, kind) && field == "items" || kind == KindMerge && (field == "first" || field == "second")
}
