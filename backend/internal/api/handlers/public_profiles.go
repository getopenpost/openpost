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
	"github.com/openpost/backend/internal/usernames"
	"github.com/uptrace/bun"
)

const publicProfileActivityDays = 365

type PublicProfileHandler struct {
	db *bun.DB
}

func NewPublicProfileHandler(db *bun.DB) *PublicProfileHandler {
	return &PublicProfileHandler{db: db}
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
		DisplayName   string                     `json:"display_name"`
		AvatarURL     string                     `json:"avatar_url"`
		JoinedAt      time.Time                  `json:"joined_at"`
		LifetimePosts int                        `json:"lifetime_posts"`
		PeakPosts     int                        `json:"peak_posts"`
		CurrentStreak int                        `json:"current_streak"`
		LongestStreak int                        `json:"longest_streak"`
		ActiveDays    int                        `json:"active_days"`
		Activity      []PublicProfileActivityDay `json:"activity"`
		TopPlatforms  []PublicProfileRanking     `json:"top_platforms"`
		TopWorkspaces []PublicProfileRanking     `json:"top_workspaces"`
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
		Errors:      []int{404, 500},
	}, func(ctx context.Context, input *GetPublicProfileInput) (*PublicProfileOutput, error) {
		username := usernames.Normalize(input.Username)
		if usernames.Validate(username) != nil {
			return nil, huma.Error404NotFound("public profile not found")
		}

		var user models.User
		if err := h.db.NewSelect().Model(&user).
			Where("LOWER(username) = ?", username).
			Where("public_profile_enabled = ?", true).
			Scan(ctx); err != nil {
			if err == sql.ErrNoRows {
				return nil, huma.Error404NotFound("public profile not found")
			}
			return nil, huma.Error500InternalServerError("failed to load public profile")
		}

		publications, err := h.loadPublishedProfilePublications(ctx, user.ID)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load public profile activity")
		}
		topPlatforms, err := h.loadTopProfilePlatforms(ctx, user.ID)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load public profile platforms")
		}
		topWorkspaces, err := h.loadTopProfileWorkspaces(ctx, user.ID)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load public profile workspaces")
		}

		activity, peak, currentStreak, longestStreak, activeDays := publicProfileActivity(publications, time.Now().UTC())
		out := &PublicProfileOutput{}
		out.Body.Username = user.Username
		out.Body.DisplayName = strings.TrimSpace(user.DisplayName)
		if out.Body.DisplayName == "" {
			out.Body.DisplayName = "@" + user.Username
		}
		out.Body.AvatarURL = user.AvatarURL
		out.Body.JoinedAt = user.CreatedAt
		out.Body.LifetimePosts = len(publications)
		out.Body.PeakPosts = peak
		out.Body.CurrentStreak = currentStreak
		out.Body.LongestStreak = longestStreak
		out.Body.ActiveDays = activeDays
		out.Body.Activity = activity
		out.Body.TopPlatforms = profileRankings(topPlatforms)
		out.Body.TopWorkspaces = profileRankings(topWorkspaces)
		return out, nil
	})
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
		Join("JOIN workspace_members AS wm ON wm.workspace_id = p.workspace_id AND wm.user_id = ?", userID).
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
		result = append(result, PublicProfileRanking{Key: row.Key, Name: row.Name, Count: row.Count})
	}
	return result
}

func publicProfileActivity(publications []publicProfilePublication, now time.Time) ([]PublicProfileActivityDay, int, int, int, int) {
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

	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	streakCursor := today
	if daily[streakCursor.Format(time.DateOnly)] == 0 {
		streakCursor = streakCursor.AddDate(0, 0, -1)
	}
	currentStreak := 0
	for daily[streakCursor.Format(time.DateOnly)] > 0 {
		currentStreak++
		streakCursor = streakCursor.AddDate(0, 0, -1)
	}

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
	return activity, peak, currentStreak, longest, len(dates)
}
