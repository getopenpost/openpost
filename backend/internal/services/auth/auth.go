package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

const TokenTTL = 7 * 24 * time.Hour

const passwordHashPrefix = "$openpost$bcrypt-sha256$"

type Service struct {
	jwtSecret []byte
}

func NewService(jwtSecret string) *Service {
	return &Service{
		jwtSecret: []byte(jwtSecret),
	}
}

func (s *Service) HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword(prehashPassword(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return passwordHashPrefix + string(bytes), nil
}

func (s *Service) CheckPassword(password, hash string) bool {
	if hash == "" {
		return false
	}
	candidate := []byte(password)
	if strings.HasPrefix(hash, passwordHashPrefix) {
		hash = strings.TrimPrefix(hash, passwordHashPrefix)
		candidate = prehashPassword(password)
	}
	err := bcrypt.CompareHashAndPassword([]byte(hash), candidate)
	return err == nil
}

// prehashPassword lets the documented Unicode password policy exceed
// bcrypt's 72-byte input limit. The versioned database prefix above keeps
// existing raw-bcrypt hashes readable until the user next changes a password.
func prehashPassword(password string) []byte {
	digest := sha256.Sum256([]byte(password))
	encoded := make([]byte, base64.RawStdEncoding.EncodedLen(len(digest)))
	base64.RawStdEncoding.Encode(encoded, digest[:])
	return encoded
}

type Claims struct {
	UserID    string `json:"user_id"`
	Email     string `json:"email"`
	SessionID string `json:"session_id,omitempty"`
	jwt.RegisteredClaims
}

func (s *Service) GenerateToken(userID, email string) (string, error) {
	return s.GenerateTokenWithSession(userID, email, "", time.Now().UTC().Add(TokenTTL))
}

func (s *Service) GenerateTokenWithSession(userID, email, sessionID string, expiresAt time.Time) (string, error) {
	claims := &Claims{
		UserID:    userID,
		Email:     email,
		SessionID: sessionID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expiresAt.UTC()),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "openpost",
		},
	}
	if sessionID != "" {
		claims.ID = sessionID
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.jwtSecret)
}

func (s *Service) ValidateToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(_ *jwt.Token) (interface{}, error) {
		return s.jwtSecret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithIssuer("openpost"))

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims, nil
	}

	return nil, jwt.ErrSignatureInvalid
}

func GenerateState() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
