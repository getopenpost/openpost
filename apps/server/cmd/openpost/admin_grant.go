package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

type grantAdminResult struct {
	UserID       string `json:"user_id"`
	Email        string `json:"email"`
	AlreadyAdmin bool   `json:"already_admin"`
	AdminCount   int    `json:"admin_count"`
}

// grantInstanceAdmin promotes one existing account to instance administrator.
// This is the operator recovery hatch for a self-hosted instance where no
// account can manage instance settings, for example after restoring a volume
// whose first account predated the automatic first-admin bootstrap.
func grantInstanceAdmin(ctx context.Context, db *bun.DB, email string) (grantAdminResult, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return grantAdminResult{}, errors.New("grant-admin requires --email <address>")
	}

	user := new(models.User)
	err := db.NewSelect().Model(user).Where("email = ?", email).Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return grantAdminResult{}, fmt.Errorf("no account found with email %q", email)
		}
		return grantAdminResult{}, err
	}

	adminCount, err := db.NewSelect().Model((*models.User)(nil)).Where("is_admin = ?", true).Count(ctx)
	if err != nil {
		return grantAdminResult{}, err
	}

	alreadyAdmin := user.IsAdmin
	if !alreadyAdmin {
		if _, err := db.NewUpdate().Model((*models.User)(nil)).
			Set("is_admin = ?", true).
			Where("id = ?", user.ID).
			Exec(ctx); err != nil {
			return grantAdminResult{}, err
		}
		adminCount++
	}

	return grantAdminResult{
		UserID:       user.ID,
		Email:        user.Email,
		AlreadyAdmin: alreadyAdmin,
		AdminCount:   adminCount,
	}, nil
}
