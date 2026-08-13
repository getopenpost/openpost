package handlers

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/mfa"
	"github.com/openpost/backend/internal/services/mfarecovery"
	"github.com/pquerna/otp/totp"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestTOTPRecoveryCodeLifecycle(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(
		t,
		(*models.User)(nil),
		(*models.AuthChallenge)(nil),
		(*models.UserMFARecoveryCode)(nil),
		(*models.UserPasskey)(nil),
	)
	ctx := context.Background()
	authService := auth.NewService("test-jwt-secret")
	passwordHash, err := authService.HashPassword("correct horse battery staple")
	require.NoError(t, err)
	user := &models.User{
		ID:           "user-1",
		Email:        "user@example.com",
		PasswordHash: passwordHash,
		CreatedAt:    time.Now().UTC(),
	}
	_, err = db.NewInsert().Model(user).Exec(ctx)
	require.NoError(t, err)

	mfaService, err := mfa.NewService("OpenPost", mfa.RelyingPartyConfig{
		Name: "OpenPost", ID: "localhost", Origins: []string{"http://localhost"},
	})
	require.NoError(t, err)
	handler := NewAuthHandler(
		db,
		authService,
		middleware.NewJWTAuthenticator(authService),
		crypto.NewTokenEncryptor("test-encryption-secret"),
		mfaService,
		false,
	)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler.Login(api)
	handler.VerifyRecoveryCodeLogin(api)
	handler.BeginTOTPSetup(api)
	handler.ConfirmTOTPSetup(api)
	handler.AcknowledgeTOTPSetup(api)
	handler.RecoveryCodeStatus(api)
	handler.BeginRecoveryCodeRegeneration(api)
	handler.AcknowledgeRecoveryCodeRegeneration(api)
	handler.DisableTOTP(api)

	authToken, err := authService.GenerateToken(user.ID, user.Email)
	require.NoError(t, err)

	setup := recoveryJSONRequest(t, e, "/api/v1/auth/security/totp/setup", map[string]any{
		"current_password": "correct horse battery staple",
	}, authToken)
	require.Equal(t, http.StatusOK, setup.Code, setup.Body.String())
	require.Equal(t, "no-store", setup.Header().Get("Cache-Control"))
	var setupBody SetupTOTPOutput
	require.NoError(t, json.Unmarshal(setup.Body.Bytes(), &setupBody.Body))
	require.NotEmpty(t, setupBody.Body.ChallengeID)
	require.NotEmpty(t, setupBody.Body.ManualEntryKey)
	setupURI, err := url.Parse(setupBody.Body.OTPAuthURL)
	if err != nil {
		t.Fatal("authenticator setup URI must be parseable")
	}
	require.Equal(t, "otpauth", setupURI.Scheme)
	require.Equal(t, "totp", setupURI.Host)
	require.Equal(t, "/OpenPost:user@example.com", setupURI.Path)
	require.Equal(t, "OpenPost", setupURI.Query().Get("issuer"))
	if subtle.ConstantTimeCompare(
		[]byte(setupBody.Body.ManualEntryKey),
		[]byte(setupURI.Query().Get("secret")),
	) != 1 {
		t.Fatal("manual setup key must match the QR setup URI secret")
	}
	encodedQRCode, found := strings.CutPrefix(setupBody.Body.QRCodeDataURL, "data:image/png;base64,")
	if !found {
		t.Fatal("authenticator setup must return a PNG data URL")
	}
	qrCodePNG, err := base64.StdEncoding.DecodeString(encodedQRCode)
	require.NoError(t, err)
	_, err = png.Decode(bytes.NewReader(qrCodePNG))
	require.NoError(t, err)
	prematureEnable := recoveryJSONRequest(t, e, "/api/v1/auth/security/totp/enable", map[string]any{
		"challenge_id":         setupBody.Body.ChallengeID,
		"recovery_codes_saved": true,
	}, authToken)
	require.Equal(t, http.StatusConflict, prematureEnable.Code, prematureEnable.Body.String())

	verificationCode, err := totp.GenerateCode(setupBody.Body.ManualEntryKey, time.Now().UTC())
	require.NoError(t, err)
	confirm := recoveryJSONRequest(t, e, "/api/v1/auth/security/totp/confirm", map[string]any{
		"challenge_id": setupBody.Body.ChallengeID,
		"code":         verificationCode,
	}, authToken)
	require.Equal(t, http.StatusOK, confirm.Code, confirm.Body.String())
	require.Equal(t, "no-store", confirm.Header().Get("Cache-Control"))
	var initialCodes RecoveryCodeSetOutput
	require.NoError(t, json.Unmarshal(confirm.Body.Bytes(), &initialCodes.Body))
	require.Len(t, initialCodes.Body.RecoveryCodes, mfarecovery.CodeCount)
	require.Equal(t, setupBody.Body.ChallengeID, initialCodes.Body.ChallengeID)
	var protectedChallenge models.AuthChallenge
	require.NoError(t, db.NewSelect().Model(&protectedChallenge).Where("id = ?", setupBody.Body.ChallengeID).Scan(ctx))
	for _, rawCode := range initialCodes.Body.RecoveryCodes {
		require.NotContains(t, protectedChallenge.Payload, rawCode)
	}

	// Verification alone must not enable TOTP or persist usable codes. The
	// plaintext set is not reissued if confirm is retried.
	var beforeAck models.User
	require.NoError(t, db.NewSelect().Model(&beforeAck).Where("id = ?", user.ID).Scan(ctx))
	require.Empty(t, beforeAck.TOTPSecretEnc)
	remaining, err := handler.mfaRecovery.CountRemaining(ctx, user.ID)
	require.NoError(t, err)
	require.Zero(t, remaining)
	repeatedConfirm := recoveryJSONRequest(t, e, "/api/v1/auth/security/totp/confirm", map[string]any{
		"challenge_id": setupBody.Body.ChallengeID,
		"code":         verificationCode,
	}, authToken)
	require.Equal(t, http.StatusConflict, repeatedConfirm.Code, repeatedConfirm.Body.String())
	require.NotContains(t, repeatedConfirm.Body.String(), initialCodes.Body.RecoveryCodes[0])

	withoutAck := recoveryJSONRequest(t, e, "/api/v1/auth/security/totp/enable", map[string]any{
		"challenge_id":         initialCodes.Body.ChallengeID,
		"recovery_codes_saved": false,
	}, authToken)
	require.Equal(t, http.StatusBadRequest, withoutAck.Code, withoutAck.Body.String())

	enable := recoveryJSONRequest(t, e, "/api/v1/auth/security/totp/enable", map[string]any{
		"challenge_id":         initialCodes.Body.ChallengeID,
		"recovery_codes_saved": true,
	}, authToken)
	require.Equal(t, http.StatusOK, enable.Code, enable.Body.String())
	repeatedEnable := recoveryJSONRequest(t, e, "/api/v1/auth/security/totp/enable", map[string]any{
		"challenge_id":         initialCodes.Body.ChallengeID,
		"recovery_codes_saved": true,
	}, authToken)
	require.Equal(t, http.StatusUnauthorized, repeatedEnable.Code, repeatedEnable.Body.String())
	var enabled models.User
	require.NoError(t, db.NewSelect().Model(&enabled).Where("id = ?", user.ID).Scan(ctx))
	require.NotEmpty(t, enabled.TOTPSecretEnc)
	remaining, err = handler.mfaRecovery.CountRemaining(ctx, user.ID)
	require.NoError(t, err)
	require.Equal(t, mfarecovery.CodeCount, remaining)
	var stored []models.UserMFARecoveryCode
	require.NoError(t, db.NewSelect().Model(&stored).Where("user_id = ?", user.ID).Scan(ctx))
	require.Len(t, stored, mfarecovery.CodeCount)
	for _, row := range stored {
		for _, rawCode := range initialCodes.Body.RecoveryCodes {
			require.NotEqual(t, rawCode, row.CodeHash)
		}
	}

	wrongStatus := recoveryJSONRequest(t, e, "/api/v1/auth/security/totp/recovery-codes/status", map[string]any{
		"current_password": "wrong password",
	}, authToken)
	require.Equal(t, http.StatusUnauthorized, wrongStatus.Code, wrongStatus.Body.String())
	status := recoveryJSONRequest(t, e, "/api/v1/auth/security/totp/recovery-codes/status", map[string]any{
		"current_password": "correct horse battery staple",
	}, authToken)
	require.Equal(t, http.StatusOK, status.Code, status.Body.String())
	var statusBody RecoveryCodeStatusOutput
	require.NoError(t, json.Unmarshal(status.Body.Bytes(), &statusBody.Body))
	require.Equal(t, mfarecovery.CodeCount, statusBody.Body.Remaining)

	loginChallenge := beginRecoveryLogin(t, e)
	require.Contains(t, loginChallenge.Body.MFAMethods, mfaMethodRecoveryCode)
	firstRecoveryLogin := completeRecoveryLogin(t, e, loginChallenge.Body.MFAToken, initialCodes.Body.RecoveryCodes[0])
	require.Equal(t, http.StatusOK, firstRecoveryLogin.Code, firstRecoveryLogin.Body.String())
	statusAfterUse := recoveryJSONRequest(t, e, "/api/v1/auth/security/totp/recovery-codes/status", map[string]any{
		"current_password": "correct horse battery staple",
	}, authToken)
	require.Equal(t, http.StatusOK, statusAfterUse.Code, statusAfterUse.Body.String())
	require.NoError(t, json.Unmarshal(statusAfterUse.Body.Bytes(), &statusBody.Body))
	require.Equal(t, mfarecovery.CodeCount-1, statusBody.Body.Remaining)

	reuseChallenge := beginRecoveryLogin(t, e)
	reusedCode := completeRecoveryLogin(t, e, reuseChallenge.Body.MFAToken, initialCodes.Body.RecoveryCodes[0])
	require.Equal(t, http.StatusUnauthorized, reusedCode.Code, reusedCode.Body.String())

	wrongRegenerate := recoveryJSONRequest(t, e, "/api/v1/auth/security/totp/recovery-codes/regenerate", map[string]any{
		"current_password": "wrong password",
	}, authToken)
	require.Equal(t, http.StatusUnauthorized, wrongRegenerate.Code, wrongRegenerate.Body.String())
	regenerate := recoveryJSONRequest(t, e, "/api/v1/auth/security/totp/recovery-codes/regenerate", map[string]any{
		"current_password": "correct horse battery staple",
	}, authToken)
	require.Equal(t, http.StatusOK, regenerate.Code, regenerate.Body.String())
	require.Equal(t, "no-store", regenerate.Header().Get("Cache-Control"))
	var replacement RecoveryCodeSetOutput
	require.NoError(t, json.Unmarshal(regenerate.Body.Bytes(), &replacement.Body))
	require.Len(t, replacement.Body.RecoveryCodes, mfarecovery.CodeCount)
	unacknowledgedReplacement := recoveryJSONRequest(t, e, "/api/v1/auth/security/totp/recovery-codes/activate", map[string]any{
		"challenge_id":         replacement.Body.ChallengeID,
		"recovery_codes_saved": false,
	}, authToken)
	require.Equal(t, http.StatusBadRequest, unacknowledgedReplacement.Code, unacknowledgedReplacement.Body.String())

	// The existing batch remains valid until the user confirms that the new set
	// is safely stored.
	oldBeforeActivation := beginRecoveryLogin(t, e)
	oldCodeResult := completeRecoveryLogin(t, e, oldBeforeActivation.Body.MFAToken, initialCodes.Body.RecoveryCodes[1])
	require.Equal(t, http.StatusOK, oldCodeResult.Code, oldCodeResult.Body.String())
	activate := recoveryJSONRequest(t, e, "/api/v1/auth/security/totp/recovery-codes/activate", map[string]any{
		"challenge_id":         replacement.Body.ChallengeID,
		"recovery_codes_saved": true,
	}, authToken)
	require.Equal(t, http.StatusOK, activate.Code, activate.Body.String())

	oldAfterActivation := beginRecoveryLogin(t, e)
	oldRevoked := completeRecoveryLogin(t, e, oldAfterActivation.Body.MFAToken, initialCodes.Body.RecoveryCodes[2])
	require.Equal(t, http.StatusUnauthorized, oldRevoked.Code, oldRevoked.Body.String())
	newChallenge := beginRecoveryLogin(t, e)
	newCodeResult := completeRecoveryLogin(t, e, newChallenge.Body.MFAToken, replacement.Body.RecoveryCodes[0])
	require.Equal(t, http.StatusOK, newCodeResult.Code, newCodeResult.Body.String())

	wrongDisable := recoveryJSONRequest(t, e, "/api/v1/auth/security/totp/disable", map[string]any{
		"current_password": "wrong password",
	}, authToken)
	require.Equal(t, http.StatusUnauthorized, wrongDisable.Code, wrongDisable.Body.String())
	disable := recoveryJSONRequest(t, e, "/api/v1/auth/security/totp/disable", map[string]any{
		"current_password": "correct horse battery staple",
	}, authToken)
	require.Equal(t, http.StatusOK, disable.Code, disable.Body.String())
	remaining, err = handler.mfaRecovery.CountRemaining(ctx, user.ID)
	require.NoError(t, err)
	require.Zero(t, remaining)

	plainLogin := beginRecoveryLogin(t, e)
	require.False(t, plainLogin.Body.RequiresMFA)
}

func TestLoginMFAMethodsOnlyAdvertisesAnUnusedRecoveryCode(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(
		t,
		(*models.UserPasskey)(nil),
		(*models.UserMFARecoveryCode)(nil),
	)
	handler := NewAuthHandler(db, nil, nil, nil, nil, false)
	ctx := context.Background()
	user := &models.User{ID: "user-1", TOTPSecretEnc: []byte("encrypted")}

	methods, err := handler.loginMFAMethods(ctx, user)
	require.NoError(t, err)
	require.Equal(t, []string{mfaMethodTOTP}, methods)

	set, err := handler.mfaRecovery.Generate()
	require.NoError(t, err)
	require.NoError(t, db.RunInTx(ctx, nil, func(txCtx context.Context, tx bun.Tx) error {
		return handler.mfaRecovery.ReplaceWithDB(txCtx, tx, user.ID, set, time.Now().UTC())
	}))
	methods, err = handler.loginMFAMethods(ctx, user)
	require.NoError(t, err)
	require.Equal(t, []string{mfaMethodTOTP, mfaMethodRecoveryCode}, methods)

	for _, code := range set.Codes {
		consumed, consumeErr := handler.mfaRecovery.Consume(ctx, user.ID, code, time.Now().UTC())
		require.NoError(t, consumeErr)
		require.True(t, consumed)
	}
	methods, err = handler.loginMFAMethods(ctx, user)
	require.NoError(t, err)
	require.Equal(t, []string{mfaMethodTOTP}, methods)
}

func TestSensitiveActionReauthenticationPreservesPasswordWhitespace(t *testing.T) {
	t.Parallel()

	authService := auth.NewService("test-secret")
	hash, err := authService.HashPassword("  padded password  ")
	require.NoError(t, err)
	handler := NewAuthHandler(nil, authService, nil, nil, nil, false)
	err = handler.authorizeSensitiveAction(
		context.Background(),
		&models.User{ID: "user-1", PasswordHash: hash},
		reauthActionRecoveryStatus,
		"  padded password  ",
		"",
	)
	require.NoError(t, err)
}

func beginRecoveryLogin(t *testing.T, e *echo.Echo) AuthOutput {
	t.Helper()
	response := recoveryJSONRequest(t, e, "/api/v1/auth/login", map[string]any{
		"email": "user@example.com", "password": "correct horse battery staple",
	}, "")
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var output AuthOutput
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &output.Body))
	return output
}

func completeRecoveryLogin(t *testing.T, e *echo.Echo, mfaToken, code string) *httptest.ResponseRecorder {
	t.Helper()
	return recoveryJSONRequest(t, e, "/api/v1/auth/login/recovery-code", map[string]any{
		"mfa_token": mfaToken, "code": code,
	}, "")
}

func recoveryJSONRequest(
	t *testing.T,
	e *echo.Echo,
	path string,
	body any,
	token string,
) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(body)
	require.NoError(t, err)
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, bytes.NewReader(raw))
	request.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	if token != "" {
		request.Header.Set(echo.HeaderAuthorization, "Bearer "+token)
	}
	response := httptest.NewRecorder()
	e.ServeHTTP(response, request)
	return response
}
