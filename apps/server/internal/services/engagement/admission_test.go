package engagement

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

type admissionGate struct{}

func (admissionGate) IsEffectiveEnabled(context.Context, string, string) (bool, error) {
	return true, nil
}
func admissionTestService(t *testing.T) *Service {
	t.Helper()
	db, err := database.InitDBWithDriver("sqlite", fmt.Sprintf("file:reply-%d?mode=memory&cache=shared", time.Now().UnixNano()))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, database.CreateSchema(db))
	for _, row := range []any{
		&models.User{ID: "u", Email: "reply@example.test", PasswordHash: "hash"},
		&models.Organization{ID: "o", Name: "Org", CreatedByID: "u"},
		&models.Workspace{ID: "w", Name: "Workspace", OrganizationID: "o"},
		&models.WorkspaceMember{WorkspaceID: "w", UserID: "u", Role: models.WorkspaceRoleAdmin, Status: models.WorkspaceMemberStatusActive},
		&models.SocialAccount{ID: "a", WorkspaceID: "w", Platform: "bluesky", AccountID: "remote", Slug: "remote", AccessTokenEnc: []byte("token"), IsActive: true},
		&models.Publication{ID: "p", WorkspaceID: "w", CreatedByID: "u", Status: models.PublicationStatusPublished},
		&models.Rendition{ID: "r", PublicationID: "p", SocialAccountID: "a", Platform: "bluesky", TargetKey: "bluesky", Status: models.RenditionStatusPublished},
		&models.EngagementItem{ID: "c", WorkspaceID: "w", RenditionID: "r", SocialAccountID: "a", Platform: "bluesky", RemoteID: "comment", CanReply: true, Body: "question", LastSeenAt: time.Now().UTC()},
	} {
		_, err = db.NewInsert().Model(row).Exec(t.Context())
		require.NoError(t, err)
	}
	s := NewService(db, nil, nil)
	s.SetFeatureGate(admissionGate{})
	return s
}
func TestPublicReplyReceiptSurvivesLostResponseAndCompletedJob(t *testing.T) {
	s := admissionTestService(t)
	db := s.db
	actor := Actor{UserID: "u"}
	jobID, err := s.QueueEngagementActionReceipt(t.Context(), actor, "c", "reply", "answer", "op")
	require.NoError(t, err)
	require.NotEmpty(t, jobID)
	_, err = db.NewUpdate().Model((*models.Job)(nil)).Set("status='completed'").Where("id=?", jobID).Exec(t.Context())
	require.NoError(t, err)
	replay, err := s.QueueEngagementActionReceipt(t.Context(), actor, "c", "reply", "answer", "op")
	require.NoError(t, err)
	require.Equal(t, jobID, replay)
	_, err = s.QueueEngagementActionReceipt(t.Context(), actor, "c", "reply", "changed", "op")
	require.ErrorIs(t, err, ErrOperationConflict)
	count, err := db.NewSelect().Model((*models.Job)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.EqualValues(t, 1, count)
	_, err = db.NewDelete().Model((*models.Job)(nil)).Where("id=?", jobID).Exec(t.Context())
	require.NoError(t, err)
	replay, err = s.QueueEngagementActionReceipt(t.Context(), actor, "c", "reply", "answer", "op")
	require.NoError(t, err)
	require.Equal(t, jobID, replay)
	_, err = s.QueueEngagementActionReceipt(t.Context(), Actor{UserID: "u", CredentialWorkspaceID: "other"}, "c", "reply", "answer", "op")
	require.ErrorIs(t, err, ErrAccessDenied)
}

func TestManualCommentRefreshReturnsScopedCollectionReceipts(t *testing.T) {
	s := admissionTestService(t)
	s.SetProvider("bluesky", &moderationProvider{})
	_, err := s.db.NewUpdate().Model((*models.Rendition)(nil)).Set("external_id='remote-post'").Where("id='r'").Exec(t.Context())
	require.NoError(t, err)
	actor := Actor{UserID: "u"}
	queued, err := s.RefreshWorkspace(t.Context(), actor, "w", true)
	require.NoError(t, err)
	require.Equal(t, 1, queued)
	first, err := s.ActiveRefreshJobIDs(t.Context(), actor, "w")
	require.NoError(t, err)
	require.Len(t, first, 1)
	queued, err = s.RefreshWorkspace(t.Context(), actor, "w", true)
	require.NoError(t, err)
	require.Zero(t, queued)
	again, err := s.ActiveRefreshJobIDs(t.Context(), actor, "w")
	require.NoError(t, err)
	require.Equal(t, first, again)
	_, err = s.ActiveRefreshJobIDs(t.Context(), Actor{UserID: "u", CredentialWorkspaceID: "other"}, "w")
	require.ErrorIs(t, err, ErrAccessDenied)
}
