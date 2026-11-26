package analytics

import (
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

func TestManualAnalyticsRefreshCollectsOlderPublishedRenditions(t *testing.T) {
	t.Parallel()
	db := newAnalyticsTestDB(t)
	account := seedAnalyticsAccount(t, db, "")
	now := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
	post := seedAnalyticsPublication(t, db, account.WorkspaceID, "july-video", now.AddDate(0, 0, -95))
	_, err := db.NewInsert().Model(&models.Rendition{ID: "older-rendition", PublicationID: post.ID, SocialAccountID: account.ID, Platform: account.Platform, Status: models.RenditionStatusPublished, ExternalID: "real-video"}).Exec(t.Context())
	require.NoError(t, err)
	service := NewService(db, staticTokenSource{})
	service.now = func() time.Time { return now }
	service.SetFeatureGate(alwaysEnabledGate{})
	service.SetProvider("test", &fakeAnalyticsAdapter{support: platform.AnalyticsSupport{Account: true, Content: true}})
	_, err = service.RefreshWorkspace(t.Context(), account.WorkspaceID)
	require.NoError(t, err)
	var jobs []models.Job
	err = db.NewSelect().Model(&jobs).Where("type = ?", JobTypeRenditionSync).Scan(t.Context())
	require.NoError(t, err)
	require.Len(t, jobs, 1, "explicit refresh must admit a 95-day-old rendition")
	require.JSONEq(t, `{"rendition_id":"older-rendition"}`, jobs[0].Payload)
}
