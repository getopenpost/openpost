package repurpose

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"testing"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

type generatorFunc func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error)

func (fn generatorFunc) Generate(ctx context.Context, input ai.GenerateRequest) (ai.GenerateResult, error) {
	return fn(ctx, input)
}

func testService(t *testing.T, generator ai.Generator) (*Service, workspaceaccess.ActorFacts) {
	t.Helper()
	connection, err := sql.Open("sqlite3", ":memory:")
	require.NoError(t, err)
	db := bun.NewDB(connection, sqlitedialect.New())
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	// Exercise the shipped migration, not a second test-only schema.
	require.NoError(t, database.CreateSchema(db))
	for _, model := range []any{
		&models.User{ID: "user", Email: "one@example.com"},
		&models.User{ID: "other", Email: "other@example.com"},
		&models.Workspace{ID: "workspace", OrganizationID: "org", Name: "Main"},
		&models.Workspace{ID: "foreign", OrganizationID: "other-org", Name: "Foreign"},
		&models.WorkspaceMember{WorkspaceID: "workspace", UserID: "user", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive},
		&models.WorkspaceMember{WorkspaceID: "workspace", UserID: "other", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive},
	} {
		_, err := db.NewInsert().Model(model).Exec(t.Context())
		require.NoError(t, err)
	}
	return New(db, generator, "fixture-model"), workspaceaccess.ActorFacts{UserID: "user", SessionID: "session"}
}

func sourceRequest() SuggestionRequest {
	return SuggestionRequest{WorkspaceID: "workspace", Source: TranscriptSource{ID: "local-recording", Revision: "snapshot-1", Duration: 90, Words: []TranscriptWord{
		{Text: "We", Start: 1.2, End: 1.5}, {Text: "made", Start: 1.5, End: 1.9}, {Text: "exports", Start: 2, End: 2.4}, {Text: "faster.", Start: 2.4, End: 3},
		{Text: "The", Start: 40, End: 40.5}, {Text: "trade-off", Start: 40.5, End: 41.2}, {Text: "is", Start: 41.2, End: 41.4}, {Text: "memory.", Start: 41.4, End: 42},
	}}}
}

const validResponse = `{"candidates":[{"first_word":0,"last_word":3,"title":"Faster exports","rationale":"Explains the improvement.","context_warning":""},{"first_word":4,"last_word":7,"title":"Memory trade-off","rationale":"Names the cost.","context_warning":"Listen to the preceding explanation."}]}`

func payloadFor(t *testing.T, service *Service, id string) string {
	t.Helper()
	var job models.Job
	require.NoError(t, service.db.NewSelect().Model(&job).Where("type = ? AND scope_id = ?", jobregistry.TypeRepurposeSuggestions, id).Order("run_at DESC").Limit(1).Scan(t.Context()))
	return job.Payload
}

func TestRepurposePersistsGroundedCandidatesAndIdempotentSubmission(t *testing.T) {
	calls := 0
	service, actor := testService(t, generatorFunc(func(_ context.Context, input ai.GenerateRequest) (ai.GenerateResult, error) {
		calls++
		require.NotNil(t, input.ResponseSchema)
		require.Contains(t, input.UserPrompt, "faster.")
		return ai.GenerateResult{Text: validResponse, Model: "fixture-model", RequestID: "provider-call", Usage: ai.Usage{InputTokens: 100, OutputTokens: 50, TotalTokens: 150}}, nil
	}))
	first, err := service.Create(t.Context(), actor, "first-request", sourceRequest())
	require.NoError(t, err)
	require.Equal(t, StateQueued, first.State)
	require.Empty(t, first.Candidates)
	replay, err := service.Create(t.Context(), actor, "first-request", sourceRequest())
	require.NoError(t, err)
	require.Equal(t, first.ID, replay.ID)
	changed := sourceRequest()
	changed.Source.Words[0].Text = "They"
	_, err = service.Create(t.Context(), actor, "first-request", changed)
	require.ErrorIs(t, err, ErrConflict)
	payload := payloadFor(t, service, first.ID)
	require.NoError(t, service.HandleJob(t.Context(), payload))
	require.NoError(t, service.HandleJob(t.Context(), payload))
	require.Equal(t, 1, calls)
	reopened, err := New(service.db, nil, "").Get(t.Context(), actor, first.ID)
	require.NoError(t, err)
	require.Equal(t, StateReady, reopened.State)
	require.Equal(t, "snapshot-1", reopened.SourceRevision)
	require.Len(t, reopened.Candidates, 2)
	require.Equal(t, 1.2, reopened.Candidates[0].Start)
	require.Equal(t, 3.0, reopened.Candidates[0].End)
	require.Equal(t, 40.0, reopened.Candidates[1].Start)
	require.Equal(t, 42.0, reopened.Candidates[1].End)
	var stored record
	require.NoError(t, service.db.NewSelect().Model(&stored).Where("id = ?", first.ID).Scan(t.Context()))
	require.Equal(t, "provider-call", stored.ProviderRequestID)
	require.Contains(t, stored.UsageJSON, "150")
	for _, table := range []string{"publications", "video_projects"} {
		count, err := service.db.NewSelect().Table(table).Count(t.Context())
		require.NoError(t, err)
		require.Zero(t, count)
	}
	_, err = service.Get(t.Context(), workspaceaccess.ActorFacts{UserID: "other", SessionID: "other-session"}, first.ID)
	require.ErrorIs(t, err, ErrNotFound)
	actor.CredentialWorkspaceID = "foreign"
	_, err = service.Get(t.Context(), actor, first.ID)
	require.ErrorIs(t, err, ErrAccess)
}

func TestRepurposeRejectsInvalidSourcesBeforeAI(t *testing.T) {
	service, actor := testService(t, generatorFunc(func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error) {
		t.Fatal("invalid source reached AI")
		return ai.GenerateResult{}, nil
	}))
	cases := map[string]func(*SuggestionRequest){
		"missing fingerprint": func(r *SuggestionRequest) { r.Source.Revision = "" },
		"out of range":        func(r *SuggestionRequest) { r.Source.Words[0].End = 100 },
		"backwards":           func(r *SuggestionRequest) { r.Source.Words[2].Start = 0 },
		"backwards ends":      func(r *SuggestionRequest) { r.Source.Words[2].Start = 1.5; r.Source.Words[2].End = 1.8 },
		"nan":                 func(r *SuggestionRequest) { r.Source.Words[0].Start = math.NaN() },
		"infinite":            func(r *SuggestionRequest) { r.Source.Duration = math.Inf(1) },
		"empty":               func(r *SuggestionRequest) { r.Source.Words = nil },
		"zero length":         func(r *SuggestionRequest) { r.Source.Words[0].End = r.Source.Words[0].Start },
		"too many words":      func(r *SuggestionRequest) { r.Source.Words = make([]TranscriptWord, maxWords+1) },
		"too much text": func(r *SuggestionRequest) {
			r.Source.Words = make([]TranscriptWord, 1000)
			for i := range r.Source.Words {
				r.Source.Words[i] = TranscriptWord{Text: strings.Repeat("a", 200), Start: float64(i), End: float64(i + 1)}
			}
			r.Source.Duration = 1000
		},
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			r := sourceRequest()
			change(&r)
			_, err := service.Create(t.Context(), actor, "invalid-"+name, r)
			require.ErrorIs(t, err, ErrInvalid)
		})
	}
	count, err := service.db.NewSelect().Model((*record)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}

func TestRepurposeRejectsInventedRangesAndAcceptsNoUsefulClips(t *testing.T) {
	output := validResponse
	service, actor := testService(t, generatorFunc(func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error) {
		return ai.GenerateResult{Text: output}, nil
	}))
	cases := []struct{ name, response, state string }{
		{"empty", `{"candidates":[]}`, StateReady},
		{"missing candidates", `{}`, StateFailed},
		{"null candidates", `{"candidates":null}`, StateFailed},
		{"out of bounds", strings.Replace(validResponse, `"last_word":7`, `"last_word":99`, 1), StateFailed},
		{"negative index", strings.Replace(validResponse, `"first_word":0`, `"first_word":-1`, 1), StateFailed},
		{"missing first", strings.Replace(validResponse, `"first_word":0,`, "", 1), StateFailed},
		{"overlap", strings.Replace(validResponse, `"first_word":4`, `"first_word":2`, 1), StateFailed},
		{"invented timestamps", strings.Replace(validResponse, `"first_word":0`, `"start":0,"first_word":0`, 1), StateFailed},
		{"same idea title", strings.Replace(validResponse, "Memory trade-off", "Faster exports", 1), StateFailed},
		{"fractional index", strings.Replace(validResponse, `"first_word":0`, `"first_word":0.5`, 1), StateFailed},
	}
	for index, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			output = tc.response
			suggestion, err := service.Create(t.Context(), actor, fmt.Sprintf("response-%d", index), sourceRequest())
			require.NoError(t, err)
			require.NoError(t, service.HandleJob(t.Context(), payloadFor(t, service, suggestion.ID)))
			suggestion, err = service.Get(t.Context(), actor, suggestion.ID)
			require.NoError(t, err)
			require.Equal(t, tc.state, suggestion.State)
			require.Empty(t, suggestion.Candidates)
		})
	}
}

func TestRepurposeCancellationFencesInflightResultAndRetry(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	calls := 0
	service, actor := testService(t, generatorFunc(func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error) {
		calls++
		if calls == 1 {
			close(entered)
			<-release
		}
		return ai.GenerateResult{Text: validResponse, RequestID: fmt.Sprintf("call-%d", calls), Usage: ai.Usage{TotalTokens: 150}}, nil
	}))
	suggestion, err := service.Create(t.Context(), actor, "cancel-request", sourceRequest())
	require.NoError(t, err)
	original := payloadFor(t, service, suggestion.ID)
	finished := make(chan error, 1)
	go func() { finished <- service.HandleJob(t.Context(), original) }()
	<-entered
	analyzing, err := service.Get(t.Context(), actor, suggestion.ID)
	require.NoError(t, err)
	require.Equal(t, StateAnalyzing, analyzing.State)
	_, err = service.Cancel(t.Context(), actor, suggestion.ID, suggestion.Revision)
	require.ErrorIs(t, err, ErrConflict)
	cancelled, err := service.Cancel(t.Context(), actor, suggestion.ID, analyzing.Revision)
	require.NoError(t, err)
	retried, err := service.Retry(t.Context(), actor, suggestion.ID, cancelled.Revision)
	require.NoError(t, err)
	require.Equal(t, StateQueued, retried.State)
	close(release)
	require.NoError(t, <-finished)
	current, err := service.Get(t.Context(), actor, suggestion.ID)
	require.NoError(t, err)
	require.Equal(t, StateQueued, current.State)
	require.Empty(t, current.Candidates)
	require.NoError(t, service.HandleJob(t.Context(), original))
	require.Equal(t, 1, calls)
	require.NoError(t, service.HandleJob(t.Context(), payloadFor(t, service, suggestion.ID)))
	current, err = service.Get(t.Context(), actor, suggestion.ID)
	require.NoError(t, err)
	require.Equal(t, StateReady, current.State)
	traces, err := service.usage.List(t.Context(), "workspace", "user")
	require.NoError(t, err)
	require.Len(t, traces, 2)
	for _, trace := range traces {
		require.Equal(t, "completed", trace.State)
		require.NotNil(t, trace.TotalTokens)
		require.EqualValues(t, 150, *trace.TotalTokens)
	}
}

func TestRepurposeAdmissionAndMediaAccess(t *testing.T) {
	calls := 0
	service, actor := testService(t, generatorFunc(func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error) {
		calls++
		return ai.GenerateResult{Text: `{"candidates":[]}`}, nil
	}))
	media := &models.MediaAttachment{ID: "foreign-media", WorkspaceID: "foreign", ProcessingStatus: "ready", FilePath: "fixture.mp4", MimeType: "video/mp4"}
	_, err := service.db.NewInsert().Model(media).Exec(t.Context())
	require.NoError(t, err)
	request := sourceRequest()
	request.Source.MediaID = "foreign-media"
	_, err = service.Create(t.Context(), actor, "foreign-media", request)
	require.ErrorIs(t, err, ErrAccess)
	request.Source.MediaID = ""
	request.Source.ID = "foreign-media"
	_, err = service.Create(t.Context(), actor, "implicit-media", request)
	require.ErrorIs(t, err, ErrAccess)
	for index := range 3 {
		_, err = service.Create(t.Context(), actor, fmt.Sprintf("capacity-%d", index), sourceRequest())
		require.NoError(t, err)
	}
	_, err = service.Create(t.Context(), actor, "capacity-next", sourceRequest())
	require.ErrorIs(t, err, ErrCapacity)
	var first record
	require.NoError(t, service.db.NewSelect().Model(&first).Limit(1).Scan(t.Context()))
	_, err = service.db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("role = ?", models.WorkspaceRoleViewer).Where("user_id = ?", "user").Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, service.HandleJob(t.Context(), payloadFor(t, service, first.ID)))
	require.Zero(t, calls)
	current, err := service.Get(t.Context(), actor, first.ID)
	require.NoError(t, err)
	require.Equal(t, StateFailed, current.State)
}

func TestRepurposeTerminalJobFailureCannotOverwriteNewGeneration(t *testing.T) {
	service, actor := testService(t, generatorFunc(func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error) {
		return ai.GenerateResult{Text: `{"candidates":[]}`}, nil
	}))
	item, err := service.Create(t.Context(), actor, "terminal-request", sourceRequest())
	require.NoError(t, err)
	payload := payloadFor(t, service, item.ID)
	require.NoError(t, service.MarkTerminalJobFailure(t.Context(), service.db, payload))
	failed, err := service.Get(t.Context(), actor, item.ID)
	require.NoError(t, err)
	require.Equal(t, StateFailed, failed.State)
	retried, err := service.Retry(t.Context(), actor, item.ID, failed.Revision)
	require.NoError(t, err)
	require.NoError(t, service.MarkTerminalJobFailure(t.Context(), service.db, payload))
	current, err := service.Get(t.Context(), actor, item.ID)
	require.NoError(t, err)
	require.Equal(t, retried.Revision, current.Revision)
	require.Equal(t, StateQueued, current.State)
	var generation jobregistry.RepurposePayload
	require.NoError(t, json.Unmarshal([]byte(payloadFor(t, service, item.ID)), &generation))
	require.Equal(t, 2, generation.Generation)
}
