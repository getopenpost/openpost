package handlers

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/uptrace/bun"
)

type xRequestStore struct {
	db *bun.DB
}

func newXRequestStore(db *bun.DB) *xRequestStore {
	return &xRequestStore{db: db}
}

func (s *xRequestStore) Save(requestToken, requestSecret, workspaceID, userID string, createdAt time.Time) error {
	record := &models.XOAuthRequestToken{
		RequestToken:  requestToken,
		RequestSecret: requestSecret,
		WorkspaceID:   workspaceID,
		UserID:        userID,
		CreatedAt:     createdAt.UTC(),
	}

	ctx := context.Background()
	_, err := s.db.NewInsert().Model(record).Exec(ctx)
	return err
}

func (s *xRequestStore) Consume(requestToken string, maxAge time.Duration) (platform.XRequestMeta, bool, error) {
	ctx := context.Background()

	record := new(models.XOAuthRequestToken)
	err := s.db.NewSelect().Model(record).Where("request_token = ?", requestToken).Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return platform.XRequestMeta{}, false, nil
		}
		return platform.XRequestMeta{}, false, err
	}

	_, delErr := s.db.NewDelete().Model(record).Where("request_token = ?", requestToken).Exec(ctx)
	if delErr != nil {
		return platform.XRequestMeta{}, false, delErr
	}

	if time.Since(record.CreatedAt) > maxAge {
		return platform.XRequestMeta{}, false, nil
	}

	return platform.XRequestMeta{
		Secret:      record.RequestSecret,
		WorkspaceID: record.WorkspaceID,
		UserID:      record.UserID,
		CreatedAt:   record.CreatedAt,
	}, true, nil
}
