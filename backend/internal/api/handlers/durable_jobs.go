package handlers

import (
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
)

func newPublishPostJob(payload string, runAt time.Time, scopeID, id string) (*models.Job, error) {
	job, err := jobregistry.NewJob(jobregistry.TypePublishPost, payload, runAt)
	if err != nil {
		return nil, err
	}
	job.ScopeID = scopeID
	if id != "" {
		job.ID = id
	}
	return job, nil
}
