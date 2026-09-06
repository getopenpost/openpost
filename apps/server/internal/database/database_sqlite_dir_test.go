package database

import (
	"net/url"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestInitDBCreatesMissingSQLiteDirectory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "db", "openpost.db")
	db, err := InitDB("file:" + path + "?cache=shared&mode=rwc")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, CreateSchema(db))
	require.FileExists(t, path)
}

func TestInitDBCreatesEscapedSQLiteDirectory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested db", "openpost.db")
	dsn := (&url.URL{Scheme: "file", Path: path, RawQuery: "cache=shared&mode=rwc"}).String()

	db, err := InitDB(dsn)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, CreateSchema(db))
	require.FileExists(t, path)
}
