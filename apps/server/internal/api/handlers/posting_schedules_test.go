package handlers

import (
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
)

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
