package lifecycle

import (
	"context"
	"database/sql"
	"fmt"
	"testing"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestServiceRecordsAndListsPublicationEvents(t *testing.T) {
	t.Parallel()

	db := newLifecycleTestDB(t)
	service := NewService(db)

	event, err := service.Record(context.Background(), EventInput{
		WorkspaceID:    "ws-1",
		PublicationID:  "publication-1",
		RenditionID:    "rendition-1",
		Type:           EventProviderProcessing,
		Status:         StatusStarted,
		Message:        "provider accepted upload",
		Metadata:       map[string]any{"provider": "youtube"},
		IdempotencyKey: "provider-processing:rendition-1",
	})
	require.NoError(t, err)
	require.NotEmpty(t, event.ID)
	require.Equal(t, EventProviderProcessing, event.Type)

	duplicate, err := service.Record(context.Background(), EventInput{
		WorkspaceID:    "ws-1",
		PublicationID:  "publication-1",
		RenditionID:    "rendition-1",
		Type:           EventProviderProcessing,
		Status:         StatusStarted,
		Message:        "provider accepted upload",
		IdempotencyKey: "provider-processing:rendition-1",
	})
	require.NoError(t, err)
	require.Equal(t, event.ID, duplicate.ID)

	events, err := service.ListForPublication(context.Background(), "ws-1", "publication-1", 10)
	require.NoError(t, err)
	require.Len(t, events, 1)
	require.Equal(t, "provider accepted upload", events[0].Message)
	require.Contains(t, events[0].MetadataJSON, "youtube")
}

func newLifecycleTestDB(t *testing.T) *bun.DB {
	t.Helper()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)

	db := bun.NewDB(sqldb, sqlitedialect.New())
	for _, model := range []interface{}{
		(*models.PublicationLifecycleEvent)(nil),
	} {
		_, err = db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}
	t.Cleanup(func() {
		require.NoError(t, db.Close())
	})
	return db
}
