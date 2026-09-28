// Package workflows owns authored workflows, source admission and resumable runs.
// Native publication effects are delegated to their existing application owners.
package workflows

import (
	"context"
	"errors"
	"time"

	"github.com/openpost/backend/internal/services/workspaceaccess"
)

const (
	maxWorkflows   = 100
	maxActiveRuns  = 1000
	SchemaVersion  = 1
	MaxSteps       = 40
	MaxDepth       = 4
	MaxTextBytes   = 20000
	MaxRunAge      = 30 * 24 * time.Hour
	SourceInterval = 5 * time.Minute
	StateQueued    = "queued"
	StateRunning   = "running"
	StateWaiting   = "waiting"
	StateApproval  = "awaiting_approval"
	StateSucceeded = "succeeded"
	StateFailed    = "failed"
	StateCancelled = "cancelled"
	ModeTest       = "test"
	ModeLive       = "live"
	ModePreview    = "preview"
	KindDraft      = "create_draft"
	KindBuild      = "build_draft"
	KindApproval   = "approval"
	KindSchedule   = "schedule"
	KindReply      = "reply"
	KindWait       = "wait"
	KindCondition  = "condition"
	KindMetrics    = "metrics"
	KindHTTP       = "http_request"
	KindCode       = "code"
	KindAIText     = "ai_text"
	KindAIDecision = "ai_decision"
	KindFields     = "set_fields"
	KindText       = "text"
	KindJSON       = "parse_json"
	KindFilter     = "list_filter"
	KindSort       = "list_sort"
	KindLimit      = "list_limit"
	KindMerge      = "merge"
	KindDate       = "date"
	KindURL        = "tracking_link"
	KindFeed       = "read_feed"
)

var (
	ErrNotFound = errors.New("workflow not found")
	ErrConflict = errors.New("workflow changed; reload before saving")
	ErrAccess   = errors.New("workspace access no longer permits this workflow")
	ErrInvalid  = errors.New("invalid workflow")
	ErrState    = errors.New("workflow run is no longer in the expected state")
)

type WorkflowDefinition struct {
	Schema int    `json:"schema" minimum:"1" maximum:"1"`
	Source Source `json:"source"`
	Steps  []Step `json:"steps" maxItems:"40"`
}

type WorkflowSource struct {
	IntervalMinutes    int      `json:"interval_minutes,omitempty" minimum:"0" maximum:"43200"`
	Kind               string   `json:"kind" enum:"manual,github_release,rss,rendition_published,interval,publication_created,rendition_failed"`
	Repository         string   `json:"repository,omitempty" maxLength:"200"`
	URL                string   `json:"url,omitempty" maxLength:"2048"`
	ConnectionID       string   `json:"connection_id,omitempty"`
	IncludePrereleases bool     `json:"include_prereleases,omitempty"`
	AccountIDs         []string `json:"account_ids,omitempty" maxItems:"50"`
}

// A whole-value reference preserves its type. Text values may contain field
// tokens such as {{source.title}}; these interpolate strings, never execute code.
type WorkflowValue struct {
	Literal   any    `json:"literal,omitempty"`
	Reference string `json:"reference,omitempty" maxLength:"200"`
}

type WorkflowStep struct {
	ID     string           `json:"id" maxLength:"64"`
	Kind   string           `json:"kind" enum:"create_draft,build_draft,approval,schedule,reply,wait,condition,metrics,http_request,code,ai_text,ai_decision,set_fields,text,parse_json,list_filter,list_sort,list_limit,merge,date,tracking_link,read_feed"`
	Name   string           `json:"name" maxLength:"100"`
	Inputs map[string]Value `json:"inputs"`
	Then   []Step           `json:"then,omitempty" maxItems:"40"`
	Else   []Step           `json:"else,omitempty" maxItems:"40"`
}

type Workflow struct {
	ID                string     `json:"id"`
	WorkspaceID       string     `json:"workspace_id"`
	Name              string     `json:"name"`
	Description       string     `json:"description"`
	Revision          int        `json:"revision"`
	PublishedRevision int        `json:"published_revision"`
	Enabled           bool       `json:"enabled"`
	Definition        Definition `json:"definition"`
	SourceError       string     `json:"source_error,omitempty"`
	LastCheckedAt     *time.Time `json:"last_checked_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

type WorkflowSaveRequest struct {
	Name             string     `json:"name" minLength:"1" maxLength:"100"`
	Description      string     `json:"description" maxLength:"500"`
	ExpectedRevision int        `json:"expected_revision" minimum:"0"`
	Definition       Definition `json:"definition"`
}

type WorkflowRun struct {
	ID               string         `json:"id"`
	WorkflowID       string         `json:"workflow_id"`
	WorkspaceID      string         `json:"workspace_id"`
	WorkflowName     string         `json:"workflow_name"`
	WorkflowRevision int            `json:"workflow_revision"`
	Mode             string         `json:"mode"`
	State            string         `json:"state"`
	Revision         int            `json:"revision"`
	Definition       Definition     `json:"definition"`
	Source           map[string]any `json:"source"`
	Steps            []StepResult   `json:"steps"`
	CurrentStepID    string         `json:"current_step_id,omitempty"`
	Error            string         `json:"error,omitempty"`
	WakeAt           *time.Time     `json:"wake_at,omitempty"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
}

type WorkflowStepResult struct {
	StepID      string         `json:"step_id"`
	Kind        string         `json:"kind"`
	Name        string         `json:"name"`
	State       string         `json:"state"`
	Inputs      map[string]any `json:"inputs"`
	Output      map[string]any `json:"output"`
	Error       string         `json:"error,omitempty"`
	StartedAt   time.Time      `json:"started_at"`
	CompletedAt *time.Time     `json:"completed_at,omitempty"`
}

type WorkflowConnection struct {
	Host       string    `json:"host,omitempty"`
	HeaderName string    `json:"header_name,omitempty"`
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Kind       string    `json:"kind"`
	CreatedAt  time.Time `json:"created_at"`
}

type EffectRequest struct {
	Kind      string
	Inputs    map[string]any
	Authority workspaceaccess.StoredAuthority
	RunID     string
	StepID    string
	ExpiresAt time.Time
}

type EffectResult struct {
	Output map[string]any
	// Pending returns control to the database queue while a native durable
	// operation finishes. Repeating the effect uses the same run/step identity.
	Pending bool
}

type Actions interface {
	Execute(context.Context, EffectRequest) (EffectResult, error)
}

type Definition = WorkflowDefinition

type Source = WorkflowSource

type Value = WorkflowValue

type Step = WorkflowStep

type SaveRequest = WorkflowSaveRequest

type Run = WorkflowRun

type StepResult = WorkflowStepResult

type Connection = WorkflowConnection

// Secret values are write-only. Credentials are bound to one HTTPS host.
type WorkflowCredentialRequest struct {
	Name       string `json:"name" minLength:"1" maxLength:"100"`
	Kind       string `json:"kind,omitempty" enum:"github,bearer,header,basic"`
	Token      string `json:"token" minLength:"1" maxLength:"4000"`
	Host       string `json:"host,omitempty" maxLength:"253"`
	HeaderName string `json:"header_name,omitempty" maxLength:"100"`
}
