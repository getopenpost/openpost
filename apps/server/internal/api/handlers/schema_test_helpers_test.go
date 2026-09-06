package handlers

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/openpost/backend/internal/database"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

var handlerTestSchemaPath string

func TestMain(m *testing.M) {
	templateDir, err := os.MkdirTemp("", "openpost-handler-tests-")
	if err != nil {
		fmt.Fprintf(os.Stderr, "create handler test template directory: %v\n", err)
		os.Exit(1)
	}
	handlerTestSchemaPath = filepath.Join(templateDir, "schema.db")
	db, err := database.InitDB("file:" + handlerTestSchemaPath + "?mode=rwc")
	if err == nil {
		err = database.CreateSchema(db)
	}
	if db != nil {
		if closeErr := db.Close(); err == nil {
			err = closeErr
		}
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "create handler test schema: %v\n", err)
		_ = os.RemoveAll(templateDir)
		os.Exit(1)
	}

	code := m.Run()
	if err := os.RemoveAll(templateDir); err != nil && code == 0 {
		fmt.Fprintf(os.Stderr, "remove handler test template directory: %v\n", err)
		code = 1
	}
	os.Exit(code)
}

func newHandlerSchemaTestDB(t *testing.T) *bun.DB {
	t.Helper()

	testPath := filepath.Join(t.TempDir(), "schema.db")
	schema, err := os.ReadFile(handlerTestSchemaPath)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(testPath, schema, 0o600))

	db, err := database.InitDB("file:" + testPath + "?mode=rwc")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return db
}
