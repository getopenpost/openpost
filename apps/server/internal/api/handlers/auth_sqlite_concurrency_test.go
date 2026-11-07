package handlers

import (
	"context"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type registrationConcurrentWriter struct {
	db        *bun.DB
	attempted bool
}

func (*registrationConcurrentWriter) BeforeQuery(ctx context.Context, _ *bun.QueryEvent) context.Context {
	return ctx
}

func (hook *registrationConcurrentWriter) AfterQuery(ctx context.Context, event *bun.QueryEvent) {
	if hook.attempted || event.Operation() != "SELECT" || !strings.Contains(event.Query, "users") {
		return
	}
	hook.attempted = true
	// A separate process may write after registration has inspected the user
	// count. It must wait for registration's write transaction, not invalidate
	// the snapshot registration will use to create the user.
	_, _ = hook.db.ExecContext(ctx, "INSERT INTO concurrent_writes (id) VALUES (1)")
}

func TestRegistrationSurvivesConcurrentSQLiteWriter(t *testing.T) {
	dsn := "file:" + filepath.Join(t.TempDir(), "registration.db") + "?mode=rwc"
	db, err := database.InitDB(dsn)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	_, err = db.NewCreateTable().Model((*models.User)(nil)).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.Exec("CREATE TABLE concurrent_writes (id INTEGER PRIMARY KEY)")
	require.NoError(t, err)
	writer, err := database.InitDB(dsn)
	require.NoError(t, err)
	t.Cleanup(func() { _ = writer.Close() })
	_, err = writer.Exec("PRAGMA busy_timeout=0")
	require.NoError(t, err)
	hook := &registrationConcurrentWriter{db: writer}
	db.AddQueryHook(hook)
	handler := NewAuthHandler(db, auth.NewService("test-secret"), nil, nil, nil, false)
	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler.Register(api)

	response := jsonRequest(t, e, http.MethodPost, "/api/v1/auth/register", map[string]any{
		"email": "first@example.com", "username": "first-user", "password": "password1234",
	}, "")
	require.True(t, hook.attempted)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var users []models.User
	require.NoError(t, db.NewSelect().Model(&users).Scan(t.Context()))
	require.Len(t, users, 1)
	require.True(t, users[0].IsAdmin)
	_, err = writer.Exec("INSERT INTO concurrent_writes (id) VALUES (2)")
	require.NoError(t, err)
}
