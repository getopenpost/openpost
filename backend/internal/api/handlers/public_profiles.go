package handlers

import (
	"context"
	"database/sql"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/publicprofiles"
	"github.com/openpost/backend/internal/usernames"
	"github.com/uptrace/bun"
)

const publicProfileActivityDays = 365

type PublicProfileHandler struct {
	db      *bun.DB
	enabled bool
}

func NewPublicProfileHandler(db *bun.DB, enabled ...bool) *PublicProfileHandler {
	publicProfilesEnabled := true
	if len(enabled) > 0 {
		publicProfilesEnabled = enabled[0]
	}
	return &PublicProfileHandler{db: db, enabled: publicProfilesEnabled}
}

type GetPublicProfileInput struct {
	Username string `path:"username" doc:"Public profile username"`
}

type PublicProfileActivityDay struct {
	Date  string `json:"date" doc:"UTC activity date in YYYY-MM-DD format"`
	Count int    `json:"count" doc:"Published OpenPost publications on this date"`
	Level int    `json:"level" doc:"Activity intensity from 0 through 4"`
}

type PublicProfileRanking struct {
	Key   string `json:"key" doc:"Stable platform or workspace identifier"`
	Name  string `json:"name" doc:"Display label"`
	Count int    `json:"count" doc:"Published destinations or publications"`
}

type PublicProfileOutput struct {
	Body struct {
		Username      string                     `json:"username"`
		VisibleFields []string                   `json:"visible_fields" doc:"Optional account fields this profile owner chose to disclose"`
		DisplayName   string                     `json:"display_name,omitempty"`
		AvatarURL     string                     `json:"avatar_url,omitempty"`
		PlanID        string                     `json:"plan_id,omitempty" doc:"Highest active OpenPost plan available to the profile owner"`
		JoinedAt      *time.Time                 `json:"joined_at,omitempty"`
		LifetimePosts *int                       `json:"lifetime_posts,omitempty"`
		PeakPosts     *int                       `json:"peak_posts,omitempty"`
		CurrentStreak *int                       `json:"current_streak,omitempty"`
		LongestStreak *int                       `json:"longest_streak,omitempty"`
		ActiveDays    *int                       `json:"active_days,omitempty"`
		Activity      []PublicProfileActivityDay `json:"activity,omitempty"`
		TopPlatforms  []PublicProfileRanking     `json:"top_platforms,omitempty"`
		TopWorkspaces []PublicProfileRanking     `json:"top_workspaces,omitempty"`
	}
}

type publicProfilePublication struct {
	WorkspaceID string    `bun:"workspace_id"`
	ActualRunAt time.Time `bun:"actual_run_at"`
	UpdatedAt   time.Time `bun:"updated_at"`
}

type publicProfileRankingRow struct {
	Key   string `bun:"key"`
	Name  string `bun:"name"`
	Count int    `bun:"count"`
}

func (h *PublicProfileHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-public-profile",
		Method:      http.MethodGet,
		Path:        "/public/profiles/{username}",
		Summary:     "Get an opt-in public publishing profile",
		Tags:        []string{tagProfiles},
		Errors:      []int{403, 404, 500},
	}, func(ctx context.Context, input *GetPublicProfileInput) (*PublicProfileOutput, error) {
		return h.getPublicProfile(ctx, input)
	})
}

func (h *PublicProfileHandler) getPublicProfile(ctx context.Context, input *GetPublicProfileInput) (*PublicProfileOutput, error) {
	if !h.enabled {
		return nil, huma.Error403Forbidden("public profiles are disabled")
	}
	username := usernames.Normalize(input.Username)
	if usernames.Validate(username) != nil {
		return nil, huma.Error404NotFound("public profile not found")
	}
	user, err := h.loadPublicProfileUser(ctx, username)
	if err != nil {
		return nil, err
	}

	visibility := publicprofiles.Parse(user.PublicProfileVisibilityJSON)
	out := newPublicProfileOutput(user, visibility)
	if err := h.populatePublicProfileActivity(ctx, user, visibility, out); err != nil {
		return nil, err
	}
	if err := h.populatePublicProfilePlatforms(ctx, user, visibility, out); err != nil {
		return nil, err
	}
	if err := h.populatePublicProfileWorkspaces(ctx, user, visibility, out); err != nil {
		return nil, err
	}
	if err := h.populatePublicProfilePlan(ctx, user, visibility, out); err != nil {
		return nil, err
	}
	return out, nil
}

func (h *PublicProfileHandler) loadPublicProfileUser(ctx context.Context, username string) (*models.User, error) {
	var user models.User
	err := h.db.NewSelect().Model(&user).
		Where("LOWER(username) = ?", username).
		Where("public_profile_enabled = ?", true).
		Scan(ctx)
	if err == sql.ErrNoRows {
		return nil, huma.Error404NotFound("public profile not found")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load public profile")
	}
	return &user, nil
}

func newPublicProfileOutput(user *models.User, visibility publicprofiles.Visibility) *PublicProfileOutput {
	out := &PublicProfileOutput{}
	out.Body.Username = user.Username
	out.Body.VisibleFields = visibility.Fields()
	if visibility.Has(publicprofiles.FieldDisplayName) {
		out.Body.DisplayName = strings.TrimSpace(user.DisplayName)
		if out.Body.DisplayName == "" {
			out.Body.DisplayName = "@" + user.Username
		}
	}
	if visibility.Has(publicprofiles.FieldAvatar) {
		out.Body.AvatarURL = user.AvatarURL
	}
	if visibility.Has(publicprofiles.FieldJoinedAt) {
		joinedAt := user.CreatedAt
		out.Body.JoinedAt = &joinedAt
	}
	return out
}

func (h *PublicProfileHandler) populatePublicProfileActivity(
	ctx context.Context,
	user *models.User,
	visibility publicprofiles.Visibility,
	out *PublicProfileOutput,
) error {
	if !visibility.Has(publicprofiles.FieldActivity) {
		return nil
	}
	publications, err := h.loadPublishedProfilePublications(ctx, user.ID)
	if err != nil {
		return huma.Error500InternalServerError("failed to load public profile activity")
	}
	activity, peak, currentStreak, longestStreak, activeDays := publicProfileActivity(publications, time.Now().UTC())
	lifetimePosts := len(publications)
	out.Body.LifetimePosts = &lifetimePosts
	out.Body.PeakPosts = &peak
	out.Body.CurrentStreak = &currentStreak
	out.Body.LongestStreak = &longestStreak
	out.Body.ActiveDays = &activeDays
	out.Body.Activity = activity
	return nil
}

func (h *PublicProfileHandler) populatePublicProfilePlatforms(
	ctx context.Context,
	user *models.User,
	visibility publicprofiles.Visibility,
	out *PublicProfileOutput,
) error {
	if !visibility.Has(publicprofiles.FieldPlatforms) {
		return nil
	}
	topPlatforms, err := h.loadTopProfilePlatforms(ctx, user.ID)
	if err != nil {
		return huma.Error500InternalServerError("failed to load public profile platforms")
	}
	out.Body.TopPlatforms = profileRankings(topPlatforms)
	return nil
}

func (h *PublicProfileHandler) populatePublicProfileWorkspaces(
	ctx context.Context,
	user *models.User,
	visibility publicprofiles.Visibility,
	out *PublicProfileOutput,
) error {
	if !visibility.Has(publicprofiles.FieldWorkspaces) {
		return nil
	}
	topWorkspaces, err := h.loadTopProfileWorkspaces(ctx, user.ID)
	if err != nil {
		return huma.Error500InternalServerError("failed to load public profile workspaces")
	}
	out.Body.TopWorkspaces = profileRankings(topWorkspaces)
	return nil
}

func (h *PublicProfileHandler) populatePublicProfilePlan(
	ctx context.Context,
	user *models.User,
	visibility publicprofiles.Visibility,
	out *PublicProfileOutput,
) error {
	if !visibility.Has(publicprofiles.FieldPlan) {
		return nil
	}
	planID, err := h.loadPublicProfilePlan(ctx, user.ID)
	if err != nil {
		return huma.Error500InternalServerError("failed to load public profile plan")
	}
	out.Body.PlanID = planID
	return nil
}

func (h *PublicProfileHandler) loadPublicProfilePlan(ctx context.Context, userID string) (string, error) {
	var rows []struct {
		PlanID string `bun:"plan_id"`
	}
	err := h.db.NewSelect().
		TableExpr("organization_members AS member").
		ColumnExpr("DISTINCT subscription.plan_id AS plan_id").
		Join("JOIN billing_subscriptions AS subscription ON subscription.organization_id = member.organization_id").
		Where("member.user_id = ?", userID).
		Where("subscription.provider = ?", models.BillingProviderPaddle).
		Where("LOWER(subscription.status) IN ('active', 'trialing')").
		Where("subscription.plan_id != ''").
		Scan(ctx, &rows)
	if err != nil {
		return "", err
	}

	planRank := map[string]int{
		"starter": 1,
		"founder": 2,
		"pro":     3,
		"team":    4,
		"agency":  5,
	}
	selected := ""
	selectedRank := 0
	for _, row := range rows {
		planID := strings.ToLower(strings.TrimSpace(row.PlanID))
		if rank := planRank[planID]; rank > selectedRank {
			selected = planID
			selectedRank = rank
		}
	}
	return selected, nil
}

func (h *PublicProfileHandler) loadPublishedProfilePublications(ctx context.Context, userID string) ([]publicProfilePublication, error) {
	var rows []publicProfilePublication
	err := h.db.NewSelect().
		TableExpr("publications AS p").
		Column("p.workspace_id", "p.actual_run_at", "p.updated_at").
		Where("p.created_by = ?", userID).
		Where("p.status = ?", models.PublicationStatusPublished).
		Order("p.updated_at ASC").
		Scan(ctx, &rows)
	return rows, err
}

func (h *PublicProfileHandler) loadTopProfilePlatforms(ctx context.Context, userID string) ([]publicProfileRankingRow, error) {
	var rows []publicProfileRankingRow
	err := h.db.NewSelect().
		TableExpr("renditions AS r").
		ColumnExpr("r.platform AS key").
		ColumnExpr("r.platform AS name").
		ColumnExpr("COUNT(*) AS count").
		Join("JOIN publications AS p ON p.id = r.publication_id").
		Where("p.created_by = ?", userID).
		Where("r.status = ?", models.RenditionStatusPublished).
		Group("r.platform").
		OrderExpr("count DESC, r.platform ASC").
		Limit(5).
		Scan(ctx, &rows)
	return rows, err
}

func (h *PublicProfileHandler) loadTopProfileWorkspaces(ctx context.Context, userID string) ([]publicProfileRankingRow, error) {
	var rows []publicProfileRankingRow
	err := h.db.NewSelect().
		TableExpr("publications AS p").
		ColumnExpr("p.workspace_id AS key").
		ColumnExpr("w.name AS name").
		ColumnExpr("COUNT(*) AS count").
		Join("JOIN workspaces AS w ON w.id = p.workspace_id").
		Join("JOIN workspace_members AS wm ON wm.workspace_id = p.workspace_id AND wm.user_id = ? AND wm.status = ?", userID, models.WorkspaceMemberStatusActive).
		Where("p.created_by = ?", userID).
		Where("p.status = ?", models.PublicationStatusPublished).
		Group("p.workspace_id", "w.name").
		OrderExpr("count DESC, w.name ASC").
		Limit(5).
		Scan(ctx, &rows)
	return rows, err
}

func profileRankings(rows []publicProfileRankingRow) []PublicProfileRanking {
	result := make([]PublicProfileRanking, 0, len(rows))
	for _, row := range rows {
		result = append(result, PublicProfileRanking(row))
	}
	return result
}

func publicProfileActivity(publications []publicProfilePublication, now time.Time) ([]PublicProfileActivityDay, int, int, int, int) {
	daily := publicationActivityCounts(publications)
	peak, longest, activeDays := publicationActivityStats(daily)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	currentStreak := publicationCurrentStreak(daily, today)
	activity := publicationActivityWindow(daily, today)
	return activity, peak, currentStreak, longest, activeDays
}

func publicationActivityCounts(publications []publicProfilePublication) map[string]int {
	daily := make(map[string]int)
	for _, publication := range publications {
		publishedAt := publication.ActualRunAt
		if publishedAt.IsZero() {
			publishedAt = publication.UpdatedAt
		}
		if publishedAt.IsZero() {
			continue
		}
		daily[publishedAt.UTC().Format(time.DateOnly)]++
	}
	return daily
}

func publicationActivityStats(daily map[string]int) (int, int, int) {
	dates := make([]string, 0, len(daily))
	peak := 0
	for date, count := range daily {
		dates = append(dates, date)
		if count > peak {
			peak = count
		}
	}
	sort.Strings(dates)
	longest := 0
	run := 0
	previous := time.Time{}
	for _, date := range dates {
		current, err := time.Parse(time.DateOnly, date)
		if err != nil {
			continue
		}
		if !previous.IsZero() && current.Sub(previous) == 24*time.Hour {
			run++
		} else {
			run = 1
		}
		if run > longest {
			longest = run
		}
		previous = current
	}
	return peak, longest, len(dates)
}

func publicationCurrentStreak(daily map[string]int, today time.Time) int {
	streakCursor := today
	if daily[streakCursor.Format(time.DateOnly)] == 0 {
		streakCursor = streakCursor.AddDate(0, 0, -1)
	}
	currentStreak := 0
	for daily[streakCursor.Format(time.DateOnly)] > 0 {
		currentStreak++
		streakCursor = streakCursor.AddDate(0, 0, -1)
	}
	return currentStreak
}

func publicationActivityWindow(daily map[string]int, today time.Time) []PublicProfileActivityDay {
	start := today.AddDate(0, 0, -(publicProfileActivityDays - 1))
	activityPeak := 0
	for day := start; !day.After(today); day = day.AddDate(0, 0, 1) {
		if count := daily[day.Format(time.DateOnly)]; count > activityPeak {
			activityPeak = count
		}
	}
	activity := make([]PublicProfileActivityDay, 0, publicProfileActivityDays)
	for day := start; !day.After(today); day = day.AddDate(0, 0, 1) {
		date := day.Format(time.DateOnly)
		count := daily[date]
		level := 0
		if count > 0 && activityPeak > 0 {
			level = (count*4 + activityPeak - 1) / activityPeak
			if level < 1 {
				level = 1
			}
		}
		activity = append(activity, PublicProfileActivityDay{Date: date, Count: count, Level: level})
	}
	return activity
}
