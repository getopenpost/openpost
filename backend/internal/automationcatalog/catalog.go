// Package automationcatalog owns which REST operations scoped API tokens may
// call and which of those operations automation adapters may expose. It keeps
// vendor-specific labels and controls out of the server contract.
package automationcatalog

import "sort"

type Access string

const (
	AccessRead  Access = "read"
	AccessWrite Access = "write"
)

type Exposure string

const (
	ExposureDisabled Exposure = "disabled"
	ExposureAlpha    Exposure = "alpha"
	ExposureStable   Exposure = "stable"
)

type Effect string

const (
	EffectQuery          Effect = "query"
	EffectLocalMutation  Effect = "local-mutation"
	EffectExternalAction Effect = "external-action"
	EffectDestructive    Effect = "destructive"
)

type RetryPolicy string

const (
	RetryNever               RetryPolicy = "never"
	RetryTransient           RetryPolicy = "transient"
	RetryIdempotentTransient RetryPolicy = "idempotent-transient"
)

type IdempotencyPolicy string

const (
	IdempotencyNone     IdempotencyPolicy = "none"
	IdempotencyOptional IdempotencyPolicy = "optional"
	IdempotencyRequired IdempotencyPolicy = "required"
)

type Pagination struct {
	Style            string `json:"style"`
	CursorParameter  string `json:"cursor_parameter,omitempty"`
	NextCursorHeader string `json:"next_cursor_header,omitempty"`
	HasMoreHeader    string `json:"has_more_header,omitempty"`
}

type ResultExtraction struct {
	BodyPath  string `json:"body_path,omitempty"`
	IDPath    string `json:"id_path,omitempty"`
	JobIDPath string `json:"job_id_path,omitempty"`
}

type SelectorHint struct {
	Parameter   string `json:"parameter"`
	OperationID string `json:"operation_id"`
	ValuePath   string `json:"value_path"`
	LabelPath   string `json:"label_path"`
}

type Operation struct {
	OperationID string `json:"-"`

	Access      Access            `json:"access"`
	Exposure    Exposure          `json:"exposure"`
	Effect      Effect            `json:"effect"`
	Retry       RetryPolicy       `json:"retry"`
	Idempotency IdempotencyPolicy `json:"idempotency"`
	Pagination  *Pagination       `json:"pagination,omitempty"`
	Result      ResultExtraction  `json:"result,omitempty"`
	Selectors   []SelectorHint    `json:"selectors,omitempty"`
}

func (operation Operation) Metadata() map[string]any {
	metadata := map[string]any{
		"access":      string(operation.Access),
		"exposure":    string(operation.Exposure),
		"effect":      string(operation.Effect),
		"retry":       string(operation.Retry),
		"idempotency": string(operation.Idempotency),
	}
	if operation.Pagination != nil {
		metadata["pagination"] = map[string]any{
			"style":              operation.Pagination.Style,
			"cursor_parameter":   operation.Pagination.CursorParameter,
			"next_cursor_header": operation.Pagination.NextCursorHeader,
			"has_more_header":    operation.Pagination.HasMoreHeader,
		}
	}
	if operation.Result.BodyPath != "" || operation.Result.IDPath != "" || operation.Result.JobIDPath != "" {
		result := make(map[string]any, 3)
		if operation.Result.BodyPath != "" {
			result["body_path"] = operation.Result.BodyPath
		}
		if operation.Result.IDPath != "" {
			result["id_path"] = operation.Result.IDPath
		}
		if operation.Result.JobIDPath != "" {
			result["job_id_path"] = operation.Result.JobIDPath
		}
		metadata["result"] = result
	}
	if len(operation.Selectors) > 0 {
		selectors := make([]map[string]any, 0, len(operation.Selectors))
		for _, selector := range operation.Selectors {
			selectors = append(selectors, map[string]any{
				"parameter":    selector.Parameter,
				"operation_id": selector.OperationID,
				"value_path":   selector.ValuePath,
				"label_path":   selector.LabelPath,
			})
		}
		metadata["selectors"] = selectors
	}
	return metadata
}

var cursorPage = &Pagination{
	Style:            "cursor",
	CursorParameter:  "cursor",
	NextCursorHeader: "X-Next-Cursor",
	HasMoreHeader:    "X-Has-More",
}

var operations = []Operation{
	read("list-workspaces", ExposureAlpha),
	readDisabled("get-workspace-settings"),
	read("list-accounts", ExposureAlpha),
	readDisabled("list-account-providers"),
	read("get-account-destination-options", ExposureAlpha),
	readDisabled("search-account-publishing-options"),
	read("get-provider-readiness", ExposureAlpha),
	readDisabled("resolve-publishing-capabilities"),
	readPaged("list-social-sets", ExposureAlpha),
	read("get-social-set", ExposureAlpha),
	readPaged("list-media", ExposureAlpha),
	readDisabled("get-media-storage"),
	readDisabled("get-media-usage"),
	readPaged("list-publications", ExposureAlpha),
	read("get-publication", ExposureAlpha),
	readPaged("list-publication-events", ExposureAlpha),
	read("validate-publication", ExposureAlpha),
	readDisabled("list-posting-schedules"),
	read("get-next-available-slot", ExposureAlpha),
	readDisabled("get-notification-preferences"),

	write("create-publication", ExposureAlpha, EffectLocalMutation),
	write("update-publication", ExposureAlpha, EffectLocalMutation),
	write("upsert-publication-renditions", ExposureAlpha, EffectLocalMutation),
	write("schedule-publication", ExposureAlpha, EffectLocalMutation),
	write("cancel-publication", ExposureAlpha, EffectLocalMutation),
	write("publish-publication-now", ExposureAlpha, EffectExternalAction),
	writeDisabled("retry-publication-rendition", EffectExternalAction),
	write("retry-failed-publication-renditions", ExposureAlpha, EffectExternalAction),
	write("create-media-upload-session", ExposureAlpha, EffectLocalMutation),
	write("complete-media-upload-session", ExposureAlpha, EffectLocalMutation),
	writeDisabled("update-media", EffectLocalMutation),
	writeDisabled("delete-media", EffectDestructive),
	writeDisabled("batch-delete-media", EffectDestructive),
	writeDisabled("restore-media", EffectLocalMutation),
	writeDisabled("update-media-favorite", EffectLocalMutation),
	writeDisabled("retry-media-analysis", EffectLocalMutation),
	writeDisabled("create-social-set", EffectLocalMutation),
	writeDisabled("update-social-set", EffectLocalMutation),
	writeDisabled("delete-social-set", EffectDestructive),
	writeDisabled("create-posting-schedule", EffectLocalMutation),
	writeDisabled("update-posting-schedule", EffectLocalMutation),
	writeDisabled("delete-posting-schedule", EffectDestructive),
	writeDisabled("create-notification-mute", EffectLocalMutation),
	writeDisabled("end-notification-mute", EffectLocalMutation),
}

var byOperationID = indexOperations(operations)

func read(operationID string, exposure Exposure) Operation {
	return Operation{
		OperationID: operationID,
		Access:      AccessRead, Exposure: exposure, Effect: EffectQuery,
		Retry: RetryTransient, Idempotency: IdempotencyNone,
	}
}

func readPaged(operationID string, exposure Exposure) Operation {
	operation := read(operationID, exposure)
	page := *cursorPage
	operation.Pagination = &page
	return operation
}

func readDisabled(operationID string) Operation {
	return read(operationID, ExposureDisabled)
}

func write(operationID string, exposure Exposure, effect Effect) Operation {
	return Operation{
		OperationID: operationID,
		Access:      AccessWrite, Exposure: exposure, Effect: effect,
		Retry: RetryIdempotentTransient, Idempotency: IdempotencyRequired,
	}
}

func writeDisabled(operationID string, effect Effect) Operation {
	return Operation{
		OperationID: operationID,
		Access:      AccessWrite, Exposure: ExposureDisabled, Effect: effect,
		Retry: RetryNever, Idempotency: IdempotencyNone,
	}
}

func indexOperations(items []Operation) map[string]Operation {
	indexed := make(map[string]Operation, len(items))
	for _, operation := range items {
		if operation.OperationID == "" {
			panic("automation catalog contains an empty operation ID")
		}
		if _, exists := indexed[operation.OperationID]; exists {
			panic("automation catalog contains duplicate operation ID: " + operation.OperationID)
		}
		indexed[operation.OperationID] = clone(operation)
	}
	return indexed
}

func Lookup(operationID string) (Operation, bool) {
	operation, ok := byOperationID[operationID]
	return clone(operation), ok
}

func All() []Operation {
	result := make([]Operation, 0, len(byOperationID))
	for _, operation := range byOperationID {
		result = append(result, clone(operation))
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].OperationID < result[j].OperationID
	})
	return result
}

func clone(operation Operation) Operation {
	if operation.Pagination != nil {
		pagination := *operation.Pagination
		operation.Pagination = &pagination
	}
	operation.Selectors = append([]SelectorHint(nil), operation.Selectors...)
	return operation
}
