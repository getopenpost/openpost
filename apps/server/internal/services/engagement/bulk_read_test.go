package engagement

import (
	"fmt"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/inboxchanges"
	"github.com/stretchr/testify/require"
)

func TestMarkAllReadUsesListFiltersBeyondLoadedPages(t *testing.T) {
	t.Parallel()
	s := admissionTestService(t)
	actor := Actor{UserID: "u"}
	_, err := s.db.NewInsert().Model(&models.SocialAccount{ID: "a2", WorkspaceID: "w", Platform: "bluesky", AccountID: "remote2", Slug: "remote2", AccessTokenEnc: []byte("token"), IsActive: true}).Exec(t.Context())
	require.NoError(t, err)
	for i := range 137 {
		_, err := s.db.NewInsert().Model(&models.EngagementItem{ID: fmt.Sprintf("bulk-%03d", i), WorkspaceID: "w", RenditionID: "r", SocialAccountID: "a", Platform: "bluesky", RemoteID: fmt.Sprintf("remote-%d", i), LastSeenAt: time.Now().UTC()}).Exec(t.Context())
		require.NoError(t, err)
	}
	for _, row := range []models.EngagementItem{
		{ID: "ours", IsOurs: true}, {ID: "archived", ArchivedAt: time.Now().UTC()},
		{ID: "other-platform", Platform: "mastodon"}, {ID: "other-account", SocialAccountID: "a2"},
	} {
		row.WorkspaceID, row.RenditionID, row.RemoteID, row.LastSeenAt = "w", "r", row.ID, time.Now().UTC()
		if row.Platform == "" {
			row.Platform = "bluesky"
		}
		if row.SocialAccountID == "" {
			row.SocialAccountID = "a"
		}
		_, err := s.db.NewInsert().Model(&row).Exec(t.Context())
		require.NoError(t, err)
	}
	input := Query{WorkspaceID: "w", Platform: "bluesky", AccountID: "a", PublicationID: "p", UnreadOnly: true, Limit: 2}
	before, err := s.ListEngagement(t.Context(), actor, input)
	require.NoError(t, err)
	require.Len(t, before.Items, 2)
	require.Equal(t, 138, before.Total)
	head, err := inboxchanges.Read(t.Context(), s.db, "w", "")
	require.NoError(t, err)
	count, err := s.MarkAllRead(t.Context(), actor, input)
	require.NoError(t, err)
	require.Equal(t, 138, count)
	after, err := s.ListEngagement(t.Context(), actor, input)
	require.NoError(t, err)
	require.Zero(t, after.Total)
	changes, err := inboxchanges.Read(t.Context(), s.db, "w", head.Cursor)
	require.NoError(t, err)
	require.Len(t, changes.Changes, 138)
	for _, id := range []string{"ours", "archived", "other-platform", "other-account"} {
		var item models.EngagementItem
		require.NoError(t, s.db.NewSelect().Model(&item).Where("id = ?", id).Scan(t.Context()))
		require.True(t, item.ReadAt.IsZero(), id)
	}
	count, err = s.MarkAllRead(t.Context(), actor, input)
	require.NoError(t, err)
	require.Zero(t, count)
	_, err = s.MarkAllRead(t.Context(), Actor{UserID: "u", CredentialWorkspaceID: "other"}, input)
	require.ErrorIs(t, err, ErrAccessDenied)
	_, err = s.db.NewUpdate().Model((*models.WorkspaceMember)(nil)).Set("role = ?", models.WorkspaceRoleViewer).Where("workspace_id = ? AND user_id = ?", "w", "u").Exec(t.Context())
	require.NoError(t, err)
	_, err = s.MarkAllRead(t.Context(), actor, input)
	require.ErrorIs(t, err, ErrAccessDenied)
}
