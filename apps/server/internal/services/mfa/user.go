package mfa

import (
	"encoding/json"

	wa "github.com/go-webauthn/webauthn/webauthn"
	"github.com/openpost/backend/internal/models"
)

type WebAuthnUser struct {
	user        *models.User
	credentials []wa.Credential
}

func NewWebAuthnUser(user *models.User, passkeys []models.UserPasskey) (*WebAuthnUser, error) {
	credentials := make([]wa.Credential, 0, len(passkeys))
	for _, passkey := range passkeys {
		var credential wa.Credential
		if err := json.Unmarshal([]byte(passkey.CredentialJSON), &credential); err != nil {
			return nil, err
		}
		credentials = append(credentials, credential)
	}

	return &WebAuthnUser{
		user:        user,
		credentials: credentials,
	}, nil
}

func (u *WebAuthnUser) WebAuthnID() []byte {
	return []byte(u.user.ID)
}

func (u *WebAuthnUser) WebAuthnName() string {
	return u.user.Email
}

func (u *WebAuthnUser) WebAuthnDisplayName() string {
	return u.user.Email
}

func (u *WebAuthnUser) WebAuthnCredentials() []wa.Credential {
	return u.credentials
}
