package handlers

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/openpost/backend/internal/idempotency"
	analyticsservice "github.com/openpost/backend/internal/services/analytics"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/publicationauth"
	"github.com/openpost/backend/internal/services/publicationbuilder"
	"github.com/openpost/backend/internal/services/workflows"
	"github.com/openpost/backend/internal/services/workspaceaccess"
)

type workflowActions struct {
	publications *PublicationHandler
	builds       *PublicationBuildHandler
	analytics    *analyticsservice.Service
}

func (a workflowActions) Execute(ctx context.Context, input workflows.EffectRequest) (workflows.EffectResult, error) {
	ctx = workspaceaccess.WithStoredAuthority(ctx, input.Authority)
	ctx = publicationauth.WithActor(ctx, publicationauth.Actor{Origin: publicationauth.OriginWorker, UserID: input.Authority.UserID})
	decision, err := workspaceaccess.NewAuthorizer(a.publications.db).AuthorizeStored(ctx, input.Authority, workspaceaccess.LevelAdminister)
	if err != nil || !decision.Allowed {
		return workflows.EffectResult{}, workflows.ErrAccess
	}
	var output map[string]any
	switch input.Kind {
	case workflows.KindDraft:
		output, err = a.draft(ctx, input)
	case workflows.KindBuild:
		return a.build(ctx, input)
	case workflows.KindApproval:
		output, err = a.approval(ctx, input)
	case workflows.KindSchedule:
		output, err = a.schedule(ctx, input)
	case workflows.KindReply:
		output, err = a.reply(ctx, input)
	case workflows.KindMetrics:
		output, err = a.metrics(ctx, input)
	default:
		err = errors.New("this native workflow action is unavailable")
	}
	return workflows.EffectResult{Output: output}, err
}
func workflowText(inputs map[string]any, key string) string {
	value, _ := inputs[key].(string)
	return value
}
func workflowInt(inputs map[string]any, key string) (int, error) {
	switch value := inputs[key].(type) {
	case float64:
		if value != float64(int(value)) {
			return 0, errors.New("expected a whole number")
		}
		return int(value), nil
	case int:
		return value, nil
	case string:
		return strconv.Atoi(value)
	}
	return 0, fmt.Errorf("configure %s", key)
}
func workflowAccounts(inputs map[string]any) []string {
	switch value := inputs["account_ids"].(type) {
	case []string:
		return value
	case []any:
		var ids []string
		for _, id := range value {
			if text, ok := id.(string); ok {
				ids = append(ids, text)
			}
		}
		return ids
	case string:
		var ids []string
		for _, id := range strings.Split(value, ",") {
			if strings.TrimSpace(id) != "" {
				ids = append(ids, strings.TrimSpace(id))
			}
		}
		return ids
	}
	return nil
}
func workflowReceipt(input workflows.EffectRequest, operation string) idempotency.Request {
	return idempotency.Request{PrincipalID: "user:" + input.Authority.UserID, WorkspaceID: input.Authority.WorkspaceID, OperationID: "workflow-" + operation, Key: input.RunID + ":" + input.StepID, HTTPStatus: 200, ExpiresAt: input.ExpiresAt}
}
func (a workflowActions) draft(ctx context.Context, input workflows.EffectRequest) (map[string]any, error) {
	commands := a.publications.publicationApplicationForTesting()
	body := CreatePublicationBody{WorkspaceID: input.Authority.WorkspaceID, Title: workflowText(input.Inputs, "title"), SourceText: workflowText(input.Inputs, "text"), SourceURL: workflowText(input.Inputs, "url"), SocialAccountIDs: workflowAccounts(input.Inputs), SocialSetID: workflowText(input.Inputs, "social_set_id"), CreationPreset: "post", ContentProfile: "text", Metadata: map[string]any{"workflow_run_id": input.RunID, "workflow_step_id": input.StepID}}
	publication, err := commands.CreateFromWorkflow(ctx, input.Authority.UserID, body, workflowReceipt(input, "create-draft"))
	if err != nil {
		return nil, err
	}
	return workflowPublicationOutput(publication), nil
}
func workflowPublicationOutput(publication PublicationResponse) map[string]any {
	return map[string]any{"id": publication.ID, "revision": publication.Revision, "text": publication.SourceText, "title": publication.Title, "status": publication.Status}
}
func (a workflowActions) approval(ctx context.Context, input workflows.EffectRequest) (map[string]any, error) {
	publication, err := a.publications.publicationApplication().Get(ctx, input.Authority.UserID, workflowText(input.Inputs, "publication_id"))
	if err != nil {
		return nil, err
	}
	if publication.WorkspaceID != input.Authority.WorkspaceID {
		return nil, workflows.ErrAccess
	}
	if revision, exists := input.Inputs["revision"]; exists {
		expected, err := workflowInt(map[string]any{"revision": revision}, "revision")
		if err != nil {
			return nil, err
		}
		if publication.Revision != expected {
			return nil, fmt.Errorf("%w: the post changed; review its current revision before approving", workflows.ErrConflict)
		}
	}
	if publication.Status != "draft" {
		return nil, fmt.Errorf("%w: only a draft post can be approved", workflows.ErrInvalid)
	}
	return map[string]any{"publication_id": publication.ID, "revision": publication.Revision, "text": publication.SourceText, "title": publication.Title, "approved": input.Inputs["revision"] != nil}, nil
}
func (a workflowActions) schedule(ctx context.Context, input workflows.EffectRequest) (map[string]any, error) {
	id := workflowText(input.Inputs, "publication_id")
	revision, err := workflowInt(input.Inputs, "revision")
	if err != nil {
		return nil, err
	}
	runAt, err := time.Parse(time.RFC3339Nano, workflowText(input.Inputs, "scheduled_at"))
	if err != nil {
		return nil, errors.New("choose a valid schedule delay")
	}
	commands := a.publications.publicationApplicationForTesting()
	receipt := workflowReceipt(input, "schedule")
	_, receipt, err = commands.prepareEnqueueIdempotency(ctx, input.Authority.UserID, id, revision+1, providerreadiness.ExecutionIntentProduction, receipt)
	if err != nil {
		return nil, err
	}
	replay, found, err := idempotency.Replay[publicationEnqueueResult](ctx, a.publications.db, receipt)
	if err != nil {
		return nil, err
	}
	if found {
		return map[string]any{"publication_id": id, "job_id": replay.Value.JobID, "scheduled_at": runAt.Format(time.RFC3339), "status": "scheduled"}, nil
	}
	updated, _, err := commands.UpdateIdempotent(ctx, input.Authority.UserID, id, PublicationUpdateBody{ExpectedRevision: revision, ScheduledAt: &runAt}, workflowReceipt(input, "schedule-time"))
	if err != nil {
		return nil, err
	}
	queued, _, err := commands.ScheduleIdempotent(ctx, input.Authority.UserID, id, updated.Revision, providerreadiness.ExecutionIntentProduction, receipt)
	if err != nil {
		return nil, err
	}
	return map[string]any{"publication_id": id, "job_id": queued.JobID, "scheduled_at": runAt.Format(time.RFC3339), "status": "scheduled"}, nil
}
func (a workflowActions) reply(ctx context.Context, input workflows.EffectRequest) (map[string]any, error) {
	rendition, publication, err := a.publications.loadRenditionWithPublicationForEdit(ctx, workflowText(input.Inputs, "rendition_id"), input.Authority.UserID)
	if err != nil {
		return nil, err
	}
	if publication.WorkspaceID != input.Authority.WorkspaceID {
		return nil, workflows.ErrAccess
	}
	runAt, err := time.Parse(time.RFC3339Nano, workflowText(input.Inputs, "run_at"))
	if err != nil {
		return nil, errors.New("reply time is unavailable")
	}
	body := workflowText(input.Inputs, "text")
	if strings.TrimSpace(body) == "" {
		return nil, errors.New("enter reply text")
	}
	receipt := workflowReceipt(input, "reply")
	jobID, err := a.publications.queueRenditionReplyCommand(ctx, rendition, publication, body, "", nil, nil, runAt, &receipt)
	if err != nil {
		return nil, err
	}
	return map[string]any{"rendition_id": rendition.ID, "job_id": jobID, "status": "queued"}, nil
}
func (a workflowActions) metrics(ctx context.Context, input workflows.EffectRequest) (map[string]any, error) {
	if a.analytics == nil {
		return nil, errors.New("analytics is unavailable")
	}
	maxAge := 60
	if _, exists := input.Inputs["max_age_minutes"]; exists {
		value, err := workflowInt(input.Inputs, "max_age_minutes")
		if err != nil || value < 1 || value > 1440 {
			return nil, errors.New("metric age must be between 1 minute and 24 hours")
		}
		maxAge = value
	}
	observed, err := a.analytics.ObserveContent(ctx, input.Authority.WorkspaceID, workflowText(input.Inputs, "rendition_id"), time.Duration(maxAge)*time.Minute)
	if err != nil {
		return nil, err
	}
	result := map[string]any{"observed_at": observed.ObservedAt.Format(time.RFC3339), "metadata": observed.Metadata}
	for key, value := range observed.Values {
		result[key] = value
	}
	return result, nil
}
func (a workflowActions) build(ctx context.Context, input workflows.EffectRequest) (workflows.EffectResult, error) {
	if a.builds == nil || a.builds.application == nil {
		return workflows.EffectResult{}, errors.New("configure an AI provider before using Build draft")
	}
	key := "workflow:" + input.RunID + ":" + input.StepID
	build, found, err := a.builds.application.FindByKey(ctx, input.Authority.WorkspaceID, input.Authority.UserID, key)
	if err != nil {
		return workflows.EffectResult{}, err
	}
	if !found {
		body := CreatePublicationBuildBody{WorkspaceID: input.Authority.WorkspaceID, Idea: workflowText(input.Inputs, "text"), AccountIDs: workflowAccounts(input.Inputs), SocialSetID: workflowText(input.Inputs, "social_set_id"), Direction: publicationbuilder.DirectionInput{Outcome: workflowText(input.Inputs, "instructions")}}
		destinations, err := a.builds.preparePublicationBuildDestinations(ctx, body.WorkspaceID, body)
		if err != nil {
			return workflows.EffectResult{}, err
		}
		build, _, err = a.builds.application.Enqueue(ctx, publicationbuilder.CreateBuildRequest{WorkspaceID: body.WorkspaceID, CreatedByID: input.Authority.UserID, IdempotencyKey: key, Authority: input.Authority, Input: publicationbuilder.BuildInput{Idea: body.Idea, Destinations: destinations, Direction: body.Direction, DestinationPolicy: publicationbuilder.DestinationPolicyRequireAll}, SocialSetID: body.SocialSetID})
		if err != nil {
			return workflows.EffectResult{}, err
		}
	}
	switch build.State {
	case publicationbuilder.BuildStateQueued, publicationbuilder.BuildStateBuilding:
		return workflows.EffectResult{Pending: true, Output: map[string]any{"build_id": build.ID, "phase": build.Phase}}, nil
	case publicationbuilder.BuildStateReady:
		build, err = a.builds.application.Commit(ctx, input.Authority.UserID, build.ID, a.publications.BuilderApplication())
		if err != nil {
			return workflows.EffectResult{}, err
		}
	case publicationbuilder.BuildStateFailed, publicationbuilder.BuildStateCancelled:
		return workflows.EffectResult{}, errors.New("the AI build did not finish. Open the build to inspect its result")
	}
	publication, err := a.publications.publicationApplication().Get(ctx, input.Authority.UserID, build.PublicationID)
	if err != nil {
		return workflows.EffectResult{}, err
	}
	output := workflowPublicationOutput(publication)
	output["build_id"] = build.ID
	return workflows.EffectResult{Output: output}, nil
}

func NewWorkflowActions(publications *PublicationHandler, builds *PublicationBuildHandler, analytics *analyticsservice.Service) workflows.Actions {
	return workflowActions{publications: publications, builds: builds, analytics: analytics}
}
