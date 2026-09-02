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

func LockOrganization(ctx context.Context, db bun.IDB, organizationID string) error {
	result, err := db.NewUpdate().Model((*models.Organization)(nil)).
		Set("name = name").
		Where("id = ?", organizationID).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("lock Organization: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows != 1 {
		return sql.ErrNoRows
	}
	return nil
}

// WithWorkspace runs fn in a transaction that holds the Organization row lock.
// Callers already inside a Bun transaction keep that transaction.
func WithWorkspace(ctx context.Context, db bun.IDB, workspaceID string, fn func(context.Context, bun.IDB) error) error {
	return withLockedScope(ctx, db, workspaceID, LockWorkspace, fn)
}

// WithOrganization serializes Organization-wide policy mutations. Callers
// already inside a Bun transaction keep that transaction.
func WithOrganization(ctx context.Context, db bun.IDB, organizationID string, fn func(context.Context, bun.IDB) error) error {
	return withLockedScope(ctx, db, organizationID, LockOrganization, fn)
}

func withLockedScope(
	ctx context.Context,
	db bun.IDB,
	id string,
	lock func(context.Context, bun.IDB, string) error,
	fn func(context.Context, bun.IDB) error,
) error {
	if root, ok := db.(*bun.DB); ok {
		return root.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			if err := lock(txCtx, tx, id); err != nil {
				return err
			}
			return fn(txCtx, tx)
		})
	}
	if err := lock(ctx, db, id); err != nil {
		return err
	}
	return fn(ctx, db)
}
