package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"io"
	"testing"

	"github.com/stretchr/testify/require"
)

func encryptLegacyCiphertext(t *testing.T, key, plaintext string) []byte {
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

func decryptLegacyCiphertext(t *testing.T, key string, ciphertext []byte) string {
	t.Helper()
	hash := sha256.Sum256([]byte(key))
	block, err := aes.NewCipher(hash[:])
	require.NoError(t, err)
	gcm, err := cipher.NewGCM(block)
	require.NoError(t, err)
	require.GreaterOrEqual(t, len(ciphertext), gcm.NonceSize()+gcm.Overhead())
	plaintext, err := gcm.Open(nil, ciphertext[:gcm.NonceSize()], ciphertext[gcm.NonceSize():], nil)
	require.NoError(t, err)
	return string(plaintext)
}

func TestNewTokenEncryptorPreservesLegacyWritesForRollback(t *testing.T) {
	const key = "legacy-compatible-encryption-key"

	ciphertext, err := NewTokenEncryptor(key).Encrypt("rollback-compatible")

	require.NoError(t, err)
	require.Equal(t, "rollback-compatible", decryptLegacyCiphertext(t, key, ciphertext))
}

func TestTokenEncryptorRejectsUnknownEnvelopeKeyID(t *testing.T) {
	retired, err := NewTokenEncryptorWithKeyring(
		"retired",
		"retired-encryption-key-with-at-least-thirty-two-characters",
		nil,
	)
	require.NoError(t, err)
	ciphertext, err := retired.Encrypt("must-not-fall-back")
	require.NoError(t, err)

	current, err := NewTokenEncryptorWithKeyring(
		"current",
		"current-encryption-key-with-at-least-thirty-two-characters",
		map[string]string{"known-old": "known-old-encryption-key-with-at-least-thirty-two-characters"},
	)
	require.NoError(t, err)

	_, err = current.Decrypt(ciphertext)
	require.ErrorContains(t, err, "unknown encryption key ID")
}

func TestEncryptDecrypt(t *testing.T) {
	encryptor := NewTokenEncryptor("test-secret-key")

	tests := []struct {
		name      string
		plaintext string
	}{
		{"empty string", ""},
		{"simple text", "hello world"},
		{"oauth token", "oauth-token-for-roundtrip-test-only"},
		{"json string", `{"access_token":"token","refresh_token":"refresh"}`},
		{"special chars", "token with spaces & symbols!@#$%"},
		{"unicode", "日本語テスト"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ciphertext, err := encryptor.Encrypt(tt.plaintext)
			if err != nil {
				t.Fatalf("Encrypt() error = %v", err)
			}

			if tt.plaintext == "" {
				if ciphertext != nil {
					t.Errorf("expected nil for empty plaintext, got %v", ciphertext)
				}
				return
			}

			decrypted, err := encryptor.Decrypt(ciphertext)
			if err != nil {
				t.Fatalf("Decrypt() error = %v", err)
			}

			if decrypted != tt.plaintext {
				t.Errorf("Decrypt() = %q, want %q", decrypted, tt.plaintext)
			}
		})
	}
}
