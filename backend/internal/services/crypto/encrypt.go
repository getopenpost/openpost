package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"io"
)

// TokenEncryptor handles encryption/decryption of sensitive tokens.
type TokenEncryptor struct {
	key []byte
}

// NewTokenEncryptor initializes a TokenEncryptor using a master key string.
// It derives a 32-byte key using SHA-256 for AES-256-GCM.
func NewTokenEncryptor(key string) *TokenEncryptor {
	hash := sha256.Sum256([]byte(key))
	return &TokenEncryptor{key: hash[:]}
}

// Encrypt plaintext securely using AES-256-GCM.
func (te *TokenEncryptor) Encrypt(plaintext string) ([]byte, error) {
	if plaintext == "" {
		return nil, nil
	}

	block, err := aes.NewCipher(te.key)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return ciphertext, nil
}

// Decrypt the ciphertext using AES-256-GCM.
func (te *TokenEncryptor) Decrypt(ciphertext []byte) (string, error) {
	if len(ciphertext) == 0 {
		return "", nil
	}

	block, err := aes.NewCipher(te.key)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return "", fmt.Errorf("ciphertext too short")
	}

	nonce, actualCiphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, actualCiphertext, nil)
	if err != nil {
		return "", err
	}

	return string(plaintext), nil
}
