package handlers

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestCreateScheduledContentRejectsDueRunTimesWithoutPersistence(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name            string
		path            string
		scheduledAt     func(time.Time) time.Time
		randomDelay     int
		body            map[string]any
		expectedMessage string
	}{
		{
			name:            "post scheduled_at is not future",
			path:            "/api/v1/posts",
			scheduledAt:     func(now time.Time) time.Time { return now.Add(-time.Minute) },
			body:            map[string]any{"workspace_id": "ws-1", "content": "Past post"},
			expectedMessage: errPostScheduleFuture.Error(),
		},
		{
			name:            "thread scheduled_at is not future",
			path:            "/api/v1/posts/thread",
			scheduledAt:     func(now time.Time) time.Time { return now },
			body:            map[string]any{"workspace_id": "ws-1", "posts": []map[string]any{{"content": "One"}, {"content": "Two"}}},
			expectedMessage: errPostScheduleFuture.Error(),
		},
		{
			name:            "post random delay window reaches now",
			path:            "/api/v1/posts",
			scheduledAt:     func(now time.Time) time.Time { return now.Add(30 * time.Second) },
			randomDelay:     1,
			body:            map[string]any{"workspace_id": "ws-1", "content": "Unsafe delayed post"},
			expectedMessage: errPostRunAtFuture.Error(),
		},
		{
			name:            "thread random delay window reaches now",
			path:            "/api/v1/posts/thread",
			scheduledAt:     func(now time.Time) time.Time { return now.Add(30 * time.Second) },
			randomDelay:     1,
			body:            map[string]any{"workspace_id": "ws-1", "posts": []map[string]any{{"content": "One"}, {"content": "Two"}}},
			expectedMessage: errPostRunAtFuture.Error(),
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			srv := newPostMediaValidationTestServer(t)
			body := make(map[string]any, len(test.body)+2)
			for key, value := range test.body {
				body[key] = value
			}
			body["social_account_ids"] = []string{}
			body["scheduled_at"] = test.scheduledAt(time.Now().UTC()).Format(time.RFC3339Nano)
			body["random_delay_minutes"] = test.randomDelay

			resp := srv.request(t, http.MethodPost, test.path, body)

			require.Equal(t, http.StatusBadRequest, resp.Code, resp.Body.String())
			require.Contains(t, resp.Body.String(), test.expectedMessage)
			postCount, err := srv.db.NewSelect().Model((*models.Post)(nil)).Count(context.Background())
			require.NoError(t, err)
			require.Zero(t, postCount)
			jobCount, err := srv.db.NewSelect().Model((*models.Job)(nil)).Count(context.Background())
			require.NoError(t, err)
			require.Zero(t, jobCount)
		})
	}
}

func TestUpdatePostRejectsDueRunTimesBeforeMutation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name                string
		initialScheduleFrom time.Duration
		body                func(time.Time) map[string]any
		expectedMessage     string
	}{
		{
			name:                "scheduled_at is not future",
			initialScheduleFrom: 2 * time.Hour,
			body: func(now time.Time) map[string]any {
				return map[string]any{"scheduled_at": now.Add(-time.Minute).Format(time.RFC3339Nano)}
			},
			expectedMessage: errPostScheduleFuture.Error(),
		},
		{
			name:                "new schedule random delay window reaches now",
			initialScheduleFrom: 2 * time.Hour,
			body: func(now time.Time) map[string]any {
				return map[string]any{
					"scheduled_at":         now.Add(30 * time.Second).Format(time.RFC3339Nano),
					"random_delay_minutes": 1,
				}
			},
			expectedMessage: errPostRunAtFuture.Error(),
		},
		{
			name:                "random-delay-only update can reach now",
			initialScheduleFrom: 30 * time.Second,
			body: func(time.Time) map[string]any {
				return map[string]any{"random_delay_minutes": 1}
			},
			expectedMessage: errPostRunAtFuture.Error(),
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			srv := newPostMediaValidationTestServer(t)
			now := time.Now().UTC().Truncate(time.Millisecond)
			originalSchedule := now.Add(test.initialScheduleFrom)
			originalRunAt := originalSchedule
			post := &models.Post{
				ID:                 "scheduled-post",
				WorkspaceID:        "ws-1",
				CreatedByID:        "user-1",
				Content:            "Keep unchanged",
				Status:             statusScheduled,
				ScheduledAt:        originalSchedule,
				ActualRunAt:        originalRunAt,
				RandomDelayMinutes: 0,
				CreatedAt:          now,
			}
			_, err := srv.db.NewInsert().Model(post).Exec(context.Background())
			require.NoError(t, err)
			job := &models.Job{
				ID: "original-job", Type: jobTypePublishPost, Payload: `{"post_id":"scheduled-post"}`,
				Status: jobStatusPending, RunAt: originalRunAt, MaxAttempts: 3,
			}
			_, err = srv.db.NewInsert().Model(job).Exec(context.Background())
			require.NoError(t, err)

			resp := srv.request(t, http.MethodPatch, "/api/v1/posts/scheduled-post", test.body(now))

			require.Equal(t, http.StatusBadRequest, resp.Code, resp.Body.String())
			require.Contains(t, resp.Body.String(), test.expectedMessage)
			var stored models.Post
			require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", post.ID).Scan(context.Background()))
			require.Equal(t, statusScheduled, stored.Status)
			require.True(t, stored.ScheduledAt.Equal(originalSchedule))
			require.True(t, stored.ActualRunAt.Equal(originalRunAt))
			require.Zero(t, stored.RandomDelayMinutes)
			var jobs []models.Job
			require.NoError(t, srv.db.NewSelect().Model(&jobs).Scan(context.Background()))
			require.Len(t, jobs, 1)
			require.Equal(t, "original-job", jobs[0].ID)
			require.True(t, jobs[0].RunAt.Equal(originalRunAt))
		})
	}
}
