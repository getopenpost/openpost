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
	require.Equal(t, 9, unchanged)
	_, err = srv.db.NewDelete().Model((*models.PostingSchedule)(nil)).Where("id = ?", "foreign-slot").Exec(t.Context())
	require.NoError(t, err)
	_, err = srv.db.ExecContext(t.Context(), "CREATE TRIGGER reject_fourth_slot BEFORE DELETE ON posting_schedules WHEN OLD.id = 'slot-3' BEGIN SELECT RAISE(ABORT, 'blocked slot'); END")
	require.NoError(t, err)
	failed := srv.postJSON(t, "/api/v1/posting-schedules/batch-delete", body, "web-token")
	require.Equal(t, http.StatusInternalServerError, failed.Code, failed.Body.String())
	retained, err := srv.db.NewSelect().Model((*models.PostingSchedule)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 8, retained)
	_, err = srv.db.ExecContext(t.Context(), "DROP TRIGGER reject_fourth_slot")
	require.NoError(t, err)
	deleted := srv.postJSON(t, "/api/v1/posting-schedules/batch-delete", body, "web-token")
	require.Equal(t, http.StatusOK, deleted.Code, deleted.Body.String())
	count, err := srv.db.NewSelect().Model((*models.PostingSchedule)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count)
	var remaining models.PostingSchedule
	require.NoError(t, srv.db.NewSelect().Model(&remaining).Scan(t.Context()))
	require.Equal(t, "other-time", remaining.ID)
	retry := srv.postJSON(t, "/api/v1/posting-schedules/batch-delete", body, "web-token")
	require.Equal(t, http.StatusOK, retry.Code, retry.Body.String())
}

// ---------------------------------------------------------------------------
// findNextConfiguredScheduleSlotTime tests
// ---------------------------------------------------------------------------

func TestFindNextConfiguredScheduleSlotTime_SkipsOccupiedSlotReturnsLaterSlotSameDay(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, time.May, 4, 8, 0, 0, 0, loc) // Monday
	schedules := []models.PostingSchedule{
		{ID: "slot-1", DayOfWeek: int(time.Monday), UTCHour: 9, UTCMinute: 0},
		{ID: "slot-2", DayOfWeek: int(time.Monday), UTCHour: 17, UTCMinute: 0},
	}
	scheduledPublications := []models.Publication{
		{ScheduledAt: time.Date(2026, time.May, 4, 9, 0, 0, 0, time.UTC)},
	}

	slot, when := findNextConfiguredScheduleSlotTime(now, loc, schedules, scheduledPublications, 0)
	if slot == nil {
		t.Fatal("expected a slot")
		return
	}
	if slot.ID != "slot-2" {
		t.Fatalf("expected slot-2, got %q", slot.ID)
	}
	expected := time.Date(2026, time.May, 4, 17, 0, 0, 0, loc)
	if !when.Equal(expected) {
		t.Fatalf("expected %s, got %s", expected, when)
	}
}

func TestFindNextConfiguredScheduleSlotTime_SkipsOccupiedOnlySlotUntilNextWeek(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, time.May, 4, 5, 0, 0, 0, loc) // Monday
	schedules := []models.PostingSchedule{
		{ID: "slot-1", DayOfWeek: int(time.Monday), UTCHour: 6, UTCMinute: 0},
	}
	scheduledPublications := []models.Publication{
		{ScheduledAt: time.Date(2026, time.May, 4, 6, 0, 0, 0, time.UTC)},
	}

	slot, when := findNextConfiguredScheduleSlotTime(now, loc, schedules, scheduledPublications, 0)
	if slot == nil {
		t.Fatal("expected a slot")
		return
	}
	if slot.ID != "slot-1" {
		t.Fatalf("expected slot-1, got %q", slot.ID)
	}
	expected := time.Date(2026, time.May, 11, 6, 0, 0, 0, loc) // next Monday
	if !when.Equal(expected) {
		t.Fatalf("expected next week %s, got %s", expected, when)
	}
}

func TestFindNextConfiguredScheduleSlotTime_ReturnsNilWhenNoSchedules(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, time.May, 4, 8, 0, 0, 0, loc)

	slot, when := findNextConfiguredScheduleSlotTime(now, loc, nil, nil, 0)
	if slot != nil {
		t.Fatalf("expected nil slot, got %q", slot.ID)
	}
	if !when.IsZero() {
		t.Fatalf("expected zero time, got %s", when)
	}
}

func TestFindNextConfiguredScheduleSlotTime_SkipsPastSlot(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, time.May, 4, 10, 0, 0, 0, loc) // Monday 10AM
	schedules := []models.PostingSchedule{
		{ID: "slot-1", DayOfWeek: int(time.Monday), UTCHour: 9, UTCMinute: 0},
		{ID: "slot-2", DayOfWeek: int(time.Monday), UTCHour: 17, UTCMinute: 0},
	}

	slot, when := findNextConfiguredScheduleSlotTime(now, loc, schedules, nil, 0)
	if slot == nil {
		t.Fatal("expected a slot")
		return
	}
	if slot.ID != "slot-2" {
		t.Fatalf("expected slot-2, got %q", slot.ID)
	}
	expected := time.Date(2026, time.May, 4, 17, 0, 0, 0, loc)
	if !when.Equal(expected) {
		t.Fatalf("expected %s, got %s", expected, when)
	}
}

func TestFindNextConfiguredScheduleSlotTime_HandlesDSTTransition(t *testing.T) {
	loc, err := time.LoadLocation("Europe/Lisbon")
	if err != nil {
		t.Fatalf("load location: %v", err)
	}

	now := time.Date(2026, time.October, 24, 8, 30, 0, 0, loc)
	schedules := []models.PostingSchedule{
		{ID: "slot-1", DayOfWeek: int(time.Sunday), UTCHour: 9, UTCMinute: 0},
	}

	slot, when := findNextConfiguredScheduleSlotTime(now, loc, schedules, nil, 0)
	if slot == nil {
		t.Fatal("expected a slot")
	}

	expected := time.Date(2026, time.October, 25, 9, 0, 0, 0, loc)
	if !when.Equal(expected) {
		t.Fatalf("expected local slot %s, got %s", expected, when)
	}
	if when.UTC().Hour() != 9 {
		t.Fatalf("expected DST-adjusted UTC hour 9 after fallback, got %d", when.UTC().Hour())
	}
}

func TestFindNextConfiguredScheduleSlotTime_WindowBlocksNearbyScheduleWithDelay(t *testing.T) {
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

func TestIsSlotOccupied_WindowBlocksWithinDelaySum(t *testing.T) {
	loc := time.UTC
	slotTime := time.Date(2026, time.May, 4, 9, 0, 0, 0, loc)
	pubs := []models.Publication{
		{ScheduledAt: time.Date(2026, time.May, 4, 9, 10, 0, 0, time.UTC), RandomDelayExplicit: true, RandomDelayMinutes: 15},
	}
	if !isSlotOccupied(pubs, slotTime, 15) {
		t.Fatal("expected window block: 09:10 with 15+15 window should block 09:00")
	}
	pubs2 := []models.Publication{
		{ScheduledAt: time.Date(2026, time.May, 4, 9, 40, 0, 0, time.UTC), RandomDelayExplicit: true, RandomDelayMinutes: 15},
	}
	if isSlotOccupied(pubs2, slotTime, 15) {
		t.Fatal("expected no block: 09:40 diff 40 >=30 should not block 09:00")
	}
}

// ---------------------------------------------------------------------------
// postingScheduleResponseForWorkspace test
// ---------------------------------------------------------------------------
