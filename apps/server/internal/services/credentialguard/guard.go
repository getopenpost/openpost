// Package credentialguard serializes account credential and primary identity
// mutations on the owning user row.
package credentialguard

import (
	"context"
	"database/sql"
	"strings"

	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
)

const firstUserBootstrapLockID = int64(0x4f50454e504f5354)

// LockFirstUserBootstrap serializes the one-time administrator decision across
// PostgreSQL processes. SQLite serializes the write transaction itself.
func LockFirstUserBootstrap(ctx context.Context, tx bun.Tx) error {
	if tx.Dialect().Name() != dialect.PG {
		return nil
	}
	_, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(?)", firstUserBootstrapLockID)
	return err
}

// LockUserMutation obtains a row-level write lock and returns the credential
// fields needed to evaluate fallback sign-in methods. Every mutation that can
// remove or replace a primary sign-in identity must call this inside its
// transaction before inspecting account credentials.
func LockUserMutation(ctx context.Context, tx bun.Tx, userID string) (*models.User, error) {
	userID = strings.TrimSpace(userID)
	result, err := tx.NewUpdate().Model((*models.User)(nil)).
		Set("email = email").
		Where("id = ?", userID).
		Exec(ctx)
	if err != nil {
		return nil, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if affected != 1 {
		return nil, sql.ErrNoRows
	}

	var user models.User
	if err := tx.NewSelect().Model(&user).
		Column("id", "email", "password_hash").
		Where("id = ?", userID).
		Scan(ctx); err != nil {
		return nil, err
	}
	return &user, nil
}
