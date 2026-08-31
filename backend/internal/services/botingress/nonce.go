package botingress

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

const (
	ConnectionNonceTTL = 15 * time.Minute
	credentialPrefix   = "opbn1"
	nonceBytes         = 32
)

type Service struct {
	db         *bun.DB
	signingKey []byte
	now        func() time.Time
	processors processorRegistry
}

type IssueNonceInput struct {
	Provider                 string
	WorkspaceID              string
	CreatedByUserID          string
	ExpectedSubjectReference string
	ExpiresAt                time.Time
}

type IssuedNonce struct {
	ID         string    `json:"id"`
	Credential string    `json:"credential"`
	ExpiresAt  time.Time `json:"expires_at"`
}

type credentialClaims struct {
	ID       string `json:"i"`
	Provider string `json:"p"`
	Nonce    string `json:"n"`
	Expires  int64  `json:"e"`
}

func New(db *bun.DB, signingKey []byte) *Service {
	return &Service{
		db: db, signingKey: append([]byte(nil), signingKey...),
		now:        func() time.Time { return time.Now().UTC() },
		processors: processorRegistry{items: make(map[string]Processor)},
	}
}

func (s *Service) SetNowForTest(now func() time.Time) {
	if now != nil {
		s.now = now
	}
}

func (s *Service) IssueNonce(ctx context.Context, input IssueNonceInput) (IssuedNonce, error) {
	now := s.now().UTC()
	input.Provider = normalizeProvider(input.Provider)
	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.CreatedByUserID = strings.TrimSpace(input.CreatedByUserID)
	input.ExpectedSubjectReference = strings.TrimSpace(input.ExpectedSubjectReference)
	if s.db == nil || len(s.signingKey) == 0 {
		return IssuedNonce{}, ErrIngressUnavailable
	}
	if !validProvider(input.Provider) || !validReference(input.WorkspaceID, 200, true) ||
		!validReference(input.CreatedByUserID, 200, true) ||
		!validReference(input.ExpectedSubjectReference, 500, false) {
		return IssuedNonce{}, ErrInvalidNonce
	}
	expiresAt := input.ExpiresAt.UTC()
	if input.ExpiresAt.IsZero() {
		expiresAt = now.Add(ConnectionNonceTTL)
	}
	if !expiresAt.After(now) || expiresAt.After(now.Add(ConnectionNonceTTL)) {
		return IssuedNonce{}, ErrInvalidNonce
	}

	nonce := make([]byte, nonceBytes)
	if _, err := rand.Read(nonce); err != nil {
		return IssuedNonce{}, ErrIngressUnavailable
	}
	claims := credentialClaims{
		ID: uuid.NewString(), Provider: input.Provider,
		Nonce: base64.RawURLEncoding.EncodeToString(nonce), Expires: expiresAt.Unix(),
	}
	credential, err := s.encodeCredential(claims)
	if err != nil {
		return IssuedNonce{}, ErrIngressUnavailable
	}
	row := &models.BotConnectionNonce{
		ID: claims.ID, Provider: claims.Provider, WorkspaceID: input.WorkspaceID,
		CreatedByUserID: input.CreatedByUserID, NonceHash: hashNonce(claims.Nonce),
		ExpectedSubjectReference: input.ExpectedSubjectReference,
		ExpiresAt:                expiresAt, CreatedAt: now,
	}
	if _, err := s.db.NewInsert().Model(row).Exec(ctx); err != nil {
		return IssuedNonce{}, ErrIngressUnavailable
	}
	return IssuedNonce{ID: row.ID, Credential: credential, ExpiresAt: expiresAt}, nil
}

func (s *Service) ConsumeNonce(ctx context.Context, credential string) (*models.BotConnectionNonce, error) {
	if s.db == nil || len(s.signingKey) == 0 {
		return nil, ErrIngressUnavailable
	}
	claims, err := s.decodeCredential(credential, s.now().UTC())
	if err != nil {
		return nil, err
	}
	return s.consumeClaims(ctx, s.db, claims, s.now().UTC(), "")
}

func (s *Service) consumeClaims(ctx context.Context, db bun.IDB, claims credentialClaims, now time.Time, subjectReference string) (*models.BotConnectionNonce, error) {
	subjectReference = strings.TrimSpace(subjectReference)
	result, err := db.NewUpdate().Model((*models.BotConnectionNonce)(nil)).
		Set("consumed_at = ?", now).
		Set("expected_subject_reference = ?", subjectReference).
		Where("id = ? AND provider = ? AND nonce_hash = ?", claims.ID, claims.Provider, hashNonce(claims.Nonce)).
		Where("consumed_at IS NULL AND expires_at > ?", now).
		Where("(expected_subject_reference = '' OR expected_subject_reference = ?)", subjectReference).
		Exec(ctx)
	if err != nil {
		return nil, ErrIngressUnavailable
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return nil, ErrIngressUnavailable
	}
	if rows != 1 {
		return nil, s.classifyNonceRejection(ctx, db, claims, now, subjectReference)
	}
	var row models.BotConnectionNonce
	if err := db.NewSelect().Model(&row).Where("id = ?", claims.ID).Scan(ctx); err != nil {
		return nil, ErrIngressUnavailable
	}
	return &row, nil
}

func (s *Service) classifyNonceRejection(ctx context.Context, db bun.IDB, claims credentialClaims, now time.Time, subjectReference string) error {
	var row models.BotConnectionNonce
	err := db.NewSelect().Model(&row).Where("id = ?", claims.ID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrInvalidNonce
	}
	if err != nil {
		return ErrIngressUnavailable
	}
	if row.Provider != claims.Provider || !hmac.Equal([]byte(row.NonceHash), []byte(hashNonce(claims.Nonce))) {
		return ErrInvalidNonce
	}
	if row.ExpectedSubjectReference != "" && row.ExpectedSubjectReference != subjectReference {
		return ErrInvalidEvent
	}
	if !row.ExpiresAt.After(now) {
		return ErrNonceExpired
	}
	if !row.ConsumedAt.IsZero() {
		return ErrNonceConsumed
	}
	return ErrInvalidNonce
}

func (s *Service) encodeCredential(claims credentialClaims) (string, error) {
	encoded, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(encoded)
	mac := hmac.New(sha256.New, s.signingKey)
	_, _ = mac.Write([]byte(credentialPrefix + "." + payload))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return credentialPrefix + "." + payload + "." + signature, nil
}

func (s *Service) decodeCredential(credential string, now time.Time) (credentialClaims, error) {
	parts := strings.Split(strings.TrimSpace(credential), ".")
	if len(parts) != 3 || parts[0] != credentialPrefix || len(s.signingKey) == 0 {
		return credentialClaims{}, ErrInvalidNonce
	}
	provided, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || len(provided) != sha256.Size {
		return credentialClaims{}, ErrInvalidNonce
	}
	mac := hmac.New(sha256.New, s.signingKey)
	_, _ = mac.Write([]byte(parts[0] + "." + parts[1]))
	if !hmac.Equal(provided, mac.Sum(nil)) {
		return credentialClaims{}, ErrInvalidNonce
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return credentialClaims{}, ErrInvalidNonce
	}
	var claims credentialClaims
	decoder := json.NewDecoder(strings.NewReader(string(payload)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&claims); err != nil {
		return credentialClaims{}, ErrInvalidNonce
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return credentialClaims{}, ErrInvalidNonce
	}
	if !validReference(claims.ID, 200, true) || !validProvider(claims.Provider) ||
		!validReference(claims.Nonce, 100, true) || claims.Expires <= 0 {
		return credentialClaims{}, ErrInvalidNonce
	}
	if !time.Unix(claims.Expires, 0).UTC().After(now) {
		return credentialClaims{}, ErrNonceExpired
	}
	return claims, nil
}

func hashNonce(nonce string) string {
	digest := sha256.Sum256([]byte(nonce))
	return hex.EncodeToString(digest[:])
}
