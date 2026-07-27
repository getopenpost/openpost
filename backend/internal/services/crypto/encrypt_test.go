package crypto

import (
	"bytes"
	"testing"
)

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
		{"oauth token", "gho_16C7e42F292c6912E7710c838347Ae178B4"},
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
