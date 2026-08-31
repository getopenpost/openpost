package handlers

import (
	"context"
	"encoding/base64"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	servicecrypto "github.com/openpost/backend/internal/services/crypto"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type synchronizeXRequestSelectsHook struct {
	mu       sync.Mutex
	arrivals int
	release  chan struct{}
}

func (hook *synchronizeXRequestSelectsHook) BeforeQuery(ctx context.Context, event *bun.QueryEvent) context.Context {
	if event.Operation() != "SELECT" || !strings.Contains(event.Query, "x_oauth_request_tokens") {
		return ctx
	}

	hook.mu.Lock()
	hook.arrivals++
	if hook.arrivals == 2 {
		close(hook.release)
	}
	hook.mu.Unlock()
	<-hook.release
	return ctx
}

func (*synchronizeXRequestSelectsHook) AfterQuery(context.Context, *bun.QueryEvent) {}

func TestXRequestStoreReturnsSecretToOneConcurrentConsumer(t *testing.T) {
	ctx := context.Background()
	db, err := database.InitDBWithDriver("sqlite", "file:"+filepath.Join(t.TempDir(), "x-request.db")+"?mode=rwc")
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if _, err := db.NewCreateTable().Model((*models.XOAuthRequestToken)(nil)).Exec(ctx); err != nil {
		t.Fatalf("create X request-token table: %v", err)
	}

	store := newXRequestStore(db, servicecrypto.NewTokenEncryptor("legacy-compatible-key"))
	if err := store.Save("request-token", "request-secret", "workspace-1", "user-1", "connect", time.Now()); err != nil {
		t.Fatalf("save X request token: %v", err)
	}

	// Force an implementation that selects before deleting to let both callbacks
	// observe the secret. An atomic delete-and-return implementation skips this hook.
	db.AddQueryHook(&synchronizeXRequestSelectsHook{release: make(chan struct{})})

	type consumeResult struct {
		secret string
		ok     bool
		err    error
	}
	results := make(chan consumeResult, 2)
	start := make(chan struct{})
	for range 2 {
		go func() {
			<-start
			meta, ok, consumeErr := store.Consume("request-token", time.Minute)
			results <- consumeResult{secret: meta.Secret, ok: ok, err: consumeErr}
		}()
	}
	close(start)

	var successes, rejected int
	for range 2 {
		result := <-results
		if result.err != nil {
			t.Fatalf("consume X request token: %v", result.err)
		}
		if result.ok {
			successes++
			if result.secret != "request-secret" {
				t.Fatalf("successful consumer received the wrong secret: %q", result.secret)
			}
			continue
		}
		rejected++
		if result.secret != "" {
			t.Fatalf("rejected consumer received X request secret: %q", result.secret)
		}
	}
	if successes != 1 || rejected != 1 {
		t.Fatalf("expected one successful and one rejected consumer, got successes=%d rejected=%d", successes, rejected)
	}
}

func TestXRequestStoreStagesEncryptedStorageAcrossRollbackBoundary(t *testing.T) {
	db, err := database.InitDBWithDriver("sqlite", "file:"+filepath.Join(t.TempDir(), "x-request-encryption.db")+"?mode=rwc")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	_, err = db.NewCreateTable().Model((*models.XOAuthRequestToken)(nil)).Exec(t.Context())
	require.NoError(t, err)

	legacyReader := servicecrypto.NewTokenEncryptor("legacy-compatible-encryption-key")
	legacyStore := newXRequestStore(db, legacyReader)
	require.NoError(t, legacyStore.Save("legacy-write", "legacy-secret", "workspace", "user", "connect", time.Now()))

	legacyRecord := new(models.XOAuthRequestToken)
	require.NoError(t, db.NewSelect().Model(legacyRecord).Where("request_token = ?", "legacy-write").Scan(t.Context()))
	require.Equal(t, "legacy-secret", legacyRecord.RequestSecret, "v4.13 must still be able to consume pre-keyring writes")

	versioned, err := servicecrypto.NewTokenEncryptorWithKeyring(
		"2026-08",
		"versioned-encryption-key-with-at-least-thirty-two-characters",
		nil,
	)
	require.NoError(t, err)
	versionedStore := newXRequestStore(db, versioned)
	require.NoError(t, versionedStore.Save("versioned-write", "versioned-secret", "workspace", "user", "connect", time.Now()))

	versionedRecord := new(models.XOAuthRequestToken)
	require.NoError(t, db.NewSelect().Model(versionedRecord).Where("request_token = ?", "versioned-write").Scan(t.Context()))
	require.True(t, strings.HasPrefix(versionedRecord.RequestSecret, xRequestEncryptedSecretPrefix))
	require.NotContains(t, versionedRecord.RequestSecret, "versioned-secret")

	meta, found, err := versionedStore.Consume("versioned-write", time.Minute)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, "versioned-secret", meta.Secret)

	_, err = db.NewInsert().Model(&models.XOAuthRequestToken{
		RequestToken: "v413-write", RequestSecret: "v413-secret", WorkspaceID: "workspace", UserID: "user", CreatedAt: time.Now(),
	}).Exec(t.Context())
	require.NoError(t, err)
	meta, found, err = versionedStore.Consume("v413-write", time.Minute)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, "v413-secret", meta.Secret, "new readers must retain the v4.13 plaintext fallback during rollout")
}

func TestXRequestStoreLegacyModeDoesNotInterpretEncryptionPrefix(t *testing.T) {
	db, err := database.InitDBWithDriver("sqlite", "file:"+filepath.Join(t.TempDir(), "x-request-prefix.db")+"?mode=rwc")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	_, err = db.NewCreateTable().Model((*models.XOAuthRequestToken)(nil)).Exec(t.Context())
	require.NoError(t, err)

	store := newXRequestStore(db, servicecrypto.NewTokenEncryptor("legacy-compatible-encryption-key"))
	rawSecrets := []string{
		xRequestEncryptedSecretPrefix + "raw-provider-secret",
		xRequestEncryptedSecretPrefix + base64.StdEncoding.EncodeToString([]byte("base64 but not an OpenPost envelope")),
	}
	for index, rawSecret := range rawSecrets {
		requestToken := fmt.Sprintf("legacy-prefixed-%d", index)
		require.NoError(t, store.Save(requestToken, rawSecret, "workspace", "user", "connect", time.Now()))

		meta, found, err := store.Consume(requestToken, time.Minute)

		require.NoError(t, err)
		require.True(t, found)
		require.Equal(t, rawSecret, meta.Secret)
	}
}

func TestXRequestStoreReadsEncryptedSecretAcrossRollingKeyIDCutover(t *testing.T) {
	const sharedKey = "shared-encryption-key-with-at-least-thirty-two-characters"
	db, err := database.InitDBWithDriver("sqlite", "file:"+filepath.Join(t.TempDir(), "x-request-rolling-key-id.db")+"?mode=rwc")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	_, err = db.NewCreateTable().Model((*models.XOAuthRequestToken)(nil)).Exec(t.Context())
	require.NoError(t, err)

	explicitIDEncryptor, err := servicecrypto.NewTokenEncryptorWithKeyring("old-primary", sharedKey, nil)
	require.NoError(t, err)
	writer := newXRequestStore(db, explicitIDEncryptor)
	legacyReader := newXRequestStore(db, servicecrypto.NewTokenEncryptor(sharedKey))
	require.NoError(t, writer.Save("same-key", "same-key-secret", "workspace", "user", "connect", time.Now()))

	meta, found, err := legacyReader.Consume("same-key", time.Minute)

	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, "same-key-secret", meta.Secret)

	require.NoError(t, writer.Save("wrong-key", "wrong-key-secret", "workspace", "user", "connect", time.Now()))
	wrongKeyReader := newXRequestStore(db, servicecrypto.NewTokenEncryptor("different-encryption-key-with-at-least-thirty-two-characters"))
	_, found, err = wrongKeyReader.Consume("wrong-key", time.Minute)
	require.ErrorContains(t, err, "decrypt X OAuth request secret")
	require.False(t, found)

	require.NoError(t, writer.Save("corrupted", "corrupted-secret", "workspace", "user", "connect", time.Now()))
	var storedSecret string
	require.NoError(t, db.QueryRowContext(
		t.Context(),
		`SELECT request_secret FROM x_oauth_request_tokens WHERE request_token = ?`,
		"corrupted",
	).Scan(&storedSecret))
	encodedCiphertext, prefixed := strings.CutPrefix(storedSecret, xRequestEncryptedSecretPrefix)
	require.True(t, prefixed)
	ciphertext, err := base64.StdEncoding.Strict().DecodeString(encodedCiphertext)
	require.NoError(t, err)
	ciphertext[len(ciphertext)-1] ^= 1
	_, err = db.ExecContext(
		t.Context(),
		`UPDATE x_oauth_request_tokens SET request_secret = ? WHERE request_token = ?`,
		xRequestEncryptedSecretPrefix+base64.StdEncoding.EncodeToString(ciphertext),
		"corrupted",
	)
	require.NoError(t, err)

	_, found, err = legacyReader.Consume("corrupted", time.Minute)
	require.ErrorContains(t, err, "decrypt X OAuth request secret")
	require.False(t, found)
}
