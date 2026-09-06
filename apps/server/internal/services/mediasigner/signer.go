package mediasigner

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"time"
)

type Signer struct {
	secret []byte
}

func New(secret string) *Signer {
	return &Signer{secret: []byte(secret)}
}

func (s *Signer) Sign(mediaID string, expiresAt time.Time) string {
	mac := hmac.New(sha256.New, s.secret)
	_, _ = mac.Write([]byte(signaturePayload(mediaID, expiresAt.Unix())))
	return hex.EncodeToString(mac.Sum(nil))
}

func (s *Signer) Verify(mediaID, signature string, expiresAtUnix int64) bool {
	if expiresAtUnix <= 0 || time.Now().UTC().Unix() > expiresAtUnix {
		return false
	}

	expected := s.Sign(mediaID, time.Unix(expiresAtUnix, 0).UTC())
	return hmac.Equal([]byte(expected), []byte(signature))
}

func signaturePayload(mediaID string, expiresAtUnix int64) string {
	return fmt.Sprintf("%s:%s", mediaID, strconv.FormatInt(expiresAtUnix, 10))
}
