package handlers

import (
	"testing"
	"time"

	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/stretchr/testify/require"
)

func TestFailedPublicationDeletionPreservesProtectedDeliveries(t *testing.T) {
	t.Parallel()
	for _, state := range []string{"unsent", providerwrite.StatusSending, providerwrite.StatusAmbiguous, providerwrite.StatusAccepted} {
		t.Run(state, func(t *testing.T) {
			srv := newMCPTestServer(t)
			commands := srv.handler.publicationHandler().publicationApplication()
			publication, err := commands.Create(t.Context(), "user-1", CreatePublicationBody{
				WorkspaceID: "ws-1", ContentProfile: "short_text", SourceText: "Failed before upload",
				SocialAccountIDs: []string{"account-1"},
			})
			require.NoError(t, err)
			_, err = srv.db.NewUpdate().Model((*models.Publication)(nil)).Set("status = ?", models.PublicationStatusFailed).Where("id = ?", publication.ID).Exec(t.Context())
			require.NoError(t, err)
			_, err = srv.db.NewUpdate().Model((*models.Rendition)(nil)).Set("status = ?", models.RenditionStatusFailed).Where("publication_id = ?", publication.ID).Exec(t.Context())
			require.NoError(t, err)
			if state != "unsent" {
				job, err := jobregistry.NewJob(jobTypePublishPublication, mustJSON(map[string]string{"publication_id": publication.ID}), time.Now().UTC())
				require.NoError(t, err)
				job.Status = "failed"
				job.ScopeID = publication.ID
				_, err = srv.db.NewInsert().Model(job).Exec(t.Context())
				require.NoError(t, err)
				_, err = srv.db.NewInsert().Model(&models.ProviderWriteAttempt{ID: "protected-attempt", JobID: job.ID, Status: state}).Exec(t.Context())
				require.NoError(t, err)
			}
			err = commands.Delete(t.Context(), "user-1", publication.ID, publication.Revision)
			if state == "unsent" {
				require.NoError(t, err)
			} else {
				require.ErrorIs(t, err, errPublicationAlreadyProcessing)
			}
			exists, err := srv.db.NewSelect().Model((*models.Publication)(nil)).Where("id = ?", publication.ID).Exists(t.Context())
			require.NoError(t, err)
			require.Equal(t, state != "unsent", exists)
		})
	}
}
