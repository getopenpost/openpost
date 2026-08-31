package crypto

import (
	"bytes"
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

func TestTokenEncryptorReadsLegacyCiphertextWithPreviousKey(t *testing.T) {
	const oldKey = "old-encryption-key-with-at-least-thirty-two-characters"
	encryptor, err := NewTokenEncryptorWithKeyring(
		"2026-08",
		"new-encryption-key-with-at-least-thirty-two-characters",
		map[string]string{"2026-07": oldKey},
	)
	require.NoError(t, err)

	plaintext, err := encryptor.Decrypt(encryptLegacyCiphertext(t, oldKey, "legacy-token"))

	require.NoError(t, err)
	require.Equal(t, "legacy-token", plaintext)
}

func TestTokenEncryptorWritesWithCurrentKeyID(t *testing.T) {
	const currentKey = "new-encryption-key-with-at-least-thirty-two-characters"
	encryptor, err := NewTokenEncryptorWithKeyring(
		"2026-08",
		currentKey,
		map[string]string{"2026-07": "old-encryption-key-with-at-least-thirty-two-characters"},
	)
	require.NoError(t, err)

	ciphertext, err := encryptor.Encrypt("current-token")
	require.NoError(t, err)
	require.NoError(t, encryptor.VerifyCurrentCiphertext(ciphertext))

	currentOnly, err := NewTokenEncryptorWithKeyring("2026-08", currentKey, nil)
	require.NoError(t, err)
	plaintext, err := currentOnly.Decrypt(ciphertext)
	require.NoError(t, err)
	require.Equal(t, "current-token", plaintext)
}

func TestLegacyWriteModeReadsSameKeyEnvelopeDuringExplicitIDRollout(t *testing.T) {
	const key = "shared-encryption-key-with-at-least-thirty-two-characters"
	explicitIDWriter, err := NewTokenEncryptorWithKeyring("old-primary", key, nil)
	require.NoError(t, err)
	ciphertext, err := explicitIDWriter.Encrypt("written-by-updated-peer")
	require.NoError(t, err)

	plaintext, err := NewTokenEncryptor(key).Decrypt(ciphertext)

	require.NoError(t, err)
	require.Equal(t, "written-by-updated-peer", plaintext)
}

func TestTokenEncryptorEnvelopeProbeDistinguishesRecognizedCiphertext(t *testing.T) {
	const key = "shared-encryption-key-with-at-least-thirty-two-characters"
	writer, err := NewTokenEncryptorWithKeyring("old-primary", key, nil)
	require.NoError(t, err)
	ciphertext, err := writer.Encrypt("recognized-envelope")
	require.NoError(t, err)
	reader := NewTokenEncryptor(key)

	plaintext, recognized, err := reader.DecryptEnvelope(ciphertext)
	require.NoError(t, err)
	require.True(t, recognized)
	require.Equal(t, "recognized-envelope", plaintext)

	plaintext, recognized, err = reader.DecryptEnvelope(encryptLegacyCiphertext(t, key, "legacy"))
	require.NoError(t, err)
	require.False(t, recognized)
	require.Empty(t, plaintext)

	corrupted := append([]byte(nil), ciphertext...)
	corrupted[len(corrupted)-1] ^= 1
	plaintext, recognized, err = reader.DecryptEnvelope(corrupted)
	require.Error(t, err)
	require.True(t, recognized)
	require.Empty(t, plaintext)
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

func TestNewTokenEncryptor(t *testing.T) {
	tests := []struct {
		name string
		key  string
	}{
		{"empty key", ""},
		{"short key", "secret"},
		{"long key", "this-is-a-very-long-secret-key-for-encryption"},
		{"special chars", "!@#$%^&*()_+-=[]{}|;':\",./<>?"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			encryptor := NewTokenEncryptor(tt.key)
			if encryptor == nil {
				t.Fatal("expected encryptor, got nil")
				return
			}
			if len(encryptor.key) != 32 {
				t.Errorf("expected key length 32, got %d", len(encryptor.key))
			}
		})
	}
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

func TestEncryptProducesDifferentCiphertext(t *testing.T) {
	encryptor := NewTokenEncryptor("test-secret-key")
	plaintext := "same-plaintext"

	ciphertext1, err := encryptor.Encrypt(plaintext)
	if err != nil {
		t.Fatalf("Encrypt() error = %v", err)
	}

	ciphertext2, err := encryptor.Encrypt(plaintext)
	if err != nil {
		t.Fatalf("Encrypt() error = %v", err)
	}

	if bytes.Equal(ciphertext1, ciphertext2) {
		t.Error("expected different ciphertext for same plaintext (due to random nonce)")
	}

	decrypted1, _ := encryptor.Decrypt(ciphertext1)
	decrypted2, _ := encryptor.Decrypt(ciphertext2)

	if decrypted1 != decrypted2 {
		t.Error("expected same plaintext after decryption")
	}
}

func TestDecryptEmptyCiphertext(t *testing.T) {
	encryptor := NewTokenEncryptor("test-secret-key")

	decrypted, err := encryptor.Decrypt(nil)
	if err != nil {
		t.Errorf("unexpected error for nil ciphertext: %v", err)
	}
	if decrypted != "" {
		t.Errorf("expected empty string for nil ciphertext, got %q", decrypted)
	}

	decrypted, err = encryptor.Decrypt([]byte{})
	if err != nil {
		t.Errorf("unexpected error for empty ciphertext: %v", err)
	}
	if decrypted != "" {
		t.Errorf("expected empty string for empty ciphertext, got %q", decrypted)
	}
}

func TestDecryptInvalidCiphertext(t *testing.T) {
	encryptor := NewTokenEncryptor("test-secret-key")

	tests := []struct {
		name       string
		ciphertext []byte
	}{
		{"too short", []byte("short")},
		{"random bytes", []byte("this is not encrypted data")},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := encryptor.Decrypt(tt.ciphertext)
			if err == nil {
				t.Error("expected error for invalid ciphertext")
			}
		})
	}
}

func TestDecryptWithWrongKey(t *testing.T) {
	encryptor1 := NewTokenEncryptor("secret-key-1")
	encryptor2 := NewTokenEncryptor("secret-key-2")

	plaintext := "sensitive-token"
	ciphertext, err := encryptor1.Encrypt(plaintext)
	if err != nil {
		t.Fatalf("Encrypt() error = %v", err)
	}

	_, err = encryptor2.Decrypt(ciphertext)
	if err == nil {
		t.Error("expected error when decrypting with wrong key")
	}
}

func TestEncryptDecryptMultipleTokens(t *testing.T) {
	encryptor := NewTokenEncryptor("master-key")

	tokens := []string{
		"token1",
		"token2",
		"token3",
		"longer-token-with-more-characters",
	}

	ciphertexts := make([][]byte, len(tokens))

	for i, token := range tokens {
		ciphertext, err := encryptor.Encrypt(token)
		if err != nil {
			t.Fatalf("Encrypt(%d) error = %v", i, err)
		}
		ciphertexts[i] = ciphertext
	}

	for i, ciphertext := range ciphertexts {
		decrypted, err := encryptor.Decrypt(ciphertext)
		if err != nil {
			t.Fatalf("Decrypt(%d) error = %v", i, err)
		}
		if decrypted != tokens[i] {
			t.Errorf("Decrypt(%d) = %q, want %q", i, decrypted, tokens[i])
		}
	}
}
