package workflows

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestScheduleRequiresMatchingReviewedPublication(t *testing.T) {
	for _, changed := range []string{"publication", "revision"} {
		t.Run(changed, func(t *testing.T) {
			calls := 0
			s, actor := workflowTestService(t, actionFunc(func(_ context.Context, in EffectRequest) (EffectResult, error) {
				if in.Kind == KindApproval {
					return EffectResult{Output: map[string]any{"publication_id": "post-a", "revision": 3}}, nil
				}
				calls++
				return EffectResult{}, nil
			}))
			post, rev := "post-a", 3
			if changed == "publication" {
				post = "post-b"
			} else {
				rev = 4
			}
			w := saveTestWorkflow(t, s, actor, []Step{{ID: "review", Kind: KindApproval, Inputs: map[string]Value{"publication_id": literal("post-a")}}, {ID: "schedule", Kind: KindSchedule, Inputs: map[string]Value{"publication_id": literal(post), "revision": literal(rev), "minutes": literal(60)}}})
			r, err := s.Start(t.Context(), actor, "ws", w.ID, ModeLive, map[string]any{}, w.Revision)
			require.NoError(t, err)
			runJob(t, s, r.ID)
			r, err = s.GetRun(t.Context(), actor, "ws", r.ID)
			require.NoError(t, err)
			_, err = s.Approve(t.Context(), actor, "ws", r.ID, r.Revision, 3)
			require.NoError(t, err)
			s = NewService(s.db, s.actions, s.encryptor)
			runJob(t, s, r.ID)
			r, err = s.GetRun(t.Context(), actor, "ws", r.ID)
			require.NoError(t, err)
			require.Equal(t, StateFailed, r.State)
			require.Equal(t, "schedule requires approval of this publication and revision in this run", r.Error)
			require.Zero(t, calls)
		})
	}
}
func TestHTTPResponseRedactsEncodedCredentials(t *testing.T) {
	secret := "private/+ token\"value"
	quoted, _ := json.Marshal(secret)
	for _, encoded := range []string{url.QueryEscape(secret), url.PathEscape(secret), hex.EncodeToString([]byte(secret)), string(quoted[1 : len(quoted)-1])} {
		t.Run(encoded, func(t *testing.T) {
			resp := &http.Response{StatusCode: 200, Header: http.Header{"Etag": []string{encoded}}, Body: io.NopCloser(strings.NewReader(encoded))}
			out, err := decodeHTTPResponse(resp, secret, "text")
			require.NoError(t, err)
			require.Equal(t, "[redacted]", out["body"])
			require.Equal(t, "[redacted]", out["headers"].(map[string]string)["ETag"])
		})
	}
}
func TestHTTPRejectsInlineCredentialsBeforeSavingAndResolvedDispatch(t *testing.T) {
	for _, inputs := range []map[string]any{
		{"url": "https://8.8.8.8/?access_token=private"},
		{"url": "https://8.8.8.8/?access_token=&access_token=private"},
		{"url": "https://8.8.8.8/", "query": map[string]any{"api-key": "private"}},
		{"url": "https://8.8.8.8/", "body": `{"auth":{"password":"private"}}`},
		{"url": "https://8.8.8.8/", "body": "access_token=private"},
		{"url": "https://8.8.8.8/", "headers": map[string]any{"X_API_KEY": "private"}},
		{"url": "https://8.8.8.8/", "headers": map[string]any{"X-API_Key": "private"}},
		{"url": "https://8.8.8.8/", "headers": map[string]any{"X.API.KEY": "private"}},
	} {
		t.Run(inputs["url"].(string), func(t *testing.T) {
			s, actor := workflowTestService(t, nil)
			bindings := map[string]Value{"method": literal("POST")}
			inputs["method"] = "POST"
			for k, v := range inputs {
				bindings[k] = literal(v)
			}
			_, err := s.Save(t.Context(), actor, "ws", "", SaveRequest{Name: "Secret", Definition: Definition{Schema: 1, Source: Source{Kind: "manual"}, Steps: []Step{{ID: "http", Kind: KindHTTP, Inputs: bindings}}}})
			assert.ErrorContains(t, err, "Connections")
			resolved := map[string]Value{}
			for k := range inputs {
				resolved[k] = reference("source." + k)
			}
			workflow := saveTestWorkflow(t, s, actor, []Step{{ID: "http", Kind: KindHTTP, Inputs: resolved}})
			calls := 0
			s.client = &http.Client{Transport: responseTransport(func(*http.Request) (*http.Response, error) {
				calls++
				return nil, errors.New("inline credential request must not dispatch")
			})}
			run, err := s.Start(t.Context(), actor, "ws", workflow.ID, ModeLive, inputs, workflow.Revision)
			require.NoError(t, err)
			runJob(t, s, run.ID)
			final, err := s.GetRun(t.Context(), actor, "ws", run.ID)
			require.NoError(t, err)
			require.Equal(t, StateFailed, final.State)
			require.Contains(t, final.Error, "Connections")
			require.Zero(t, calls)
		})
	}
}

func TestWorkflowAIBudgetCountsFailedCalls(t *testing.T) {
	s, actor := workflowTestService(t, nil)
	calls := 0
	s.SetAI(generatorFunc(func(context.Context, ai.GenerateRequest) (ai.GenerateResult, error) {
		calls++
		return ai.GenerateResult{}, errors.New("provider failed")
	}), "model")
	s.SetAILimits(true, 1)
	w := saveTestWorkflow(t, s, actor, []Step{{ID: "ai", Kind: KindAIText, Inputs: map[string]Value{"text": literal("hello"), "instructions": literal("rewrite")}}})
	run := func() {
		r, err := s.Start(t.Context(), actor, "ws", w.ID, ModeLive, map[string]any{}, w.Revision)
		require.NoError(t, err)
		runJob(t, s, r.ID)
	}
	run()
	run()
	require.Equal(t, 1, calls)
	s.SetAILimits(false, 0)
	run()
	require.Equal(t, 1, calls)
	s.SetAILimits(true, 0)
	run()
	require.Equal(t, 2, calls)
}

func TestAutomaticRenditionSourcesExcludeWorkflowCreatedPosts(t *testing.T) {
	for _, kind := range []string{"rendition_published", "rendition_failed"} {
		t.Run(kind, func(t *testing.T) {
			s, actor := workflowTestService(t, nil)
			w := saveTestWorkflow(t, s, actor, []Step{{ID: "wait", Kind: KindWait, Inputs: map[string]Value{"minutes": literal(0)}}})
			w.Definition.Source = Source{Kind: kind}
			w, err := s.Save(t.Context(), actor, "ws", w.ID, SaveRequest{Name: w.Name, ExpectedRevision: w.Revision, Definition: w.Definition})
			require.NoError(t, err)
			w, err = s.Publish(t.Context(), actor, "ws", w.ID, w.Revision)
			require.NoError(t, err)
			now := time.Now().UTC()
			for _, origin := range []string{"web", "autopost"} {
				_, err = s.db.NewInsert().Model(&models.Publication{ID: origin, WorkspaceID: "ws", CreatedByID: "user", CreationSource: origin, CreatedAt: now, UpdatedAt: now}).Exec(t.Context())
				require.NoError(t, err)
				_, err = s.db.NewInsert().Model(&models.Rendition{ID: origin, PublicationID: origin, Status: models.RenditionStatusPublished, CreatedAt: now, UpdatedAt: now}).Exec(t.Context())
				require.NoError(t, err)
				event := "published"
				if kind == "rendition_failed" {
					event = "failed"
				}
				_, err = s.db.NewInsert().Model(&models.PublicationLifecycleEvent{ID: origin, WorkspaceID: "ws", PublicationID: origin, RenditionID: origin, Type: event, CreatedAt: now}).Exec(t.Context())
				require.NoError(t, err)
			}
			require.NoError(t, s.HandleJob(t.Context(), jobregistry.TypeWorkflowPoll, fmt.Sprintf(`{"workflow_id":%q}`, w.ID)))
			runs, err := s.Runs(t.Context(), actor, "ws", w.ID)
			require.NoError(t, err)
			require.Len(t, runs, 1)
			require.Equal(t, "web", runs[0].Source["publication_id"])
		})
	}
}
