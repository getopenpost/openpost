package publicationauth

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

// LegacyJobsInput reconciles pending compatibility jobs with the immutable
// authorization contract. Callers must provide either an exact job or
// publication scope. Force appends a new receipt after an already-scheduled
// publication changes.
type LegacyJobsInput struct {
	JobID         string
	PublicationID string
	Actor         Actor
	ConfirmedAt   time.Time
	Force         bool
}

// AuthorizeLegacyJobs binds every matching pending publish_publication job to
// a hash-only receipt and updates the payload that the publisher will verify.
// Callers that also mutate publication/job state should pass their transaction
// so the receipt and queue identity commit together.
func AuthorizeLegacyJobs(ctx context.Context, db bun.IDB, input LegacyJobsInput) error {
	input.JobID = strings.TrimSpace(input.JobID)
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	if input.JobID == "" && input.PublicationID == "" {
		return fmt.Errorf("legacy publication authorization requires a job or publication scope")
	}
	input.Actor = input.Actor.normalized()
	if input.ConfirmedAt.IsZero() {
		input.ConfirmedAt = time.Now().UTC()
	} else {
		input.ConfirmedAt = input.ConfirmedAt.UTC()
	}

	var jobs []models.Job
	query := db.NewSelect().Model(&jobs).
		Where("type = ? AND status = ?", jobregistry.TypePublishPublication, jobregistry.StatusPending).
		Order("run_at ASC", "id ASC")
	if input.JobID != "" {
		query = query.Where("id = ?", input.JobID)
	} else if input.PublicationID != "" {
		query = query.Where("scope_id = ?", input.PublicationID)
	}
	if err := query.Scan(ctx); err != nil {
		return fmt.Errorf("load legacy publication jobs: %w", err)
	}
	for index := range jobs {
		if err := authorizeLegacyJob(ctx, db, &jobs[index], input); err != nil {
			return err
		}
	}
	return nil
}

func authorizeLegacyJob(ctx context.Context, db bun.IDB, job *models.Job, input LegacyJobsInput) error {
	payload, err := decodeLegacyJobPayload(job)
	if err != nil {
		return err
	}
	publicationID := stringPayloadValue(payload, "publication_id")
	if publicationID == "" || (input.PublicationID != "" && publicationID != input.PublicationID) {
		return nil
	}
	alreadyBound, err := legacyJobAuthorizationExists(
		ctx,
		db,
		job.ID,
		publicationID,
		stringPayloadValue(payload, "authorization_batch_id"),
	)
	if err != nil {
		return err
	}
	if alreadyBound && !input.Force {
		return nil
	}

	action, err := legacyJobAction(job.ID, payload)
	if err != nil {
		return err
	}
	// A compatibility content mutation may rotate the primary publication
	// receipt, but it must never change an independently authorized reply
	// operation. Exact JobID recovery can still bind a missing reply receipt.
	if input.Force && input.JobID == "" && action == ActionReply {
		return nil
	}
	actor, eligible, err := legacyJobAuthorizationActor(ctx, db, job.ID, publicationID, action, payload, input.Actor)
	if err != nil || !eligible {
		return err
	}
	batchID, err := createLegacyJobReceipt(ctx, db, job, publicationID, action, actor, input, payload)
	if err != nil {
		return err
	}
	return bindLegacyJobAuthorization(ctx, db, job, payload, batchID)
}

func legacyJobAuthorizationActor(
	ctx context.Context,
	db bun.IDB,
	jobID,
	publicationID,
	action string,
	payload map[string]any,
	actor Actor,
) (Actor, bool, error) {
	var publication models.Publication
	if err := db.NewSelect().Model(&publication).Where("id = ?", publicationID).Scan(ctx); err != nil {
		return Actor{}, false, fmt.Errorf("load legacy authorization publication %s: %w", publicationID, err)
	}
	if !actor.valid() {
		actor = Actor{Origin: OriginLegacy, UserID: publication.CreatedByID}
	}
	eligible, err := legacyJobHasDestination(ctx, db, jobID, publicationID, action, payload)
	return actor, eligible, err
}

func decodeLegacyJobPayload(job *models.Job) (map[string]any, error) {
	payload := map[string]any{}
	if err := json.Unmarshal([]byte(job.Payload), &payload); err != nil {
		return nil, fmt.Errorf("decode legacy publication job %s: %w", job.ID, err)
	}
	return payload, nil
}

func legacyJobAction(jobID string, payload map[string]any) (string, error) {
	action := strings.ToLower(stringPayloadValue(payload, "action"))
	if action == "" {
		return ActionPublish, nil
	}
	if action != ActionPublish && action != ActionReply {
		return "", fmt.Errorf("authorize legacy publication job %s: unsupported action %q", jobID, action)
	}
	return action, nil
}

func legacyJobHasDestination(
	ctx context.Context,
	db bun.IDB,
	jobID, publicationID, action string,
	payload map[string]any,
) (bool, error) {
	if action != ActionPublish || stringPayloadValue(payload, "rendition_id") != "" {
		return true, nil
	}
	count, err := db.NewSelect().Model((*models.Rendition)(nil)).
		Where("publication_id = ?", publicationID).
		Count(ctx)
	if err != nil {
		return false, fmt.Errorf("count legacy authorization destinations for job %s: %w", jobID, err)
	}
	// A compatibility schedule without destinations cannot make an external
	// write. Leave it unbound so publisher preflight remains fail-closed while
	// draft/cancel recovery stays available.
	return count > 0, nil
}

func createLegacyJobReceipt(
	ctx context.Context,
	db bun.IDB,
	job *models.Job,
	publicationID, action string,
	actor Actor,
	input LegacyJobsInput,
	payload map[string]any,
) (string, error) {
	runAt := job.RunAt.UTC()
	var (
		batchID string
		err     error
	)
	if action == ActionReply {
		batchID, _, err = CreateExplicit(ctx, db, ExplicitInput{
			BatchInput: BatchInput{
				PublicationID: publicationID,
				Actor:         actor,
				Action:        ActionReply,
				PolicyMode:    PolicyLegacyScheduled,
				ConfirmedAt:   input.ConfirmedAt,
			},
			RenditionID: stringPayloadValue(payload, "rendition_id"),
			JobID:       job.ID,
			RunAt:       runAt,
			Content:     payload["body"],
			Media:       payload["media"],
			Settings: map[string]any{
				"parent_id": stringPayloadValue(payload, "parent_id"),
				"settings":  payload["settings"],
			},
		})
	} else {
		batchID, _, err = CreateBatch(ctx, db, BatchInput{
			PublicationID: publicationID,
			Actor:         actor,
			Action:        ActionPublish,
			PolicyMode:    PolicyLegacyScheduled,
			ConfirmedAt:   input.ConfirmedAt,
			Targets: []JobTarget{{
				JobID:       job.ID,
				RenditionID: stringPayloadValue(payload, "rendition_id"),
				RunAt:       runAt,
			}},
		})
	}
	if err != nil {
		return "", fmt.Errorf("authorize legacy publication job %s: %w", job.ID, err)
	}
	return batchID, nil
}

func bindLegacyJobAuthorization(
	ctx context.Context,
	db bun.IDB,
	job *models.Job,
	payload map[string]any,
	batchID string,
) error {
	runAt := job.RunAt.UTC()
	payload["authorization_batch_id"] = batchID
	payload["authorization_scheduled_at"] = runAt.Format(time.RFC3339Nano)
	encoded, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode authorized legacy publication job %s: %w", job.ID, err)
	}
	result, err := db.NewUpdate().Model((*models.Job)(nil)).
		Set("payload = ?", string(encoded)).
		Where("id = ? AND type = ? AND status = ?", job.ID, jobregistry.TypePublishPublication, jobregistry.StatusPending).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("bind legacy publication job %s to authorization: %w", job.ID, err)
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return fmt.Errorf("bind legacy publication job %s to authorization: job is no longer pending", job.ID)
	}
	job.Payload = string(encoded)
	return nil
}

func legacyJobAuthorizationExists(ctx context.Context, db bun.IDB, jobID, publicationID, batchID string) (bool, error) {
	if batchID == "" {
		return false, nil
	}
	count, err := db.NewSelect().Model((*models.PublicationAuthorization)(nil)).
		Where("batch_id = ? AND job_id = ? AND publication_id = ?", batchID, jobID, publicationID).
		Count(ctx)
	if err != nil {
		return false, fmt.Errorf("load legacy job authorization: %w", err)
	}
	return count > 0, nil
}

func stringPayloadValue(payload map[string]any, key string) string {
	value, _ := payload[key].(string)
	return strings.TrimSpace(value)
}
