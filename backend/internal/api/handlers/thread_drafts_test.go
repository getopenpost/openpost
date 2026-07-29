package handlers

import (
	"context"
	"database/sql"
	"strings"
	"testing"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	postservice "github.com/openpost/backend/internal/services/posts"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

// newTestDB spins up a fresh in-memory SQLite + bun connection for
// thread-draft regression tests. Mirrors production: single connection,
// PRAGMA foreign_keys=ON, the thread_drafts table created.
func newTestDB(t *testing.T) *bun.DB {
	t.Helper()

	sqldb, err := sql.Open("sqlite3", "file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=private")
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)

	db := bun.NewDB(sqldb, sqlitedialect.New())
	_, err = db.Exec("PRAGMA foreign_keys=ON")
	require.NoError(t, err)
	_, err = db.NewCreateTable().Model((*models.ThreadDraft)(nil)).IfNotExists().Exec(context.Background())
	require.NoError(t, err)

	t.Cleanup(func() {
		_ = db.Close()
	})
	return db
}

const sampleThreadBlob = postservice.ThreadDraftPrefix + `{"p":[{"k":"a","c":"first","m":[]},{"k":"b","c":"second","m":[]}],"v":{}}`

func TestResolveThreadDraftInput(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name             string
		content          string
		threadDraftField *string
		wantContent      string
		wantDraftNonNil  bool
	}{
		{
			name:        "no thread draft, plain content",
			content:     "hello world",
			wantContent: "hello world",
		},
		{
			name:             "explicit thread_draft field set",
			content:          "ignored",
			threadDraftField: ptrString(sampleThreadBlob),
			wantContent:      "ignored",
			wantDraftNonNil:  true,
		},
		{
			// An empty explicit field is not a valid blob (IsThreadDraft
			// rejects it) so ResolveThreadDraftInput returns nil; the
			// downstream UpsertThreadDraftTx is what actually deletes the
			// row — see TestUpsertThreadDraftTxClearsWithEmptyString.
			name:             "explicit field empty string is not treated as a blob",
			content:          "kept",
			threadDraftField: ptrString(""),
			wantContent:      "kept",
		},
		{
			name:             "explicit field without prefix is ignored",
			content:          "kept",
			threadDraftField: ptrString("not a thread blob"),
			wantContent:      "kept",
		},
		{
			name:             "explicit field without content falls through to plain content",
			content:          "first post",
			threadDraftField: ptrString(sampleThreadBlob),
			wantContent:      "first post",
			wantDraftNonNil:  true,
		},
		{
			name:            "legacy blob in content is migrated and content cleared",
			content:         sampleThreadBlob,
			wantContent:     "",
			wantDraftNonNil: true,
		},
		{
			name:             "explicit field takes priority over legacy blob in content",
			content:          sampleThreadBlob,
			threadDraftField: ptrString(sampleThreadBlob),
			wantContent:      sampleThreadBlob,
			wantDraftNonNil:  true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			gotContent, gotDraft := postservice.ResolveThreadDraftInput(tc.content, tc.threadDraftField)
			require.Equal(t, tc.wantContent, gotContent)
			if tc.wantDraftNonNil {
				require.NotNil(t, gotDraft, "expected draft to be set")
			} else {
				require.Nil(t, gotDraft, "expected draft to be nil")
			}
		})
	}
}

func TestUpsertThreadDraftTxWrites(t *testing.T) {
	t.Parallel()

	db := newTestDB(t)
	ctx := context.Background()

	draft := sampleThreadBlob
	require.NoError(t, db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		return postservice.UpsertThreadDraftTx(ctx, tx, "post-1", &draft)
	}))

	loaded, err := postservice.NewService(db).LoadThreadDraft(ctx, "post-1")
	require.NoError(t, err)
	require.NotNil(t, loaded)
	require.Equal(t, sampleThreadBlob, *loaded)
}

func TestUpsertThreadDraftTxReplacesExistingRow(t *testing.T) {
	t.Parallel()

	db := newTestDB(t)
	ctx := context.Background()

	original := sampleThreadBlob
	updated := postservice.ThreadDraftPrefix + `{"p":[{"k":"x","c":"different","m":[]}],"v":{}}`

	require.NoError(t, db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		return postservice.UpsertThreadDraftTx(ctx, tx, "post-1", &original)
	}))
	require.NoError(t, db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		return postservice.UpsertThreadDraftTx(ctx, tx, "post-1", &updated)
	}))

	loaded, err := postservice.NewService(db).LoadThreadDraft(ctx, "post-1")
	require.NoError(t, err)
	require.NotNil(t, loaded)
	require.Equal(t, updated, *loaded, "second upsert should replace the first")
}

func TestUpsertThreadDraftTxClearsWithNil(t *testing.T) {
	t.Parallel()

	db := newTestDB(t)
	ctx := context.Background()

	draft := sampleThreadBlob
	require.NoError(t, db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		return postservice.UpsertThreadDraftTx(ctx, tx, "post-1", &draft)
	}))

	require.NoError(t, db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		return postservice.UpsertThreadDraftTx(ctx, tx, "post-1", nil)
	}))

	loaded, err := postservice.NewService(db).LoadThreadDraft(ctx, "post-1")
	require.NoError(t, err)
	require.Nil(t, loaded, "row should be deleted when upsert is called with nil")
}

func TestUpsertThreadDraftTxClearsWithEmptyString(t *testing.T) {
	t.Parallel()

	db := newTestDB(t)
	ctx := context.Background()

	draft := sampleThreadBlob
	require.NoError(t, db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		return postservice.UpsertThreadDraftTx(ctx, tx, "post-1", &draft)
	}))

	empty := ""
	require.NoError(t, db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		return postservice.UpsertThreadDraftTx(ctx, tx, "post-1", &empty)
	}))

	loaded, err := postservice.NewService(db).LoadThreadDraft(ctx, "post-1")
	require.NoError(t, err)
	require.Nil(t, loaded, "row should be deleted when upsert is called with an empty string")
}

func TestLoadThreadDraftReturnsNilWhenAbsent(t *testing.T) {
	t.Parallel()

	db := newTestDB(t)
	ctx := context.Background()

	loaded, err := postservice.NewService(db).LoadThreadDraft(ctx, "no-such-post")
	require.NoError(t, err)
	require.Nil(t, loaded)
}

func TestIsThreadDraftDetectsLegacyBlob(t *testing.T) {
	t.Parallel()

	require.True(t, postservice.IsThreadDraft(sampleThreadBlob))
	// A content value that is *just* the prefix is not a valid blob
	// (no JSON after the marker), so IsThreadDraft is intentionally
	// strict here.
	require.False(t, postservice.IsThreadDraft(postservice.ThreadDraftPrefix))
	require.False(t, postservice.IsThreadDraft(""))
	require.False(t, postservice.IsThreadDraft("just a regular post"))
	require.False(t, postservice.IsThreadDraft("__openpost_")) // not the right prefix
}

func ptrString(s string) *string { return &s }
