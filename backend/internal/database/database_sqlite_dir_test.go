package database

import (
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

func TestSqliteFileDir(t *testing.T) {
	cases := []struct {
		name string
		dsn  string
		want string
	}{
		{name: "absolute file path", dsn: "file:/data/db/openpost.db?cache=shared&mode=rwc", want: "/data/db"},
		{name: "relative nested path", dsn: "file:state/openpost.db", want: "state"},
		{name: "bare filename", dsn: "file:openpost.db?cache=shared&mode=rwc", want: ""},
		{name: "plain path without scheme", dsn: "/data/db/openpost.db", want: "/data/db"},
		{name: "memory keyword", dsn: "file::memory:", want: ""},
		{name: "memory mode", dsn: "file:test?mode=memory&cache=shared", want: ""},
		{name: "root directory", dsn: "file:/openpost.db", want: ""},
		{name: "empty", dsn: "", want: ""},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			require.Equal(t, testCase.want, sqliteFileDir(testCase.dsn))
		})
	}
}
