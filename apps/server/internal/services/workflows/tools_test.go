package workflows

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type generatorFunc func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error)

func (f generatorFunc) Generate(ctx context.Context, request ai.GenerateRequest) (ai.GenerateResult, error) {
	return f(ctx, request)
}

type deciderFunc func(context.Context, ai.DecisionRequest) (ai.DecisionResult, error)

func (f deciderFunc) Decide(ctx context.Context, request ai.DecisionRequest) (ai.DecisionResult, error) {
	return f(ctx, request)
}

func TestHTTPRequestUsesRotatedScopedSecretWithoutExposingIt(t *testing.T) {
	s, actor := workflowTestService(t, nil)
	connection, err := s.SaveCredential(t.Context(), actor, "ws", WorkflowCredentialRequest{Name: "API", Kind: "bearer", Host: "8.8.8.8", Token: "original-secret-value"})
	require.NoError(t, err)
	_, err = s.RotateCredential(t.Context(), actor, "ws", connection.ID, "rotated-secret-value")
	require.NoError(t, err)
	calls := 0
	s.client = &http.Client{Transport: responseTransport(func(request *http.Request) (*http.Response, error) {
		calls++
		require.Equal(t, "Bearer rotated-secret-value", request.Header.Get("Authorization"))
		require.NotEmpty(t, request.Header.Get("Idempotency-Key"))
		require.Equal(t, `He said "hi"`, request.Header.Get("X-Title"))
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(`{"token":"rotated-secret-value","answer":42}`))}, nil
	})}
	workflow := saveTestWorkflow(t, s, actor, []Step{{ID: "request", Kind: KindHTTP, Inputs: map[string]Value{"method": literal("GET"), "url": literal("https://8.8.8.8/data"), "connection_id": literal(connection.ID), "headers": literal(map[string]any{"X-Title": "{{source.title}}"})}}})
	run, err := s.Start(t.Context(), actor, "ws", workflow.ID, ModeLive, map[string]any{"title": `He said "hi"`}, workflow.Revision)
	require.NoError(t, err)
	require.ErrorIs(t, s.DeleteConnection(t.Context(), actor, "ws", connection.ID), ErrInvalid)
	runJob(t, s, run.ID)
	runJob(t, s, run.ID)
	final, err := s.GetRun(t.Context(), actor, "ws", run.ID)
	require.NoError(t, err)
	require.Equal(t, StateSucceeded, final.State)
	require.Equal(t, 1, calls)
	encoded, err := json.Marshal(final)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "rotated-secret-value")
	require.Contains(t, string(encoded), "[redacted]")
	for _, url := range []string{"https://1.1.1.1/data", "http://127.0.0.1/internal"} {
		workflow.Definition.Steps[0].Inputs["url"] = literal(url)
		workflow, err = s.Save(t.Context(), actor, "ws", workflow.ID, SaveRequest{Name: workflow.Name, ExpectedRevision: workflow.Revision, Definition: workflow.Definition})
		require.NoError(t, err)
		blocked, err := s.Start(t.Context(), actor, "ws", workflow.ID, ModeLive, map[string]any{"title": "Test"}, workflow.Revision)
		require.NoError(t, err)
		runJob(t, s, blocked.ID)
		final, err = s.GetRun(t.Context(), actor, "ws", blocked.ID)
		require.NoError(t, err)
		require.Equal(t, StateFailed, final.State)
	}
	require.Equal(t, 1, calls)
}

func TestAITextAcceptsGeneralMessages(t *testing.T) {
	for _, system := range []string{"", "Reply in Portuguese."} {
		t.Run(system, func(t *testing.T) {
			s, actor := workflowTestService(t, nil)
			s.SetAI(generatorFunc(func(_ context.Context, request ai.GenerateRequest) (ai.GenerateResult, error) {
				require.Equal(t, system, request.SystemPrompt)
				require.Equal(t, "Explain gravity.", request.UserPrompt)
				return ai.GenerateResult{Text: "An explanation", Model: "text-model"}, nil
			}), "text-model")
			inputs := map[string]Value{"text": literal("Explain gravity.")}
			if system != "" {
				inputs["instructions"] = literal(system)
			}
			workflow := saveTestWorkflow(t, s, actor, []Step{{ID: "explain", Kind: KindAIText, Inputs: inputs}})
			run, err := s.Start(t.Context(), actor, "ws", workflow.ID, ModeLive, map[string]any{}, workflow.Revision)
			require.NoError(t, err)
			runJob(t, s, run.ID)
			final, err := s.GetRun(t.Context(), actor, "ws", run.ID)
			require.NoError(t, err)
			require.Equal(t, StateSucceeded, final.State)
			require.Equal(t, "An explanation", final.Steps[0].Output["text"])
		})
	}
}

func TestAIUsageSurvivesInvalidOutputAndProviderFailureWithoutReplay(t *testing.T) {
	for _, providerFailure := range []bool{false, true} {
		t.Run(fmt.Sprint(providerFailure), func(t *testing.T) {
			s, actor := workflowTestService(t, nil)
			calls := 0
			cost := 0.002
			s.SetDecisionAI(deciderFunc(func(_ context.Context, request ai.DecisionRequest) (ai.DecisionResult, error) {
				calls++
				require.Equal(t, "configured-model", request.Model)
				require.Equal(t, "Release notes", request.Input)
				require.Equal(t, "Is this relevant?", request.Criteria)
				result := ai.DecisionResult{Probability: math.NaN(), Model: "model", RequestID: "request-1", Usage: ai.Usage{InputTokens: 100, OutputTokens: 20, TotalTokens: 120, CostUSD: &cost}}
				if providerFailure {
					return result, errors.New("provider private error")
				}
				return result, nil
			}), "configured-model")
			workflow := saveTestWorkflow(t, s, actor, []Step{{ID: "decision", Kind: KindAIDecision, Inputs: map[string]Value{"text": literal("Release notes"), "instructions": literal("Is this relevant?")}}})
			run, err := s.Start(t.Context(), actor, "ws", workflow.ID, ModeLive, map[string]any{}, workflow.Revision)
			require.NoError(t, err)
			runJob(t, s, run.ID)
			runJob(t, s, run.ID)
			final, err := s.GetRun(t.Context(), actor, "ws", run.ID)
			require.NoError(t, err)
			require.Equal(t, StateFailed, final.State)
			require.NotContains(t, final.Error, "private error")
			require.Equal(t, 1, calls)
			var usage []usageRecord
			require.NoError(t, s.db.NewSelect().Model(&usage).Scan(t.Context()))
			require.Len(t, usage, 1)
			require.Equal(t, StateFailed, usage[0].State)
			require.Equal(t, "user", usage[0].UserID)
			require.Equal(t, int64(120), usage[0].TotalTokens)
			require.Equal(t, cost, *usage[0].CostUSD)
			require.Equal(t, "request-1", usage[0].ProviderRequestID)
		})
	}
}

func TestCreatedPostTriggerExcludesAutomationAndAdmitsOnce(t *testing.T) {
	s, actor := workflowTestService(t, nil)
	workflow := saveTestWorkflow(t, s, actor, []Step{{ID: "wait", Kind: KindWait, Inputs: map[string]Value{"minutes": literal(0)}}})
	workflow.Definition.Source = Source{Kind: "publication_created"}
	workflow, err := s.Save(t.Context(), actor, "ws", workflow.ID, SaveRequest{Name: workflow.Name, ExpectedRevision: workflow.Revision, Definition: workflow.Definition})
	require.NoError(t, err)
	workflow, err = s.Publish(t.Context(), actor, "ws", workflow.ID, workflow.Revision)
	require.NoError(t, err)
	for _, origin := range []string{"web", "autopost"} {
		_, err = s.db.NewInsert().Model(&models.Publication{ID: origin, WorkspaceID: "ws", CreatedByID: "user", CreationSource: origin, Title: origin, SourceText: "New post", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}).Exec(t.Context())
		require.NoError(t, err)
	}
	payload := fmt.Sprintf(`{"workflow_id":%q}`, workflow.ID)
	require.NoError(t, s.HandleJob(t.Context(), jobregistry.TypeWorkflowPoll, payload))
	require.NoError(t, s.HandleJob(t.Context(), jobregistry.TypeWorkflowPoll, payload))
	runs, err := s.Runs(t.Context(), actor, "ws", workflow.ID)
	require.NoError(t, err)
	require.Len(t, runs, 1)
	require.Equal(t, "web", runs[0].Source["id"])
}

func TestBasicCredentialCannotLeakThroughResponseHeaders(t *testing.T) {
	s, actor := workflowTestService(t, nil)
	secret := "username:private-password"
	encoded := base64.StdEncoding.EncodeToString([]byte(secret))
	connection, err := s.SaveCredential(t.Context(), actor, "ws", WorkflowCredentialRequest{Name: "Basic API", Kind: "basic", Host: "8.8.8.8", Token: secret})
	require.NoError(t, err)
	s.client = &http.Client{Transport: responseTransport(func(request *http.Request) (*http.Response, error) {
		require.Equal(t, "Basic "+encoded, request.Header.Get("Authorization"))
		return &http.Response{StatusCode: 200, Header: http.Header{"Etag": []string{"Basic " + encoded}}, Body: io.NopCloser(strings.NewReader("ok"))}, nil
	})}
	workflow := saveTestWorkflow(t, s, actor, []Step{{ID: "request", Kind: KindHTTP, Inputs: map[string]Value{"method": literal("GET"), "url": literal("https://8.8.8.8/data"), "connection_id": literal(connection.ID)}}})
	run, err := s.Start(t.Context(), actor, "ws", workflow.ID, ModeLive, map[string]any{}, workflow.Revision)
	require.NoError(t, err)
	runJob(t, s, run.ID)
	final, err := s.GetRun(t.Context(), actor, "ws", run.ID)
	require.NoError(t, err)
	require.Equal(t, StateSucceeded, final.State)
	snapshot, err := json.Marshal(final)
	require.NoError(t, err)
	require.NotContains(t, string(snapshot), encoded)
	require.Contains(t, string(snapshot), "Basic [redacted]")
}

type afterWorkflowQuery func(context.Context, *bun.QueryEvent)

func (h afterWorkflowQuery) BeforeQuery(ctx context.Context, _ *bun.QueryEvent) context.Context {
	return ctx
}
func (h afterWorkflowQuery) AfterQuery(ctx context.Context, event *bun.QueryEvent) { h(ctx, event) }

func TestCancellationAfterCheckpointStopsExternalDispatch(t *testing.T) {
	s, actor := workflowTestService(t, nil)
	calls := 0
	s.SetAI(generatorFunc(func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error) {
		calls++
		return ai.GenerateResult{Text: "hello"}, nil
	}), "model")
	workflow := saveTestWorkflow(t, s, actor, []Step{{ID: "generate", Kind: KindAIText, Inputs: map[string]Value{"text": literal("hello"), "instructions": literal("write a post")}}})
	run, err := s.Start(t.Context(), actor, "ws", workflow.ID, ModeLive, map[string]any{}, workflow.Revision)
	require.NoError(t, err)
	cancelled := false
	s.db.AddQueryHook(afterWorkflowQuery(func(ctx context.Context, event *bun.QueryEvent) {
		if cancelled || !strings.HasPrefix(event.Query, "UPDATE") || !strings.Contains(event.Query, "results_json =") {
			return
		}
		cancelled = true
		current, err := s.GetRun(ctx, actor, "ws", run.ID)
		require.NoError(t, err)
		_, err = s.Cancel(ctx, actor, "ws", run.ID, current.Revision)
		require.NoError(t, err)
	}))
	runJob(t, s, run.ID)
	require.True(t, cancelled)
	final, err := s.GetRun(t.Context(), actor, "ws", run.ID)
	require.NoError(t, err)
	require.Equal(t, StateCancelled, final.State)
	require.Zero(t, calls)
}

func TestFailedPostTriggerKeepsFailureAfterRetry(t *testing.T) {
	s, actor := workflowTestService(t, nil)
	workflow := saveTestWorkflow(t, s, actor, []Step{{ID: "wait", Kind: KindWait, Inputs: map[string]Value{"minutes": literal(0)}}})
	workflow.Definition.Source = Source{Kind: "rendition_failed"}
	workflow, err := s.Save(t.Context(), actor, "ws", workflow.ID, SaveRequest{Name: workflow.Name, ExpectedRevision: workflow.Revision, Definition: workflow.Definition})
	require.NoError(t, err)
	workflow, err = s.Publish(t.Context(), actor, "ws", workflow.ID, workflow.Revision)
	require.NoError(t, err)
	now := time.Now().UTC()
	for _, row := range []any{
		&models.SocialAccount{ID: "account", WorkspaceID: "ws", Platform: "mastodon", AccountID: "account", AccessTokenEnc: []byte("test"), CreatedAt: now},
		&models.Publication{ID: "post", WorkspaceID: "ws", CreatedByID: "user", Title: "Launch", SourceText: "Release", CreatedAt: now, UpdatedAt: now},
		&models.Rendition{ID: "variant", PublicationID: "post", SocialAccountID: "account", TargetKey: "variant", Platform: "mastodon", Status: models.RenditionStatusScheduled, CreatedAt: now, UpdatedAt: now},
		&models.PublicationLifecycleEvent{ID: "failure", WorkspaceID: "ws", PublicationID: "post", RenditionID: "variant", Type: "failed", CreatedAt: now},
	} {
		_, err := s.db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}
	payload := fmt.Sprintf(`{"workflow_id":%q}`, workflow.ID)
	require.NoError(t, s.HandleJob(t.Context(), jobregistry.TypeWorkflowPoll, payload))
	require.NoError(t, s.HandleJob(t.Context(), jobregistry.TypeWorkflowPoll, payload))
	runs, err := s.Runs(t.Context(), actor, "ws", workflow.ID)
	require.NoError(t, err)
	require.Len(t, runs, 1)
	require.Equal(t, "variant", runs[0].Source["rendition_id"])
}

func TestSingleNodeTestDispatchesOnlySelectedNodeWithTypedData(t *testing.T) {
	nativeCalls := 0
	s, actor := workflowTestService(t, actionFunc(func(context.Context, EffectRequest) (EffectResult, error) { nativeCalls++; return EffectResult{}, nil }))
	calls := 0
	s.client = &http.Client{Transport: responseTransport(func(request *http.Request) (*http.Response, error) {
		calls++
		require.Equal(t, "{{literal-content}}", request.Header.Get("X-Title"))
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(`{"items":[{"title":"Release"}]}`))}, nil
	})}
	workflow := saveTestWorkflow(t, s, actor, []Step{
		{ID: "shape", Kind: KindCode, Inputs: map[string]Value{"data": literal(nil), "code": literal("return input;")}},
		{ID: "request", Kind: KindHTTP, Inputs: map[string]Value{"method": literal("GET"), "url": literal("https://8.8.8.8/data"), "headers": literal(map[string]any{"X-Title": "{{shape.data.items.0.title}}"})}},
		{ID: "draft", Kind: KindDraft, Inputs: map[string]Value{"text": literal("Must not create a draft")}},
	})
	run, err := s.TestNode(t.Context(), actor, "ws", workflow.ID, WorkflowNodeTestRequest{ExpectedRevision: workflow.Revision, StepID: "request", Data: map[string]any{"source": map[string]any{}, "shape": map[string]any{"data": map[string]any{"items": []any{map[string]any{"title": "{{literal-content}}"}}}}}})
	require.NoError(t, err)
	runJob(t, s, run.ID)
	runJob(t, s, run.ID)
	final, err := s.GetRun(t.Context(), actor, "ws", run.ID)
	require.NoError(t, err)
	require.Equal(t, StateSucceeded, final.State)
	require.Equal(t, ModeTest, final.Mode)
	require.Len(t, final.Steps, 1)
	require.Equal(t, float64(200), final.Steps[0].Output["status"])
	require.Equal(t, 1, calls)
	require.Zero(t, nativeCalls)
	_, err = s.TestNode(t.Context(), actor, "ws", workflow.ID, WorkflowNodeTestRequest{ExpectedRevision: workflow.Revision, StepID: "draft"})
	require.ErrorIs(t, err, ErrInvalid)
}

func TestAIDecisionRoutesAndRecordsEvidence(t *testing.T) {
	for _, probability := range []float64{0.1, 0.9} {
		t.Run(fmt.Sprint(probability), func(t *testing.T) {
			s, actor := workflowTestService(t, nil)
			calls := 0
			s.SetDecisionAI(deciderFunc(func(context.Context, ai.DecisionRequest) (ai.DecisionResult, error) {
				calls++
				return ai.DecisionResult{Probability: probability, Model: "typesafe/jev-1.13", Usage: ai.Usage{InputTokens: 42, TotalTokens: 42}}, nil
			}), "typesafe/jev-1.13")
			workflow := saveTestWorkflow(t, s, actor, []Step{{ID: "decision", Kind: KindAIDecision, Inputs: map[string]Value{"text": literal("A software bug"), "instructions": literal("Does this describe a bug?")}, Then: []Step{{ID: "yes", Kind: KindText, Inputs: map[string]Value{"text": literal("YES"), "operation": literal("lowercase")}}}, Else: []Step{{ID: "no", Kind: KindText, Inputs: map[string]Value{"text": literal("NO"), "operation": literal("lowercase")}}}}})
			run, err := s.Start(t.Context(), actor, "ws", workflow.ID, ModeLive, map[string]any{}, workflow.Revision)
			require.NoError(t, err)
			for range 4 {
				runJob(t, s, run.ID)
			}
			final, err := s.GetRun(t.Context(), actor, "ws", run.ID)
			require.NoError(t, err)
			require.Equal(t, StateSucceeded, final.State)
			require.Len(t, final.Steps, 2)
			expected := "no"
			if probability >= 0.5 {
				expected = "yes"
			}
			require.Equal(t, expected, final.Steps[1].StepID)
			require.Equal(t, probability, final.Steps[0].Output["probability"])
			require.Equal(t, 1, calls)
			var usage usageRecord
			require.NoError(t, s.db.NewSelect().Model(&usage).Where("run_id = ?", run.ID).Scan(t.Context()))
			require.Equal(t, StateSucceeded, usage.State)
			require.Equal(t, int64(42), usage.TotalTokens)
		})
	}
}
