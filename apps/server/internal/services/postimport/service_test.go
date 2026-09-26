package postimport

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

var postImportTestSchemaPath string

func TestMain(m *testing.M) {
	templateDir, err := os.MkdirTemp("", "openpost-postimport-tests-")
	if err != nil {
		fmt.Fprintf(os.Stderr, "create postimport test template directory: %v\n", err)
		os.Exit(1)
	}
	postImportTestSchemaPath = filepath.Join(templateDir, "schema.db")
	db, err := database.InitDB("file:" + postImportTestSchemaPath + "?mode=rwc")
	if err == nil {
		err = database.CreateSchema(db)
	}
	if db != nil {
		if closeErr := db.Close(); err == nil {
			err = closeErr
		}
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "create postimport test schema: %v\n", err)
		_ = os.RemoveAll(templateDir)
		os.Exit(1)
	}

	code := m.Run()
	if err := os.RemoveAll(templateDir); err != nil && code == 0 {
		fmt.Fprintf(os.Stderr, "remove postimport test template directory: %v\n", err)
		code = 1
	}
	os.Exit(code)
}

type stubTokenSource struct {
	token string
	calls atomic.Int64
	err   error
}

func (s *stubTokenSource) GetValidAccessToken(context.Context, string) (string, error) {
	s.calls.Add(1)
	return s.token, s.err
}

func newPostImportTestDB(t *testing.T) *bun.DB {
	t.Helper()
	template, err := os.ReadFile(postImportTestSchemaPath)
	require.NoError(t, err)
	databasePath := filepath.Join(t.TempDir(), "postimport.db")
	require.NoError(t, os.WriteFile(databasePath, template, 0o600))
	db, err := database.InitDB("file:" + databasePath + "?mode=rwc")
	require.NoError(t, err)
	now := time.Now().UTC()
	_, err = db.NewInsert().Model(&models.Organization{ID: "organization-1", Name: "Imports", CreatedByID: "user-1", CreatedAt: now, UpdatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", OrganizationID: "organization-1", Name: "Imports", CreatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return db
}

func seedPostImportAccount(t *testing.T, db *bun.DB, platform, accountID, instanceURL string) models.SocialAccount {
	t.Helper()
	account := models.SocialAccount{
		ID:              "account-" + platform,
		WorkspaceID:     "workspace-1",
		Slug:            "native-" + platform,
		Platform:        platform,
		AccountID:       accountID,
		AccountUsername: "owner",
		InstanceURL:     instanceURL,
		AccessTokenEnc:  []byte("encrypted"),
		IsActive:        true,
		CreatedAt:       time.Now().UTC(),
	}
	_, err := db.NewInsert().Model(&account).Exec(context.Background())
	require.NoError(t, err)
	return account
}

func countImported(t *testing.T, db *bun.DB, accountID string) int {
	t.Helper()
	count, err := db.NewSelect().Model((*models.ImportedPost)(nil)).
		Where("social_account_id = ?", accountID).
		Count(context.Background())
	require.NoError(t, err)
	return count
}

func loadImportState(t *testing.T, db *bun.DB, accountID string) models.PostImportState {
	t.Helper()
	state := models.PostImportState{}
	require.NoError(t, db.NewSelect().Model(&state).Where("social_account_id = ?", accountID).Scan(context.Background()))
	return state
}

func blueskyFeedServer(responses map[string]string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		cursor := req.URL.Query().Get("cursor")
		body, ok := responses[cursor]
		if !ok {
			body = `{"feed":[]}`
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
}

func blueskyFeedItem(uri, text, createdAt string) string {
	return fmt.Sprintf(`{"post":{"uri":%q,"author":{"did":"did:plc:owner","handle":"owner.test"},"record":{"text":%q,"createdAt":%q},"indexedAt":%q}}`,
		uri, text, createdAt, createdAt)
}

func TestEnableSetsWatermarkWithoutBackfill(t *testing.T) {
	server := blueskyFeedServer(map[string]string{
		"": `{"feed":[` + blueskyFeedItem("at://did:plc:owner/app.bsky.feed.post/old", "old post", "2026-01-10T10:00:00Z") + `]}`,
	})
	defer server.Close()

	db := newPostImportTestDB(t)
	account := seedPostImportAccount(t, db, "bluesky", "did:plc:owner", server.URL)
	tokens := &stubTokenSource{token: "token"}
	service := NewService(db, tokens)
	frozen := time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return frozen }

	state, err := service.Enable(context.Background(), "workspace-1", account.ID)
	require.NoError(t, err)
	require.True(t, state.Enabled)
	require.True(t, state.ImportWatermark.Equal(frozen))

	// The only provider post predates activation, so activation imports nothing.
	require.NoError(t, service.SyncAccount(context.Background(), "workspace-1", account.ID))
	require.Equal(t, 0, countImported(t, db, account.ID))

	// A post published after activation is imported on the next due cycle.
	_, err = db.NewUpdate().Model((*models.PostImportState)(nil)).
		Set("next_eligible_at = ?", frozen.Add(-time.Minute)).
		Set("last_success_at = ?", frozen.Add(-25*time.Hour)).
		Where("social_account_id = ?", account.ID).
		Exec(context.Background())
	require.NoError(t, err)

	server.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"feed":[` + blueskyFeedItem("at://did:plc:owner/app.bsky.feed.post/new", "new post", "2026-09-26T11:00:00Z") + `]}`))
	})
	require.NoError(t, service.SyncAccount(context.Background(), "workspace-1", account.ID))
	require.Equal(t, 1, countImported(t, db, account.ID))

	posts, err := service.ListImported(context.Background(), "workspace-1", account.ID, 10)
	require.NoError(t, err)
	require.Len(t, posts, 1)
	require.Equal(t, "external", posts[0].Origin)
}

func TestSyncDedupesRepeatedReads(t *testing.T) {
	server := blueskyFeedServer(map[string]string{
		"": `{"feed":[` + blueskyFeedItem("at://did:plc:owner/app.bsky.feed.post/aaa", "hello", "2026-09-26T11:00:00Z") + `]}`,
	})
	defer server.Close()

	db := newPostImportTestDB(t)
	account := seedPostImportAccount(t, db, "bluesky", "did:plc:owner", server.URL)
	service := NewService(db, &stubTokenSource{token: "token"})
	frozen := time.Date(2026, 9, 26, 9, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return frozen }

	_, err := service.Enable(context.Background(), "workspace-1", account.ID)
	require.NoError(t, err)
	require.NoError(t, service.SyncAccount(context.Background(), "workspace-1", account.ID))
	require.Equal(t, 1, countImported(t, db, account.ID))

	// Force the next cycle: the same provider post must not duplicate.
	_, err = db.NewUpdate().Model((*models.PostImportState)(nil)).
		Set("next_eligible_at = ?", frozen.Add(-time.Minute)).
		Set("last_success_at = ?", frozen.Add(-25*time.Hour)).
		Where("social_account_id = ?", account.ID).
		Exec(context.Background())
	require.NoError(t, err)
	require.NoError(t, service.SyncAccount(context.Background(), "workspace-1", account.ID))
	require.Equal(t, 1, countImported(t, db, account.ID))
}

func TestSyncResumesFromStoredCursor(t *testing.T) {
	server := blueskyFeedServer(map[string]string{
		"":       `{"cursor":"page-2","feed":[` + blueskyFeedItem("at://did:plc:owner/app.bsky.feed.post/aaa", "first", "2026-09-26T11:00:00Z") + `]}`,
		"page-2": `{"feed":[` + blueskyFeedItem("at://did:plc:owner/app.bsky.feed.post/bbb", "second", "2026-09-26T10:00:00Z") + `]}`,
	})
	defer server.Close()

	db := newPostImportTestDB(t)
	account := seedPostImportAccount(t, db, "bluesky", "did:plc:owner", server.URL)
	service := NewService(db, &stubTokenSource{token: "token"})
	service.maxPages = 1
	frozen := time.Date(2026, 9, 26, 9, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return frozen }

	_, err := service.Enable(context.Background(), "workspace-1", account.ID)
	require.NoError(t, err)

	// First execution commits page one with its checkpoint and stops at the
	// page bound, keeping the cursor for resume.
	require.NoError(t, service.SyncAccount(context.Background(), "workspace-1", account.ID))
	require.Equal(t, 1, countImported(t, db, account.ID))
	state := loadImportState(t, db, account.ID)
	require.Equal(t, "page-2", state.Cursor)

	// The retry resumes from the stored cursor instead of re-reading page one.
	_, err = db.NewUpdate().Model((*models.PostImportState)(nil)).
		Set("next_eligible_at = ?", frozen.Add(-time.Minute)).
		Where("social_account_id = ?", account.ID).
		Exec(context.Background())
	require.NoError(t, err)
	require.NoError(t, service.SyncAccount(context.Background(), "workspace-1", account.ID))
	require.Equal(t, 2, countImported(t, db, account.ID))
	state = loadImportState(t, db, account.ID)
	require.Empty(t, state.Cursor)
	require.False(t, state.LastSuccessAt.IsZero())
}

func TestResumedSyncKeepsStartWatermark(t *testing.T) {
	server := blueskyFeedServer(map[string]string{
		"":      `{"cursor":"older","feed":[` + blueskyFeedItem("at://did:plc:owner/app.bsky.feed.post/first", "first", "2026-09-26T11:00:00Z") + `]}`,
		"older": `{"feed":[` + blueskyFeedItem("at://did:plc:owner/app.bsky.feed.post/second", "second", "2026-09-26T10:00:00Z") + `]}`,
	})
	defer server.Close()
	db := newPostImportTestDB(t)
	account := seedPostImportAccount(t, db, "bluesky", "did:plc:owner", server.URL)
	service := NewService(db, &stubTokenSource{token: "token"})
	service.maxPages = 1
	started := time.Date(2026, 9, 26, 9, 0, 0, 0, time.UTC)
	current := started
	service.now = func() time.Time { return current }
	_, err := service.Enable(t.Context(), "workspace-1", account.ID)
	require.NoError(t, err)
	require.NoError(t, service.SyncAccount(t.Context(), "workspace-1", account.ID))
	current = started.Add(25 * time.Hour)
	_, err = db.NewUpdate().Model((*models.PostImportState)(nil)).Set("next_eligible_at = ?", started).Where("social_account_id = ?", account.ID).Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, service.SyncAccount(t.Context(), "workspace-1", account.ID))
	state := loadImportState(t, db, account.ID)
	require.True(t, state.LastSuccessAt.Equal(started), "next cycle must revisit posts published during the cursor resume")
	require.True(t, state.CycleStartedAt.IsZero())
}

func TestInitialCapTransitionsToIncremental(t *testing.T) {
	server := blueskyFeedServer(map[string]string{"": `{"cursor":"older","feed":[` + blueskyFeedItem("at://did:plc:owner/app.bsky.feed.post/new", "new", "2026-09-26T11:00:00Z") + `]}`})
	defer server.Close()
	db := newPostImportTestDB(t)
	account := seedPostImportAccount(t, db, "bluesky", "did:plc:owner", server.URL)
	service := NewService(db, &stubTokenSource{token: "token"})
	started := time.Date(2026, 9, 26, 9, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return started }
	_, err := service.Enable(t.Context(), "workspace-1", account.ID)
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.PostImportState)(nil)).Set("initial_items_seen = ?", initialItemCap-1).Where("social_account_id = ?", account.ID).Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, service.SyncAccount(t.Context(), "workspace-1", account.ID))
	state := loadImportState(t, db, account.ID)
	require.False(t, state.InitialFinishedAt.IsZero())
	require.True(t, state.LastSuccessAt.Equal(started))
	require.Empty(t, state.Cursor)
}

func TestSyncSkipsPostsPublishedThroughOpenPost(t *testing.T) {
	ownURI := "at://did:plc:owner/app.bsky.feed.post/own"
	nativeURI := "at://did:plc:owner/app.bsky.feed.post/native"
	feedServer := blueskyFeedServer(map[string]string{
		"": `{"feed":[` +
			blueskyFeedItem(ownURI, "published via openpost", "2026-09-26T11:00:00Z") + `,` +
			blueskyFeedItem(nativeURI, "native only", "2026-09-26T10:00:00Z") + `]}`,
	})
	defer feedServer.Close()

	db := newPostImportTestDB(t)
	account := seedPostImportAccount(t, db, "bluesky", "did:plc:owner", feedServer.URL)
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.Rendition{
		ID: "rendition-1", PublicationID: "publication-1", SocialAccountID: account.ID,
		TargetKey: "t", Platform: "bluesky", Profile: "p",
		Body: "published via openpost", Status: "published",
		ExternalID: ownURI, CreatedAt: now, UpdatedAt: now,
	}).Exec(context.Background())
	require.NoError(t, err)

	service := NewService(db, &stubTokenSource{token: "token"})
	service.now = func() time.Time { return time.Date(2026, 9, 26, 9, 0, 0, 0, time.UTC) }
	_, err = service.Enable(context.Background(), "workspace-1", account.ID)
	require.NoError(t, err)
	require.NoError(t, service.SyncAccount(context.Background(), "workspace-1", account.ID))

	posts, err := service.ListImported(context.Background(), "workspace-1", account.ID, 10)
	require.NoError(t, err)
	require.Len(t, posts, 1)
	require.Equal(t, nativeURI, posts[0].ProviderPostID)
}

func TestReadBudgetGuardBlocksProvidersReads(t *testing.T) {
	db := newPostImportTestDB(t)
	account := seedPostImportAccount(t, db, "x", "x-user", "")
	now := time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC)
	_, err := db.NewInsert().Model(&models.PostImportState{
		ID: "state-1", WorkspaceID: "workspace-1", SocialAccountID: account.ID,
		Platform: "x", Enabled: true, Status: "partial",
		ImportWatermark: now, CreatedAt: now, UpdatedAt: now,
	}).Exec(context.Background())
	require.NoError(t, err)

	tokens := &stubTokenSource{token: "token"}
	service := NewService(db, tokens)
	service.now = func() time.Time { return now }

	require.NoError(t, service.SyncAccount(context.Background(), "workspace-1", account.ID))
	require.Equal(t, int64(0), tokens.calls.Load())
	require.Equal(t, 0, countImported(t, db, account.ID))
	state := loadImportState(t, db, account.ID)
	require.Equal(t, "cost_limited", state.Status)
	require.True(t, account.IsActive)
}

func TestPermissionFailureKeepsAccountConnected(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":"AuthRequired"}`))
	}))
	defer server.Close()

	db := newPostImportTestDB(t)
	account := seedPostImportAccount(t, db, "bluesky", "did:plc:owner", server.URL)
	service := NewService(db, &stubTokenSource{token: "stale"})
	_, err := service.Enable(context.Background(), "workspace-1", account.ID)
	require.NoError(t, err)

	require.NoError(t, service.SyncAccount(context.Background(), "workspace-1", account.ID))
	state := loadImportState(t, db, account.ID)
	require.Equal(t, "permission_required", state.Status)
	require.NotEmpty(t, state.FailureMessage)

	var reloaded models.SocialAccount
	require.NoError(t, db.NewSelect().Model(&reloaded).Where("id = ?", account.ID).Scan(context.Background()))
	require.True(t, reloaded.IsActive)
}

func TestImportsStayOutOfAnalyticsTables(t *testing.T) {
	server := blueskyFeedServer(map[string]string{
		"": `{"feed":[` + blueskyFeedItem("at://did:plc:owner/app.bsky.feed.post/aaa", "hello", "2026-09-26T11:00:00Z") + `]}`,
	})
	defer server.Close()

	db := newPostImportTestDB(t)
	account := seedPostImportAccount(t, db, "bluesky", "did:plc:owner", server.URL)
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.AnalyticsAccountSnapshot{
		ID: "snapshot-1", WorkspaceID: "workspace-1", SocialAccountID: account.ID,
		Platform: "bluesky", MetricsJSON: "{}", MetricMetadataJSON: "{}",
		CapturedAt: now,
	}).Exec(context.Background())
	require.NoError(t, err)

	service := NewService(db, &stubTokenSource{token: "token"})
	service.now = func() time.Time { return time.Date(2026, 9, 26, 9, 0, 0, 0, time.UTC) }
	_, err = service.Enable(context.Background(), "workspace-1", account.ID)
	require.NoError(t, err)
	require.NoError(t, service.SyncAccount(context.Background(), "workspace-1", account.ID))
	require.Equal(t, 1, countImported(t, db, account.ID))

	// Analytics-owned inventory is untouched by the import cycle.
	snapshots, err := db.NewSelect().Model((*models.AnalyticsAccountSnapshot)(nil)).
		Where("workspace_id = ?", "workspace-1").
		Count(context.Background())
	require.NoError(t, err)
	require.Equal(t, 1, snapshots)
	renditions, err := db.NewSelect().Model((*models.Rendition)(nil)).
		Where("social_account_id = ?", account.ID).
		Count(context.Background())
	require.NoError(t, err)
	require.Equal(t, 0, renditions)

	// The library read is DB-only: it works with a failing token source.
	broken := NewService(db, &stubTokenSource{err: context.DeadlineExceeded})
	posts, err := broken.ListImported(context.Background(), "workspace-1", account.ID, 10)
	require.NoError(t, err)
	require.Len(t, posts, 1)
}

func TestDisableStopsSync(t *testing.T) {
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"feed":[]}`))
	}))
	defer server.Close()

	db := newPostImportTestDB(t)
	account := seedPostImportAccount(t, db, "bluesky", "did:plc:owner", server.URL)
	service := NewService(db, &stubTokenSource{token: "token"})
	_, err := service.Enable(context.Background(), "workspace-1", account.ID)
	require.NoError(t, err)
	require.NoError(t, service.Disable(context.Background(), "workspace-1", account.ID))
	require.NoError(t, service.SyncAccount(context.Background(), "workspace-1", account.ID))
	require.Equal(t, int64(0), calls.Load())
}

func TestHandleJobRejectsBadPayload(t *testing.T) {
	db := newPostImportTestDB(t)
	service := NewService(db, &stubTokenSource{token: "token"})
	require.Error(t, service.HandleJob(context.Background(), "post_import_sync", `{}`))
	require.Error(t, service.HandleJob(context.Background(), "unknown", `{}`))
}

func TestDueImportIsQueuedOnceAfterItsFirstCycle(t *testing.T) {
	db := newPostImportTestDB(t)
	account := seedPostImportAccount(t, db, "bluesky", "did:plc:owner", "https://bsky.example")
	service := NewService(db, &stubTokenSource{token: "token"})
	now := time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	_, err := service.Enable(t.Context(), "workspace-1", account.ID)
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.Job)(nil)).Set("status = ?", "completed").Where("type = ?", JobTypeSync).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.PostImportState)(nil)).Set("next_eligible_at = ?", now.Add(time.Hour)).Where("social_account_id = ?", account.ID).Exec(t.Context())
	require.NoError(t, err)

	queued, err := service.EnqueueDue(t.Context())
	require.NoError(t, err)
	require.Equal(t, 0, queued)

	now = now.Add(time.Hour)
	queued, err = service.EnqueueDue(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, queued)
	queued, err = service.EnqueueDue(t.Context())
	require.NoError(t, err)
	require.Equal(t, 0, queued)

	count, err := db.NewSelect().Model((*models.Job)(nil)).Where("type = ? AND status = ?", JobTypeSync, "pending").Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, count)
}
