package handlers

import (
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
)

// ---------------------------------------------------------------------------
// findNextConfiguredScheduleSlotTime tests
// ---------------------------------------------------------------------------

func TestFindNextConfiguredScheduleSlotTime_ReturnsFirstFreeSlot(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, time.May, 4, 8, 0, 0, 0, loc) // Monday
	schedules := []models.PostingSchedule{
		{ID: "slot-1", DayOfWeek: int(time.Monday), UTCHour: 9, UTCMinute: 0},
		{ID: "slot-2", DayOfWeek: int(time.Monday), UTCHour: 17, UTCMinute: 0},
	}

	slot, when := findNextConfiguredScheduleSlotTime(now, loc, schedules, nil)
	if slot == nil {
		t.Fatal("expected a slot")
		return
	}
	if slot.ID != "slot-1" {
		t.Fatalf("expected slot-1, got %q", slot.ID)
	}
	expected := time.Date(2026, time.May, 4, 9, 0, 0, 0, loc)
	if !when.Equal(expected) {
		t.Fatalf("expected %s, got %s", expected, when)
	}
}

func TestFindNextConfiguredScheduleSlotTime_SkipsOccupiedSlotReturnsLaterSlotSameDay(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, time.May, 4, 8, 0, 0, 0, loc) // Monday
	schedules := []models.PostingSchedule{
		{ID: "slot-1", DayOfWeek: int(time.Monday), UTCHour: 9, UTCMinute: 0},
		{ID: "slot-2", DayOfWeek: int(time.Monday), UTCHour: 17, UTCMinute: 0},
	}
	scheduledPosts := []models.Post{
		{ScheduledAt: time.Date(2026, time.May, 4, 9, 0, 0, 0, time.UTC)},
	}

	slot, when := findNextConfiguredScheduleSlotTime(now, loc, schedules, scheduledPosts)
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
	scheduledPosts := []models.Post{
		{ScheduledAt: time.Date(2026, time.May, 4, 6, 0, 0, 0, time.UTC)},
	}

	slot, when := findNextConfiguredScheduleSlotTime(now, loc, schedules, scheduledPosts)
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

	slot, when := findNextConfiguredScheduleSlotTime(now, loc, nil, nil)
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

	slot, when := findNextConfiguredScheduleSlotTime(now, loc, schedules, nil)
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

func TestFindNextConfiguredScheduleSlotTime_PrefersEarliestSlotWhenMultipleFree(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, time.May, 4, 8, 0, 0, 0, loc) // Monday
	schedules := []models.PostingSchedule{
		{ID: "slot-2", DayOfWeek: int(time.Monday), UTCHour: 17, UTCMinute: 0},
		{ID: "slot-1", DayOfWeek: int(time.Monday), UTCHour: 9, UTCMinute: 0},
	}

	slot, when := findNextConfiguredScheduleSlotTime(now, loc, schedules, nil)
	if slot == nil {
		t.Fatal("expected a slot")
		return
	}
	if slot.ID != "slot-1" {
		t.Fatalf("expected slot-1, got %q", slot.ID)
	}
	expected := time.Date(2026, time.May, 4, 9, 0, 0, 0, loc)
	if !when.Equal(expected) {
		t.Fatalf("expected %s, got %s", expected, when)
	}
}

func TestFindNextConfiguredScheduleSlotTime_SkipsToNextDayWhenAllSlotsOnDayOccupied(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, time.May, 4, 5, 0, 0, 0, loc) // Monday
	schedules := []models.PostingSchedule{
		{ID: "slot-1", DayOfWeek: int(time.Monday), UTCHour: 6, UTCMinute: 0},
		{ID: "slot-2", DayOfWeek: int(time.Monday), UTCHour: 9, UTCMinute: 0},
		{ID: "slot-3", DayOfWeek: int(time.Tuesday), UTCHour: 9, UTCMinute: 0},
	}
	scheduledPosts := []models.Post{
		{ScheduledAt: time.Date(2026, time.May, 4, 6, 0, 0, 0, time.UTC)},
		{ScheduledAt: time.Date(2026, time.May, 4, 9, 0, 0, 0, time.UTC)},
	}

	slot, when := findNextConfiguredScheduleSlotTime(now, loc, schedules, scheduledPosts)
	if slot == nil {
		t.Fatal("expected a slot")
		return
	}
	if slot.ID != "slot-3" {
		t.Fatalf("expected slot-3, got %q", slot.ID)
	}
	expected := time.Date(2026, time.May, 5, 9, 0, 0, 0, loc) // Tuesday
	if !when.Equal(expected) {
		t.Fatalf("expected Tuesday %s, got %s", expected, when)
	}
}

func TestFindNextConfiguredScheduleSlotTime_ReturnsNilWhenAllSlotsFullInLookahead(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, time.May, 4, 5, 0, 0, 0, loc) // Monday
	schedules := []models.PostingSchedule{
		{ID: "slot-1", DayOfWeek: int(time.Monday), UTCHour: 6, UTCMinute: 0},
	}

	scheduledPosts := make([]models.Post, 0, 30)
	for i := 0; i < 30; i++ {
		day := time.Date(2026, time.May, 4+i*7, 6, 0, 0, 0, time.UTC)
		scheduledPosts = append(scheduledPosts, models.Post{ScheduledAt: day})
	}

	slot, when := findNextConfiguredScheduleSlotTime(now, loc, schedules, scheduledPosts)
	if slot != nil {
		t.Fatalf("expected nil slot after exhausting lookahead, got %q", slot.ID)
	}
	if !when.IsZero() {
		t.Fatalf("expected zero time, got %s", when)
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

	slot, when := findNextConfiguredScheduleSlotTime(now, loc, schedules, nil)
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

// ---------------------------------------------------------------------------
// findNextOverflowPostingTime tests
// ---------------------------------------------------------------------------

func TestFindNextOverflowPostingTime_ReturnsGapAfterLastPost(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, time.May, 4, 8, 0, 0, 0, loc)
	scheduledPosts := []models.Post{
		{ScheduledAt: time.Date(2026, time.May, 4, 9, 0, 0, 0, time.UTC)},
		{ScheduledAt: time.Date(2026, time.May, 4, 11, 0, 0, 0, time.UTC)},
	}

	when := findNextOverflowPostingTime(now, loc, scheduledPosts, 90)
	expected := time.Date(2026, time.May, 4, 12, 30, 0, 0, loc)
	if !when.Equal(expected) {
		t.Fatalf("expected %s, got %s", expected, when)
	}
}

func TestFindNextOverflowPostingTime_ReturnsZeroTimeWhenNoScheduledPosts(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, time.May, 4, 8, 0, 0, 0, loc)

	when := findNextOverflowPostingTime(now, loc, nil, 60)
	if !when.IsZero() {
		t.Fatalf("expected zero time, got %s", when)
	}
}

func TestFindNextOverflowPostingTime_ReturnsZeroTimeWhenGapIsZero(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, time.May, 4, 8, 0, 0, 0, loc)
	scheduledPosts := []models.Post{
		{ScheduledAt: time.Date(2026, time.May, 4, 9, 0, 0, 0, time.UTC)},
	}

	when := findNextOverflowPostingTime(now, loc, scheduledPosts, 0)
	if !when.IsZero() {
		t.Fatalf("expected zero time, got %s", when)
	}
}

func TestFindNextOverflowPostingTime_ReturnsZeroTimeWhenGapIsNegative(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, time.May, 4, 8, 0, 0, 0, loc)
	scheduledPosts := []models.Post{
		{ScheduledAt: time.Date(2026, time.May, 4, 9, 0, 0, 0, time.UTC)},
	}

	when := findNextOverflowPostingTime(now, loc, scheduledPosts, -1)
	if !when.IsZero() {
		t.Fatalf("expected zero time, got %s", when)
	}
}

func TestFindNextOverflowPostingTime_ReturnsGapAfterSinglePost(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, time.May, 4, 8, 0, 0, 0, loc)
	scheduledPosts := []models.Post{
		{ScheduledAt: time.Date(2026, time.May, 4, 9, 0, 0, 0, time.UTC)},
	}

	when := findNextOverflowPostingTime(now, loc, scheduledPosts, 60)
	expected := time.Date(2026, time.May, 4, 10, 0, 0, 0, loc)
	if !when.Equal(expected) {
		t.Fatalf("expected %s, got %s", expected, when)
	}
}

func TestFindNextOverflowPostingTime_UsesLatestPostOnDay(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, time.May, 4, 5, 0, 0, 0, loc)
	scheduledPosts := []models.Post{
		{ScheduledAt: time.Date(2026, time.May, 4, 6, 0, 0, 0, time.UTC)},
		{ScheduledAt: time.Date(2026, time.May, 4, 9, 0, 0, 0, time.UTC)},
		{ScheduledAt: time.Date(2026, time.May, 4, 14, 0, 0, 0, time.UTC)},
	}

	when := findNextOverflowPostingTime(now, loc, scheduledPosts, 60)
	expected := time.Date(2026, time.May, 4, 15, 0, 0, 0, loc)
	if !when.Equal(expected) {
		t.Fatalf("expected %s, got %s", expected, when)
	}
}

func TestFindNextOverflowPostingTime_SkipsDayWithNoPosts(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, time.May, 4, 5, 0, 0, 0, loc) // Monday
	scheduledPosts := []models.Post{
		{ScheduledAt: time.Date(2026, time.May, 5, 9, 0, 0, 0, time.UTC)}, // Tuesday
	}

	when := findNextOverflowPostingTime(now, loc, scheduledPosts, 60)
	expected := time.Date(2026, time.May, 5, 10, 0, 0, 0, loc) // Tuesday
	if !when.Equal(expected) {
		t.Fatalf("expected %s, got %s", expected, when)
	}
}

func TestFindNextOverflowPostingTime_ReturnsZeroWhenFallbackExceedsDayEnd(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, time.May, 4, 5, 0, 0, 0, loc)
	scheduledPosts := []models.Post{
		{ScheduledAt: time.Date(2026, time.May, 4, 23, 30, 0, 0, time.UTC)},
	}

	when := findNextOverflowPostingTime(now, loc, scheduledPosts, 60)
	// 23:30 + 60m = 00:30 next day, which is past dayEnd (midnight)
	if !when.IsZero() {
		t.Fatalf("expected zero time when fallback exceeds day end, got %s", when)
	}
}

func TestFindNextOverflowPostingTime_DoesNotReturnTimeBeforeNow(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, time.May, 4, 15, 0, 0, 0, loc)
	scheduledPosts := []models.Post{
		{ScheduledAt: time.Date(2026, time.May, 4, 9, 0, 0, 0, time.UTC)},
	}

	when := findNextOverflowPostingTime(now, loc, scheduledPosts, 60)
	// 9:00 + 60m = 10:00, which is before now (15:00), so skip
	if !when.IsZero() {
		t.Fatalf("expected zero time when fallback is before now, got %s", when)
	}
}

func TestFindNextOverflowPostingTime_ReturnsZeroWhenNoPostsAfterNow(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, time.May, 5, 5, 0, 0, 0, loc) // Tuesday
	scheduledPosts := []models.Post{
		{ScheduledAt: time.Date(2026, time.May, 4, 9, 0, 0, 0, time.UTC)}, // Monday - before now
	}

	when := findNextOverflowPostingTime(now, loc, scheduledPosts, 60)
	// The post is before now, so lastPost + 60 = 10:00 Monday, which is before now
	// It doesn't match fallbackTime.After(now), so skip
	if !when.IsZero() {
		t.Fatalf("expected zero time when all posts are before now, got %s", when)
	}
}

// ---------------------------------------------------------------------------
// postingScheduleResponseForWorkspace test
// ---------------------------------------------------------------------------

func TestPostingScheduleResponseForWorkspaceReturnsStoredLocalFields(t *testing.T) {
	loc, err := time.LoadLocation("Europe/Lisbon")
	if err != nil {
		t.Fatalf("load location: %v", err)
	}

	schedule := models.PostingSchedule{
		ID:          "slot-1",
		WorkspaceID: "workspace-1",
		DayOfWeek:   int(time.Monday),
		UTCHour:     9,
		UTCMinute:   15,
	}

	resp := postingScheduleResponseForWorkspace(time.Date(2026, time.January, 5, 0, 0, 0, 0, loc), loc, schedule)
	if resp.LocalDayOfWeek != int(time.Monday) || resp.LocalHour != 9 || resp.LocalMinute != 15 {
		t.Fatalf("expected local fields to mirror stored wall-clock schedule, got %+v", resp)
	}
}
