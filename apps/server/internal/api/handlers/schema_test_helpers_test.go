package handlers

import (
	"os"
	"testing"

	"github.com/openpost/backend/internal/imageprepare"
	"github.com/openpost/backend/internal/testdb"
	"github.com/uptrace/bun"
)

func TestMain(m *testing.M) {
	if handled, err := imageprepare.RunWorker(os.Args[1:], os.Stdin, os.Stdout); handled {
		if err != nil {
			os.Exit(1)
		}
		return
	}
	os.Exit(m.Run())
}

func newHandlerSchemaTestDB(t *testing.T) *bun.DB {
	t.Helper()
	return testdb.NewSQLite(t)
}
