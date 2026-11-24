package handlers

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/dataretention"
	"github.com/openpost/backend/internal/services/organizationguard"
	"github.com/openpost/backend/internal/services/tokenmanager"
	"github.com/uptrace/bun"
)

type DisconnectAccountInput struct {
	AccountID string `path:"account_id"`
}

type RevokeAccountGrantInput struct {
	AccountID string `path:"account_id"`
}

func (h *OAuthHandler) DisconnectAccount(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "disconnect-account",
		Method:      http.MethodDelete,
		Path:        "/accounts/{account_id}",
		Summary:     "Disconnect one social destination without revoking its provider grant",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{404, 409},
	}, func(ctx context.Context, input *DisconnectAccountInput) (*struct{}, error) {
		account, err := h.getEditableAccount(ctx, input.AccountID, middleware.GetUserID(ctx))
		if err != nil {
			return nil, err
		}
		if account.OAuthGrantID == "" {
			return nil, huma.Error409Conflict(lastGrantDestinationMessage)
		}

		err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			if account.Platform == "youtube" {
				if err := organizationguard.LockWorkspace(txCtx, tx, account.WorkspaceID); err != nil {
					return err
				}
			}
			if err := lockActiveAccountGrant(txCtx, tx, account); err != nil {
				return err
			}

			if err := requireOtherActiveGrantDestination(txCtx, tx, account); err != nil {
				return err
			}

			result, err := tx.NewUpdate().Model((*models.SocialAccount)(nil)).
				Set("is_active = ?", false).
				Where("id = ? AND workspace_id = ? AND oauth_grant_id = ? AND is_active = ?", account.ID, account.WorkspaceID, account.OAuthGrantID, true).
				Exec(txCtx)
			if err != nil {
				return err
			}
			updated, err := result.RowsAffected()
			if err != nil {
				return err
			}
			if updated != 1 {
				return sql.ErrNoRows
			}
			if account.Platform == "youtube" {
				return dataretention.RetireYouTubeAccount(txCtx, tx, time.Now().UTC(), account.WorkspaceID, account.ID)
			}
			return nil
		})
		if errors.Is(err, errLastGrantDestination) {
			return nil, huma.Error409Conflict(lastGrantDestinationMessage)
		}
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error404NotFound("active provider grant not found")
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to disconnect account")
		}

		return nil, nil
	})
}

func requireOtherActiveGrantDestination(ctx context.Context, db bun.IDB, account models.SocialAccount) error {
	activeDestinations, err := db.NewSelect().Model((*models.SocialAccount)(nil)).
		Where("oauth_grant_id = ? AND workspace_id = ? AND is_active = ?", account.OAuthGrantID, account.WorkspaceID, true).
		Count(ctx)
	if err != nil {
		return err
	}
	if activeDestinations <= 1 {
		return errLastGrantDestination
	}
	return nil
}

func lockActiveAccountGrant(ctx context.Context, db bun.IDB, account models.SocialAccount) error {
	lockResult, err := db.NewUpdate().Model((*models.OAuthGrant)(nil)).
		Set("updated_at = updated_at").
		Where("id = ? AND workspace_id = ? AND revoked_at IS NULL", account.OAuthGrantID, account.WorkspaceID).
		Exec(ctx)
	if err != nil {
		return err
	}
	locked, err := lockResult.RowsAffected()
	if err != nil {
		return err
	}
	if locked != 1 {
		return sql.ErrNoRows
	}
	return nil
}

func (h *OAuthHandler) RevokeAccountGrant(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "revoke-account-grant",
		Method:      http.MethodDelete,
		Path:        "/accounts/{account_id}/grant",
		Summary:     "Revoke a provider grant and disconnect every destination that uses it",
		Tags:        []string{tagAccounts},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404, 502},
	}, func(ctx context.Context, input *RevokeAccountGrantInput) (*struct{}, error) {
		userID := middleware.GetUserID(ctx)
		account, err := h.getEditableAccount(ctx, input.AccountID, userID)
		if err != nil {
			return nil, err
		}
		if err := h.revokeProviderAuthorization(ctx, account); err != nil {
			log.Printf("failed to revoke provider authorization account=%s provider=%s: %v", account.ID, account.Platform, err)
			return nil, huma.Error502BadGateway("failed to revoke provider authorization")
		}
		now := time.Now().UTC()
		if err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
			return persistAccountGrantRevocation(txCtx, tx, account, userID, now)
		}); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, huma.Error404NotFound("provider grant not found")
			}
			return nil, huma.Error500InternalServerError("failed to revoke provider grant")
		}
		h.cleanupRevokedYouTubeData(ctx, account, now)
		return nil, nil
	})
}

// Commit local revocation before attempting cleanup. The revoked grant itself
// remains discoverable by the independent hourly retention sweep.
func persistAccountGrantRevocation(ctx context.Context, db bun.IDB, account models.SocialAccount, userID string, now time.Time) error {
	if account.Platform == "youtube" {
		if err := organizationguard.LockWorkspace(ctx, db, account.WorkspaceID); err != nil {
			return err
		}
	}
	var err error
	if account.OAuthGrantID == "" {
		err = revokeLegacyAccountGrant(ctx, db, account)
	} else {
		err = revokeSharedAccountGrant(ctx, db, account, userID, now)
	}
	return err
}

func enqueueYouTubeRevocationCleanup(ctx context.Context, db bun.IDB, account models.SocialAccount, now time.Time) error {
	job, err := jobregistry.NewJob(jobregistry.TypeYouTubeProfileSweep, "{}", now)
	if err != nil {
		return err
	}
	identity := account.OAuthGrantID
	if identity == "" {
		identity = account.ID
	}
	job.ScopeID = "youtube-profile"
	job.DedupeKey = "revoked:" + identity
	_, err = db.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(ctx)
	return err
}

func (h *OAuthHandler) cleanupRevokedYouTubeData(ctx context.Context, account models.SocialAccount, now time.Time) {
	if account.Platform != "youtube" {
		return
	}
	if err := enqueueYouTubeRevocationCleanup(ctx, h.db, account, now); err != nil {
		log.Printf("YouTube cleanup receipt deferred to periodic sweep account=%s", account.ID)
	}
	if err := dataretention.ClearRevokedYouTubeMetadata(ctx, h.db, now, account.WorkspaceID); err != nil {
		log.Printf("YouTube data cleanup deferred to durable retry account=%s", account.ID)
	}
}

func revokeLegacyAccountGrant(ctx context.Context, db bun.IDB, account models.SocialAccount) error {
	_, err := db.NewUpdate().Model((*models.SocialAccount)(nil)).
		Set("is_active = ?", false).
		Set("access_token_encrypted = ?", []byte{}).
		Set("refresh_token_encrypted = ?", []byte{}).
		Set("token_expires_at = NULL").
		Set("error_message = ?", "Provider authorization revoked").
		Where("id = ?", account.ID).
		Exec(ctx)
	if err != nil {
		return err
	}
	return nil
}

func revokeSharedAccountGrant(ctx context.Context, db bun.IDB, account models.SocialAccount, userID string, now time.Time) error {
	result, err := db.NewUpdate().Model((*models.OAuthGrant)(nil)).
		Set("access_token_encrypted = ?", []byte{}).
		Set("refresh_token_encrypted = ?", []byte{}).
		Set("access_token_expires_at = NULL").
		Set("refresh_token_expires_at = NULL").
		Set("token_version = token_version + 1").
		Set("refresh_lease_owner = ''").
		Set("refresh_lease_expires_at = NULL").
		Set("revoked_by_id = ?", userID).
		Set("revocation_reason = ?", "user_revoked").
		Set("revoked_at = ?", now).
		Set("validation_status = ?", "revoked").
		Set("updated_at = ?", now).
		Where("id = ? AND workspace_id = ? AND revoked_at IS NULL", account.OAuthGrantID, account.WorkspaceID).
		Exec(ctx)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		var exists int
		if err := db.NewSelect().Model((*models.OAuthGrant)(nil)).
			ColumnExpr("COUNT(*)").
			Where("id = ? AND workspace_id = ?", account.OAuthGrantID, account.WorkspaceID).
			Scan(ctx, &exists); err != nil {
			return err
		}
		if exists == 0 {
			return sql.ErrNoRows
		}
	}
	if _, err := db.NewUpdate().Model((*models.SocialAccount)(nil)).
		Set("is_active = ?", false).
		Set("error_message = ?", "Provider authorization revoked").
		Where("oauth_grant_id = ? AND workspace_id = ?", account.OAuthGrantID, account.WorkspaceID).
		Exec(ctx); err != nil {
		return err
	}
	return tokenmanager.CancelGrantRefreshJobs(ctx, db, account.OAuthGrantID)
}

func (h *OAuthHandler) revokeProviderAuthorization(ctx context.Context, account models.SocialAccount) error {
	key := account.Platform
	if account.Platform == mastodonProvider || account.Platform == "bluesky" {
		key = platform.AccountProviderKey(account.Platform, account.InstanceURL, "")
	}
	adapter, _ := h.provider(key)
	revoker, ok := adapter.(platform.AuthorizationRevoker)
	if !ok {
		return nil
	}

	var encrypted []byte
	if account.OAuthGrantID == "" {
		encrypted = account.AccessTokenEnc
	} else {
		var grant models.OAuthGrant
		if err := h.db.NewSelect().Model(&grant).
			Column("access_token_encrypted").
			Where("id = ? AND workspace_id = ? AND revoked_at IS NULL", account.OAuthGrantID, account.WorkspaceID).
			Scan(ctx); err != nil {
			return err
		}
		encrypted = grant.AccessTokenEnc
	}
	if len(encrypted) == 0 {
		return errors.New("provider authorization credential is unavailable")
	}
	accessToken, err := h.crypto.Decrypt(encrypted)
	if err != nil {
		return fmt.Errorf("decrypt provider authorization: %w", err)
	}
	return revoker.RevokeAuthorization(ctx, accessToken)
}
