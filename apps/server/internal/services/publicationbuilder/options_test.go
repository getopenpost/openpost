package publicationbuilder

import (
	"context"
	"encoding/json"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/memes"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/screenshottemplates"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type decisionFunc func(context.Context, ai.DecisionRequest) (ai.DecisionResult, error)

func TestFourPostFailureStaysPendingWhileDurableRetryIsRunnable(t *testing.T) {
	t.Parallel()
	db := newBuilderApplicationTestDB(t)
	app, err := NewApplication(db, packageBuilderFunc(func(context.Context, BuildInput) (BuildResult, error) {
		return BuildResult{}, nil
	}), ApplicationConfig{})
	require.NoError(t, err)
	request := testBuildRequest(time.Now(), "four-options-retry-state")
	request.Input.OptionCount = 4
	build, _, err := app.Enqueue(t.Context(), request)
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*BuildRecord)(nil)).Set("state = ?", BuildStateFailed).
		Set("error_code = 'review_rejected'").Set("error_message = 'Retry this build.'").Where("id = ?", build.ID).Exec(t.Context())
	require.NoError(t, err)
	pending, err := app.Get(t.Context(), "user-1", build.ID)
	require.NoError(t, err)
	require.Equal(t, BuildStateQueued, pending.State, "the UI must keep polling while a durable retry is runnable")
	require.Empty(t, pending.ErrorMessage)
	_, err = db.NewUpdate().Model((*models.Job)(nil)).Set("status = ?", jobregistry.StatusFailed).Where("type = ?", jobregistry.TypePublicationBuild).Exec(t.Context())
	require.NoError(t, err)
	failed, err := app.Get(t.Context(), "user-1", build.ID)
	require.NoError(t, err)
	require.Equal(t, BuildStateFailed, failed.State)
	require.Equal(t, "Retry this build.", failed.ErrorMessage)
}

func (fn decisionFunc) Decide(ctx context.Context, request ai.DecisionRequest) (ai.DecisionResult, error) {
	return fn(ctx, request)
}

func TestFourPostBuildRepairsBrokenMemeAndRetainsDecisionUsage(t *testing.T) {
	t.Parallel()
	provider, err := memes.NewBuiltinProvider()
	require.NoError(t, err)
	writerCalls := 0
	decisionCalls := 0
	service, err := New(generationFunc(func(_ context.Context, request ai.GenerateRequest) (ai.GenerateResult, error) {
		var value any
		switch request.ResponseSchema.Name {
		case "openpost_four_post_directions":
			require.Contains(t, request.UserPrompt, `"id":"drake"`)
			require.Contains(t, request.UserPrompt, `"id":"3hd"`)
			require.Contains(t, request.UserPrompt, `"language":"Portuguese"`)
			options := make([]plannedOption, 4)
			for i := range options {
				media := MediaPlan{Treatment: "none", Role: "none", Brief: "Text is sufficient."}
				if i == 1 {
					media = MediaPlan{Treatment: "meme", Role: "punchline", Brief: "Reject more code and prefer fewer lines.", TemplateID: "drake"}
				}
				options[i] = plannedOption{Label: []string{"The result", "The preference", "The confession", "The observation"}[i], Direction: DirectorPlan{CanonicalText: "I deleted 15,000 lines.", FactualKernel: []string{"The author deleted 15,000 lines."}, Thesis: "Less code delivered more features.", Outcome: "shares", Audience: "engineers", Angle: "less code", Route: "artifact_led", Media: media, Destinations: []DestinationDecision{{AccountID: "x-1", Include: true, Reason: "Fits the selected audience."}}}}
			}
			value = optionDirections{Options: options}
		case "openpost_four_complete_posts":
			writerCalls++
			require.NotEmpty(t, request.Images, "the writer must inspect the selected visual")
			options := make([]PostOption, 4)
			for i, body := range []string{"I deleted 15,000 lines. The product has more features now.", "", "Apparently my best feature this week was the delete key.", "15,000 fewer lines. Somehow, more product."} {
				media := MediaPlan{Treatment: "none", Role: "none", Brief: "Text is sufficient."}
				if i == 1 {
					captions := []string{"more code", "more features"}
					if writerCalls == 1 {
						captions = captions[:1]
					}
					media = MediaPlan{Treatment: "meme", Role: "punchline", Brief: "Reject more code and prefer fewer lines.", TemplateID: "drake", Document: &screenshottemplates.ScreenshotTemplateDocument{SchemaVersion: 1, TemplateID: "meme", Title: "More features", Appearance: "light", Frame: "natural", TextSize: "normal", Meme: &screenshottemplates.ScreenshotTemplateMeme{TemplateID: "drake", Name: "Drake", Captions: captions, Format: "png", OverlayMediaIDs: []string{}}}}
				}
				options[i] = PostOption{Destinations: []DestinationPlan{{AccountID: "x-1", Objective: "shares", Archetype: "artifact_joke", OutputProfile: "x.short_text", Preview: "More features, less code.", Segments: []SegmentPlan{{Body: body}}, Media: media}}}
			}
			value = optionOutput{Options: options}
		case "openpost_four_post_review":
			return ai.GenerateResult{Text: `{"approved":true,"issue":""}`}, nil
		default:
			t.Fatalf("unexpected generation schema: %s", request.ResponseSchema.Name)
		}
		data, err := json.Marshal(value)
		require.NoError(t, err)
		return ai.GenerateResult{Text: string(data), Model: "writer", RequestID: "write", Usage: ai.Usage{InputTokens: 10, OutputTokens: 20, TotalTokens: 30}}, nil
	}), Config{Model: "writer", Memes: provider, DecisionModel: "configured-decision-model", Decider: decisionFunc(func(_ context.Context, request ai.DecisionRequest) (ai.DecisionResult, error) {
		decisionCalls++
		require.Equal(t, "configured-decision-model", request.Model)
		require.Contains(t, request.Input, "more features")
		return ai.DecisionResult{Probability: 0.9, Model: "configured-decision-model", RequestID: "decision-1", Usage: ai.Usage{InputTokens: 3, OutputTokens: 1, TotalTokens: 4}}, nil
	})})
	require.NoError(t, err)
	ctx, trace := withGenerationTrace(t.Context())
	result, err := service.Build(ctx, BuildInput{OptionCount: 4, Idea: "I deleted 15,000 lines and the product has more features now.", DestinationPolicy: DestinationPolicyRequireAll, Destinations: []Destination{{AccountID: "x-1", Platform: "x", Voice: VoiceSnapshot{Definition: VoiceDefinition{Language: "Portuguese"}}, AllowedOutputProfiles: []OutputProfile{{Key: "x.short_text", TextLimit: 280, MaxSegments: 1, MediaMaxCount: 4, AllowedMIMEs: []string{"image/*"}}}}}})
	require.NoError(t, err)
	require.Len(t, result.Options, 4)
	require.Equal(t, "", result.Options[1].Destinations[0].Segments[0].Body, "a visual can carry the complete post")
	require.Len(t, result.Options[1].Destinations[0].Media.Document.Meme.Captions, 2)
	require.Equal(t, 2, writerCalls, "repair only the invalid generation stage")
	require.Equal(t, 1, decisionCalls, "do not pay for decision review of invalid output")
	_, _, usage := trace.encoded()
	require.Contains(t, usage, "decision-1")
	require.Contains(t, usage, `"total_tokens":94`)
}

func TestFourPostProviderRequestsShareSeriousReleaseContextThroughPlannerRepairWriterAndCritique(t *testing.T) {
	t.Parallel()
	plannerCalls := 0
	service, err := New(generationFunc(func(_ context.Context, request ai.GenerateRequest) (ai.GenerateResult, error) {
		var value any
		switch request.ResponseSchema.Name {
		case "openpost_four_post_directions":
			plannerCalls++
			require.Contains(t, request.SystemPrompt, "Serious releases and technical updates")
			require.Contains(t, request.UserPrompt, `"id":"release-notes"`)
			require.Contains(t, request.UserPrompt, `"outcome":"Help existing users configure the integration safely"`)
			require.Contains(t, request.UserPrompt, `"platform":"linkedin"`)
			require.Contains(t, request.UserPrompt, `"platform":"x"`)
			require.Contains(t, request.UserPrompt, `"platform":"bluesky"`)
			if plannerCalls == 2 {
				require.Contains(t, request.UserPrompt, `"validation_error":"exactly four creative options are required"`)
				require.Contains(t, request.UserPrompt, `"text":"Enable the webhook in Settings, then copy the signing secret."`)
				require.Contains(t, request.UserPrompt, `"guidance":"Direct, technical, no jokes."`)
				require.Contains(t, request.UserPrompt, `"writing_model"`, "repair must retain provider policy context")
			}
			count := 4
			if plannerCalls == 1 {
				count = 3
			}
			plans := make([]plannedOption, count)
			for i := range plans {
				plans[i] = plannedOption{Label: []string{"Prerequisite", "Decision", "Trade-off", "Result"}[i], Direction: DirectorPlan{
					CanonicalText: "Webhook signing is available.", FactualKernel: []string{"Enable the webhook in Settings, then copy the signing secret."},
					Thesis: "The release adds webhook signing with one supplied setup sequence.", Outcome: "Help existing users configure the integration safely", Audience: "Existing technical users", Angle: "Lead with the prerequisite", Route: "artifact_led",
					Media:        MediaPlan{Treatment: "none", Role: "none", Brief: "The supplied steps carry the update."},
					Destinations: []DestinationDecision{{AccountID: "linkedin-1", Include: true, Reason: "Required."}, {AccountID: "x-1", Include: true, Reason: "Required."}, {AccountID: "bluesky-1", Include: true, Reason: "Required."}},
				}}
			}
			value = optionDirections{Options: plans}
		case "openpost_four_complete_posts":
			require.Contains(t, request.SystemPrompt, "If the source is sparse, write a concise honest announcement")
			require.Contains(t, request.UserPrompt, `"planned_options"`)
			require.Contains(t, request.UserPrompt, `"platform_policies"`)
			posts := make([]PostOption, 4)
			for i, opening := range []string{"Webhook signing is now available.", "The setup has two supplied steps.", "Signing is explicit by design.", "One prerequisite before copying the secret."} {
				posts[i] = PostOption{Destinations: []DestinationPlan{
					{AccountID: "linkedin-1", Objective: "trust", Archetype: "announcement", OutputProfile: "linkedin.post", Preview: opening, Segments: []SegmentPlan{{Body: opening + " Enable the webhook in Settings, then copy the signing secret."}}, Media: MediaPlan{Treatment: "none", Role: "none", Brief: "Text is sufficient."}},
					{AccountID: "x-1", Objective: "clicks", Archetype: "announcement", OutputProfile: "x.post", Preview: opening, Segments: []SegmentPlan{{Body: opening + " Enable it in Settings, then copy the signing secret."}}, Media: MediaPlan{Treatment: "none", Role: "none", Brief: "Text is sufficient."}},
					{AccountID: "bluesky-1", Objective: "clicks", Archetype: "technical_note", OutputProfile: "bluesky.post", Preview: opening, Segments: []SegmentPlan{{Body: opening + " Enable it in Settings, then copy the signing secret."}}, Media: MediaPlan{Treatment: "none", Role: "none", Brief: "Text is sufficient."}},
				}}
			}
			value = optionOutput{Options: posts}
		case "openpost_four_post_review":
			require.Contains(t, request.SystemPrompt, "useful supported specificity")
			require.Contains(t, request.UserPrompt, `"platform_policies"`)
			require.Contains(t, request.UserPrompt, `"guidance":"Direct, technical, no jokes."`)
			return ai.GenerateResult{Text: `{"approved":true,"issue":""}`}, nil
		default:
			t.Fatalf("unexpected schema %s", request.ResponseSchema.Name)
		}
		data, marshalErr := json.Marshal(value)
		require.NoError(t, marshalErr)
		return ai.GenerateResult{Text: string(data)}, nil
	}), Config{Model: "writer", DecisionModel: "decision", Decider: decisionFunc(func(_ context.Context, request ai.DecisionRequest) (ai.DecisionResult, error) {
		require.Contains(t, request.Input, `"id":"release-notes"`)
		require.Contains(t, request.Criteria, "Do not judge humor, writing quality, voice fit, distinctness, engagement")
		require.NotContains(t, request.Criteria, "reader benefit")
		return ai.DecisionResult{Probability: 1}, nil
	})})
	require.NoError(t, err)
	voice := VoiceSnapshot{Definition: VoiceDefinition{Language: "English", Guidance: "Direct, technical, no jokes."}}
	result, err := service.Build(t.Context(), BuildInput{
		OptionCount: 4, Idea: "Webhook signing is available.", Sources: []SourceMaterial{{ID: "release-notes", Kind: "text", Text: "Enable the webhook in Settings, then copy the signing secret."}},
		Direction: DirectionInput{Outcome: "Help existing users configure the integration safely", Audience: "Existing technical users", Angle: "Lead with the prerequisite"}, DestinationPolicy: DestinationPolicyRequireAll,
		Destinations: []Destination{
			{AccountID: "linkedin-1", Platform: "linkedin", Voice: voice, AllowedOutputProfiles: []OutputProfile{{Key: "linkedin.post", TextLimit: 3000, MaxSegments: 1}}},
			{AccountID: "x-1", Platform: "x", Voice: voice, AllowedOutputProfiles: []OutputProfile{{Key: "x.post", TextLimit: 280, MaxSegments: 1}}},
			{AccountID: "bluesky-1", Platform: "bluesky", Voice: voice, AllowedOutputProfiles: []OutputProfile{{Key: "bluesky.post", TextLimit: 300, MaxSegments: 1}}},
		},
	})
	require.NoError(t, err)
	require.Len(t, result.Options, 4)
	require.Equal(t, 2, plannerCalls)
	for _, option := range result.Options {
		require.Len(t, option.Destinations, 3)
		require.Equal(t, "Help existing users configure the integration safely", option.Direction.Outcome, "locked direction must survive planning repair")
	}
}

func TestChoosingAnOptionPersistsAuthorEditsAndMissingDemo(t *testing.T) {
	t.Parallel()
	db := newBuilderApplicationTestDB(t)
	input := BuildInput{OptionCount: 4, Idea: "I built a faster editor.", Destinations: []Destination{{AccountID: "account-1", Platform: "x", AllowedOutputProfiles: []OutputProfile{{Key: "x.short_text", TextLimit: 280, MaxSegments: 1, MediaMaxCount: 4, AllowedMIMEs: []string{"video/*"}}}}}}
	options := make([]PostOption, 4)
	for i := range options {
		options[i] = PostOption{ID: []string{"option-1", "option-2", "option-3", "option-4"}[i], CanonicalText: "A faster editor.", Destinations: []DestinationPlan{{AccountID: "account-1", Platform: "x", Objective: "shares", Archetype: "product_demo", OutputProfile: "x.short_text", Preview: "A faster editor.", Segments: []SegmentPlan{{Body: "A faster editor."}}, Media: MediaPlan{Treatment: "attach_video", Role: "demo", Brief: "Show the editor interaction."}}}}
	}
	app, err := NewApplication(db, packageBuilderFunc(func(context.Context, BuildInput) (BuildResult, error) { return BuildResult{Options: options}, nil }), ApplicationConfig{AuthorizeStored: func(context.Context, workspaceaccess.StoredAuthority) error { return nil }})
	require.NoError(t, err)
	build, _, err := app.Enqueue(t.Context(), func() CreateBuildRequest {
		request := testBuildRequest(time.Now(), "four-options-test")
		request.Input = input
		return request
	}())
	require.NoError(t, err)
	require.NoError(t, app.HandleJob(t.Context(), jobregistry.TypePublicationBuild, `{"build_id":"`+build.ID+`"}`))
	build, err = app.Get(t.Context(), "user-1", build.ID)
	require.NoError(t, err)
	publications := &publicationApplicationStub{}
	_, err = app.Commit(t.Context(), "user-1", build.ID, publications)
	require.ErrorContains(t, err, "choose a post option")
	chosen, err := app.CommitOption(t.Context(), "user-1", build.ID, "option-3", build.Revision, nil, []OptionEdit{{AccountID: "account-1", Segments: []SegmentPlan{{Body: "The editor finally keeps up with me."}}}}, publications)
	require.NoError(t, err)
	require.Equal(t, "option-3", chosen.Result.SelectedOptionID)
	require.Equal(t, "The editor finally keeps up with me.", *publications.command.Renditions[0].Segments[0].BodyOverride)
	require.Equal(t, map[string]any{"kind": "video", "brief": "Show the editor interaction."}, publications.command.Renditions[0].Segments[0].Settings["attachment_requirement"])
	_, err = app.CommitOption(t.Context(), "user-1", build.ID, "option-3", build.Revision, nil, nil, publications)
	require.NoError(t, err)
	require.Equal(t, 1, publications.createCalls, "repeat selection must not create another publication")
}

func TestSourceBackedOptionEditsSurviveReloadAndCommit(t *testing.T) {
	t.Parallel()
	db := newBuilderApplicationTestDB(t)
	_, err := db.NewInsert().Model(&models.MediaAttachment{ID: "proof", WorkspaceID: "workspace-1", MimeType: "image/png", ProcessingStatus: "ready"}).Exec(t.Context())
	require.NoError(t, err)
	input := testBuildRequest(time.Now(), "source-option-test")
	input.Input.OptionCount = 4
	input.Input.Destinations[0].AllowedOutputProfiles[0].MediaMaxCount = 4
	input.Input.Destinations[0].AllowedOutputProfiles[0].AllowedMIMEs = []string{"image/*"}
	input.Assets = []BuildAsset{{MediaID: "proof", Role: "evidence", MayPublish: true}}
	app, err := NewApplication(db, packageBuilderFunc(func(_ context.Context, resolved BuildInput) (BuildResult, error) {
		require.Equal(t, "image/png", resolved.Sources[0].MIMEType)
		option := PostOption{ID: "option-1", Destinations: []DestinationPlan{{AccountID: "account-1", Platform: "x", Objective: "shares", Archetype: "artifact_joke", OutputProfile: "x.short_text", Preview: "The screenshot speaks for itself.", Segments: []SegmentPlan{{Body: "what the heck"}}, Media: MediaPlan{Treatment: "use_source", Role: "punchline", Brief: "Use the supplied screenshot.", SourceRef: "media:proof"}, Claims: []Claim{{Text: "The supplied screenshot", Status: "supported", SourceRefs: []string{"media:proof"}}}}}}
		return BuildResult{Options: []PostOption{option}}, nil
	}), ApplicationConfig{AuthorizeStored: func(context.Context, workspaceaccess.StoredAuthority) error { return nil }, AssetLoader: assetLoaderFunc(func(context.Context, string, []BuildAsset) (LoadedAssets, error) {
		return LoadedAssets{Sources: []SourceMaterial{{ID: "media:proof", Kind: "image", MIMEType: "image/png", Label: "proof.png", Publishable: true}}}, nil
	})})
	require.NoError(t, err)
	build, _, err := app.Enqueue(t.Context(), input)
	require.NoError(t, err)
	require.NoError(t, app.HandleJob(t.Context(), jobregistry.TypePublicationBuild, `{"build_id":"`+build.ID+`"}`))
	build, err = app.Get(t.Context(), "user-1", build.ID)
	require.NoError(t, err)
	edits := []OptionEdit{{AccountID: "account-1", Segments: []SegmentPlan{{Body: "someone really shipped this"}}}}
	saved, err := app.SaveOption(t.Context(), "user-1", build.ID, "option-1", build.Revision, edits)
	require.NoError(t, err)
	reloaded, err := app.Get(t.Context(), "user-1", build.ID)
	require.NoError(t, err)
	require.Equal(t, "someone really shipped this", reloaded.Result.Options[0].Destinations[0].Segments[0].Body)
	replayed, err := app.SaveOption(t.Context(), "user-1", build.ID, "option-1", build.Revision, edits)
	require.NoError(t, err, "a lost response must be safely recoverable")
	require.Equal(t, saved.Revision, replayed.Revision)
	_, err = app.SaveOption(t.Context(), "user-1", build.ID, "option-1", build.Revision, []OptionEdit{{AccountID: "account-1", Segments: []SegmentPlan{{Body: "obsolete client text"}}}})
	require.ErrorIs(t, err, ErrBuildNotReady, "stale different edits must not overwrite newer edits")
	publications := &publicationApplicationStub{}
	_, err = app.CommitOption(t.Context(), "user-1", build.ID, "option-1", build.Revision, nil, []OptionEdit{{AccountID: "account-1", Segments: []SegmentPlan{{Body: "obsolete client text"}}}}, publications)
	require.ErrorIs(t, err, ErrBuildNotReady, "stale selection must not overwrite saved edits")
	require.Zero(t, publications.createCalls)
	chosen, err := app.CommitOption(t.Context(), "user-1", build.ID, "option-1", saved.Revision, nil, edits, publications)
	require.NoError(t, err)
	require.Greater(t, chosen.Revision, saved.Revision)
	require.Equal(t, "proof", publications.command.Renditions[0].Segments[0].Media[0].MediaID)
	require.Equal(t, "someone really shipped this", *publications.command.Renditions[0].Segments[0].BodyOverride)
	_, err = app.CommitOption(t.Context(), "user-1", build.ID, "option-1", build.Revision, nil, nil, publications)
	require.NoError(t, err, "a retry of the selected option remains idempotent")
	require.Equal(t, 1, publications.createCalls)
}

type selectionContextKey struct{}
type optionSelectionHook struct {
	bReads           atomic.Int32
	bRead, aSelected chan struct{}
}

func (hook *optionSelectionHook) BeforeQuery(ctx context.Context, event *bun.QueryEvent) context.Context {
	if ctx.Value(selectionContextKey{}) == "B" && strings.HasPrefix(event.Query, "SELECT") && hook.bReads.Add(1) == 2 {
		select {
		case <-hook.aSelected:
		case <-ctx.Done():
		}
	}
	return ctx
}
func (hook *optionSelectionHook) AfterQuery(ctx context.Context, event *bun.QueryEvent) {
	if ctx.Value(selectionContextKey{}) == "B" && strings.HasPrefix(event.Query, "SELECT") && hook.bReads.Load() == 1 {
		close(hook.bRead)
	}
}

func TestConcurrentOptionChoicesCannotReplaceTheSelectedSnapshot(t *testing.T) {
	t.Parallel()
	db := newBuilderApplicationTestDB(t)
	hook := &optionSelectionHook{bRead: make(chan struct{}), aSelected: make(chan struct{})}
	db.AddQueryHook(hook)
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	allowCommit := make(chan struct{})
	app, err := NewApplication(db, packageBuilderFunc(func(context.Context, BuildInput) (BuildResult, error) {
		return BuildResult{Options: []PostOption{{ID: "option-1", CanonicalText: "First choice"}, {ID: "option-2", CanonicalText: "Second choice"}}}, nil
	}), ApplicationConfig{AuthorizeStored: func(ctx context.Context, _ workspaceaccess.StoredAuthority) error {
		if ctx.Value(selectionContextKey{}) == "A" {
			close(hook.aSelected)
			select {
			case <-allowCommit:
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		return nil
	}})
	require.NoError(t, err)
	build, _, err := app.Enqueue(ctx, testBuildRequest(time.Now(), "concurrent-choices"))
	require.NoError(t, err)
	require.NoError(t, app.HandleJob(ctx, jobregistry.TypePublicationBuild, `{"build_id":"`+build.ID+`"}`))
	build, err = app.Get(t.Context(), "user-1", build.ID)
	require.NoError(t, err)
	publications := &publicationApplicationStub{}
	bResult := make(chan error, 1)
	go func() {
		_, err := app.CommitOption(context.WithValue(ctx, selectionContextKey{}, "B"), "user-1", build.ID, "option-2", build.Revision, nil, nil, publications)
		bResult <- err
	}()
	select {
	case <-hook.bRead:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	aResult := make(chan error, 1)
	go func() {
		_, err := app.CommitOption(context.WithValue(ctx, selectionContextKey{}, "A"), "user-1", build.ID, "option-1", build.Revision, nil, nil, publications)
		aResult <- err
	}()
	require.ErrorIs(t, <-bResult, ErrBuildNotReady)
	close(allowCommit)
	require.NoError(t, <-aResult)
	final, err := app.Get(ctx, "user-1", build.ID)
	require.NoError(t, err)
	require.Equal(t, "option-1", final.Result.SelectedOptionID)
	require.Equal(t, 1, publications.createCalls)
}

func TestFourPostCreativeFeedbackGetsOneRewriteWithConsistencyRechecked(t *testing.T) {
	t.Parallel()
	writerCalls, reviewCalls, decisionCalls := 0, 0, 0
	service, err := New(generationFunc(func(_ context.Context, request ai.GenerateRequest) (ai.GenerateResult, error) {
		var value any
		switch request.ResponseSchema.Name {
		case "openpost_four_post_directions":
			plans := make([]plannedOption, 4)
			for i := range plans {
				plans[i] = plannedOption{Label: []string{"Result", "Confession", "Observation", "Comparison"}[i], Direction: DirectorPlan{CanonicalText: "Less code, more product.", FactualKernel: []string{"The author deleted 15,000 lines."}, Thesis: "Less code delivered more features.", Outcome: "shares", Audience: "engineers", Angle: "less code", Route: "thesis_led", Media: MediaPlan{Treatment: "none", Role: "none", Brief: "Text is sufficient."}, Destinations: []DestinationDecision{{AccountID: "x-1", Include: true, Reason: "Fits."}}}}
			}
			value = optionDirections{Options: plans}
		case "openpost_four_complete_posts":
			writerCalls++
			if writerCalls == 2 {
				require.Contains(t, request.UserPrompt, "Give the confession a different payoff")
			}
			posts := make([]PostOption, 4)
			for i, text := range []string{"Deleted 15,000 lines. More features now.", "The delete key did my product work.", "My refactor added features by removing code.", "Less code to maintain. More product to use."} {
				if writerCalls == 2 && i == 1 {
					text = "My most productive day involved mostly deleting things."
				}
				posts[i] = PostOption{Destinations: []DestinationPlan{{AccountID: "x-1", Objective: "shares", Archetype: "technical_opinion", OutputProfile: "x.post", Preview: text, Segments: []SegmentPlan{{Body: text}}, Media: MediaPlan{Treatment: "none", Role: "none", Brief: "Text is sufficient."}}}}
			}
			value = optionOutput{Options: posts}
		case "openpost_four_post_review":
			reviewCalls++
			require.Contains(t, request.UserPrompt, `"platform_policies"`)
			return ai.GenerateResult{Text: `{"approved":false,"issue":"Give the confession a different payoff."}`}, nil
		default:
			t.Fatalf("unexpected schema %s", request.ResponseSchema.Name)
		}
		data, err := json.Marshal(value)
		require.NoError(t, err)
		return ai.GenerateResult{Text: string(data)}, nil
	}), Config{Model: "writer", DecisionModel: "decision", Decider: decisionFunc(func(_ context.Context, request ai.DecisionRequest) (ai.DecisionResult, error) {
		decisionCalls++
		require.Contains(t, request.Criteria, "concrete contradiction")
		require.Contains(t, request.Criteria, "Do not judge humor, writing quality, voice fit, distinctness, engagement")
		if decisionCalls == 2 {
			return ai.DecisionResult{Probability: 0}, nil
		}
		return ai.DecisionResult{Probability: 1}, nil
	})})
	require.NoError(t, err)
	_, err = service.Build(t.Context(), BuildInput{OptionCount: 4, Idea: "I deleted 15,000 lines. More features now.", DestinationPolicy: DestinationPolicyRequireAll, Destinations: []Destination{{AccountID: "x-1", Platform: "x", AllowedOutputProfiles: []OutputProfile{{Key: "x.post", TextLimit: 280, MaxSegments: 1}}}}})
	require.ErrorContains(t, err, "decision review found a concrete source contradiction")
	require.Equal(t, 2, writerCalls)
	require.Equal(t, 1, reviewCalls, "a subjective critic must not loop after its rewrite")
	require.Equal(t, 2, decisionCalls, "the replacement must be consistency checked without opening another rewrite")
}

func TestRenderedPrivateContextAssetCanBeExplicitlyAttached(t *testing.T) {
	t.Parallel()
	db := newBuilderApplicationTestDB(t)
	_, err := db.NewInsert().Model(&models.MediaAttachment{ID: "visual", WorkspaceID: "workspace-1", MimeType: "image/png", ProcessingStatus: "ready"}).Exec(t.Context())
	require.NoError(t, err)
	request := testBuildRequest(time.Now(), "rendered-private-context")
	request.Input.OptionCount = 4
	request.Input.Destinations[0].AllowedOutputProfiles[0].MediaMaxCount = 4
	request.Input.Destinations[0].AllowedOutputProfiles[0].AllowedMIMEs = []string{"image/*"}
	request.Assets = []BuildAsset{{MediaID: "visual", Role: "evidence", MayPublish: false}}
	document := &screenshottemplates.ScreenshotTemplateDocument{SchemaVersion: 1, TemplateID: "meme", Title: "Less code", Appearance: "light", Frame: "natural", TextSize: "normal", Meme: &screenshottemplates.ScreenshotTemplateMeme{TemplateID: "drake", Name: "Drake", Captions: []string{"More code", "Fewer lines"}, Format: "png", OverlayMediaIDs: []string{}}}
	app, err := NewApplication(db, packageBuilderFunc(func(context.Context, BuildInput) (BuildResult, error) {
		return BuildResult{Options: []PostOption{{ID: "option-1", Destinations: []DestinationPlan{{AccountID: "account-1", Platform: "x", Objective: "shares", Archetype: "artifact_joke", OutputProfile: "x.short_text", Preview: "Less code.", Segments: []SegmentPlan{{Body: "Less code."}}, Media: MediaPlan{Treatment: "meme", Role: "punchline", Brief: "A preference.", TemplateID: "drake", Document: document}}}}}}, nil
	}), ApplicationConfig{AuthorizeStored: func(context.Context, workspaceaccess.StoredAuthority) error { return nil }, AssetLoader: assetLoaderFunc(func(context.Context, string, []BuildAsset) (LoadedAssets, error) {
		return LoadedAssets{Sources: []SourceMaterial{{ID: "media:visual", Kind: "image", MIMEType: "image/png", Publishable: false}}}, nil
	})})
	require.NoError(t, err)
	build, _, err := app.Enqueue(t.Context(), request)
	require.NoError(t, err)
	require.NoError(t, app.HandleJob(t.Context(), jobregistry.TypePublicationBuild, `{"build_id":"`+build.ID+`"}`))
	build, err = app.Get(t.Context(), "user-1", build.ID)
	require.NoError(t, err)
	publications := &publicationApplicationStub{}
	_, err = app.CommitOption(t.Context(), "user-1", build.ID, "option-1", build.Revision, []OptionMedia{{AccountID: "account-1", MediaID: "visual"}}, nil, publications)
	require.NoError(t, err)
	require.Len(t, publications.command.Renditions[0].Segments[0].Media, 1, "explicit rendered-image selection grants attachment permission")
	require.Equal(t, "visual", publications.command.Renditions[0].Segments[0].Media[0].MediaID)
}
