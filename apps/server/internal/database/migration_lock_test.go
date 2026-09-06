package database

import (
	"context"
	"path/filepath"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestConcurrentSQLiteMigrationCommandsSerializeAcrossConnections(t *testing.T) {
	t.Parallel()

	dsn := "file:" + filepath.Join(t.TempDir(), "openpost.db") + "?cache=shared&mode=rwc"
	first, err := InitDBWithDriver("sqlite", dsn)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, first.Close()) })
	second, err := InitDBWithDriver("sqlite", dsn)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, second.Close()) })

	start := make(chan struct{})
	var wait sync.WaitGroup
	wait.Add(2)
	errors := make(chan error, 2)
	for _, db := range []*bun.DB{first, second} {
		go func() {
			defer wait.Done()
			<-start
			errors <- CreateSchemaLocked(t.Context(), db, "sqlite", dsn)
		}()
	}
	close(start)
	wait.Wait()
	close(errors)

	for err := range errors {
		require.NoError(t, err)
	}
	require.NoError(t, RequireCurrentSchema(t.Context(), first))
}

func TestLongLivedProcessRejectsAnUnmigratedDatabase(t *testing.T) {
	t.Parallel()

	dsn := "file:" + filepath.Join(t.TempDir(), "unmigrated.db") + "?cache=shared&mode=rwc"
	db, err := InitDBWithDriver("sqlite", dsn)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })

	err = RequireCurrentSchema(context.Background(), db)
	require.ErrorContains(t, err, "openpost migrate")

	require.NoError(t, CreateSchemaLocked(t.Context(), db, "sqlite", dsn))
	require.NoError(t, RequireCurrentSchema(context.Background(), db))
}
