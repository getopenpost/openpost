package mfa

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	wa "github.com/go-webauthn/webauthn/webauthn"
	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

type Service struct {
	issuer   string
	webAuthn *wa.WebAuthn
}

type RelyingPartyConfig struct {
	Name    string
	ID      string
	Origins []string
}

func NewService(issuer string, rp RelyingPartyConfig) (*Service, error) {
	cfg := &wa.Config{
		RPDisplayName: issuer,
		RPID:          rp.ID,
		RPOrigins:     rp.Origins,
	}

	webAuthn, err := wa.New(cfg)
	if err != nil {
		return nil, err
	}

	return &Service{
		issuer:   issuer,
		webAuthn: webAuthn,
	}, nil
}

func (s *Service) GenerateTOTP(email string) (*otp.Key, []byte, error) {
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      s.issuer,
		AccountName: email,
		Period:      30,
		SecretSize:  20,
	})
	if err != nil {
		return nil, nil, err
	}

	image, err := key.Image(240, 240)
	if err != nil {
		return nil, nil, err
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, image); err != nil {
		return nil, nil, err
	}

	return key, buf.Bytes(), nil
}

func (s *Service) ValidateTOTP(secret, code string) bool {
	return totp.Validate(strings.TrimSpace(code), strings.TrimSpace(secret))
}

func (s *Service) BeginPasskeyRegistration(user wa.User) (*protocol.CredentialCreation, *wa.SessionData, error) {
	return s.webAuthn.BeginRegistration(
		user,
		wa.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			ResidentKey:      protocol.ResidentKeyRequirementPreferred,
			UserVerification: protocol.VerificationPreferred,
		}),
	)
}

func (s *Service) FinishPasskeyRegistration(user wa.User, session wa.SessionData, rawCredential json.RawMessage) (*wa.Credential, error) {
	request, err := jsonRequest(rawCredential)
	if err != nil {
		return nil, err
	}
	return s.webAuthn.FinishRegistration(user, session, request)
}

func (s *Service) BeginPasskeyLogin(user wa.User) (*protocol.CredentialAssertion, *wa.SessionData, error) {
	return s.webAuthn.BeginLogin(
		user,
		wa.WithUserVerification(protocol.VerificationPreferred),
	)
}

func (s *Service) FinishPasskeyLogin(user wa.User, session wa.SessionData, rawAssertion json.RawMessage) (*wa.Credential, error) {
	request, err := jsonRequest(rawAssertion)
	if err != nil {
		return nil, err
	}
	return s.webAuthn.FinishLogin(user, session, request)
}

func jsonRequest(body json.RawMessage) (*http.Request, error) {
	if len(body) == 0 {
		return nil, fmt.Errorf("missing webauthn payload")
	}
	request := httptest.NewRequestWithContext(
		context.Background(),
		"POST",
		"https://openpost.local/webauthn",
		bytes.NewReader(body),
	)
	request.Header.Set("Content-Type", "application/json")
	return request, nil
}

func MarshalSessionData(session *wa.SessionData) (string, error) {
	if session == nil {
		return "", nil
	}
	data, err := json.Marshal(session)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func UnmarshalSessionData(raw string) (*wa.SessionData, error) {
	if raw == "" {
		return nil, fmt.Errorf("missing session data")
	}
	var session wa.SessionData
	if err := json.Unmarshal([]byte(raw), &session); err != nil {
		return nil, err
	}
	return &session, nil
}

func ChallengeExpiry() time.Time {
	return time.Now().UTC().Add(10 * time.Minute)
}
