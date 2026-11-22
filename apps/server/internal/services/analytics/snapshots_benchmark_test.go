package analytics

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/testdb"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

func analyticsSnapshotTestDB(t testing.TB, backend string, extraModels ...any) *bun.DB {
	t.Helper()
	var db *bun.DB
	if backend == "postgres" {
		dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
		if dsn == "" {
			t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
		}
		db = bun.NewDB(sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn))), pgdialect.New())
		db.SetMaxOpenConns(1)
		t.Cleanup(func() { require.NoError(t, db.Close()) })
		schema := fmt.Sprintf("analytics_test_%d", time.Now().UnixNano())
		_, err := db.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
		require.NoError(t, err)
		t.Cleanup(func() {
			_, err := db.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
			require.NoError(t, err)
		})
		_, err = db.ExecContext(t.Context(), `SET search_path TO "`+schema+`"`)
		require.NoError(t, err)
	} else {
		var err error
		db, err = testdb.Open("file:" + filepath.Join(t.TempDir(), "snapshots.db") + "?mode=rwc")
		require.NoError(t, err)
		t.Cleanup(func() { require.NoError(t, db.Close()) })
	}
	_, err := db.NewCreateTable().Model((*models.AnalyticsRenditionSnapshot)(nil)).Exec(t.Context())
	require.NoError(t, err)
	for _, model := range extraModels {
		_, err := db.NewCreateTable().Model(model).Exec(t.Context())
		require.NoError(t, err)
	}
	// Match the indexes owned by migrations 043, 048 and 157.
	for _, statement := range []string{
		`CREATE INDEX analytics_rendition_snapshots_rendition_captured_idx ON analytics_rendition_snapshots (rendition_id, captured_at)`,
		`CREATE INDEX analytics_rendition_snapshots_workspace_captured_idx ON analytics_rendition_snapshots (workspace_id, captured_at)`,
		`CREATE INDEX analytics_rendition_snapshots_rendition_workspace_captured_idx ON analytics_rendition_snapshots (rendition_id, workspace_id, captured_at)`,
		`CREATE UNIQUE INDEX analytics_rendition_snapshots_capture_key_idx ON analytics_rendition_snapshots (rendition_id, capture_key) WHERE capture_key <> ''`,
	} {
		_, err := db.ExecContext(t.Context(), statement)
		require.NoError(t, err)
	}
	return db
}

func BenchmarkAnalyticsSnapshotReads(b *testing.B) {
	for _, backend := range []string{"sqlite", "postgres"} {
		for _, size := range []struct{ renditions, history int }{{10, 30}, {100, 365}, {1000, 90}} {
			b.Run(fmt.Sprintf("%s/renditions_%d/history_%d", backend, size.renditions, size.history), func(b *testing.B) {
				db := analyticsSnapshotTestDB(b, backend)
				now := time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC)
				ids := make([]string, size.renditions)
				content := make([]ContentOverview, size.renditions)
				for i := range ids {
					id := fmt.Sprintf("rendition-%04d", i)
					ids[i] = id
					content[i] = ContentOverview{Reference: ContentReference{RenditionID: id}}
					rows := make([]models.AnalyticsRenditionSnapshot, size.history)
					for n := range rows {
						rows[n] = models.AnalyticsRenditionSnapshot{
							ID: fmt.Sprintf("%s-%04d", id, n), WorkspaceID: "workspace", PublicationID: "publication-" + id,
							RenditionID: id, SocialAccountID: "account", Platform: "mastodon",
							MetricsJSON:        fmt.Sprintf(`{"likes":%d,"comments":10,"reposts":5,"views":1200}`, n),
							MetricMetadataJSON: `{"likes":{"unit":"count","aggregation":"lifetime_total","source":"provider"},"comments":{"unit":"count","aggregation":"lifetime_total","source":"provider"},"reposts":{"unit":"count","aggregation":"lifetime_total","source":"provider"},"views":{"unit":"count","aggregation":"lifetime_total","source":"provider"}}`,
							CaptureKey:         fmt.Sprintf("capture-%d", n), CapturedAt: now.Add(-time.Duration(size.history-n) * 24 * time.Hour),
						}
					}
					_, err := db.NewInsert().Model(&rows).Exec(b.Context())
					require.NoError(b, err)
				}
				_, err := db.ExecContext(b.Context(), "ANALYZE")
				require.NoError(b, err)
				service := NewService(db, nil)
				b.Run("insights", func(b *testing.B) {
					b.ReportAllocs()
					for b.Loop() {
						stored, err := service.loadStoredInsightContent(b.Context(), "workspace", content)
						if err != nil {
							b.Fatal(err)
						}
						if len(stored) != len(content) || stored[0].Metrics["likes"] != int64(size.history-1) {
							b.Fatal("incorrect latest snapshots")
						}
					}
				})
				b.Run("baselines", func(b *testing.B) {
					b.ReportAllocs()
					for b.Loop() {
						rows, err := service.loadLatestRenditionSnapshots(b.Context(), "workspace", ids, now.Add(-7*24*time.Hour), "")
						if err != nil {
							b.Fatal(err)
						}
						if len(rows) != len(ids) {
							b.Fatal("incorrect baseline count")
						}
					}
				})
			})
		}
	}
}

func BenchmarkAnalyticsTrendBaselinesWithoutStatistics(b *testing.B) {
	for _, backend := range []string{"sqlite", "postgres"} {
		b.Run(backend, func(b *testing.B) {
			db := analyticsSnapshotTestDB(b, backend)
			now := time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC)
			ids := make([]string, 200)
			for i := range ids {
				id := fmt.Sprintf("rendition-%d", i)
				ids[i] = id
				// Half have older measurements; half have only an observation in
				// the current range and must not inherit another post's baseline.
				count := 30
				if i >= 100 {
					count = 1
				}
				rows := make([]models.AnalyticsRenditionSnapshot, 0, count)
				for n := range count {
					captured := now.Add(-time.Duration(n+8) * 24 * time.Hour)
					if i >= 100 {
						captured = now
					}
					rows = append(rows, models.AnalyticsRenditionSnapshot{
						ID: fmt.Sprintf("%s-%d", id, n), WorkspaceID: "workspace", PublicationID: id,
						RenditionID: id, SocialAccountID: "account", Platform: "test",
						MetricsJSON: `{"likes":3}`, CapturedAt: captured,
					})
				}
				_, err := db.NewInsert().Model(&rows).Exec(b.Context())
				require.NoError(b, err)
			}
			service := NewService(db, nil)
			b.ReportAllocs()
			b.ResetTimer()
			for b.Loop() {
				rows, err := service.loadLatestRenditionSnapshots(b.Context(), "workspace", ids, now.Add(-7*24*time.Hour), "")
				if err != nil {
					b.Fatal(err)
				}
				if len(rows) != 100 {
					b.Fatal("incorrect baseline count")
				}
			}
		})
	}
}
