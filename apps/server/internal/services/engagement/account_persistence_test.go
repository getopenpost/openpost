package engagement

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/dataretention"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestYouTubeRetiredCommentReusesItemAndAutomationReceipt(t *testing.T) {
	s := admissionTestService(t)
	ctx := t.Context()
	now := time.Now().UTC()
	for _, model := range []any{(*models.SocialAccount)(nil), (*models.Rendition)(nil), (*models.EngagementItem)(nil)} {
		_, err := s.db.NewUpdate().Model(model).Set("platform = ?", "youtube").Where("id IN (?)", bun.List([]string{"a", "r", "c"})).Exec(ctx)
		require.NoError(t, err)
	}
	reply := AutomationReply{ID: "sent-reply", WorkspaceID: "w", ItemID: "c", WorkflowID: "wf", RunID: "run", StepID: "reply", UserID: "u", Channel: "public", Body: "Already answered", ItemBody: "Fetched comment", State: "sent", JobID: "original-job", CreatedAt: now, UpdatedAt: now}
	_, err := s.db.NewInsert().Model(&reply).Exec(ctx)
	require.NoError(t, err)
	_, err = s.db.NewUpdate().Model((*models.EngagementItem)(nil)).Set("replied_at = ?", now).Where("id = ?", "c").Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, dataretention.PurgeYouTube(ctx, s.db, now, "w", "a"))
	require.NoError(t, dataretention.PurgeYouTube(ctx, s.db, now, "w", "a"))
	var retired models.EngagementItem
	require.NoError(t, s.db.NewSelect().Model(&retired).Where("id = ?", "c").Scan(ctx))
	require.Equal(t, dataretention.RetiredYouTubeIdentity("w", "comment"), retired.RemoteID)
	var account models.SocialAccount
	var rendition models.Rendition
	require.NoError(t, s.db.NewSelect().Model(&account).Where("id = ?", "a").Scan(ctx))
	require.NoError(t, s.db.NewSelect().Model(&rendition).Where("id = ?", "r").Scan(ctx))
	for i := 0; i < 2; i++ {
		require.NoError(t, s.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
			item, isNew, err := persistEngagementComment(ctx, tx, rendition, account, platform.Comment{ID: "comment", Text: "Refreshed comment", CanReply: true}, now.Add(time.Minute))
			require.NoError(t, err)
			require.False(t, isNew, "reconnect must not emit a new comment or repeat automation admission")
			require.Equal(t, "c", item.ID)
			require.Equal(t, "comment", item.RemoteID)
			require.False(t, item.RepliedAt.IsZero())
			return err
		}))
	}
	count, err := s.db.NewSelect().Model((*models.EngagementItem)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, count)
	require.NoError(t, s.db.NewSelect().Model(&reply).WherePK().Scan(ctx))
	require.Equal(t, "c", reply.ItemID)
	require.Equal(t, "sent", reply.State)
	require.Equal(t, "original-job", reply.JobID)
}
