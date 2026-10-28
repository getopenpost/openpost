package postimport

import (
	"context"
	"fmt"
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

type nativeReaderFixture struct {
	platform.Adapter
	pages map[string]platform.NativePostPage
	read  func(context.Context, platform.NativePostRequest) (platform.NativePostPage, error)
}

func (*nativeReaderFixture) NativePostSupport() platform.NativePostSupport {
	return platform.NativePostSupport{Supported: true}
}
func (f *nativeReaderFixture) ListNativePosts(ctx context.Context, _ string, req platform.NativePostRequest) (platform.NativePostPage, error) {
	if f.read != nil {
		return f.read(ctx, req)
	}
	page, ok := f.pages[req.Cursor]
	if !ok {
		return platform.NativePostPage{Coverage: platform.NativePostComplete}, nil
	}
	return page, nil
}
func nativePostItem(uri, text, createdAt string) platform.NativePostItem {
	at, err := time.Parse(time.RFC3339, createdAt)
	if err != nil {
		panic(err)
	}
	return platform.NativePostItem{ProviderPostID: uri, Text: text, PublishedAt: at, Origin: platform.ImportedPostOriginExternal}
}

func TestEnableSetsWatermarkWithoutBackfill(t *testing.T) {
	reader := &nativeReaderFixture{pages: map[string]platform.NativePostPage{
		"": {Coverage: platform.NativePostComplete, NextCursor: "", Items: []platform.NativePostItem{nativePostItem("at://did:plc:owner/app.bsky.feed.post/old", "old post", "2026-01-10T10:00:00Z")}},
	}}

	db := newPostImportTestDB(t)
	account := seedPostImportAccount(t, db, "bluesky", "did:plc:owner", "")
	tokens := &stubTokenSource{token: "token"}
	service := NewService(db, tokens)
	service.SetProvider("bluesky", reader)
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

	reader.pages[""] = platform.NativePostPage{Coverage: platform.NativePostComplete, NextCursor: "", Items: []platform.NativePostItem{nativePostItem("at://did:plc:owner/app.bsky.feed.post/new", "new post", "2026-09-26T13:00:00Z")}}
	require.NoError(t, service.SyncAccount(context.Background(), "workspace-1", account.ID))
	require.Equal(t, 1, countImported(t, db, account.ID))

	posts, err := service.ListImported(context.Background(), "workspace-1", account.ID, 10)
	require.NoError(t, err)
	require.Len(t, posts, 1)
	require.Equal(t, "external", posts[0].Origin)
}

func TestSyncDedupesRepeatedReads(t *testing.T) {
	page := platform.NativePostPage{Coverage: platform.NativePostComplete, NextCursor: "", Items: []platform.NativePostItem{nativePostItem("at://did:plc:owner/app.bsky.feed.post/aaa", "hello", "2026-09-26T11:00:00Z")}}
	reads := 0
	reader := &nativeReaderFixture{read: func(context.Context, platform.NativePostRequest) (platform.NativePostPage, error) {
		reads++
		return page, nil
	}}

	db := newPostImportTestDB(t)
	account := seedPostImportAccount(t, db, "bluesky", "did:plc:owner", "")
	service := NewService(db, &stubTokenSource{token: "token"})
	service.SetProvider("bluesky", reader)
	frozen := time.Date(2026, 9, 26, 9, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return frozen }

	_, err := service.Enable(context.Background(), "workspace-1", account.ID)
	require.NoError(t, err)
	require.NoError(t, service.SyncAccount(context.Background(), "workspace-1", account.ID))
	require.Equal(t, 1, reads)
	require.Equal(t, 1, countImported(t, db, account.ID))

	// Force the next cycle: the same provider post must be read again and must
	// not duplicate, so a skipped second read cannot pass this test.
	_, err = db.NewUpdate().Model((*models.PostImportState)(nil)).
		Set("next_eligible_at = ?", frozen.Add(-time.Minute)).
		Set("last_success_at = ?", frozen.Add(-25*time.Hour)).
		Where("social_account_id = ?", account.ID).
		Exec(context.Background())
	require.NoError(t, err)
	require.NoError(t, service.SyncAccount(context.Background(), "workspace-1", account.ID))
	require.Equal(t, 2, reads, "the second cycle must issue a second provider read")
	require.Equal(t, 1, countImported(t, db, account.ID))
}

func TestResumedSyncKeepsStartWatermark(t *testing.T) {
	reader := &nativeReaderFixture{pages: map[string]platform.NativePostPage{
		"":      {Coverage: platform.NativePostComplete, NextCursor: "older", Items: []platform.NativePostItem{nativePostItem("at://did:plc:owner/app.bsky.feed.post/first", "first", "2026-09-26T11:00:00Z")}},
		"older": {Coverage: platform.NativePostComplete, NextCursor: "", Items: []platform.NativePostItem{nativePostItem("at://did:plc:owner/app.bsky.feed.post/second", "second", "2026-09-26T10:00:00Z")}},
	}}
	db := newPostImportTestDB(t)
	account := seedPostImportAccount(t, db, "bluesky", "did:plc:owner", "")
	service := NewService(db, &stubTokenSource{token: "token"})
	service.SetProvider("bluesky", reader)
	service.maxPages = 1
	started := time.Date(2026, 9, 26, 9, 0, 0, 0, time.UTC)
	current := started
	service.now = func() time.Time { return current }
	_, err := service.Enable(t.Context(), "workspace-1", account.ID)
	require.NoError(t, err)
	require.NoError(t, service.SyncAccount(t.Context(), "workspace-1", account.ID))
	require.Equal(t, 1, countImported(t, db, account.ID), "the first execution commits the first provider page")
	state := loadImportState(t, db, account.ID)
	require.Equal(t, "older", state.Cursor, "the first execution stops at the page bound with the remaining cursor stored")
	current = started.Add(25 * time.Hour)
	_, err = db.NewUpdate().Model((*models.PostImportState)(nil)).Set("next_eligible_at = ?", started).Where("social_account_id = ?", account.ID).Exec(t.Context())
	require.NoError(t, err)
	require.NoError(t, service.SyncAccount(t.Context(), "workspace-1", account.ID))
	require.Equal(t, 2, countImported(t, db, account.ID), "the resumed execution imports the remaining provider page")
	state = loadImportState(t, db, account.ID)
	require.Empty(t, state.Cursor, "the resumed execution finishes the stored cursor")
	require.True(t, state.LastSuccessAt.Equal(started), "next cycle must revisit posts published during the cursor resume")
	require.True(t, state.CycleStartedAt.IsZero())
}

func TestInitialSyncRetainsCursorAfter250StoredPosts(t *testing.T) {
	reader := &nativeReaderFixture{pages: map[string]platform.NativePostPage{"": {Coverage: platform.NativePostComplete, NextCursor: "older", Items: []platform.NativePostItem{nativePostItem("at://did:plc:owner/app.bsky.feed.post/new", "new", "2026-09-26T11:00:00Z")}}}}
	db := newPostImportTestDB(t)
	account := seedPostImportAccount(t, db, "bluesky", "did:plc:owner", "")
	service := NewService(db, &stubTokenSource{token: "token"})
	service.SetProvider("bluesky", reader)
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
	reader := &nativeReaderFixture{pages: map[string]platform.NativePostPage{
		"": {Coverage: platform.NativePostComplete, NextCursor: "", Items: []platform.NativePostItem{nativePostItem(ownURI, "published via openpost", "2026-09-26T11:00:00Z"), nativePostItem(nativeURI, "native only", "2026-09-26T10:00:00Z")}},
	}}

	db := newPostImportTestDB(t)
	account := seedPostImportAccount(t, db, "bluesky", "did:plc:owner", "")
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.Rendition{
		ID: "rendition-1", PublicationID: "publication-1", SocialAccountID: account.ID,
		TargetKey: "t", Platform: "bluesky", Profile: "p",
		Body: "published via openpost", Status: "published",
		ExternalID: fmt.Sprintf(`{"uri":%q,"cid":"cid"}`, ownURI), CreatedAt: now, UpdatedAt: now,
	}).Exec(context.Background())
	require.NoError(t, err)

	service := NewService(db, &stubTokenSource{token: "token"})
	service.SetProvider("bluesky", reader)
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
	// The block is a policy refusal, not a disconnection: the persisted account
	// must still be active after the sync.
	var stored models.SocialAccount
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", account.ID).Scan(context.Background()))
	require.True(t, stored.IsActive)
}

func TestReadBudgetIsFreshAtTheUTCDayItsRetryWaitsFor(t *testing.T) {
	reader := &nativeReaderFixture{pages: map[string]platform.NativePostPage{
		"":       {Coverage: platform.NativePostComplete, NextCursor: "page-2", Items: []platform.NativePostItem{nativePostItem("at://did:plc:owner/app.bsky.feed.post/aaa", "first", "2026-09-26T15:30:00Z")}},
		"page-2": {Coverage: platform.NativePostComplete, NextCursor: "", Items: []platform.NativePostItem{nativePostItem("at://did:plc:owner/app.bsky.feed.post/bbb", "second", "2026-09-26T15:20:00Z")}},
	}}

	db := newPostImportTestDB(t)
	account := seedPostImportAccount(t, db, "bluesky", "did:plc:owner", "")
	service := NewService(db, &stubTokenSource{token: "token"})
	service.SetProvider("bluesky", reader)
	service.policies["bluesky"] = Policy{ReadRequestsPerDay: 1, PageSize: 50}
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
	reader := &nativeReaderFixture{read: func(context.Context, platform.NativePostRequest) (platform.NativePostPage, error) {
		return platform.NativePostPage{}, platform.NewNativePostError(platform.NativePostPermissionRequired, "auth_required", 0)
	}}

	db := newPostImportTestDB(t)
	account := seedPostImportAccount(t, db, "bluesky", "did:plc:owner", "")
	service := NewService(db, &stubTokenSource{token: "stale"})
	service.SetProvider("bluesky", reader)
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
	reader := &nativeReaderFixture{pages: map[string]platform.NativePostPage{
		"": {Coverage: platform.NativePostComplete, NextCursor: "", Items: []platform.NativePostItem{nativePostItem("at://did:plc:owner/app.bsky.feed.post/aaa", "hello", "2026-09-26T11:00:00Z")}},
	}}

	db := newPostImportTestDB(t)
	account := seedPostImportAccount(t, db, "bluesky", "did:plc:owner", "")
	now := time.Now().UTC()
	_, err := db.NewInsert().Model(&models.AnalyticsAccountSnapshot{
		ID: "snapshot-1", WorkspaceID: "workspace-1", SocialAccountID: account.ID,
		Platform: "bluesky", MetricsJSON: "{}", MetricMetadataJSON: "{}",
		CapturedAt: now,
	}).Exec(context.Background())
	require.NoError(t, err)

	service := NewService(db, &stubTokenSource{token: "token"})
	service.SetProvider("bluesky", reader)
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
	reader := &nativeReaderFixture{read: func(context.Context, platform.NativePostRequest) (platform.NativePostPage, error) {
		calls.Add(1)
		return platform.NativePostPage{Coverage: platform.NativePostComplete}, nil
	}}

	db := newPostImportTestDB(t)
	account := seedPostImportAccount(t, db, "bluesky", "did:plc:owner", "")
	service := NewService(db, &stubTokenSource{token: "token"})
	service.SetProvider("bluesky", reader)
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
	reader := &nativeReaderFixture{read: func(context.Context, platform.NativePostRequest) (platform.NativePostPage, error) {
		state := loadImportState(t, db, account.ID)
		require.Equal(t, 1, state.ReadBudgetUsed, "a crash during the request must not restore the spent budget")
		return platform.NativePostPage{Coverage: platform.NativePostComplete}, nil
	}}

	account = seedPostImportAccount(t, db, "bluesky", "did:plc:owner", "")
	service := NewService(db, &stubTokenSource{token: "token"})
	service.SetProvider("bluesky", reader)
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
	reader := &nativeReaderFixture{read: func(ctx context.Context, _ platform.NativePostRequest) (platform.NativePostPage, error) {
		require.NoError(t, service.Disable(ctx, account.WorkspaceID, account.ID))
		return platform.NativePostPage{Coverage: platform.NativePostComplete, NextCursor: "next", Items: []platform.NativePostItem{nativePostItem("at://did:plc:owner/app.bsky.feed.post/new", "new", "2026-10-03T12:00:00Z")}}, nil
	}}

	account = seedPostImportAccount(t, db, "bluesky", "did:plc:owner", "")
	service = NewService(db, &stubTokenSource{token: "token"})
	service.SetProvider("bluesky", reader)
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
