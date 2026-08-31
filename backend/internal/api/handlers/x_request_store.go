package handlers

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"strings"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/uptrace/bun"
)

const xRequestEncryptedSecretPrefix = "openpost-encrypted-v1:"

type xRequestStore struct {
	db        *bun.DB
	encryptor *servicecrypto.TokenEncryptor
}

func newXRequestStore(db *bun.DB, encryptor *servicecrypto.TokenEncryptor) *xRequestStore {
	return &xRequestStore{db: db, encryptor: encryptor}
}

func (s *xRequestStore) Save(requestToken, requestSecret, workspaceID, userID, executionIntent string, createdAt time.Time) error {
	storedSecret := requestSecret
	if s.encryptor.WritesVersionedCiphertext() {
		ciphertext, err := s.encryptor.Encrypt(requestSecret)
		if err != nil {
			return errors.New("encrypt X OAuth request secret")
		}
		storedSecret = xRequestEncryptedSecretPrefix + base64.StdEncoding.EncodeToString(ciphertext)
	}
	record := &models.XOAuthRequestToken{
		RequestToken:    requestToken,
		RequestSecret:   storedSecret,
		WorkspaceID:     workspaceID,
		UserID:          userID,
		ExecutionIntent: executionIntent,
		CreatedAt:       createdAt.UTC(),
	}

	ctx := context.Background()
	_, err := s.db.NewInsert().Model(record).Exec(ctx)
	return err
}

func (s *xRequestStore) Consume(requestToken string, maxAge time.Duration) (platform.XRequestMeta, bool, error) {
	ctx := context.Background()

	record := new(models.XOAuthRequestToken)
	err := s.db.NewDelete().
		Model(record).
		Where("request_token = ?", requestToken).
		Returning("*").
		Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return platform.XRequestMeta{}, false, nil
		}
		return platform.XRequestMeta{}, false, err
	}

	if time.Since(record.CreatedAt) > maxAge {
		return platform.XRequestMeta{}, false, nil
	}

	requestSecret := record.RequestSecret
	if encodedCiphertext, prefixed := strings.CutPrefix(requestSecret, xRequestEncryptedSecretPrefix); prefixed {
		if ciphertext, decodeErr := base64.StdEncoding.Strict().DecodeString(encodedCiphertext); decodeErr == nil {
			plaintext, recognized, decryptErr := s.encryptor.DecryptEnvelope(ciphertext)
			if recognized {
				if decryptErr != nil {
					return platform.XRequestMeta{}, false, errors.New("decrypt X OAuth request secret")
				}
				requestSecret = plaintext
			}
		}
	}

	return platform.XRequestMeta{
		Secret:          requestSecret,
		WorkspaceID:     record.WorkspaceID,
		UserID:          record.UserID,
		ExecutionIntent: record.ExecutionIntent,
		CreatedAt:       record.CreatedAt,
	}, true, nil
}
