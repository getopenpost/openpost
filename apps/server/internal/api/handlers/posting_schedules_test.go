package handlers

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/stretchr/testify/require"
)

func TestPostingScheduleBatchDeleteIsAtomicAndWorkspaceScoped(t *testing.T) {
	t.Parallel()
	srv := newWorkspaceTestServer(t, entitlements.NewSelfHostedService())
	seedWorkspaceUserAndMember(t, srv.db, "user-1", "user@example.com", models.WorkspaceRoleAdmin)
	_, err := srv.db.NewCreateTable().Model((*models.PostingSchedule)(nil)).Exec(t.Context())
	require.NoError(t, err)
	handler := NewPostingScheduleHandler(srv.db, testAuthenticator{})
	handler.DeleteSchedule(srv.api)
	handler.BatchDeleteSchedules(srv.api)
	ids := make([]string, 0, 7)
	for day := range 7 {
		id := fmt.Sprintf("slot-%d", day)
		ids = append(ids, id)
		_, err = srv.db.NewInsert().Model(&models.PostingSchedule{ID: id, WorkspaceID: "ws-1", UTCHour: 9, DayOfWeek: day, IsActive: true}).Exec(t.Context())
		require.NoError(t, err)
	}
	body := map[string]any{"workspace_id": "ws-1", "ids": ids}
	_, err = srv.db.NewInsert().Model(&models.PostingSchedule{ID: "other-time", WorkspaceID: "ws-1", UTCHour: 18, DayOfWeek: 0, IsActive: true}).Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.Workspace{ID: "ws-2", OrganizationID: "org-1", Name: "Other"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.PostingSchedule{ID: "foreign-slot", WorkspaceID: "ws-2", UTCHour: 9, DayOfWeek: 0, IsActive: true}).Exec(t.Context())
	require.NoError(t, err)
	foreign := srv.postJSON(t, "/api/v1/posting-schedules/batch-delete", map[string]any{"workspace_id": "ws-1", "ids": []string{ids[0], "foreign-slot"}}, "web-token")
	require.Equal(t, http.StatusForbidden, foreign.Code, foreign.Body.String())
	unauthorized := srv.postJSON(t, "/api/v1/posting-schedules/batch-delete", map[string]any{"workspace_id": "ws-2", "ids": []string{"foreign-slot"}}, "web-token")
	require.Equal(t, http.StatusForbidden, unauthorized.Code, unauthorized.Body.String())
	unchanged, err := srv.db.NewSelect().Model((*models.PostingSchedule)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.EqualValues(t, 9, unchanged)
	_, err = srv.db.NewDelete().Model((*models.PostingSchedule)(nil)).Where("id = ?", "foreign-slot").Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.ExecContext(t.Context(), "CREATE TRIGGER reject_fourth_slot BEFORE DELETE ON posting_schedules WHEN OLD.id = 'slot-3' BEGIN SELECT RAISE(ABORT, 'blocked slot'); END")
	require.NoError(t, err)
	failed := srv.postJSON(t, "/api/v1/posting-schedules/batch-delete", body, "web-token")
	require.Equal(t, http.StatusInternalServerError, failed.Code, failed.Body.String())
	retained, err := srv.db.NewSelect().Model((*models.PostingSchedule)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.EqualValues(t, 8, retained)
	_, err = srv.db.ExecContext(t.Context(), "DROP TRIGGER reject_fourth_slot")
	require.NoError(t, err)
	deleted := srv.postJSON(t, "/api/v1/posting-schedules/batch-delete", body, "web-token")
	require.Equal(t, http.StatusOK, deleted.Code, deleted.Body.String())
	count, err := srv.db.NewSelect().Model((*models.PostingSchedule)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.EqualValues(t, 1, count)
	var remaining models.PostingSchedule
	require.NoError(t, srv.db.NewSelect().Model(&remaining).Scan(t.Context()))
	require.Equal(t, "other-time", remaining.ID)
	retry := srv.postJSON(t, "/api/v1/posting-schedules/batch-delete", body, "web-token")
	require.Equal(t, http.StatusOK, retry.Code, retry.Body.String())
}

// ---------------------------------------------------------------------------
// findNextConfiguredScheduleSlotTime tests
// ---------------------------------------------------------------------------

func TestFindNextConfiguredScheduleSlotTime_WindowBlocksNearbyScheduleWithDelay(t *testing.T) {
	t.Parallel()
	loc := time.UTC
	now := time.Date(2026, time.May, 4, 8, 0, 0, 0, loc)
	schedules := []models.PostingSchedule{
		{ID: "slot-1", DayOfWeek: int(time.Monday), UTCHour: 9, UTCMinute: 0},
		{ID: "slot-2", DayOfWeek: int(time.Monday), UTCHour: 9, UTCMinute: 30},
	}
	scheduledPublications := []models.Publication{
		{ScheduledAt: time.Date(2026, time.May, 4, 9, 10, 0, 0, time.UTC), RandomDelayExplicit: true, RandomDelayMinutes: 5},
	}
	slot, _ := findNextConfiguredScheduleSlotTime(now, loc, schedules, scheduledPublications, 15)
	if slot == nil {
		t.Fatal("expected a slot")
	}
	if slot.ID != "slot-2" {
		t.Fatalf("expected 09:00 blocked by 09:10 with +-15 window, should return slot-2, got %q", slot.ID)
	}
}

// ---------------------------------------------------------------------------
// postingScheduleResponseForWorkspace test
// ---------------------------------------------------------------------------
