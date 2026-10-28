package auth

import (
	"slices"
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
	validToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign valid token: %v", err)
	}
	verified, err := service.ValidateToken(validToken)
	if err != nil {
		t.Fatalf("expected the same fixture signed with HS256 and the OpenPost issuer to validate: %v", err)
	}
	if verified.UserID != "user-123" || verified.Email != "user@example.com" {
		t.Fatalf("valid token resolved the wrong identity: %#v", verified)
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

// Use medians and a wide relative margin to distinguish an immediate account
// existence oracle from normal scheduler noise around password verification.
func TestMissingPasswordHashUsesPasswordVerificationCost(t *testing.T) {
	service := NewService("test-secret")
	hash, err := service.HashPassword("some unrelated password")
	if err != nil {
		t.Fatal(err)
	}
	measure := func(hash string) time.Duration {
		samples := make([]time.Duration, 3)
		for i := range samples {
			start := time.Now()
			if service.CheckPassword("incorrect-password", hash) {
				t.Fatal("invalid password authenticated")
			}
			samples[i] = time.Since(start)
		}
		slices.Sort(samples)
		return samples[1]
	}
	known := measure(hash)
	missing := measure("")
	if missing < known/4 {
		t.Fatalf("missing-account verification %s bypassed password KDF cost %s", missing, known)
	}
}
