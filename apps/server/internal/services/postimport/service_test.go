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
	"github.com/openpost/backend/internal/platform"
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
		_, _ = w.Write([]byte(`{"feed":[` + blueskyFeedItem("at://did:plc:owner/app.bsky.feed.post/new", "new post", "2026-09-26T13:00:00Z") + `]}`))
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

func TestInitialSyncRetainsCursorAfter250StoredPosts(t *testing.T) {
	server := blueskyFeedServer(map[string]string{"": `{"cursor":"older","feed":[` + blueskyFeedItem("at://did:plc:owner/app.bsky.feed.post/new", "new", "2026-09-26T11:00:00Z") + `]}`})
	defer server.Close()
	db := newPostImportTestDB(t)
	account := seedPostImportAccount(t, db, "bluesky", "did:plc:owner", server.URL)
	service := NewService(db, &stubTokenSource{token: "token"})
	service.maxPages = 1
	started := time.Date(2026, 9, 26, 9, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return started }
	_, err := service.Enable(t.Context(), "workspace-1", account.ID)
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.PostImportState)(nil)).Set("initial_items_seen = ?", 249).Where("social_account_id = ?", account.ID).Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, service.SyncAccount(t.Context(), "workspace-1", account.ID))
	state := loadImportState(t, db, account.ID)
	require.True(t, state.InitialFinishedAt.IsZero())
	require.True(t, state.LastSuccessAt.IsZero())
	require.Equal(t, "older", state.Cursor)
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
		ExternalID: fmt.Sprintf(`{"uri":%q,"cid":"cid"}`, ownURI), CreatedAt: now, UpdatedAt: now,
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

func TestReadBudgetIsFreshAtTheUTCDayItsRetryWaitsFor(t *testing.T) {
	server := blueskyFeedServer(map[string]string{
		"":       `{"cursor":"page-2","feed":[` + blueskyFeedItem("at://did:plc:owner/app.bsky.feed.post/aaa", "first", "2026-09-26T15:30:00Z") + `]}`,
		"page-2": `{"feed":[` + blueskyFeedItem("at://did:plc:owner/app.bsky.feed.post/bbb", "second", "2026-09-26T15:20:00Z") + `]}`,
	})
	defer server.Close()

	db := newPostImportTestDB(t)
	account := seedPostImportAccount(t, db, "bluesky", "did:plc:owner", server.URL)
	service := NewService(db, &stubTokenSource{token: "token"})
	service.SetPolicy("bluesky", Policy{ReadRequestsPerDay: 1, PageSize: 50})
	now := time.Date(2026, 9, 26, 15, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	_, err := service.Enable(context.Background(), "workspace-1", account.ID)
	require.NoError(t, err)

	// 16:00 spends the day's one read on page one; page two waits for the
	// next UTC day.
	now = time.Date(2026, 9, 26, 16, 0, 0, 0, time.UTC)
	require.NoError(t, service.SyncAccount(context.Background(), "workspace-1", account.ID))
	require.Equal(t, 1, countImported(t, db, account.ID))
	state := loadImportState(t, db, account.ID)
	require.Equal(t, "cost_limited", state.Status)
	require.Equal(t, time.Date(2026, 9, 27, 0, 0, 0, 0, time.UTC), state.NextEligibleAt.UTC())

	// At that retry the budget is a new day's, not still the one spent at 16:00.
	now = time.Date(2026, 9, 27, 0, 30, 0, 0, time.UTC)
	require.NoError(t, service.SyncAccount(context.Background(), "workspace-1", account.ID))
	require.Equal(t, 2, countImported(t, db, account.ID))
	state = loadImportState(t, db, account.ID)
	require.NotEqual(t, "cost_limited", state.Status)
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

func TestSyncPersistsReadBudgetBeforeProviderCall(t *testing.T) {
	db := newPostImportTestDB(t)
	var account models.SocialAccount
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		state := loadImportState(t, db, account.ID)
		require.Equal(t, 1, state.ReadBudgetUsed, "a crash during the request must not restore the spent budget")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"feed":[]}`))
	}))
	defer server.Close()
	account = seedPostImportAccount(t, db, "bluesky", "did:plc:owner", server.URL)
	service := NewService(db, &stubTokenSource{token: "token"})
	_, err := service.Enable(t.Context(), "workspace-1", account.ID)
	require.NoError(t, err)
	require.NoError(t, service.SyncAccount(t.Context(), "workspace-1", account.ID))
}

func TestNativeImportsRespectGrantAndConfiguredReaders(t *testing.T) {
	db := newPostImportTestDB(t)
	account := seedPostImportAccount(t, db, "tiktok", "owner", "")
	tokens := &stubTokenSource{token: "token"}
	service := NewService(db, tokens)
	service.SetProvider("tiktok", platform.NewTikTokAdapter("", "", ""))
	// A stale account credential mirror must not authorize a canonical grant.
	_, err := db.NewInsert().Model(&models.OAuthGrant{ID: "grant", WorkspaceID: account.WorkspaceID, Provider: "tiktok", AccessTokenEnc: []byte("encrypted"), GrantedScopes: "video.publish"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("oauth_grant_id = ?", "grant").Set("granted_scopes = ?", "video.list").Where("id = ?", account.ID).Exec(t.Context())
	require.NoError(t, err)
	overview, err := service.ReadOverview(t.Context(), account.WorkspaceID, account.ID, "", 50)
	require.NoError(t, err)
	require.False(t, overview.Support.Supported)
	require.Contains(t, overview.Support.UnavailableReason, "video.list")
	_, err = service.Enable(t.Context(), account.WorkspaceID, account.ID)
	require.Error(t, err)
	require.EqualValues(t, 0, tokens.calls.Load())
	_, err = db.NewUpdate().Model((*models.OAuthGrant)(nil)).Set("granted_scopes = ?", "video.publish video.list").Where("id = ?", "grant").Exec(t.Context())
	require.NoError(t, err)
	overview, err = service.ReadOverview(t.Context(), account.WorkspaceID, account.ID, "", 50)
	require.NoError(t, err)
	require.True(t, overview.Support.Supported)
	service.SetProvider("tiktok", platform.NewTikTokAdapterWithCapabilities("", "", "", platform.TikTokMinimalScopeCapabilities()))
	overview, err = service.ReadOverview(t.Context(), account.WorkspaceID, account.ID, "", 50)
	require.NoError(t, err)
	require.False(t, overview.Support.Supported)
	require.Contains(t, overview.Support.UnavailableReason, "Display API")
	require.EqualValues(t, 0, tokens.calls.Load(), "availability reads must stay local")
}

func TestDisableDuringProviderReadStopsTheInFlightImport(t *testing.T) {
	db := newPostImportTestDB(t)
	var service *Service
	var account models.SocialAccount
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.NoError(t, service.Disable(r.Context(), account.WorkspaceID, account.ID))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"cursor":"next","feed":[` + blueskyFeedItem("at://did:plc:owner/app.bsky.feed.post/new", "new", "2026-10-03T12:00:00Z") + `]}`))
	}))
	defer server.Close()
	account = seedPostImportAccount(t, db, "bluesky", "did:plc:owner", server.URL)
	service = NewService(db, &stubTokenSource{token: "token"})
	service.now = func() time.Time { return time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC) }
	_, err := service.Enable(t.Context(), account.WorkspaceID, account.ID)
	require.NoError(t, err)
	require.NoError(t, service.SyncAccount(t.Context(), account.WorkspaceID, account.ID))
	require.False(t, loadImportState(t, db, account.ID).Enabled)
	require.Zero(t, countImported(t, db, account.ID))
}

type aliasNativeAdapter struct {
	platform.Adapter
	items []platform.NativePostItem
}

func (a aliasNativeAdapter) NativePostSupport() platform.NativePostSupport {
	return platform.NativePostSupport{Supported: true}
}
func (a aliasNativeAdapter) ListNativePosts(context.Context, string, platform.NativePostRequest) (platform.NativePostPage, error) {
	return platform.NativePostPage{Items: a.items, Coverage: platform.NativePostComplete}, nil
}

func TestNativeImportsExcludeConfirmedFacebookPhotoAlias(t *testing.T) {
	db := newPostImportTestDB(t)
	account := seedPostImportAccount(t, db, "facebook", "page", "")
	now := time.Date(2026, 10, 10, 9, 0, 0, 0, time.UTC)
	publication := &models.Publication{ID: "pub", WorkspaceID: account.WorkspaceID, Status: models.PublicationStatusPublished, CreatedAt: now, UpdatedAt: now}
	_, err := db.NewInsert().Model(publication).Exec(t.Context())
	require.NoError(t, err)
	rendition := &models.Rendition{ID: "rend", PublicationID: publication.ID, SocialAccountID: account.ID, Platform: "facebook", Status: models.RenditionStatusPublished, ExternalID: "photo-1"}
	_, err = db.NewInsert().Model(rendition).Exec(t.Context())
	require.NoError(t, err)
	service := NewService(db, &stubTokenSource{token: "token"})
	service.now = func() time.Time { return now }
	service.SetProvider("facebook", aliasNativeAdapter{items: []platform.NativePostItem{
		{ProviderPostID: "page_feed-1", IdentityAliases: []string{"photo-1"}, Origin: platform.ImportedPostOriginExternal, Text: "same caption", PublishedAt: now.Add(time.Minute)},
		{ProviderPostID: "page_feed-2", IdentityAliases: []string{"other-photo"}, Origin: platform.ImportedPostOriginExternal, Text: "same caption", PublishedAt: now.Add(2 * time.Minute)},
	}})
	_, err = service.Enable(t.Context(), account.WorkspaceID, account.ID)
	require.NoError(t, err)
	service.now = func() time.Time { return now.Add(time.Minute) }
	require.NoError(t, service.SyncAccount(t.Context(), account.WorkspaceID, account.ID))
	posts, err := service.ListImported(t.Context(), account.WorkspaceID, account.ID, 10)
	require.NoError(t, err)
	require.Len(t, posts, 1)
	require.Equal(t, "page_feed-2", posts[0].ProviderPostID)
}

func TestNativeImportDefersUnresolvedInstagramPublication(t *testing.T) {
	db := newPostImportTestDB(t)
	account := seedPostImportAccount(t, db, "instagram", "ig", "")
	now := time.Date(2026, 10, 10, 10, 0, 0, 0, time.UTC)
	service := NewService(db, &stubTokenSource{token: "token"})
	service.now = func() time.Time { return now }
	service.SetProvider("instagram", aliasNativeAdapter{items: []platform.NativePostItem{{ProviderPostID: "ambiguous-id", Origin: platform.ImportedPostOriginExternal, Text: "caption", PublishedAt: now.Add(30 * time.Second)}}})
	_, err := db.NewInsert().Model(&models.Publication{ID: "pub-pending", WorkspaceID: account.WorkspaceID, Status: models.PublicationStatusScheduled}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Rendition{ID: "rend-pending", PublicationID: "pub-pending", SocialAccountID: account.ID, TargetKey: "rendition", Platform: "instagram", Status: models.RenditionStatusScheduled}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.PublicationAuthorization{ID: "auth", BatchID: "batch", WorkspaceID: account.WorkspaceID, PublicationID: "pub-pending", RenditionID: "rend-pending", SocialAccountID: account.ID, TargetKey: "rendition", Action: "publish", ActorOrigin: "legacy", ActorUserID: "user-1", PublicationRevision: 1, ContentHash: "sha256:content", MediaHash: "sha256:media", SettingsHash: "sha256:settings", PolicyMode: "immediate", ConfirmedAt: now, ScheduledAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.ProviderWriteAttempt{ID: "attempt", AuthorizationID: "auth", OperationID: "op", AttemptNumber: 1, WorkspaceID: account.WorkspaceID, PublicationID: "pub-pending", RenditionID: "rend-pending", SocialAccountID: account.ID, TargetKey: "rendition", Provider: "instagram", Operation: "publish", PayloadFingerprint: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", Status: "sending", SubmissionState: "pending", RetrySafety: "reconcile_only"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.ProviderDelivery{ID: "delivery", PublicationID: "pub-pending", RenditionID: "rend-pending", CurrentAttemptNumber: 1, TargetKey: "rendition", CurrentAttemptID: "attempt", WorkspaceID: account.WorkspaceID, SocialAccountID: account.ID, Provider: "instagram", CurrentAttemptCreatedAt: now.Add(-2 * time.Minute), State: "processing", CreatedAt: now.Add(-2 * time.Minute), UpdatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	_, err = service.Enable(t.Context(), account.WorkspaceID, account.ID)
	require.NoError(t, err)
	service.now = func() time.Time { return now.Add(time.Minute) }
	require.NoError(t, service.SyncAccount(t.Context(), account.WorkspaceID, account.ID))
	require.Zero(t, countImported(t, db, account.ID))
	state := loadImportState(t, db, account.ID)
	require.Equal(t, "published_identity_pending", state.FailureCode)
	require.True(t, state.InitialFinishedAt.IsZero())
	// Repeated provider reconciliation must not renew the identity ambiguity window.
	_, err = db.NewUpdate().Model((*models.ProviderDelivery)(nil)).Set("current_attempt_created_at = ?", now.AddDate(0, 0, -31)).Where("id = ?", "delivery").Exec(t.Context())
	require.NoError(t, err)
	service.now = func() time.Time { return now.Add(20 * time.Minute) }
	require.NoError(t, service.SyncAccount(t.Context(), account.WorkspaceID, account.ID))
	require.Equal(t, 1, countImported(t, db, account.ID))
}
