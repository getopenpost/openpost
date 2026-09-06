package crypto

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
)

const (
	defaultEncryptionKeyID = "default"
	envelopeVersion        = byte(1)
	envelopeKeyIDMaxLength = 255
	envelopeMagic          = "OPENPOST\x00"
	envelopeFixedLength    = len(envelopeMagic) + 3
)

// TokenEncryptor handles encryption/decryption of sensitive tokens.
type TokenEncryptor struct {
	// key remains the current derived key for compatibility with callers and
	// tests that construct an encryptor through NewTokenEncryptor.
	key           []byte
	primaryKeyID  string
	keys          map[string][]byte
	legacyKeyIDs  []string
	writeEnvelope bool
}

// NewTokenEncryptor initializes a TokenEncryptor using a master key string.
// It preserves the original single-key wire format so a release can roll back
// before an operator explicitly begins a keyring cutover.
func NewTokenEncryptor(key string) *TokenEncryptor {
	derivedKey := deriveKey(key)
	return &TokenEncryptor{
		key:           derivedKey,
		primaryKeyID:  defaultEncryptionKeyID,
		keys:          map[string][]byte{defaultEncryptionKeyID: derivedKey},
		legacyKeyIDs:  []string{defaultEncryptionKeyID},
		writeEnvelope: false,
	}
}

// NewTokenEncryptorWithKeyring creates an encryptor that writes only with the
// primary key and can read envelopes or legacy ciphertext with previous keys.
func NewTokenEncryptorWithKeyring(primaryKeyID, primaryKey string, previousKeys map[string]string) (*TokenEncryptor, error) {
	primaryKeyID = strings.TrimSpace(primaryKeyID)
	if err := validateKeyID(primaryKeyID); err != nil {
		return nil, fmt.Errorf("invalid primary encryption key ID: %w", err)
	}
	if primaryKey == "" {
		return nil, errors.New("primary encryption key is required")
	}
	if _, exists := previousKeys[primaryKeyID]; exists {
		return nil, errors.New("primary encryption key ID must not also identify a previous key")
	}

	keys := make(map[string][]byte, len(previousKeys)+1)
	primaryDerivedKey := deriveKey(primaryKey)
	keys[primaryKeyID] = primaryDerivedKey
	legacyKeyIDs := make([]string, 1, len(previousKeys)+1)
	legacyKeyIDs[0] = primaryKeyID

	previousKeyIDs := make([]string, 0, len(previousKeys))
	for keyID, key := range previousKeys {
		keyID = strings.TrimSpace(keyID)
		if err := validateKeyID(keyID); err != nil {
			return nil, fmt.Errorf("invalid previous encryption key ID: %w", err)
		}
		if key == "" {
			return nil, fmt.Errorf("previous encryption key %q is empty", keyID)
		}
		if _, exists := keys[keyID]; exists {
			return nil, fmt.Errorf("duplicate encryption key ID %q", keyID)
		}
		keys[keyID] = deriveKey(key)
		previousKeyIDs = append(previousKeyIDs, keyID)
	}
	sort.Strings(previousKeyIDs)
	legacyKeyIDs = append(legacyKeyIDs, previousKeyIDs...)

	return &TokenEncryptor{
		key:           primaryDerivedKey,
		primaryKeyID:  primaryKeyID,
		keys:          keys,
		legacyKeyIDs:  legacyKeyIDs,
		writeEnvelope: true,
	}, nil
}

func deriveKey(key string) []byte {
	hash := sha256.Sum256([]byte(key))
	return hash[:]
}

func validateKeyID(keyID string) error {
	if keyID == "" {
		return errors.New("key ID is required")
	}
	if len(keyID) > envelopeKeyIDMaxLength {
		return fmt.Errorf("key ID exceeds %d bytes", envelopeKeyIDMaxLength)
	}
	for _, character := range keyID {
		if character >= 'a' && character <= 'z' ||
			character >= 'A' && character <= 'Z' ||
			character >= '0' && character <= '9' ||
			character == '.' || character == '_' || character == '-' {
			continue
		}
		return errors.New("key ID may contain only letters, numbers, periods, underscores, and hyphens")
	}
	return nil
}

// Encrypt encrypts plaintext with AES-256-GCM and binds the version and key ID
// to the ciphertext as authenticated data.
func (te *TokenEncryptor) Encrypt(plaintext string) ([]byte, error) {
	if plaintext == "" {
		return nil, nil
	}

	gcm, err := newGCM(te.key)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	if !te.writeEnvelope {
		return gcm.Seal(nonce, nonce, []byte(plaintext), nil), nil
	}

	header := makeEnvelopeHeader(te.primaryKeyID)
	sealed := gcm.Seal(nil, nonce, []byte(plaintext), header)

	ciphertext := make([]byte, 0, len(header)+len(nonce)+len(sealed))
	ciphertext = append(ciphertext, header...)
	ciphertext = append(ciphertext, nonce...)
	ciphertext = append(ciphertext, sealed...)
	return ciphertext, nil
}

// Decrypt accepts current envelopes, envelopes for configured previous keys,
// and legacy unversioned nonce-prefixed ciphertext.
func (te *TokenEncryptor) Decrypt(ciphertext []byte) (string, error) {
	if len(ciphertext) == 0 {
		return "", nil
	}

	plaintext, enveloped, err := te.DecryptEnvelope(ciphertext)
	if err != nil {
		return "", err
	}
	if enveloped {
		return plaintext, nil
	}

	for _, legacyKeyID := range te.legacyKeyIDs {
		plaintext, legacyErr := decryptPayload(te.keys[legacyKeyID], nil, ciphertext)
		if legacyErr == nil {
			return plaintext, nil
		}
	}
	return "", errors.New("legacy ciphertext could not be decrypted with the configured encryption keys")
}

// DecryptEnvelope decrypts only recognized versioned OpenPost ciphertext. The
// boolean is false for legacy ciphertext and unrelated bytes, allowing stores
// with a text marker to distinguish a raw value from an encrypted envelope.
func (te *TokenEncryptor) DecryptEnvelope(ciphertext []byte) (plaintext string, recognized bool, err error) {
	keyID, header, payload, enveloped, err := parseEnvelope(ciphertext)
	if err != nil {
		return "", enveloped, err
	}
	if !enveloped {
		return "", false, nil
	}

	key, exists := te.keys[keyID]
	if !exists && !te.writeEnvelope {
		// During the explicit-ID rollout, a legacy-writing peer has only the
		// shared current key. Envelope authentication still proves whether
		// that key matches without weakening keyed-ID reads after cutover.
		key = te.key
		exists = true
	}
	if !exists {
		return "", true, fmt.Errorf("unknown encryption key ID %q", keyID)
	}
	plaintext, err = decryptPayload(key, header, payload)
	return plaintext, true, err
}

// VerifyCurrentCiphertext proves that a nonempty value is an authenticated
// envelope written with the current primary key.
func (te *TokenEncryptor) VerifyCurrentCiphertext(ciphertext []byte) error {
	if len(ciphertext) == 0 {
		return nil
	}
	keyID, header, payload, enveloped, err := parseEnvelope(ciphertext)
	if err != nil {
		return err
	}
	if !enveloped {
		return errors.New("ciphertext uses the legacy unversioned format")
	}
	if keyID != te.primaryKeyID {
		return fmt.Errorf("ciphertext uses encryption key ID %q instead of the current primary", keyID)
	}
	if _, err := decryptPayload(te.key, header, payload); err != nil {
		return errors.New("ciphertext failed authentication with the current primary encryption key")
	}
	return nil
}

// WritesVersionedCiphertext reports whether new values use authenticated key
// IDs. It lets short-lived compatibility stores retain a legacy rollback value
// until the operator explicitly begins the keyring cutover.
func (te *TokenEncryptor) WritesVersionedCiphertext() bool {
	return te.writeEnvelope
}

func makeEnvelopeHeader(keyID string) []byte {
	header := make([]byte, envelopeFixedLength+len(keyID))
	copy(header, envelopeMagic)
	header[len(envelopeMagic)] = envelopeVersion
	binary.BigEndian.PutUint16(header[len(envelopeMagic)+1:], uint16(len(keyID)))
	copy(header[envelopeFixedLength:], keyID)
	return header
}

func parseEnvelope(ciphertext []byte) (keyID string, header, payload []byte, enveloped bool, err error) {
	if len(ciphertext) < len(envelopeMagic) || !bytes.Equal(ciphertext[:len(envelopeMagic)], []byte(envelopeMagic)) {
		return "", nil, ciphertext, false, nil
	}
	if len(ciphertext) < envelopeFixedLength {
		return "", nil, nil, true, errors.New("encrypted envelope header is truncated")
	}
	if ciphertext[len(envelopeMagic)] != envelopeVersion {
		return "", nil, nil, true, fmt.Errorf("unsupported encrypted envelope version %d", ciphertext[len(envelopeMagic)])
	}
	keyIDLength := int(binary.BigEndian.Uint16(ciphertext[len(envelopeMagic)+1 : envelopeFixedLength]))
	headerLength := envelopeFixedLength + keyIDLength
	if keyIDLength == 0 || headerLength > len(ciphertext) {
		return "", nil, nil, true, errors.New("encrypted envelope key ID is invalid")
	}
	keyID = string(ciphertext[envelopeFixedLength:headerLength])
	if err := validateKeyID(keyID); err != nil {
		return "", nil, nil, true, fmt.Errorf("encrypted envelope key ID is invalid: %w", err)
	}
	return keyID, ciphertext[:headerLength], ciphertext[headerLength:], true, nil
}

func newGCM(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func decryptPayload(key, additionalData, payload []byte) (string, error) {
	gcm, err := newGCM(key)
	if err != nil {
		return "", err
	}
	if len(payload) < gcm.NonceSize()+gcm.Overhead() {
		return "", errors.New("ciphertext too short")
	}
	nonce := payload[:gcm.NonceSize()]
	actualCiphertext := payload[gcm.NonceSize():]
	plaintext, err := gcm.Open(nil, nonce, actualCiphertext, additionalData)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}
