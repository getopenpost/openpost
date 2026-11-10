package migrations

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/openpost/backend/internal/inboxactivity"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
)

// Account-level mentions and reviews have no required Publication. Keep the
// existing FK and item IDs, including receipts referencing those IDs.
func prepareAccountEngagement(ctx context.Context, db *bun.DB) (result error) {
	if db.Dialect().Name() == dialect.PG {
		_, err := db.ExecContext(ctx, `ALTER TABLE engagement_items ALTER COLUMN rendition_id DROP NOT NULL`)
		return err
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	var ddl string
	if err := conn.QueryRowContext(ctx, `SELECT sql FROM sqlite_master WHERE type='table' AND name='engagement_items'`).Scan(&ddl); err != nil {
		return err
	}
	column := regexp.MustCompile(`(?i)("?rendition_id"?\s+TEXT)\s+NOT\s+NULL`)
	if !column.MatchString(ddl) {
		return nil
	}
	var foreignKeys int
	if err := conn.QueryRowContext(ctx, `PRAGMA foreign_keys`).Scan(&foreignKeys); err != nil {
		return err
	}
	if _, err := conn.ExecContext(ctx, `PRAGMA foreign_keys=OFF`); err != nil {
		return err
	}
	defer func() {
		_, restoreErr := conn.ExecContext(context.Background(), fmt.Sprintf("PRAGMA foreign_keys=%d", foreignKeys))
		result = errors.Join(result, restoreErr)
	}()
	return conn.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		var objects []struct{ SQL string }
		if err := tx.NewRaw(`SELECT sql FROM sqlite_master WHERE tbl_name='engagement_items' AND type IN ('index','trigger') AND sql IS NOT NULL`).Scan(ctx, &objects); err != nil {
			return err
		}
		// Use the installed definition, preserving every historic column and FK.
		replacement := column.ReplaceAllString(ddl, "$1")
		name := regexp.MustCompile(`(?i)^(CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?)"?engagement_items"?`)
		if !name.MatchString(replacement) {
			return fmt.Errorf("could not rename engagement replacement table")
		}
		replacement = name.ReplaceAllString(replacement, "${1}engagement_items_account_activity")
		for _, statement := range []string{replacement,
			`INSERT INTO engagement_items_account_activity SELECT * FROM engagement_items`,
			`DROP TABLE engagement_items`,
			`ALTER TABLE engagement_items_account_activity RENAME TO engagement_items`,
		} {
			if _, err := tx.ExecContext(ctx, statement); err != nil {
				return err
			}
		}
		for _, object := range objects {
			if _, err := tx.ExecContext(ctx, object.SQL); err != nil {
				return err
			}
		}
		// Validate both sides of the rebuilt table's relationships without
		// making unrelated historic orphans a prerequisite for this upgrade.
		var tables []string
		if err := tx.NewRaw(`SELECT DISTINCT schema.name
			FROM sqlite_master AS schema
			JOIN pragma_foreign_key_list(schema.name) AS fk ON fk."table"='engagement_items' COLLATE NOCASE
			WHERE schema.type='table'
			UNION SELECT 'engagement_items'`).Scan(ctx, &tables); err != nil {
			return err
		}
		for _, table := range tables {
			rows, err := tx.QueryContext(ctx, `SELECT parent FROM pragma_foreign_key_check(?)`, table)
			if err != nil {
				return err
			}
			defer rows.Close()
			for rows.Next() {
				var parent string
				if err := rows.Scan(&parent); err != nil {
					return err
				}
				if strings.EqualFold(table, "engagement_items") || strings.EqualFold(parent, "engagement_items") {
					return fmt.Errorf("engagement rebuild violates an existing foreign key")
				}
			}
			if err := rows.Err(); err != nil {
				return err
			}
		}
		return nil
	})
}

func backfillEngagementNativeIdentity(ctx context.Context, db *bun.DB) error {
	var after string
	for {
		var rows []struct{ ID, Platform, RemoteID string }
		if err := db.NewRaw("SELECT id,platform,remote_id FROM engagement_items WHERE native_remote_id='' AND id>? ORDER BY id LIMIT 100", after).Scan(ctx, &rows); err != nil {
			return err
		}
		if len(rows) == 0 {
			return nil
		}
		for _, row := range rows {
			if _, err := db.ExecContext(ctx, "UPDATE engagement_items SET native_remote_id=? WHERE id=? AND native_remote_id=''", inboxactivity.NativeIdentity(row.Platform, row.RemoteID), row.ID); err != nil {
				return err
			}
			after = row.ID
		}
	}
}
