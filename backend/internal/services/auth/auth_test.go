package auth

import (
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

func TestNewService(t *testing.T) {
	tests := []struct {
		name      string
		jwtSecret string
	}{
		{"short secret", "secret"},
		{"long secret", "this-is-a-very-long-secret-key-for-jwt-signing"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			service := NewService(tt.jwtSecret)
			if service == nil {
				t.Fatal("expected service, got nil")
			}
		})
	}
}

func TestHashPassword(t *testing.T) {
	service := NewService("test-secret")

	tests := []struct {
		name     string
		password string
	}{
		{"simple password", "password123"},
		{"complex password", "C0mpl3x_P@ssw0rd!"},
		{"password beyond bcrypt raw input limit", strings.Repeat("a", 1024)},
		{"long Unicode password", strings.Repeat("🔐", 1024)},
		{"empty password", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			hash, err := service.HashPassword(tt.password)
			if err != nil {
				t.Fatalf("HashPassword() error = %v", err)
			}

			if len(hash) == 0 {
				t.Error("expected non-empty hash")
			}

			if hash == tt.password {
				t.Error("hash should not equal plaintext password")
			}
		})
	}
}

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

func TestCheckPassword(t *testing.T) {
	service := NewService("test-secret")

	password := "correct-password"
	hash, err := service.HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword() error = %v", err)
	}

	tests := []struct {
		name     string
		password string
		hash     string
		want     bool
	}{
		{"correct password", password, hash, true},
		{"wrong password", "wrong-password", hash, false},
		{"empty password", "", hash, false},
		{"empty hash", password, "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := service.CheckPassword(tt.password, tt.hash)
			if got != tt.want {
				t.Errorf("CheckPassword() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestCheckPasswordDifferentHashes(t *testing.T) {
	service := NewService("test-secret")

	password := "same-password"
	hash1, _ := service.HashPassword(password)
	hash2, _ := service.HashPassword(password)

	if hash1 == hash2 {
		t.Error("bcrypt should produce different hashes for same password")
	}

	if !service.CheckPassword(password, hash1) {
		t.Error("expected password to match hash1")
	}

	if !service.CheckPassword(password, hash2) {
		t.Error("expected password to match hash2")
	}
}

func TestGenerateToken(t *testing.T) {
	service := NewService("super-secret-jwt-key")

	tests := []struct {
		name   string
		userID string
		email  string
	}{
		{"regular user", "user-123", "user@example.com"},
		{"uuid user", "550e8400-e29b-41d4-a716-446655440000", "test@test.org"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			token, err := service.GenerateToken(tt.userID, tt.email)
			if err != nil {
				t.Fatalf("GenerateToken() error = %v", err)
			}

			if token == "" {
				t.Error("expected non-empty token")
			}

			parts := strings.Split(token, ".")
			if len(parts) != 3 {
				t.Errorf("expected JWT with 3 parts, got %d", len(parts))
			}
		})
	}
}

func TestValidateToken(t *testing.T) {
	service := NewService("validation-secret")

	userID := "user-123"
	email := "user@example.com"

	token, err := service.GenerateToken(userID, email)
	if err != nil {
		t.Fatalf("GenerateToken() error = %v", err)
	}

	claims, err := service.ValidateToken(token)
	if err != nil {
		t.Fatalf("ValidateToken() error = %v", err)
	}

	if claims.UserID != userID {
		t.Errorf("UserID = %q, want %q", claims.UserID, userID)
	}

	if claims.Email != email {
		t.Errorf("Email = %q, want %q", claims.Email, email)
	}

	if claims.Issuer != "openpost" {
		t.Errorf("Issuer = %q, want %q", claims.Issuer, "openpost")
	}
}

func TestValidateTokenExpiry(t *testing.T) {
	service := NewService("expiry-secret")

	token, _ := service.GenerateToken("user-123", "user@example.com")
	claims, err := service.ValidateToken(token)
	if err != nil {
		t.Fatalf("ValidateToken() error = %v", err)
	}

	if claims.ExpiresAt == nil {
		t.Fatal("expected ExpiresAt to be set")
	}

	expectedExpiry := time.Now().Add(7 * 24 * time.Hour)
	actualExpiry := claims.ExpiresAt.Time

	diff := actualExpiry.Sub(expectedExpiry)
	if diff.Abs() > time.Minute {
		t.Errorf("ExpiresAt = %v, want approximately %v", actualExpiry, expectedExpiry)
	}
}

func TestValidateTokenInvalidSignature(t *testing.T) {
	service1 := NewService("secret-key-1")
	service2 := NewService("secret-key-2")

	token, _ := service1.GenerateToken("user-123", "user@example.com")

	_, err := service2.ValidateToken(token)
	if err == nil {
		t.Error("expected error when validating token with wrong secret")
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

func TestValidateTokenInvalidFormat(t *testing.T) {
	service := NewService("test-secret")

	tests := []struct {
		name  string
		token string
	}{
		{"empty token", ""},
		{"invalid format", "not-a-valid-token"},
		{"missing parts", "header.payload"},
		{"random string", "abc.def.ghi"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := service.ValidateToken(tt.token)
			if err == nil {
				t.Error("expected error for invalid token")
			}
		})
	}
}

func TestGenerateState(t *testing.T) {
	state1, err := GenerateState()
	if err != nil {
		t.Fatalf("GenerateState() error = %v", err)
	}
	state2, err := GenerateState()
	if err != nil {
		t.Fatalf("GenerateState() error = %v", err)
	}

	if state1 == state2 {
		t.Error("expected different states")
	}

	if len(state1) != 32 {
		t.Errorf("expected state length 32, got %d", len(state1))
	}

	for _, r := range state1 {
		if !isHexChar(r) {
			t.Errorf("expected hex character, got %c", r)
		}
	}
}

func isHexChar(r rune) bool {
	return (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f')
}

func TestGenerateStateUniqueness(t *testing.T) {
	states := make(map[string]bool)

	for i := 0; i < 1000; i++ {
		state, err := GenerateState()
		if err != nil {
			t.Fatalf("GenerateState() error = %v", err)
		}
		if states[state] {
			t.Fatalf("duplicate state generated: %s", state)
		}
		states[state] = true
	}
}
