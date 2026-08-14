// Package organizationguard provides the shared database fence used by
// workspace and Organization job producers. Permanent Organization deletion
// holds the same row lock before its final job scan and removal.
package organizationguard

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

func LockWorkspace(ctx context.Context, db bun.IDB, workspaceID string) error {
	result, err := db.NewUpdate().Model((*models.Organization)(nil)).
		Set("name = name").
		Where("id = (SELECT organization_id FROM workspaces WHERE id = ?)", workspaceID).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("lock Workspace Organization: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows != 1 {
		return sql.ErrNoRows
	}
	return nil
}

// WithWorkspace runs fn in a transaction that holds the Organization row lock.
// Callers already inside a Bun transaction keep that transaction.
func WithWorkspace(ctx context.Context, db bun.IDB, workspaceID string, fn func(context.Context, bun.IDB) error) error {
	if root, ok := db.(*bun.DB); ok {
		return root.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			if err := LockWorkspace(txCtx, tx, workspaceID); err != nil {
				return err
			}
			return fn(txCtx, tx)
		})
	}
	if err := LockWorkspace(ctx, db, workspaceID); err != nil {
		return err
	}
	return fn(ctx, db)
}
