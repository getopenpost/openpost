package workflows

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/openpost/backend/internal/database"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

var workflowTestSchemaPath string

func TestMain(m *testing.M) {
	templateDir, err := os.MkdirTemp("", "openpost-workflow-tests-")
	if err != nil {
		fmt.Fprintf(os.Stderr, "create workflow test template directory: %v\n", err)
		os.Exit(1)
	}
	workflowTestSchemaPath = filepath.Join(templateDir, "schema.db")
	db, err := database.InitDB("file:" + workflowTestSchemaPath + "?mode=rwc")
	if err == nil {
		err = database.CreateSchema(db)
	}
	if db != nil {
		if closeErr := db.Close(); err == nil {
			err = closeErr
		}
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "create workflow test schema: %v\n", err)
		_ = os.RemoveAll(templateDir)
		os.Exit(1)
	}

	code := m.Run()
	if err := os.RemoveAll(templateDir); err != nil && code == 0 {
		fmt.Fprintf(os.Stderr, "remove workflow test template directory: %v\n", err)
		code = 1
	}
	os.Exit(code)
}

func newWorkflowSchemaTestDB(t *testing.T) *bun.DB {
	t.Helper()

	testPath := filepath.Join(t.TempDir(), "schema.db")
	schema, err := os.ReadFile(workflowTestSchemaPath)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(testPath, schema, 0o600))

	dsn := url.URL{Scheme: "file", Path: testPath, RawQuery: "mode=rwc"}
	db, err := database.InitDB(dsn.String())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return db
}
