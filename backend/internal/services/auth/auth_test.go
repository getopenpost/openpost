package auth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

func TestCheckPasswordKeepsLegacyRawBcryptHashesReadable(t *testing.T) {
	t.Parallel()

	legacyPassword := "existing-password"
	legacyHash, err := bcrypt.GenerateFromPassword([]byte(legacyPassword), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("create legacy bcrypt hash: %v", err)
	}

	service := NewService("test-secret")
	if !service.CheckPassword(legacyPassword, string(legacyHash)) {
		t.Fatal("expected the versioned checker to accept an existing raw bcrypt hash")
	}
	if service.CheckPassword("wrong-password", string(legacyHash)) {
		t.Fatal("expected the versioned checker to reject a wrong legacy password")
	}
}

func TestValidateTokenRejectsUnexpectedAlgorithmAndIssuer(t *testing.T) {
	const secret = "validation-secret"
	service := NewService(secret)
	now := time.Now().UTC()

	claims := &Claims{
		UserID: "user-123",
		Email:  "user@example.com",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "openpost",
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
	wrongAlgorithm := jwt.NewWithClaims(jwt.SigningMethodHS384, claims)
	wrongAlgorithmToken, err := wrongAlgorithm.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign HS384 token: %v", err)
	}
	if _, err := service.ValidateToken(wrongAlgorithmToken); err == nil {
		t.Fatal("expected HS384 token to be rejected")
	}

	claims.Issuer = "another-service"
	wrongIssuer := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	wrongIssuerToken, err := wrongIssuer.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign wrong-issuer token: %v", err)
	}
	if _, err := service.ValidateToken(wrongIssuerToken); err == nil {
		t.Fatal("expected token with a different issuer to be rejected")
	}
}

func isHexChar(r rune) bool {
	return (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f')
}
