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
	IdempotencyNatural  IdempotencyPolicy = "natural"
	IdempotencyOptional IdempotencyPolicy = "optional"
	IdempotencyRequired IdempotencyPolicy = "required"
)

type Pagination struct {
	Style            string `json:"style"`
	CursorParameter  string `json:"cursor_parameter,omitempty"`
	NextCursorHeader string `json:"next_cursor_header,omitempty"`
	HasMoreHeader    string `json:"has_more_header,omitempty"`
	OffsetParameter  string `json:"offset_parameter,omitempty"`
	LimitParameter   string `json:"limit_parameter,omitempty"`
	TotalPath        string `json:"total_path,omitempty"`
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
			"offset_parameter":   operation.Pagination.OffsetParameter,
			"limit_parameter":    operation.Pagination.LimitParameter,
			"total_path":         operation.Pagination.TotalPath,
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
		selectors := make([]any, 0, len(operation.Selectors))
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
	withSelectors(read("list-accounts", ExposureAlpha), workspaceSelector()),
	readDisabled("list-account-providers"),
	withSelectors(read("get-account-destination-options", ExposureAlpha), workspaceSelector(), accountSelector("account_id")),
	readDisabled("search-account-publishing-options"),
	withSelectors(read("get-provider-readiness", ExposureAlpha), workspaceSelector()),
	readDisabled("resolve-publishing-capabilities"),
	withSelectors(read("list-social-sets", ExposureAlpha), workspaceSelector()),
	withSelectors(read("get-social-set", ExposureAlpha), workspaceSelector(), socialSetSelector("id")),
	withResult(withPagination(withSelectors(read("list-media", ExposureAlpha), workspaceSelector()), Pagination{
		Style: "offset", OffsetParameter: "offset", LimitParameter: "limit", TotalPath: "total",
	}), ResultExtraction{BodyPath: "media"}),
	readDisabled("get-media-storage"),
	readDisabled("get-media-usage"),
	withSelectors(readPaged("list-publications", ExposureAlpha), workspaceSelector()),
	withSelectors(read("get-publication", ExposureAlpha), workspaceSelector(), publicationSelector("id")),
	withSelectors(readPaged("list-publication-events", ExposureAlpha), workspaceSelector(), publicationSelector("id")),
	withSelectors(read("validate-publication", ExposureAlpha), workspaceSelector(), publicationSelector("id")),
	readDisabled("list-posting-schedules"),
	withSelectors(read("get-next-available-slot", ExposureAlpha), workspaceSelector()),
	readResult("get-job", ExposureAlpha, ResultExtraction{IDPath: "$.id"}),
	readDisabled("get-notification-preferences"),

	withSelectors(write("create-publication", ExposureAlpha, EffectLocalMutation), workspaceSelector()),
	withSelectors(write("update-publication", ExposureAlpha, EffectLocalMutation), workspaceSelector(), publicationSelector("id")),
	withSelectors(write("upsert-publication-renditions", ExposureAlpha, EffectLocalMutation), workspaceSelector(), publicationSelector("id")),
	withSelectors(write("schedule-publication", ExposureAlpha, EffectLocalMutation), workspaceSelector(), publicationSelector("id")),
	withSelectors(write("cancel-publication", ExposureAlpha, EffectLocalMutation), workspaceSelector(), publicationSelector("id")),
	withSelectors(write("publish-publication-now", ExposureAlpha, EffectExternalAction), workspaceSelector(), publicationSelector("id")),
	writeDisabled("retry-publication-rendition", EffectExternalAction),
	withSelectors(write("retry-failed-publication-renditions", ExposureAlpha, EffectExternalAction), workspaceSelector(), publicationSelector("id")),
	withSelectors(write("create-media-upload-session", ExposureAlpha, EffectLocalMutation), workspaceSelector()),
	writeNaturallyIdempotent("complete-media-upload-session", ExposureAlpha, EffectLocalMutation),
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

func readResult(operationID string, exposure Exposure, result ResultExtraction) Operation {
	operation := read(operationID, exposure)
	operation.Result = result
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

func writeNaturallyIdempotent(operationID string, exposure Exposure, effect Effect) Operation {
	return Operation{
		OperationID: operationID,
		Access:      AccessWrite, Exposure: exposure, Effect: effect,
		Retry: RetryTransient, Idempotency: IdempotencyNatural,
	}
}

func withResult(operation Operation, result ResultExtraction) Operation {
	operation.Result = result
	return operation
}

func withPagination(operation Operation, pagination Pagination) Operation {
	operation.Pagination = &pagination
	return operation
}

func withSelectors(operation Operation, selectors ...SelectorHint) Operation {
	operation.Selectors = append(operation.Selectors, selectors...)
	return operation
}

func workspaceSelector() SelectorHint {
	return SelectorHint{Parameter: "workspace_id", OperationID: "list-workspaces", ValuePath: "id", LabelPath: "name"}
}

func accountSelector(parameter string) SelectorHint {
	return SelectorHint{Parameter: parameter, OperationID: "list-accounts", ValuePath: "id", LabelPath: "account_username"}
}

func publicationSelector(parameter string) SelectorHint {
	return SelectorHint{Parameter: parameter, OperationID: "list-publications", ValuePath: "id", LabelPath: "title"}
}

func socialSetSelector(parameter string) SelectorHint {
	return SelectorHint{Parameter: parameter, OperationID: "list-social-sets", ValuePath: "id", LabelPath: "name"}
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
