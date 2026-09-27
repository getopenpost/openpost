package workflows

import (
	"time"

	"github.com/uptrace/bun"
)

type workflowRecord struct {
	bun.BaseModel     `bun:"table:workflows"`
	ID                string `bun:",pk"`
	WorkspaceID       string
	Name              string
	Description       string
	Revision          int
	PublishedRevision int
	Enabled           bool
	DraftJSON         string
	PublishedJSON     string
	AuthorityJSON     string
	SourceFingerprint string
	SourceInitialized bool
	SourcePage        int
	SourceError       string
	SourceStartedAt   *time.Time `bun:",nullzero"`
	LastCheckedAt     *time.Time `bun:",nullzero"`
	PollLeaseUntil    *time.Time `bun:",nullzero"`
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type runRecord struct {
	bun.BaseModel    `bun:"table:workflow_runs"`
	ID               string `bun:",pk"`
	WorkflowID       string
	WorkspaceID      string
	WorkflowName     string
	WorkflowRevision int
	Mode             string
	State            string
	Revision         int
	DefinitionJSON   string
	AuthorityJSON    string
	SourceJSON       string
	RemainingJSON    string
	ResultsJSON      string
	CurrentStepID    string
	Error            string
	WakeAt           *time.Time `bun:",nullzero"`
	LeaseToken       string
	LeaseUntil       *time.Time `bun:",nullzero"`
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type eventRecord struct {
	bun.BaseModel     `bun:"table:workflow_events"`
	WorkflowID        string `bun:",pk"`
	SourceFingerprint string `bun:",pk"`
	EventKey          string `bun:",pk"`
	CreatedAt         time.Time
}

type connectionRecord struct {
	bun.BaseModel `bun:"table:workflow_connections"`
	ID            string `bun:",pk"`
	WorkspaceID   string
	Name          string
	Kind          string
	Ciphertext    []byte
	CreatedAt     time.Time
}
