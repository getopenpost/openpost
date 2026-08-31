package encryptionrotation

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"testing"
	"time"

	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"
)

type encryptedFixture struct {
	table      string
	column     string
	primaryKey []string
	keyValues  []string
	plaintext  string
}

func rotationTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqlDB, err := sql.Open(sqliteshim.ShimName, "file:"+t.Name()+"?mode=memory&cache=shared")
	require.NoError(t, err)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })

	statements := []string{
		`CREATE TABLE users (id TEXT PRIMARY KEY, totp_secret_encrypted BLOB)`,
		`CREATE TABLE identity_providers (id TEXT PRIMARY KEY, client_secret_encrypted BLOB)`,
		`CREATE TABLE oidc_auth_requests (id TEXT PRIMARY KEY, pkce_verifier_encrypted BLOB)`,
		`CREATE TABLE oidc_native_handoffs (id TEXT PRIMARY KEY, token_encrypted BLOB)`,
		`CREATE TABLE mastodon_instances (id TEXT PRIMARY KEY, client_secret_encrypted BLOB)`,
		`CREATE TABLE provider_apps (id TEXT PRIMARY KEY, client_secret_encrypted BLOB)`,
		`CREATE TABLE instance_settings (key TEXT PRIMARY KEY, value_encrypted BLOB)`,
		`CREATE TABLE ai_prompt_overrides (key TEXT PRIMARY KEY, value_encrypted BLOB)`,
		`CREATE TABLE oauth_grants (id TEXT PRIMARY KEY, access_token_encrypted BLOB, refresh_token_encrypted BLOB)`,
		`CREATE TABLE social_accounts (id TEXT PRIMARY KEY, access_token_encrypted BLOB, refresh_token_encrypted BLOB)`,
		`CREATE TABLE x_oauth_request_tokens (request_token TEXT PRIMARY KEY, request_secret TEXT NOT NULL, created_at TIMESTAMP NOT NULL)`,
		`CREATE TABLE oauth_account_selections (id TEXT PRIMARY KEY, access_token_encrypted BLOB, refresh_token_encrypted BLOB)`,
		`CREATE TABLE rendition_media_deliveries (rendition_id TEXT, media_id TEXT, session_state_encrypted BLOB, PRIMARY KEY (rendition_id, media_id))`,
		`CREATE TABLE auth_challenges (id TEXT PRIMARY KEY, type TEXT, payload TEXT)`,
		`CREATE TABLE jobs (id TEXT PRIMARY KEY, type TEXT, payload TEXT)`,
	}
	for _, statement := range statements {
		_, err := db.ExecContext(t.Context(), statement)
		require.NoError(t, err)
	}
	return db
}

func legacyCiphertext(t *testing.T, key, plaintext string) []byte {
	t.Helper()
	hash := sha256.Sum256([]byte(key))
	block, err := aes.NewCipher(hash[:])
	require.NoError(t, err)
	gcm, err := cipher.NewGCM(block)
	require.NoError(t, err)
	nonce := make([]byte, gcm.NonceSize())
	_, err = io.ReadFull(rand.Reader, nonce)
	require.NoError(t, err)
	return gcm.Seal(nonce, nonce, []byte(plaintext), nil)
}

func seedEncryptedColumns(t *testing.T, db *bun.DB, key string) []encryptedFixture {
	t.Helper()
	fixtures := []encryptedFixture{
		{table: "users", column: "totp_secret_encrypted", primaryKey: []string{"id"}, keyValues: []string{"user"}, plaintext: "totp-secret"},
		{table: "identity_providers", column: "client_secret_encrypted", primaryKey: []string{"id"}, keyValues: []string{"identity"}, plaintext: "identity-secret"},
		{table: "oidc_auth_requests", column: "pkce_verifier_encrypted", primaryKey: []string{"id"}, keyValues: []string{"request"}, plaintext: "pkce-verifier"},
		{table: "oidc_native_handoffs", column: "token_encrypted", primaryKey: []string{"id"}, keyValues: []string{"handoff"}, plaintext: "native-token"},
		{table: "mastodon_instances", column: "client_secret_encrypted", primaryKey: []string{"id"}, keyValues: []string{"mastodon"}, plaintext: "mastodon-secret"},
		{table: "provider_apps", column: "client_secret_encrypted", primaryKey: []string{"id"}, keyValues: []string{"provider"}, plaintext: "provider-secret"},
		{table: "instance_settings", column: "value_encrypted", primaryKey: []string{"key"}, keyValues: []string{"setting"}, plaintext: "instance-setting"},
		{table: "ai_prompt_overrides", column: "value_encrypted", primaryKey: []string{"key"}, keyValues: []string{"prompt"}, plaintext: "ai-prompt"},
		{table: "oauth_grants", column: "access_token_encrypted", primaryKey: []string{"id"}, keyValues: []string{"grant"}, plaintext: "grant-access"},
		{table: "oauth_grants", column: "refresh_token_encrypted", primaryKey: []string{"id"}, keyValues: []string{"grant"}, plaintext: "grant-refresh"},
		{table: "social_accounts", column: "access_token_encrypted", primaryKey: []string{"id"}, keyValues: []string{"account"}, plaintext: "account-access"},
		{table: "social_accounts", column: "refresh_token_encrypted", primaryKey: []string{"id"}, keyValues: []string{"account"}, plaintext: "account-refresh"},
		{table: "oauth_account_selections", column: "access_token_encrypted", primaryKey: []string{"id"}, keyValues: []string{"selection"}, plaintext: "selection-access"},
		{table: "oauth_account_selections", column: "refresh_token_encrypted", primaryKey: []string{"id"}, keyValues: []string{"selection"}, plaintext: "selection-refresh"},
		{table: "rendition_media_deliveries", column: "session_state_encrypted", primaryKey: []string{"rendition_id", "media_id"}, keyValues: []string{"rendition", "media"}, plaintext: "upload-session"},
	}

	insertedRows := make(map[string]bool)
	for _, fixture := range fixtures {
		rowKey := fixture.table + "\x00" + fmt.Sprint(fixture.keyValues)
		ciphertext := legacyCiphertext(t, key, fixture.plaintext)
		if !insertedRows[rowKey] {
			columns := append(append([]string{}, fixture.primaryKey...), fixture.column)
			arguments := make([]any, 0, len(fixture.keyValues)+1)
			for _, value := range fixture.keyValues {
				arguments = append(arguments, value)
			}
			arguments = append(arguments, ciphertext)
			_, err := db.ExecContext(t.Context(), fmt.Sprintf(
				"INSERT INTO %s (%s) VALUES (%s)",
				quoteTestIdentifier(fixture.table),
				joinTestIdentifiers(columns),
				placeholders(len(columns)),
			), arguments...)
			require.NoError(t, err)
			insertedRows[rowKey] = true
			continue
		}
		_, err := db.ExecContext(t.Context(), fmt.Sprintf(
			"UPDATE %s SET %s = ? WHERE %s = ?",
			quoteTestIdentifier(fixture.table),
			quoteTestIdentifier(fixture.column),
			quoteTestIdentifier(fixture.primaryKey[0]),
		), ciphertext, fixture.keyValues[0])
		require.NoError(t, err)
	}
	return fixtures
}

func TestRotateReencryptsEveryPersistedCiphertextAndVerifiesCurrentKey(t *testing.T) {
	const oldKey = "old-encryption-key-with-at-least-thirty-two-characters"
	db := rotationTestDB(t)
	fixtures := seedEncryptedColumns(t, db, oldKey)

	authCiphertext := legacyCiphertext(t, oldKey, "pending-totp-secret")
	authPayload, err := json.Marshal(map[string]any{
		"secret_encrypted":     base64.StdEncoding.EncodeToString(authCiphertext),
		"recovery_batch_id":    "batch",
		"future_unknown_field": map[string]any{"preserved": true},
	})
	require.NoError(t, err)
	_, err = db.ExecContext(t.Context(), `INSERT INTO auth_challenges (id, type, payload) VALUES (?, 'totp_setup', ?)`, "challenge", string(authPayload))
	require.NoError(t, err)

	jobCiphertext := legacyCiphertext(t, oldKey, "https://openpost.test/invite?token=secret")
	jobPayload, err := json.Marshal(map[string]any{
		"accept_url_encrypted": base64.StdEncoding.EncodeToString(jobCiphertext),
		"delivery_id":          "delivery",
		"future_unknown_field": []string{"preserved"},
	})
	require.NoError(t, err)
	_, err = db.ExecContext(t.Context(), `INSERT INTO jobs (id, type, payload) VALUES (?, 'notification_email', ?)`, "job", string(jobPayload))
	require.NoError(t, err)
	encryptor, err := servicecrypto.NewTokenEncryptorWithKeyring(
		"2026-08",
		"new-encryption-key-with-at-least-thirty-two-characters",
		map[string]string{"2026-07": oldKey},
	)
	require.NoError(t, err)

	result, err := Rotate(t.Context(), db, encryptor)

	require.NoError(t, err)
	require.Equal(t, 17, result.RotatedCiphertexts)
	require.Equal(t, 17, result.VerifiedCiphertexts)
	for _, fixture := range fixtures {
		var ciphertext []byte
		arguments := make([]any, 0, len(fixture.keyValues))
		where := make([]string, 0, len(fixture.primaryKey))
		for index, primaryKey := range fixture.primaryKey {
			where = append(where, quoteTestIdentifier(primaryKey)+" = ?")
			arguments = append(arguments, fixture.keyValues[index])
		}
		err := db.QueryRowContext(t.Context(), fmt.Sprintf(
			"SELECT %s FROM %s WHERE %s",
			quoteTestIdentifier(fixture.column),
			quoteTestIdentifier(fixture.table),
			joinWithAND(where),
		), arguments...).Scan(&ciphertext)
		require.NoError(t, err)
		require.NoError(t, encryptor.VerifyCurrentCiphertext(ciphertext), "%s.%s", fixture.table, fixture.column)
		plaintext, err := encryptor.Decrypt(ciphertext)
		require.NoError(t, err)
		require.Equal(t, fixture.plaintext, plaintext)
	}

	requireEncryptedJSONField(t, db, encryptor, "auth_challenges", "challenge", "secret_encrypted", "pending-totp-secret")
	requireEncryptedJSONField(t, db, encryptor, "jobs", "job", "accept_url_encrypted", "https://openpost.test/invite?token=secret")
	secondResult, err := Rotate(t.Context(), db, encryptor)
	require.NoError(t, err)
	require.Zero(t, secondResult.RotatedCiphertexts)
	require.Equal(t, 17, secondResult.VerifiedCiphertexts)
}

func TestRotateRollsBackWhenAnyCiphertextCannotBeVerified(t *testing.T) {
	const oldKey = "old-encryption-key-with-at-least-thirty-two-characters"
	db := rotationTestDB(t)
	legacyUser := legacyCiphertext(t, oldKey, "legacy-user-secret")
	_, err := db.ExecContext(t.Context(), `INSERT INTO users (id, totp_secret_encrypted) VALUES ('a-user', ?)`, legacyUser)
	require.NoError(t, err)

	unknown, err := servicecrypto.NewTokenEncryptorWithKeyring(
		"unknown",
		"unknown-encryption-key-with-at-least-thirty-two-characters",
		nil,
	)
	require.NoError(t, err)
	unknownCiphertext, err := unknown.Encrypt("unavailable-secret")
	require.NoError(t, err)
	_, err = db.ExecContext(t.Context(), `INSERT INTO users (id, totp_secret_encrypted) VALUES ('b-user', ?)`, unknownCiphertext)
	require.NoError(t, err)

	encryptor, err := servicecrypto.NewTokenEncryptorWithKeyring(
		"current",
		"current-encryption-key-with-at-least-thirty-two-characters",
		map[string]string{"old": oldKey},
	)
	require.NoError(t, err)

	_, err = Rotate(context.Background(), db, encryptor)

	require.ErrorContains(t, err, "users.totp_secret_encrypted")
	var stored []byte
	require.NoError(t, db.QueryRowContext(t.Context(), `SELECT totp_secret_encrypted FROM users WHERE id = 'a-user'`).Scan(&stored))
	require.Equal(t, legacyUser, stored, "a later verification failure must roll back its bounded rewrite batch")
}

func TestVerifyFailsClosedBeforePreviousKeysAreRemoved(t *testing.T) {
	db := rotationTestDB(t)
	previousWriter, err := servicecrypto.NewTokenEncryptorWithKeyring(
		"previous",
		"previous-encryption-key-with-at-least-thirty-two-characters",
		nil,
	)
	require.NoError(t, err)
	previousCiphertext, err := previousWriter.Encrypt("still-on-previous-key")
	require.NoError(t, err)
	_, err = db.ExecContext(t.Context(), `INSERT INTO users (id, totp_secret_encrypted) VALUES ('user', ?)`, previousCiphertext)
	require.NoError(t, err)

	currentReader, err := servicecrypto.NewTokenEncryptorWithKeyring(
		"current",
		"current-encryption-key-with-at-least-thirty-two-characters",
		map[string]string{"previous": "previous-encryption-key-with-at-least-thirty-two-characters"},
	)
	require.NoError(t, err)

	verified, err := Verify(t.Context(), db, currentReader)

	require.Zero(t, verified)
	require.ErrorContains(t, err, "users.totp_secret_encrypted")
	require.ErrorContains(t, err, "instead of the current primary")
}

func TestRotatePurgesExpiredXOAuthRequestSecrets(t *testing.T) {
	db := rotationTestDB(t)
	for index := range rotationBatchSize + 1 {
		_, err := db.ExecContext(
			t.Context(),
			`INSERT INTO x_oauth_request_tokens (request_token, request_secret, created_at) VALUES (?, ?, ?)`,
			fmt.Sprintf("expired-%03d", index),
			"plaintext-request-secret",
			time.Now().UTC().Add(-11*time.Minute),
		)
		require.NoError(t, err)
	}
	encryptor, err := servicecrypto.NewTokenEncryptorWithKeyring(
		"current",
		"current-encryption-key-with-at-least-thirty-two-characters",
		nil,
	)
	require.NoError(t, err)

	result, err := Rotate(t.Context(), db, encryptor)

	require.NoError(t, err)
	require.Equal(t, rotationBatchSize+1, result.DeletedExpiredXOAuthRequests)
	var remaining int
	require.NoError(t, db.QueryRowContext(t.Context(), `SELECT COUNT(*) FROM x_oauth_request_tokens`).Scan(&remaining))
	require.Zero(t, remaining)
}

func TestRotateFailsWhileUnexpiredXOAuthRequestSecretRemains(t *testing.T) {
	db := rotationTestDB(t)
	now := time.Now().UTC()
	_, err := db.ExecContext(
		t.Context(),
		`INSERT INTO x_oauth_request_tokens (request_token, request_secret, created_at) VALUES (?, ?, ?), (?, ?, ?)`,
		"expired",
		"expired-plaintext-secret",
		now.Add(-11*time.Minute),
		"unexpired",
		"unexpired-plaintext-secret",
		now.Add(-time.Minute),
	)
	require.NoError(t, err)
	encryptor, err := servicecrypto.NewTokenEncryptorWithKeyring(
		"current",
		"current-encryption-key-with-at-least-thirty-two-characters",
		nil,
	)
	require.NoError(t, err)

	_, err = Rotate(t.Context(), db, encryptor)

	require.ErrorContains(t, err, "X OAuth request secret rows remain")
	var expiredCount int
	require.NoError(t, db.QueryRowContext(t.Context(), `SELECT COUNT(*) FROM x_oauth_request_tokens WHERE request_token = 'expired'`).Scan(&expiredCount))
	require.Zero(t, expiredCount)
	var unexpiredSecret string
	require.NoError(t, db.QueryRowContext(t.Context(), `SELECT request_secret FROM x_oauth_request_tokens WHERE request_token = 'unexpired'`).Scan(&unexpiredSecret))
	require.Equal(t, "unexpired-plaintext-secret", unexpiredSecret)

	verified, verifyErr := Verify(t.Context(), db, encryptor)
	require.Zero(t, verified)
	require.ErrorContains(t, verifyErr, "X OAuth request secret rows remain")
}

func requireEncryptedJSONField(
	t *testing.T,
	db *bun.DB,
	encryptor *servicecrypto.TokenEncryptor,
	table,
	id,
	field,
	wantPlaintext string,
) {
	t.Helper()
	var payload string
	require.NoError(t, db.QueryRowContext(t.Context(), "SELECT payload FROM "+quoteTestIdentifier(table)+" WHERE id = ?", id).Scan(&payload))
	var values map[string]json.RawMessage
	require.NoError(t, json.Unmarshal([]byte(payload), &values))
	var ciphertext []byte
	require.NoError(t, json.Unmarshal(values[field], &ciphertext))
	require.NoError(t, encryptor.VerifyCurrentCiphertext(ciphertext))
	plaintext, err := encryptor.Decrypt(ciphertext)
	require.NoError(t, err)
	require.Equal(t, wantPlaintext, plaintext)
	require.Contains(t, values, "future_unknown_field")
}

func quoteTestIdentifier(identifier string) string {
	return `"` + identifier + `"`
}

func joinTestIdentifiers(identifiers []string) string {
	quoted := make([]string, len(identifiers))
	for index, identifier := range identifiers {
		quoted[index] = quoteTestIdentifier(identifier)
	}
	return joinWithComma(quoted)
}

func placeholders(count int) string {
	values := make([]string, count)
	for index := range values {
		values[index] = "?"
	}
	return joinWithComma(values)
}

func joinWithComma(values []string) string {
	result := ""
	for index, value := range values {
		if index > 0 {
			result += ", "
		}
		result += value
	}
	return result
}

func joinWithAND(values []string) string {
	result := ""
	for index, value := range values {
		if index > 0 {
			result += " AND "
		}
		result += value
	}
	return result
}
