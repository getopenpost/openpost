package workflows

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/stretchr/testify/require"
)

type actionFunc func(context.Context, EffectRequest) (EffectResult, error)

func (f actionFunc) Execute(ctx context.Context, input EffectRequest) (EffectResult, error) {
	return f(ctx, input)
}

type responseTransport func(*http.Request) (*http.Response, error)

func (f responseTransport) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

func workflowTestService(t *testing.T, actions Actions) (*Service, workspaceaccess.ActorFacts) {
	t.Helper()
	db, err := database.InitDBWithDriver("sqlite", fmt.Sprintf("file:workflow-%d?mode=memory&cache=shared", time.Now().UnixNano()))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, database.CreateSchema(db))
	now := time.Now().UTC()
	for _, row := range []any{
		&models.User{ID: "user", Email: "workflow@example.com", PasswordHash: "hash", CreatedAt: now},
		&models.Organization{ID: "org", Name: "Example", CreatedByID: "user", CreatedAt: now, UpdatedAt: now},
		&models.OrganizationMember{OrganizationID: "org", UserID: "user", Role: models.OrganizationRoleOwner, CreatedAt: now},
		&models.Workspace{ID: "ws", OrganizationID: "org", Name: "Workspace", CreatedAt: now},
		&models.WorkspaceMember{WorkspaceID: "ws", UserID: "user", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive, CreatedAt: now},
		&models.UserSession{ID: "session", UserID: "user", CreatedAt: now, LastUsedAt: now, ExpiresAt: now.Add(time.Hour)},
	} {
		_, err := db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}
	return NewService(db, actions, servicecrypto.NewTokenEncryptor("workflow-test")), workspaceaccess.ActorFacts{UserID: "user", SessionID: "session"}
}
func literal(value any) Value      { return Value{Literal: value} }
func reference(value string) Value { return Value{Reference: value} }
func saveTestWorkflow(t *testing.T, s *Service, actor workspaceaccess.ActorFacts, steps []Step) Workflow {
	t.Helper()
	item, err := s.Save(t.Context(), actor, "ws", "", SaveRequest{Name: "Release announcement", Definition: Definition{Schema: 1, Source: Source{Kind: "manual"}, Steps: steps}})
	require.NoError(t, err)
	return item
}
func runJob(t *testing.T, s *Service, id string) {
	t.Helper()
	payload, err := json.Marshal(map[string]string{"run_id": id})
	require.NoError(t, err)
	require.NoError(t, s.HandleJob(t.Context(), jobregistry.TypeWorkflowRun, string(payload)))
}

func TestRunKeepsSavedDefinitionBranchesAndTypedBindingsAcrossRestart(t *testing.T) {
	var calls []EffectRequest
	effect := actionFunc(func(_ context.Context, input EffectRequest) (EffectResult, error) {
		calls = append(calls, input)
		return EffectResult{Output: map[string]any{"id": "post-42", "revision": 7}}, nil
	})
	s, actor := workflowTestService(t, effect)
	workflow := saveTestWorkflow(t, s, actor, []Step{{ID: "filter", Kind: KindCondition, Inputs: map[string]Value{"left": reference("source.title"), "operator": literal("contains"), "right": literal("release")}, Then: []Step{{ID: "draft", Kind: KindDraft, Inputs: map[string]Value{"text": literal("Shipped: {{source.title}}"), "account_ids": reference("source.accounts")}}}, Else: []Step{{ID: "ignored", Kind: KindDraft, Inputs: map[string]Value{"text": literal("wrong branch")}}}}})
	run, err := s.Start(t.Context(), actor, "ws", workflow.ID, ModeLive, map[string]any{"title": "Release 2.0", "accounts": []string{"a", "b"}}, workflow.Revision)
	require.NoError(t, err)
	_, err = s.Save(t.Context(), actor, "ws", workflow.ID, SaveRequest{Name: workflow.Name, ExpectedRevision: workflow.Revision, Definition: Definition{Schema: 1, Source: Source{Kind: "manual"}, Steps: []Step{{ID: "replacement", Kind: KindDraft, Inputs: map[string]Value{"text": literal("edited after start")}}}}})
	require.NoError(t, err)
	runJob(t, s, run.ID)
	restarted := NewService(s.db, effect, s.encryptor)
	runJob(t, restarted, run.ID)
	runJob(t, restarted, run.ID)
	final, err := s.GetRun(t.Context(), actor, "ws", run.ID)
	require.NoError(t, err)
	require.Equal(t, StateSucceeded, final.State)
	require.Len(t, calls, 1)
	require.Equal(t, "Shipped: Release 2.0", calls[0].Inputs["text"])
	require.Equal(t, []any{"a", "b"}, calls[0].Inputs["account_ids"])
	require.Equal(t, "post-42", final.Steps[1].Output["id"])
	require.Equal(t, workflow.Revision, final.WorkflowRevision)
}

func TestPreviewNeverDispatchesNativeEffectsAndMissingFieldsFail(t *testing.T) {
	calls := 0
	s, actor := workflowTestService(t, actionFunc(func(context.Context, EffectRequest) (EffectResult, error) { calls++; return EffectResult{}, nil }))
	workflow := saveTestWorkflow(t, s, actor, []Step{{ID: "draft", Kind: KindDraft, Inputs: map[string]Value{"text": reference("source.body")}}})
	preview, err := s.Start(t.Context(), actor, "ws", workflow.ID, ModePreview, map[string]any{"body": "sample"}, workflow.Revision)
	require.NoError(t, err)
	runJob(t, s, preview.ID)
	final, err := s.GetRun(t.Context(), actor, "ws", preview.ID)
	require.NoError(t, err)
	require.Equal(t, StateSucceeded, final.State)
	require.Equal(t, 0, calls)
	require.Equal(t, true, final.Steps[0].Output["preview"])
	missing, err := s.Start(t.Context(), actor, "ws", workflow.ID, ModeLive, map[string]any{}, workflow.Revision)
	require.NoError(t, err)
	runJob(t, s, missing.ID)
	final, err = s.GetRun(t.Context(), actor, "ws", missing.ID)
	require.NoError(t, err)
	require.Equal(t, StateFailed, final.State)
	require.Contains(t, final.Error, "source.body")
	require.Equal(t, 0, calls)
}

func TestDurableWaitCancelAndRevokedAuthority(t *testing.T) {
	calls := 0
	s, actor := workflowTestService(t, actionFunc(func(context.Context, EffectRequest) (EffectResult, error) { calls++; return EffectResult{}, nil }))
	workflow := saveTestWorkflow(t, s, actor, []Step{{ID: "wait", Kind: KindWait, Inputs: map[string]Value{"minutes": literal(10)}}, {ID: "draft", Kind: KindDraft, Inputs: map[string]Value{"text": literal("later")}}})
	run, err := s.Start(t.Context(), actor, "ws", workflow.ID, ModeLive, map[string]any{}, workflow.Revision)
	require.NoError(t, err)
	runJob(t, s, run.ID)
	waiting, err := s.GetRun(t.Context(), actor, "ws", run.ID)
	require.NoError(t, err)
	require.Equal(t, StateWaiting, waiting.State)
	require.NotNil(t, waiting.WakeAt)
	restarted := NewService(s.db, s.actions, s.encryptor)
	runJob(t, restarted, run.ID)
	require.Equal(t, 0, calls)
	cancelled, err := s.Cancel(t.Context(), actor, "ws", run.ID, waiting.Revision)
	require.NoError(t, err)
	require.Equal(t, StateCancelled, cancelled.State)
	runJob(t, restarted, run.ID)
	require.Equal(t, 0, calls)
	revoked, err := s.Start(t.Context(), actor, "ws", workflow.ID, ModeLive, map[string]any{}, workflow.Revision)
	require.NoError(t, err)
	_, err = s.db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("status = ?", models.WorkspaceMemberStatusInactive).Where("workspace_id = ? AND user_id = ?", "ws", "user").Exec(t.Context())
	require.NoError(t, err)
	runJob(t, restarted, revoked.ID)
	var stored runRecord
	require.NoError(t, s.db.NewSelect().Model(&stored).Where("id = ?", revoked.ID).Scan(t.Context()))
	require.Equal(t, StateFailed, stored.State)
	require.Equal(t, 0, calls)
}

func TestApprovalResumesExactlyOnceWithReviewedRevision(t *testing.T) {
	var scheduled []EffectRequest
	s, actor := workflowTestService(t, actionFunc(func(_ context.Context, input EffectRequest) (EffectResult, error) {
		if input.Kind == KindApproval {
			return EffectResult{Output: map[string]any{"publication_id": "post-1", "revision": 3, "text": "review me"}}, nil
		}
		scheduled = append(scheduled, input)
		return EffectResult{Output: map[string]any{"job_id": "job-1", "renditions": []any{map[string]any{"id": "variant-1", "status": "scheduled"}}}}, nil
	}))
	workflow := saveTestWorkflow(t, s, actor, []Step{{ID: "review", Kind: KindApproval, Inputs: map[string]Value{"publication_id": literal("post-1")}}, {ID: "schedule", Kind: KindSchedule, Inputs: map[string]Value{"publication_id": reference("review.publication_id"), "revision": reference("review.revision"), "minutes": literal(60)}}, {ID: "outcomes", Kind: KindFields, Inputs: map[string]Value{"fields": reference("schedule.renditions.0")}}})
	run, err := s.Start(t.Context(), actor, "ws", workflow.ID, ModeLive, map[string]any{}, workflow.Revision)
	require.NoError(t, err)
	runJob(t, s, run.ID)
	awaiting, err := s.GetRun(t.Context(), actor, "ws", run.ID)
	require.NoError(t, err)
	require.Equal(t, StateApproval, awaiting.State)
	_, err = s.Approve(t.Context(), actor, "ws", run.ID, awaiting.Revision, 3)
	require.NoError(t, err)
	_, err = s.Approve(t.Context(), actor, "ws", run.ID, awaiting.Revision, 3)
	require.ErrorIs(t, err, ErrState)
	restarted := NewService(s.db, s.actions, s.encryptor)
	runJob(t, restarted, run.ID)
	runJob(t, restarted, run.ID)
	require.Len(t, scheduled, 1)
	require.EqualValues(t, 3, scheduled[0].Inputs["revision"])
	final, err := s.GetRun(t.Context(), actor, "ws", run.ID)
	require.NoError(t, err)
	require.Equal(t, StateSucceeded, final.State, final.Error)
	require.Equal(t, map[string]any{"id": "variant-1", "status": "scheduled"}, final.Steps[2].Output)
}

func TestSourceBaselineDeduplicationAndSampleDoNotAdmitOldItems(t *testing.T) {
	s, actor := workflowTestService(t, nil)
	rss := `<rss version="2.0"><channel><title>Updates</title><item><guid>old</guid><title>Old</title><description>Earlier</description></item></channel></rss>`
	s.client = &http.Client{Transport: responseTransport(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(rss)), Header: make(http.Header)}, nil
	})}
	workflow := saveTestWorkflow(t, s, actor, []Step{{ID: "draft", Kind: KindDraft, Inputs: map[string]Value{"text": reference("source.body")}}})
	workflow.Definition.Source = Source{Kind: "rss", URL: "https://8.8.8.8/feed"}
	workflow, err := s.Save(t.Context(), actor, "ws", workflow.ID, SaveRequest{Name: workflow.Name, ExpectedRevision: workflow.Revision, Definition: workflow.Definition})
	require.NoError(t, err)
	workflow, err = s.Publish(t.Context(), actor, "ws", workflow.ID, workflow.Revision)
	require.NoError(t, err)
	payload := fmt.Sprintf(`{"workflow_id":%q}`, workflow.ID)
	require.NoError(t, s.HandleJob(t.Context(), jobregistry.TypeWorkflowPoll, payload))
	rss = strings.Replace(rss, "</channel>", `<item><guid>new</guid><title>New</title><description><![CDATA[<p>Hello <strong>world</strong></p>]]></description></item></channel>`, 1)
	_, err = s.Sample(t.Context(), actor, "ws", workflow.Definition.Source)
	require.NoError(t, err)
	before, err := s.Runs(t.Context(), actor, "ws", workflow.ID)
	require.NoError(t, err)
	require.Empty(t, before)
	require.NoError(t, s.HandleJob(t.Context(), jobregistry.TypeWorkflowPoll, payload))
	require.NoError(t, s.HandleJob(t.Context(), jobregistry.TypeWorkflowPoll, payload))
	after, err := s.Runs(t.Context(), actor, "ws", workflow.ID)
	require.NoError(t, err)
	require.Len(t, after, 1)
	require.Equal(t, "new", after[0].Source["id"])
	require.Equal(t, "Hello world", after[0].Source["body"])
}

func TestDraftConflictScopeAndConnectionSecrecy(t *testing.T) {
	s, actor := workflowTestService(t, nil)
	workflow := saveTestWorkflow(t, s, actor, nil)
	_, err := s.Save(t.Context(), actor, "ws", workflow.ID, SaveRequest{Name: "New name", ExpectedRevision: workflow.Revision, Definition: workflow.Definition})
	require.NoError(t, err)
	_, err = s.Save(t.Context(), actor, "ws", workflow.ID, SaveRequest{Name: "Stale tab", ExpectedRevision: workflow.Revision, Definition: workflow.Definition})
	require.ErrorIs(t, err, ErrConflict)
	scoped := actor
	scoped.CredentialWorkspaceID = "other"
	_, err = s.List(t.Context(), scoped, "ws")
	require.ErrorIs(t, err, ErrAccess)
	connection, err := s.SaveConnection(t.Context(), actor, "ws", "GitHub", "github-secret-token")
	require.NoError(t, err)
	list, err := s.Connections(t.Context(), actor, "ws")
	require.NoError(t, err)
	encoded, err := json.Marshal(list)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "secret")
	var stored connectionRecord
	require.NoError(t, s.db.NewSelect().Model(&stored).Where("id = ?", connection.ID).Scan(t.Context()))
	require.NotContains(t, string(stored.Ciphertext), "github-secret-token")
	var count int
	require.NoError(t, s.db.NewSelect().Model((*models.Publication)(nil)).ColumnExpr("COUNT(*)").Scan(t.Context(), &count))
	require.Zero(t, count)
}

func TestSourceActivationIncludesItemsBeforeFirstWorkerPoll(t *testing.T) {
	s, actor := workflowTestService(t, nil)
	rss := `<rss version="2.0"><channel><title>Feed</title><item><guid>old</guid><title>Old</title></item></channel></rss>`
	s.client = &http.Client{Transport: responseTransport(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(rss)), Header: make(http.Header)}, nil
	})}
	workflow := saveTestWorkflow(t, s, actor, []Step{{ID: "wait", Kind: KindWait, Inputs: map[string]Value{"minutes": literal(1)}}})
	workflow.Definition.Source = Source{Kind: "rss", URL: "https://8.8.8.8/feed"}
	workflow, err := s.Save(t.Context(), actor, "ws", workflow.ID, SaveRequest{Name: workflow.Name, ExpectedRevision: workflow.Revision, Definition: workflow.Definition})
	require.NoError(t, err)
	workflow, err = s.Publish(t.Context(), actor, "ws", workflow.ID, workflow.Revision)
	require.NoError(t, err)
	rss = strings.Replace(rss, "</channel>", `<item><guid>after-activation</guid><title>New</title></item></channel>`, 1)
	require.NoError(t, s.HandleJob(t.Context(), jobregistry.TypeWorkflowPoll, fmt.Sprintf(`{"workflow_id":%q}`, workflow.ID)))
	runs, err := s.Runs(t.Context(), actor, "ws", workflow.ID)
	require.NoError(t, err)
	require.Len(t, runs, 1)
	require.Equal(t, "after-activation", runs[0].Source["id"])
}

func TestPublishedSourceDrainsBacklogBeyondOnePage(t *testing.T) {
	s, actor := workflowTestService(t, nil)
	workflow := saveTestWorkflow(t, s, actor, []Step{{ID: "wait", Kind: KindWait, Inputs: map[string]Value{"minutes": literal(1)}}})
	workflow.Definition.Source = Source{Kind: "rendition_published"}
	workflow, err := s.Save(t.Context(), actor, "ws", workflow.ID, SaveRequest{Name: workflow.Name, ExpectedRevision: workflow.Revision, Definition: workflow.Definition})
	require.NoError(t, err)
	workflow, err = s.Publish(t.Context(), actor, "ws", workflow.ID, workflow.Revision)
	require.NoError(t, err)
	now := time.Now().UTC()
	_, err = s.db.NewInsert().Model(&models.SocialAccount{ID: "account", WorkspaceID: "ws", Platform: "mastodon", AccountID: "account", AccountUsername: "example", AccessTokenEnc: []byte("test-token"), CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = s.db.NewInsert().Model(&models.Publication{ID: "publication", WorkspaceID: "ws", Status: "published", CreatedAt: now, UpdatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	for i := range 501 {
		id := fmt.Sprintf("rendition-%04d", i)
		_, err = s.db.NewInsert().Model(&models.Rendition{ID: id, PublicationID: "publication", SocialAccountID: "account", TargetKey: id, Platform: "mastodon", Status: models.RenditionStatusPublished, CreatedAt: now, UpdatedAt: now}).Exec(t.Context())
		require.NoError(t, err)
		_, err = s.db.NewInsert().Model(&models.PublicationLifecycleEvent{ID: id, WorkspaceID: "ws", PublicationID: "publication", RenditionID: id, Type: "published", CreatedAt: now}).Exec(t.Context())
		require.NoError(t, err)
	}
	for range 3 {
		require.NoError(t, s.HandleJob(t.Context(), jobregistry.TypeWorkflowPoll, fmt.Sprintf(`{"workflow_id":%q}`, workflow.ID)))
	}
	count, err := s.db.NewSelect().Model((*runRecord)(nil)).Where("workflow_id = ?", workflow.ID).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 501, count)
}

func TestCancelDuringNativeEffectKeepsItsOutcomeAndStopsNextStep(t *testing.T) {
	s, actor := workflowTestService(t, nil)
	calls := 0
	s.SetActions(actionFunc(func(ctx context.Context, input EffectRequest) (EffectResult, error) {
		calls++
		run, err := s.GetRun(ctx, actor, "ws", input.RunID)
		require.NoError(t, err)
		_, err = s.Cancel(ctx, actor, "ws", run.ID, run.Revision)
		require.NoError(t, err)
		return EffectResult{Output: map[string]any{"id": "accepted-post"}}, nil
	}))
	workflow := saveTestWorkflow(t, s, actor, []Step{{ID: "first", Kind: KindDraft, Inputs: map[string]Value{"text": literal("First")}}, {ID: "second", Kind: KindDraft, Inputs: map[string]Value{"text": literal("Second")}}})
	run, err := s.Start(t.Context(), actor, "ws", workflow.ID, ModeLive, map[string]any{}, workflow.Revision)
	require.NoError(t, err)
	runJob(t, s, run.ID)
	runJob(t, s, run.ID)
	final, err := s.GetRun(t.Context(), actor, "ws", run.ID)
	require.NoError(t, err)
	require.Equal(t, StateCancelled, final.State)
	require.Equal(t, 1, calls)
	require.Equal(t, "accepted-post", final.Steps[0].Output["id"])
}

func TestGitHubSampleHandlesRepositoriesWithLargeReleaseHistories(t *testing.T) {
	s, actor := workflowTestService(t, nil)
	s.client = &http.Client{Transport: responseTransport(func(req *http.Request) (*http.Response, error) {
		count, err := strconv.Atoi(req.URL.Query().Get("per_page"))
		require.NoError(t, err)
		releases := make([]map[string]any, count)
		for i := range releases {
			releases[i] = map[string]any{"id": i + 1, "name": fmt.Sprintf("Release %d", i+1), "body": "Release notes", "assets": strings.Repeat("x", 32*1024)}
		}
		data, err := json.Marshal(releases)
		require.NoError(t, err)
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(string(data))), Header: make(http.Header)}, nil
	})}
	items, err := s.Sample(t.Context(), actor, "ws", Source{Kind: "github_release", Repository: "example/releases"})
	require.NoError(t, err)
	require.Len(t, items, 5)
	require.Equal(t, "Release 1", items[0].Title)
	require.Equal(t, "Release notes", items[0].Body)
}

func TestGitHubPollReconcilesPagesWithoutReplayingKnownReleases(t *testing.T) {
	s, actor := workflowTestService(t, nil)
	now := time.Now().UTC()
	var expanded bool
	s.client = &http.Client{Transport: responseTransport(func(req *http.Request) (*http.Response, error) {
		page := req.URL.Query().Get("page")
		releases := make([]map[string]any, 0, 10)
		count := 10
		if page == "3" {
			count = 1
		}
		for i := range count {
			id := i + 1
			date := now.Add(-time.Hour)
			if expanded && page == "2" {
				id += 100
				date = time.Now().UTC().Add(time.Second)
			}
			if expanded && page == "3" {
				id += 200
				date = time.Now().UTC().Add(time.Second)
			}
			releases = append(releases, map[string]any{"id": id, "name": fmt.Sprintf("Release %d", id), "body": "Release notes", "published_at": date.Format(time.RFC3339)})
		}
		data, err := json.Marshal(releases)
		require.NoError(t, err)
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(data))), Header: make(http.Header)}, nil
	})}
	workflow := saveTestWorkflow(t, s, actor, []Step{{ID: "wait", Kind: KindWait, Inputs: map[string]Value{"minutes": literal(1)}}})
	workflow.Definition.Source = Source{Kind: "github_release", Repository: "example/releases"}
	workflow, err := s.Save(t.Context(), actor, "ws", workflow.ID, SaveRequest{Name: workflow.Name, ExpectedRevision: workflow.Revision, Definition: workflow.Definition})
	require.NoError(t, err)
	workflow, err = s.Publish(t.Context(), actor, "ws", workflow.ID, workflow.Revision)
	require.NoError(t, err)
	expanded = true
	for range 3 {
		require.NoError(t, s.HandleJob(t.Context(), jobregistry.TypeWorkflowPoll, fmt.Sprintf(`{"workflow_id":%q}`, workflow.ID)))
	}
	count, err := s.db.NewSelect().Model((*runRecord)(nil)).Where("workflow_id = ?", workflow.ID).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 11, count)
}

func TestDeletedConnectionCannotBeSavedFromStaleEditor(t *testing.T) {
	s, actor := workflowTestService(t, nil)
	connection, err := s.SaveConnection(t.Context(), actor, "ws", "Private releases", "github-secret-token")
	require.NoError(t, err)
	workflow := saveTestWorkflow(t, s, actor, nil)
	require.NoError(t, s.DeleteConnection(t.Context(), actor, "ws", connection.ID))
	workflow.Definition.Source = Source{Kind: "github_release", Repository: "example/private", ConnectionID: connection.ID}
	_, err = s.Save(t.Context(), actor, "ws", workflow.ID, SaveRequest{Name: workflow.Name, ExpectedRevision: workflow.Revision, Definition: workflow.Definition})
	require.ErrorIs(t, err, ErrInvalid)
}

func TestGitHubAdmitsUnseenReleaseWithinActivationSecond(t *testing.T) {
	s, actor := workflowTestService(t, nil)
	releases := `[]`
	s.client = &http.Client{Transport: responseTransport(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(releases)), Header: make(http.Header)}, nil
	})}
	workflow := saveTestWorkflow(t, s, actor, []Step{{ID: "wait", Kind: KindWait, Inputs: map[string]Value{"minutes": literal(1)}}})
	workflow.Definition.Source = Source{Kind: "github_release", Repository: "example/releases"}
	workflow, err := s.Save(t.Context(), actor, "ws", workflow.ID, SaveRequest{Name: workflow.Name, ExpectedRevision: workflow.Revision, Definition: workflow.Definition})
	require.NoError(t, err)
	workflow, err = s.Publish(t.Context(), actor, "ws", workflow.ID, workflow.Revision)
	require.NoError(t, err)
	stored, err := s.loadWorkflow(t.Context(), "ws", workflow.ID)
	require.NoError(t, err)
	releases = fmt.Sprintf(`[{"id":42,"name":"New release","published_at":%q}]`, stored.SourceStartedAt.Format(time.RFC3339))
	require.NoError(t, s.HandleJob(t.Context(), jobregistry.TypeWorkflowPoll, fmt.Sprintf(`{"workflow_id":%q}`, workflow.ID)))
	runs, err := s.Runs(t.Context(), actor, "ws", workflow.ID)
	require.NoError(t, err)
	require.Len(t, runs, 1)
}

func TestSourceAdmitsAvailableCapacityAndKeepsRemainingEvents(t *testing.T) {
	s, actor := workflowTestService(t, nil)
	rss := `<rss version="2.0"><channel><title>Feed</title></channel></rss>`
	s.client = &http.Client{Transport: responseTransport(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(rss)), Header: make(http.Header)}, nil
	})}
	workflow := saveTestWorkflow(t, s, actor, []Step{{ID: "wait", Kind: KindWait, Inputs: map[string]Value{"minutes": literal(1)}}})
	workflow.Definition.Source = Source{Kind: "rss", URL: "https://8.8.8.8/feed"}
	workflow, err := s.Save(t.Context(), actor, "ws", workflow.ID, SaveRequest{Name: workflow.Name, ExpectedRevision: workflow.Revision, Definition: workflow.Definition})
	require.NoError(t, err)
	workflow, err = s.Publish(t.Context(), actor, "ws", workflow.ID, workflow.Revision)
	require.NoError(t, err)
	// Persist active runs as the pre-existing workload, then exercise public polling.
	rows := make([]runRecord, 999)
	now := time.Now().UTC()
	for i := range rows {
		rows[i] = runRecord{ID: fmt.Sprintf("existing-%d", i), WorkflowID: workflow.ID, WorkspaceID: "ws", State: StateApproval, Mode: ModeLive, DefinitionJSON: "{}", AuthorityJSON: "{}", SourceJSON: "{}", RemainingJSON: "[]", ResultsJSON: "[]", CreatedAt: now, UpdatedAt: now}
	}
	_, err = s.db.NewInsert().Model(&rows).Exec(t.Context())
	require.NoError(t, err)
	rss = strings.Replace(rss, "</channel>", `<item><guid>one</guid><title>One</title></item><item><guid>two</guid><title>Two</title></item></channel>`, 1)
	poll := func() {
		require.NoError(t, s.HandleJob(t.Context(), jobregistry.TypeWorkflowPoll, fmt.Sprintf(`{"workflow_id":%q}`, workflow.ID)))
	}
	poll()
	count, err := s.db.NewSelect().Model((*runRecord)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1000, count)
	_, err = s.db.NewUpdate().Model((*runRecord)(nil)).Set("state = ?", StateCancelled).Where("id = ?", "existing-0").Exec(t.Context())
	require.NoError(t, err)
	poll()
	count, err = s.db.NewSelect().Model((*runRecord)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1001, count)
}

func TestConditionMatchesTypedOutputAgainstAuthoredScalarText(t *testing.T) {
	for _, value := range []any{float64(10), true} {
		t.Run(fmt.Sprint(value), func(t *testing.T) {
			s, actor := workflowTestService(t, nil)
			workflow := saveTestWorkflow(t, s, actor, []Step{{ID: "compare", Kind: KindCondition, Inputs: map[string]Value{"left": reference("source.value"), "operator": literal("equals"), "right": literal(fmt.Sprint(value))}, Then: []Step{{ID: "matched", Kind: KindDraft, Inputs: map[string]Value{"text": literal("Matched")}}}}})
			run, err := s.Start(t.Context(), actor, "ws", workflow.ID, ModePreview, map[string]any{"value": value}, workflow.Revision)
			require.NoError(t, err)
			runJob(t, s, run.ID)
			runJob(t, s, run.ID)
			result, err := s.GetRun(t.Context(), actor, "ws", run.ID)
			require.NoError(t, err)
			require.Len(t, result.Steps, 2)
			require.Equal(t, "Matched", result.Steps[1].Output["text"])
		})
	}
}

func TestExpiredWaitResumesOnceAfterRestart(t *testing.T) {
	calls := 0
	s, actor := workflowTestService(t, actionFunc(func(context.Context, EffectRequest) (EffectResult, error) {
		calls++
		return EffectResult{Output: map[string]any{"id": "draft"}}, nil
	}))
	workflow := saveTestWorkflow(t, s, actor, []Step{{ID: "wait", Kind: KindWait, Inputs: map[string]Value{"minutes": literal(10)}}, {ID: "draft", Kind: KindDraft, Inputs: map[string]Value{"text": literal("After the restart")}}})
	run, err := s.Start(t.Context(), actor, "ws", workflow.ID, ModeLive, map[string]any{}, workflow.Revision)
	require.NoError(t, err)
	runJob(t, s, run.ID)
	waiting, err := s.GetRun(t.Context(), actor, "ws", run.ID)
	require.NoError(t, err)
	require.Equal(t, StateWaiting, waiting.State)
	waiting.Steps[0].StartedAt = time.Now().UTC().Add(-11 * time.Minute)
	results, err := json.Marshal(waiting.Steps)
	require.NoError(t, err)
	_, err = s.db.NewUpdate().Model((*runRecord)(nil)).Set("results_json = ?, wake_at = ?", string(results), time.Now().UTC().Add(-time.Minute)).Where("id = ?", run.ID).Exec(t.Context())
	require.NoError(t, err)
	restarted := NewService(s.db, s.actions, s.encryptor)
	for range 4 {
		runJob(t, restarted, run.ID)
	}
	final, err := restarted.GetRun(t.Context(), actor, "ws", run.ID)
	require.NoError(t, err)
	require.Equal(t, StateSucceeded, final.State)
	require.Equal(t, 1, calls)
}

func TestWorkflowRejectsBrokenTokensBeforeStarting(t *testing.T) {
	s, actor := workflowTestService(t, nil)
	for _, text := range []string{"Hello {{source.title", "Hello {{source.title + 1}}"} {
		item := saveTestWorkflow(t, s, actor, []Step{{ID: "draft", Kind: KindDraft, Inputs: map[string]Value{"text": literal(text)}}})
		_, err := s.Start(t.Context(), actor, "ws", item.ID, ModePreview, map[string]any{"title": "Release"}, item.Revision)
		require.ErrorIs(t, err, ErrInvalid)
	}
}

func TestWorkflowTransformsFeedItemsBeforeCreatingContent(t *testing.T) {
	s, actor := workflowTestService(t, nil)
	item := saveTestWorkflow(t, s, actor, []Step{
		{ID: "parse", Kind: "parse_json", Inputs: map[string]Value{"text": reference("source.body")}},
		{ID: "limit", Kind: "list_limit", Inputs: map[string]Value{"items": reference("parse.data"), "limit": literal(2)}},
		{ID: "code", Kind: "code", Inputs: map[string]Value{"data": reference("limit.items"), "code": literal("return { text: input.map(item => item.title).join(' | ') };")}},
		{ID: "draft", Kind: KindDraft, Inputs: map[string]Value{"text": reference("code.data.text")}},
	})
	run, err := s.Start(t.Context(), actor, "ws", item.ID, ModePreview, map[string]any{"body": `[{"title":"Release"},{"title":"Behind the scenes"},{"title":"Later"}]`}, item.Revision)
	require.NoError(t, err)
	for range 4 {
		runJob(t, s, run.ID)
	}
	result, err := s.GetRun(t.Context(), actor, "ws", run.ID)
	require.NoError(t, err)
	require.Equal(t, StateSucceeded, result.State, result.Error)
	require.Equal(t, "Release | Behind the scenes", result.Steps[3].Inputs["text"])
}
