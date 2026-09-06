package publicprofiles

import (
	"encoding/json"
	"errors"
	"strings"
)

const usernameSentinel = "username"

const (
	FieldDisplayName = "display_name"
	FieldAvatar      = "avatar"
	FieldJoinedAt    = "joined_at"
	FieldActivity    = "activity"
	FieldPlatforms   = "platforms"
	FieldWorkspaces  = "workspaces"
	FieldPlan        = "plan"
)

var supportedFields = []string{
	FieldDisplayName,
	FieldAvatar,
	FieldJoinedAt,
	FieldActivity,
	FieldPlatforms,
	FieldWorkspaces,
	FieldPlan,
}

var ErrUnsupportedField = errors.New("unsupported public profile field")

// Visibility is the normalized public-profile disclosure policy. Username is
// always visible while a profile is enabled and is therefore not included in
// Fields.
type Visibility struct {
	fields map[string]struct{}
}

// SupportedFields returns the optional fields in stable API and UI order.
func SupportedFields() []string {
	return append([]string(nil), supportedFields...)
}

// Parse resolves the stored visibility policy. Empty values and the historical
// [] default retain the original all-fields behavior. Malformed or unknown
// policies fail closed so a damaged row cannot disclose account data.
func Parse(raw string) Visibility {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "[]" {
		return allVisible()
	}

	var encoded []string
	if err := json.Unmarshal([]byte(raw), &encoded); err != nil {
		return Visibility{fields: map[string]struct{}{}}
	}

	fields := make(map[string]struct{}, len(encoded))
	for _, field := range encoded {
		field = strings.TrimSpace(field)
		if field == usernameSentinel {
			continue
		}
		if !isSupported(field) {
			return Visibility{fields: map[string]struct{}{}}
		}
		fields[field] = struct{}{}
	}
	return Visibility{fields: fields}
}

// Normalize validates a requested list and returns its canonical storage and
// response forms. The username sentinel distinguishes an intentional empty
// selection from the historical [] all-fields default.
func Normalize(requested []string) (string, []string, error) {
	requestedSet := make(map[string]struct{}, len(requested))
	for _, field := range requested {
		field = strings.TrimSpace(field)
		if !isSupported(field) {
			return "", nil, ErrUnsupportedField
		}
		requestedSet[field] = struct{}{}
	}

	fields := make([]string, 0, len(requestedSet))
	encoded := make([]string, 0, len(requestedSet)+1)
	encoded = append(encoded, usernameSentinel)
	for _, field := range supportedFields {
		if _, ok := requestedSet[field]; !ok {
			continue
		}
		fields = append(fields, field)
		encoded = append(encoded, field)
	}

	raw, err := json.Marshal(encoded)
	if err != nil {
		return "", nil, err
	}
	return string(raw), fields, nil
}

func (v Visibility) Has(field string) bool {
	_, ok := v.fields[field]
	return ok
}

func (v Visibility) Fields() []string {
	fields := make([]string, 0, len(v.fields))
	for _, field := range supportedFields {
		if v.Has(field) {
			fields = append(fields, field)
		}
	}
	return fields
}

func allVisible() Visibility {
	fields := make(map[string]struct{}, len(supportedFields))
	for _, field := range supportedFields {
		fields[field] = struct{}{}
	}
	return Visibility{fields: fields}
}

func isSupported(field string) bool {
	for _, supported := range supportedFields {
		if field == supported {
			return true
		}
	}
	return false
}
