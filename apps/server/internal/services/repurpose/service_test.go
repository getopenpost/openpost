package repurpose

import (
	"context"

	"fmt"

	"testing"

	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/openpost/backend/internal/testdb"
	"github.com/stretchr/testify/require"
)

type generatorFunc func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error)

func (fn generatorFunc) Generate(ctx context.Context, input ai.GenerateRequest) (ai.GenerateResult, error) {
	return fn(ctx, input)
}

func testService(t *testing.T, generator ai.Generator) (*Service, workspaceaccess.ActorFacts) {
	t.Helper()
	db := testdb.NewSQLiteNoFK(t)
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

func TestRepurposeCancellationFencesInflightResultAndRetry(t *testing.T) {
	t.Parallel()
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
