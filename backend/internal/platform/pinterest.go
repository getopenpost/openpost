package platform

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	pinterestAuthorizationURL            = "https://www.pinterest.com/oauth/"
	pinterestAPIBaseURL                  = "https://api.pinterest.com/v5"
	pinterestTokenURL                    = pinterestAPIBaseURL + "/oauth/token"
	pinterestPageSize                    = 100
	pinterestVideoMaxSize          int64 = 2 * 1024 * 1024 * 1024
	pinterestUploadSessionLifetime       = 15 * time.Minute
	pinterestMediaPollAttempts           = 6
	pinterestMediaPollInitialDelay       = time.Second
	pinterestMediaPollMaxDelay           = 16 * time.Second
	pinterestPinReconcileDelay           = 30 * time.Second
	pinterestPinReferencePrefix          = "pin1:"
)

var pinterestProviderID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

var pinterestOAuthScopes = []string{
	"boards:read",
	"boards:write",
	"pins:read",
	"pins:write",
	"user_accounts:read",
}

type PinterestAdapter struct {
	clientID     string
	clientSecret string
	redirectURI  string

	mediaPollAttempts int
	mediaPollDelay    time.Duration
	sleep             func(context.Context, time.Duration) error
}

func NewPinterestAdapter(clientID, clientSecret, redirectURI string) *PinterestAdapter {
	return &PinterestAdapter{
		clientID: clientID, clientSecret: clientSecret, redirectURI: redirectURI,
		mediaPollAttempts: pinterestMediaPollAttempts,
		mediaPollDelay:    pinterestMediaPollInitialDelay,
		sleep:             pinterestSleep,
	}
}

func (p *PinterestAdapter) AuthorizationGrantDescriptor() AuthorizationGrantDescriptor {
	return AuthorizationGrantDescriptor{
		ProjectID:     p.clientID,
		ExecutionMode: "oauth2",
		Evidence:      map[string]string{"protocol": "oauth2", "exchange": "authorization_code"},
	}
}

func (p *PinterestAdapter) GenerateAuthURL(state string) (string, map[string]string) {
	query := url.Values{
		oauthParamClientID:    {p.clientID},
		oauthParamRedirectURI: {p.redirectURI},
		"response_type":       {oauthResponseType},
		"scope":               {strings.Join(pinterestOAuthScopes, ",")},
		"state":               {state},
	}
	return pinterestAuthorizationURL + "?" + query.Encode(), nil
}

func (p *PinterestAdapter) ExchangeCode(ctx context.Context, code string, _ map[string]string) (*TokenResult, error) {
	if strings.TrimSpace(code) == "" {
		return nil, fmt.Errorf("pinterest token exchange requires an authorization code")
	}
	return p.exchangeToken(ctx, map[string]string{
		grantType:             oauthGrantAuthCode,
		oauthParamCode:        code,
		oauthParamRedirectURI: p.redirectURI,
	}, "pinterest token exchange")
}

func (p *PinterestAdapter) RefreshCapability() RefreshCapability {
	return RefreshCapability{Supported: true, CredentialSource: RefreshCredentialRefreshToken}
}

func (p *PinterestAdapter) RefreshToken(ctx context.Context, input RefreshTokenInput) (*TokenResult, error) {
	if strings.TrimSpace(input.RefreshToken) == "" {
		return nil, fmt.Errorf("pinterest refresh requires a refresh token")
	}
	return p.exchangeToken(ctx, map[string]string{
		grantType:                             oauthGrantRefresh,
		string(RefreshCredentialRefreshToken): input.RefreshToken,
	}, "pinterest token refresh")
}

func (p *PinterestAdapter) exchangeToken(ctx context.Context, values map[string]string, label string) (*TokenResult, error) {
	body, err := DoFormURLEncoded(ctx, http.MethodPost, pinterestTokenURL, values, map[string]string{
		headerAuthorization: "Basic " + base64.StdEncoding.EncodeToString([]byte(p.clientID+":"+p.clientSecret)),
	})
	if err != nil {
		return nil, fmt.Errorf("%s: %w", label, err)
	}
	var response struct {
		AccessToken           string `json:"access_token"`
		RefreshToken          string `json:"refresh_token"`
		ExpiresIn             int    `json:"expires_in"`
		RefreshTokenExpiresIn int    `json:"refresh_token_expires_in"`
		TokenType             string `json:"token_type"`
		Scope                 string `json:"scope"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decoding %s: %w", label, err)
	}
	if strings.TrimSpace(response.AccessToken) == "" {
		return nil, fmt.Errorf("%s returned no access token", label)
	}
	return &TokenResult{
		AccessToken:      response.AccessToken,
		RefreshToken:     response.RefreshToken,
		ExpiresIn:        response.ExpiresIn,
		RefreshExpiresIn: response.RefreshTokenExpiresIn,
		TokenType:        firstNonEmptyString(response.TokenType, tokenTypeBearer),
		Extra:            map[string]string{"scope": response.Scope},
	}, nil
}

// RevokeAuthorization invalidates the current provider credential before the
// local grant is cleared.
func (p *PinterestAdapter) RevokeAuthorization(ctx context.Context, accessToken string) error {
	if strings.TrimSpace(accessToken) == "" {
		return fmt.Errorf("pinterest revocation requires an access token")
	}
	if _, err := DoFormURLEncoded(ctx, http.MethodPost, pinterestTokenURL+"/revoke", map[string]string{
		"token":           accessToken,
		"token_type_hint": "access_token",
	}, map[string]string{
		headerAuthorization: "Basic " + base64.StdEncoding.EncodeToString([]byte(p.clientID+":"+p.clientSecret)),
	}); err != nil {
		return fmt.Errorf("pinterest token revocation: %w", err)
	}
	return nil
}

func (p *PinterestAdapter) GetProfile(ctx context.Context, accessToken string) (*UserProfile, error) {
	body, err := DoRequest(ctx, http.MethodGet, pinterestAPIBaseURL+"/user_account", nil, bearerHeaders(accessToken))
	if err != nil {
		return nil, fmt.Errorf("pinterest user account: %w", err)
	}
	var account struct {
		Username     string `json:"username"`
		BusinessName string `json:"business_name"`
		AccountType  string `json:"account_type"`
		ProfileImage string `json:"profile_image"`
	}
	if err := json.Unmarshal(body, &account); err != nil {
		return nil, fmt.Errorf("decoding pinterest user account: %w", err)
	}
	if strings.TrimSpace(account.Username) == "" {
		return nil, fmt.Errorf("pinterest user account returned no username")
	}
	return &UserProfile{
		ID:          account.Username,
		Username:    account.Username,
		DisplayName: firstNonEmptyString(account.BusinessName, account.Username),
		AvatarURL:   account.ProfileImage,
		CapabilityState: map[string]string{
			"pinterest_account_type": account.AccountType,
		},
	}, nil
}

func (p *PinterestAdapter) ListDestinationOptions(ctx context.Context, accessToken string, _ DestinationOptionsInput) (map[string][]DestinationOption, error) {
	boards, err := p.listAllBoards(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	return map[string][]DestinationOption{"pinterest_boards": pinterestBoardOptions(boards)}, nil
}

func (p *PinterestAdapter) SearchPublishingOptions(ctx context.Context, accessToken string, input PublishingOptionsInput) (PublishingOptionsPage, error) {
	switch input.Source {
	case "pinterest_boards":
		if strings.TrimSpace(input.Search) != "" {
			boards, err := p.listAllBoards(ctx, accessToken)
			if err != nil {
				return PublishingOptionsPage{}, err
			}
			return paginatePinterestOptions(pinterestBoardOptions(boards), input.Search, input.Cursor, input.Limit), nil
		}
		page, err := p.listBoardsPage(ctx, accessToken, input.Cursor, input.Limit)
		if err != nil {
			return PublishingOptionsPage{}, err
		}
		return PublishingOptionsPage{Options: pinterestBoardOptions(page.Items), NextCursor: page.Bookmark}, nil
	case "pinterest_sections":
		boardID := pinterestContextBoardID(input.Context)
		if boardID == "" {
			return PublishingOptionsPage{}, nil
		}
		if strings.TrimSpace(input.Search) != "" {
			sections, err := p.listAllSections(ctx, accessToken, boardID)
			if err != nil {
				return PublishingOptionsPage{}, err
			}
			return paginatePinterestOptions(pinterestSectionOptions(sections), input.Search, input.Cursor, input.Limit), nil
		}
		page, err := p.listSectionsPage(ctx, accessToken, boardID, input.Cursor, input.Limit)
		if err != nil {
			return PublishingOptionsPage{}, err
		}
		return PublishingOptionsPage{Options: pinterestSectionOptions(page.Items), NextCursor: page.Bookmark}, nil
	default:
		return PublishingOptionsPage{}, fmt.Errorf("pinterest publishing option source %q is not supported", input.Source)
	}
}

func (p *PinterestAdapter) ValidatePublishingTarget(ctx context.Context, accessToken, accountID string, settings map[string]interface{}) error {
	boardID := settingString(settings, "board_id")
	if boardID == "" {
		return fmt.Errorf("pinterest board is required")
	}
	profile, err := p.GetProfile(ctx, accessToken)
	if err != nil {
		return fmt.Errorf("validate pinterest account access: %w", err)
	}
	if strings.TrimSpace(accountID) != "" && !strings.EqualFold(profile.ID, accountID) {
		return fmt.Errorf("pinterest authorization no longer belongs to the connected account")
	}
	board, err := p.getBoard(ctx, accessToken, boardID)
	if err != nil {
		return fmt.Errorf("validate pinterest board: %w", err)
	}
	if board.Owner.Username == "" || !strings.EqualFold(board.Owner.Username, profile.Username) {
		return fmt.Errorf("pinterest board is not owned by the connected account")
	}

	sectionID := settingString(settings, "section_id")
	if sectionID == "" {
		return nil
	}
	sections, err := p.listAllSections(ctx, accessToken, boardID)
	if err != nil {
		return fmt.Errorf("validate pinterest board section: %w", err)
	}
	for _, section := range sections {
		if section.ID == sectionID {
			return nil
		}
	}
	return fmt.Errorf("pinterest board section does not belong to the selected board")
}

func (p *PinterestAdapter) UploadMedia(_ context.Context, _, _, _ string, _ io.Reader) (string, error) {
	return "", fmt.Errorf("pinterest video upload requires resumable metadata")
}

type pinterestUploadSession struct {
	UploadURL        string            `json:"upload_url"`
	UploadParameters map[string]string `json:"upload_parameters"`
}

type pinterestMediaRegistration struct {
	MediaID          string            `json:"media_id"`
	UploadURL        string            `json:"upload_url"`
	UploadParameters map[string]string `json:"upload_parameters"`
}

func (p *PinterestAdapter) UploadMediaResumable(
	ctx context.Context,
	accessToken, _ string,
	req UploadMediaRequest,
	state ResumableMediaUploadState,
	checkpoint MediaUploadCheckpoint,
) (string, error) {
	if err := validatePinterestVideoUpload(req); err != nil {
		return "", &MediaUploadError{RetryClassification: MediaRetryTerminal, Err: err}
	}
	if checkpoint == nil {
		return "", &MediaUploadError{RetryClassification: MediaRetryTerminal, Err: errors.New("pinterest upload checkpoint is required")}
	}
	state.TotalBytes = req.Size

	session, err := p.ensurePinterestMediaRegistered(ctx, accessToken, &state, checkpoint)
	if err != nil {
		return "", err
	}
	ready, err := p.reconcilePinterestMediaBeforeUpload(ctx, accessToken, &state, checkpoint)
	if err != nil || ready {
		return state.ProviderMediaID, err
	}
	if err := uploadPinterestVideoIfNeeded(ctx, req, session, &state, checkpoint); err != nil {
		return "", err
	}
	return p.pollPinterestMedia(ctx, accessToken, state, checkpoint)
}

func (p *PinterestAdapter) ensurePinterestMediaRegistered(
	ctx context.Context,
	accessToken string,
	state *ResumableMediaUploadState,
	checkpoint MediaUploadCheckpoint,
) (pinterestUploadSession, error) {
	session, err := decodePinterestUploadSession(state.OpaqueState)
	if err != nil {
		return pinterestUploadSession{}, &MediaUploadError{RetryClassification: MediaRetryTerminal, Err: err}
	}
	if state.ProviderMediaID != "" {
		if !pinterestProviderID.MatchString(state.ProviderMediaID) {
			return pinterestUploadSession{}, &MediaUploadError{RetryClassification: MediaRetryTerminal, Err: errors.New("pinterest media registration returned an invalid id")}
		}
		return session, nil
	}
	registration, err := p.registerPinterestVideo(ctx, accessToken)
	if err != nil {
		return pinterestUploadSession{}, &MediaUploadError{RetryClassification: MediaRetrySafeResume, Err: err}
	}
	state.ProviderMediaID = registration.MediaID
	session = pinterestUploadSession{UploadURL: registration.UploadURL, UploadParameters: registration.UploadParameters}
	state.OpaqueState, err = encodePinterestUploadSession(session)
	if err != nil {
		return pinterestUploadSession{}, &MediaUploadError{RetryClassification: MediaRetryTerminal, Err: err}
	}
	state.Status = MediaUploadUploading
	state.RetryClassification = MediaRetrySafeResume
	state.SessionExpiresAt = time.Now().UTC().Add(pinterestUploadSessionLifetime)
	state.LastCheckedAt = time.Now().UTC()
	if err := checkpoint(*state); err != nil {
		return pinterestUploadSession{}, fmt.Errorf("checkpointing pinterest media registration: %w", err)
	}
	return session, nil
}

func (p *PinterestAdapter) reconcilePinterestMediaBeforeUpload(
	ctx context.Context,
	accessToken string,
	state *ResumableMediaUploadState,
	checkpoint MediaUploadCheckpoint,
) (bool, error) {
	status, err := p.pinterestMediaStatus(ctx, accessToken, state.ProviderMediaID)
	if err != nil {
		return false, &MediaUploadError{RetryClassification: MediaRetryReconcile, Err: err}
	}
	switch status {
	case "failed":
		return false, p.checkpointPinterestTerminalMedia(*state, checkpoint)
	case "processing":
		state.OpaqueState = ""
		state.UploadedBytes = state.TotalBytes
		state.Status = MediaUploadUploaded
		state.RetryClassification = MediaRetryReconcile
		state.SessionExpiresAt = time.Time{}
		state.LastCheckedAt = time.Now().UTC()
		if err := checkpoint(*state); err != nil {
			return false, fmt.Errorf("checkpointing accepted pinterest upload: %w", err)
		}
		return false, nil
	case "succeeded":
		state.OpaqueState = ""
		state.UploadedBytes = state.TotalBytes
		state.Status = MediaUploadReady
		state.RetryClassification = MediaRetryNone
		state.SessionExpiresAt = time.Time{}
		state.LastCheckedAt = time.Now().UTC()
		if err := checkpoint(*state); err != nil {
			return false, fmt.Errorf("checkpointing ready pinterest media: %w", err)
		}
		return true, nil
	default:
		return false, nil
	}
}

func uploadPinterestVideoIfNeeded(
	ctx context.Context,
	req UploadMediaRequest,
	session pinterestUploadSession,
	state *ResumableMediaUploadState,
	checkpoint MediaUploadCheckpoint,
) error {
	if state.UploadedBytes >= state.TotalBytes {
		return nil
	}
	if session.UploadURL == "" || len(session.UploadParameters) == 0 {
		return &MediaUploadError{
			RetryClassification: MediaRetryTerminal,
			Err:                 errors.New("pinterest upload session is missing after media registration"),
		}
	}
	if !state.SessionExpiresAt.IsZero() && !time.Now().UTC().Before(state.SessionExpiresAt) {
		return &MediaUploadError{
			RetryClassification: MediaRetryTerminal,
			Err:                 errors.New("pinterest upload session expired before the video was accepted"),
		}
	}
	reader, err := req.OpenReaderAt(0)
	if err != nil {
		return &MediaUploadError{RetryClassification: MediaRetrySafeResume, Err: fmt.Errorf("opening pinterest video: %w", err)}
	}
	uploadErr := uploadPinterestVideo(ctx, session, req, reader)
	_ = reader.Close()
	if uploadErr != nil {
		return &MediaUploadError{RetryClassification: MediaRetrySafeResume, Err: uploadErr}
	}
	state.UploadedBytes = state.TotalBytes
	state.Status = MediaUploadUploaded
	state.RetryClassification = MediaRetryReconcile
	state.OpaqueState = ""
	state.SessionExpiresAt = time.Time{}
	state.LastCheckedAt = time.Now().UTC()
	if err := checkpoint(*state); err != nil {
		return fmt.Errorf("checkpointing uploaded pinterest media: %w", err)
	}
	return nil
}

func validatePinterestVideoUpload(req UploadMediaRequest) error {
	if strings.ToLower(strings.TrimSpace(req.MimeType)) != "video/mp4" {
		return fmt.Errorf("pinterest video Pins require an MP4 video")
	}
	if req.Size <= 0 || req.Size > pinterestVideoMaxSize {
		return fmt.Errorf("pinterest video must be between 1 byte and 2 GiB")
	}
	if req.OpenReaderAt == nil {
		return fmt.Errorf("pinterest video upload requires a restartable media reader")
	}
	if req.ThumbnailReader == nil {
		return fmt.Errorf("pinterest video Pins require a cover image")
	}
	if mimeType := strings.ToLower(strings.TrimSpace(req.ThumbnailMimeType)); mimeType != "image/jpeg" && mimeType != "image/png" {
		return fmt.Errorf("pinterest video cover must be a JPEG or PNG image")
	}
	if req.ThumbnailSize <= 0 {
		return fmt.Errorf("pinterest video cover must not be empty")
	}
	return nil
}

func (p *PinterestAdapter) registerPinterestVideo(ctx context.Context, accessToken string) (pinterestMediaRegistration, error) {
	body, err := DoJSON(ctx, http.MethodPost, pinterestAPIBaseURL+"/media", map[string]string{"media_type": "video"}, bearerHeaders(accessToken))
	if err != nil {
		return pinterestMediaRegistration{}, fmt.Errorf("pinterest media registration: %w", err)
	}
	var registration pinterestMediaRegistration
	if err := json.Unmarshal(body, &registration); err != nil {
		return pinterestMediaRegistration{}, fmt.Errorf("decoding pinterest media registration: %w", err)
	}
	if !pinterestProviderID.MatchString(registration.MediaID) {
		return pinterestMediaRegistration{}, fmt.Errorf("pinterest media registration returned an invalid id")
	}
	if err := validatePinterestUploadURL(registration.UploadURL); err != nil {
		return pinterestMediaRegistration{}, err
	}
	if len(registration.UploadParameters) == 0 {
		return pinterestMediaRegistration{}, fmt.Errorf("pinterest media registration returned no upload parameters")
	}
	return registration, nil
}

func validatePinterestUploadURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || parsed.Hostname() == "" {
		return fmt.Errorf("pinterest media registration returned an invalid upload URL")
	}
	host := strings.ToLower(parsed.Hostname())
	if host != "s3.amazonaws.com" && !strings.HasSuffix(host, ".s3.amazonaws.com") && !strings.HasSuffix(host, ".s3-accelerate.amazonaws.com") {
		return fmt.Errorf("pinterest media registration returned an untrusted upload host")
	}
	return nil
}

func uploadPinterestVideo(ctx context.Context, session pinterestUploadSession, req UploadMediaRequest, reader io.Reader) error {
	if err := validatePinterestUploadURL(session.UploadURL); err != nil {
		return err
	}
	pipeReader, pipeWriter := io.Pipe()
	writer := multipart.NewWriter(pipeWriter)
	go func() {
		var writeErr error
		for key, value := range session.UploadParameters {
			if strings.TrimSpace(key) == "" || strings.ContainsAny(key, "\r\n") {
				writeErr = fmt.Errorf("invalid pinterest upload parameter")
				break
			}
			if fieldErr := writer.WriteField(key, value); fieldErr != nil {
				writeErr = fieldErr
				break
			}
		}
		if writeErr == nil {
			var part io.Writer
			part, writeErr = writer.CreateFormFile("file", firstNonEmptyString(req.Filename, "video.mp4"))
			if writeErr == nil {
				_, writeErr = io.Copy(part, reader)
			}
		}
		if closeErr := writer.Close(); writeErr == nil {
			writeErr = closeErr
		}
		_ = pipeWriter.CloseWithError(writeErr)
	}()

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, session.UploadURL, pipeReader)
	if err != nil {
		_ = pipeReader.Close()
		return fmt.Errorf("creating pinterest video upload: %w", err)
	}
	request.Header.Set(headerContentType, writer.FormDataContentType())
	client := *httpClient
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := client.Do(request)
	if err != nil {
		_ = pipeReader.Close()
		return fmt.Errorf("pinterest video upload failed: %w", err)
	}
	defer response.Body.Close()
	body, readErr := io.ReadAll(response.Body)
	if readErr != nil {
		return fmt.Errorf("reading pinterest video upload response: %w", readErr)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("pinterest video upload: %w", NewHTTPError(response.StatusCode, response.Header, body))
	}
	return nil
}

func (p *PinterestAdapter) pinterestMediaStatus(ctx context.Context, accessToken, mediaID string) (string, error) {
	if !pinterestProviderID.MatchString(mediaID) {
		return "", fmt.Errorf("pinterest media status requires a valid media id")
	}
	body, err := DoRequest(ctx, http.MethodGet, pinterestAPIBaseURL+"/media/"+url.PathEscape(mediaID), nil, bearerHeaders(accessToken))
	if err != nil {
		return "", fmt.Errorf("pinterest media status: %w", err)
	}
	var response struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return "", fmt.Errorf("decoding pinterest media status: %w", err)
	}
	return strings.ToLower(strings.TrimSpace(response.Status)), nil
}

func (p *PinterestAdapter) pollPinterestMedia(ctx context.Context, accessToken string, state ResumableMediaUploadState, checkpoint MediaUploadCheckpoint) (string, error) {
	attempts := p.mediaPollAttempts
	if attempts <= 0 || attempts > pinterestMediaPollAttempts {
		attempts = pinterestMediaPollAttempts
	}
	delay := p.mediaPollDelay
	if delay < 0 || delay > pinterestMediaPollMaxDelay {
		delay = pinterestMediaPollInitialDelay
	}
	for attempt := 0; attempt < attempts; attempt++ {
		ready, err := p.pollPinterestMediaOnce(ctx, accessToken, &state, checkpoint)
		if err != nil || ready {
			return state.ProviderMediaID, err
		}
		if attempt+1 < attempts && delay > 0 {
			if err := p.sleepFor(ctx, delay); err != nil {
				return "", &MediaUploadError{RetryClassification: MediaRetryReconcile, Err: err}
			}
			delay = min(delay*2, pinterestMediaPollMaxDelay)
		}
	}
	return "", &MediaUploadError{
		RetryClassification: MediaRetryReconcile,
		Err:                 errors.New("pinterest video is still processing"),
	}
}

func (p *PinterestAdapter) pollPinterestMediaOnce(
	ctx context.Context,
	accessToken string,
	state *ResumableMediaUploadState,
	checkpoint MediaUploadCheckpoint,
) (bool, error) {
	status, err := p.pinterestMediaStatus(ctx, accessToken, state.ProviderMediaID)
	state.LastCheckedAt = time.Now().UTC()
	state.Status = MediaUploadUploaded
	state.RetryClassification = MediaRetryReconcile
	if err == nil && status == "succeeded" {
		state.Status = MediaUploadReady
		state.RetryClassification = MediaRetryNone
		state.SessionExpiresAt = time.Time{}
		if checkpointErr := checkpoint(*state); checkpointErr != nil {
			return false, fmt.Errorf("checkpointing ready pinterest media: %w", checkpointErr)
		}
		return true, nil
	}
	if err == nil && status == "failed" {
		return false, p.checkpointPinterestTerminalMedia(*state, checkpoint)
	}
	if checkpointErr := checkpoint(*state); checkpointErr != nil {
		return false, fmt.Errorf("checkpointing pinterest media processing: %w", checkpointErr)
	}
	return false, nil
}

func (p *PinterestAdapter) checkpointPinterestTerminalMedia(state ResumableMediaUploadState, checkpoint MediaUploadCheckpoint) error {
	state.OpaqueState = ""
	state.Status = MediaUploadFailed
	state.RetryClassification = MediaRetryTerminal
	state.SessionExpiresAt = time.Time{}
	state.LastCheckedAt = time.Now().UTC()
	if err := checkpoint(state); err != nil {
		return fmt.Errorf("checkpointing failed pinterest media: %w", err)
	}
	return &MediaUploadError{
		RetryClassification: MediaRetryTerminal,
		Err:                 errors.New("pinterest rejected the uploaded video"),
	}
}

func (p *PinterestAdapter) sleepFor(ctx context.Context, delay time.Duration) error {
	if p.sleep != nil {
		return p.sleep(ctx, delay)
	}
	return pinterestSleep(ctx, delay)
}

func pinterestSleep(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func decodePinterestUploadSession(raw string) (pinterestUploadSession, error) {
	if strings.TrimSpace(raw) == "" {
		return pinterestUploadSession{}, nil
	}
	var session pinterestUploadSession
	if err := json.Unmarshal([]byte(raw), &session); err != nil {
		return pinterestUploadSession{}, fmt.Errorf("decoding pinterest upload session: %w", err)
	}
	if err := validatePinterestUploadURL(session.UploadURL); err != nil {
		return pinterestUploadSession{}, err
	}
	return session, nil
}

func encodePinterestUploadSession(session pinterestUploadSession) (string, error) {
	encoded, err := json.Marshal(session)
	if err != nil {
		return "", fmt.Errorf("encoding pinterest upload session: %w", err)
	}
	return string(encoded), nil
}

func (p *PinterestAdapter) Publish(ctx context.Context, accessToken, accountID string, req *PublishRequest) (PublishResult, error) {
	if req == nil {
		return PublishResult{}, fmt.Errorf("pinterest publish request is required")
	}
	switch req.Profile {
	case "short_video":
		return p.publishPinterestVideo(ctx, accessToken, accountID, req)
	case "image_post", "carousel":
		return p.publishPinterestImages(ctx, accessToken, accountID, req)
	default:
		return PublishResult{}, fmt.Errorf("pinterest publishing does not support profile %q", req.Profile)
	}
}

func (p *PinterestAdapter) publishPinterestImages(ctx context.Context, accessToken, accountID string, req *PublishRequest) (PublishResult, error) {
	payload, err := buildPinterestPinRequest(req)
	if err != nil {
		return PublishResult{}, err
	}
	if err := p.ValidatePublishingTarget(ctx, accessToken, accountID, req.Settings); err != nil {
		return PublishResult{}, err
	}

	prepared := PublishResult{ProviderState: "create_pin", RetrySafety: PublishRetryNever}
	if err := req.BeginWrite(prepared); err != nil {
		return PublishResult{}, err
	}
	body, err := DoJSON(ctx, http.MethodPost, pinterestAPIBaseURL+"/pins", payload, bearerHeaders(accessToken))
	if err != nil {
		return prepared, fmt.Errorf("creating pinterest Pin: %w", err)
	}
	var response struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return prepared, fmt.Errorf("decoding pinterest Pin create response: %w", err)
	}
	response.ID = strings.TrimSpace(response.ID)
	if response.ID == "" {
		return prepared, fmt.Errorf("pinterest Pin create response is missing an id")
	}
	result := AcceptedPublishResult(response.ID)
	result.ProviderState = "pin_created"
	result.ExternalURL = pinterestPinURL(response.ID)
	if err := req.Checkpoint(result); err != nil {
		return result, err
	}
	return result, nil
}

func (p *PinterestAdapter) publishPinterestVideo(ctx context.Context, accessToken, accountID string, req *PublishRequest) (PublishResult, error) {
	if req.ResumeProviderReference != "" {
		return p.ReconcilePublish(ctx, accessToken, accountID, req.ResumeProviderReference)
	}
	if req.ResumeProviderState == "creating" {
		return PublishResult{ProviderState: "creating", RetrySafety: PublishRetryNever}, fmt.Errorf("pinterest video Pin create outcome is ambiguous; OpenPost will not replay it")
	}
	if err := p.ValidatePublishingTarget(ctx, accessToken, accountID, req.Settings); err != nil {
		return PublishResult{}, err
	}
	payload, err := pinterestVideoPinPayload(req)
	if err != nil {
		return PublishResult{}, err
	}
	prepared := PublishResult{ProviderState: "creating", RetrySafety: PublishRetryNever}
	if err := req.BeginWrite(prepared); err != nil {
		return PublishResult{}, err
	}
	body, err := DoJSON(ctx, http.MethodPost, pinterestAPIBaseURL+"/pins", payload, bearerHeaders(accessToken))
	if err != nil {
		return prepared, fmt.Errorf("pinterest create video Pin: %w", err)
	}
	var response struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return prepared, fmt.Errorf("decoding pinterest create video Pin: %w", err)
	}
	if !pinterestProviderID.MatchString(response.ID) {
		return prepared, fmt.Errorf("pinterest create video Pin returned an invalid id")
	}
	pending := pendingPinterestPinResult(response.ID)
	if err := req.Checkpoint(pending); err != nil {
		return pending, fmt.Errorf("checkpointing pinterest video Pin: %w", err)
	}
	return pending, nil
}

type pinterestPinCreateRequest struct {
	BoardID        string                  `json:"board_id"`
	BoardSectionID string                  `json:"board_section_id,omitempty"`
	Title          string                  `json:"title,omitempty"`
	Description    string                  `json:"description,omitempty"`
	Link           string                  `json:"link,omitempty"`
	AltText        string                  `json:"alt_text,omitempty"`
	AIDisclosures  *pinterestAIDisclosures `json:"ai_disclosures,omitempty"`
	MediaSource    pinterestPinMediaSource `json:"media_source"`
}

type pinterestPinMediaSource struct {
	SourceType string                  `json:"source_type"`
	URL        string                  `json:"url,omitempty"`
	Items      []pinterestPinMediaItem `json:"items,omitempty"`
}

type pinterestPinMediaItem struct {
	URL         string `json:"url"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	Link        string `json:"link,omitempty"`
}

type pinterestAIDisclosures struct {
	Values []string `json:"values"`
}

func buildPinterestPinRequest(req *PublishRequest) (pinterestPinCreateRequest, error) {
	if req == nil {
		return pinterestPinCreateRequest{}, fmt.Errorf("pinterest publish request is required")
	}
	if err := validatePinterestPublishMedia(req); err != nil {
		return pinterestPinCreateRequest{}, err
	}
	title, description, link, altText, aiDisclosures, err := pinterestPinMetadata(req)
	if err != nil {
		return pinterestPinCreateRequest{}, err
	}
	payload := pinterestPinCreateRequest{
		BoardID:        settingString(req.Settings, "board_id"),
		BoardSectionID: settingString(req.Settings, "section_id"),
		Title:          title,
		Description:    description,
		Link:           link,
		AltText:        altText,
		AIDisclosures:  aiDisclosures,
	}
	if len(req.PlatformMediaIDs) == 1 {
		payload.MediaSource = pinterestPinMediaSource{SourceType: "image_url", URL: req.PlatformMediaIDs[0]}
		return payload, nil
	}

	payload.MediaSource.SourceType = "multiple_image_urls"
	payload.MediaSource.Items = make([]pinterestPinMediaItem, 0, len(req.PlatformMediaIDs))
	for _, mediaURL := range req.PlatformMediaIDs {
		payload.MediaSource.Items = append(payload.MediaSource.Items, pinterestPinMediaItem{
			URL: mediaURL, Title: title, Description: description, Link: link,
		})
	}
	return payload, nil
}

func validatePinterestPublishMedia(req *PublishRequest) error {
	mediaCount := len(req.PlatformMediaIDs)
	if req.Profile == "image_post" && mediaCount != 1 {
		return fmt.Errorf("pinterest image Pins require exactly one image")
	}
	if req.Profile == "carousel" && (mediaCount < 2 || mediaCount > 5) {
		return fmt.Errorf("pinterest multi-image Pins require 2-5 images")
	}
	if req.Profile != "image_post" && req.Profile != "carousel" {
		return fmt.Errorf("pinterest publishing does not support profile %q", req.Profile)
	}
	if len(req.Media) != mediaCount {
		return fmt.Errorf("pinterest publishing requires ordered media metadata for every image")
	}
	for index, item := range req.Media {
		if !pinterestImageMIME(item.MimeType) {
			return fmt.Errorf("pinterest image %d must be JPEG, PNG, or WebP", index+1)
		}
		if item.Size > 20*1024*1024 {
			return fmt.Errorf("pinterest image %d must be 20MB or smaller", index+1)
		}
		if !pinterestSourceURL(req.PlatformMediaIDs[index]) {
			return fmt.Errorf("pinterest image %d requires a public HTTPS URL", index+1)
		}
	}
	return nil
}

func pinterestPinMetadata(req *PublishRequest) (string, string, string, string, *pinterestAIDisclosures, error) {
	title := strings.TrimSpace(firstNonEmptyString(settingString(req.Settings, "pin_title"), req.Title))
	description := strings.TrimSpace(firstNonEmptyString(req.Description, req.Content))
	link := strings.TrimSpace(settingString(req.Settings, "destination_link"))
	if utf8.RuneCountInString(title) > 100 {
		return "", "", "", "", nil, fmt.Errorf("pinterest Pin title must be 100 characters or fewer")
	}
	if utf8.RuneCountInString(description) > 800 {
		return "", "", "", "", nil, fmt.Errorf("pinterest Pin description must be 800 characters or fewer")
	}
	if link != "" && !pinterestDestinationURL(link) {
		return "", "", "", "", nil, fmt.Errorf("pinterest destination link must be an absolute HTTP or HTTPS URL")
	}
	altText := strings.TrimSpace(settingString(req.Settings, "alt_text"))
	if len(req.MediaAltTexts) > 0 && strings.TrimSpace(req.MediaAltTexts[0]) != "" {
		altText = strings.TrimSpace(req.MediaAltTexts[0])
	}
	if utf8.RuneCountInString(altText) > 500 {
		return "", "", "", "", nil, fmt.Errorf("pinterest Pin alt text must be 500 characters or fewer")
	}
	aiDisclosures, err := pinterestAIDisclosure(req.Settings)
	if err != nil {
		return "", "", "", "", nil, err
	}
	return title, description, link, altText, aiDisclosures, nil
}

func pinterestAIDisclosure(settings map[string]interface{}) (*pinterestAIDisclosures, error) {
	raw, present := settings["is_ai_generated"]
	if !present {
		return nil, nil
	}
	value, ok := raw.(bool)
	if !ok {
		return nil, fmt.Errorf("pinterest AI-generated disclosure must be a boolean")
	}
	if !value {
		return nil, nil
	}
	return &pinterestAIDisclosures{Values: []string{"AI_MODIFIED"}}, nil
}

func pinterestImageMIME(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "image/jpeg", "image/png", "image/webp":
		return true
	default:
		return false
	}
}

func pinterestSourceURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	return err == nil && parsed.Scheme == "https" && parsed.Host != "" && parsed.User == nil
}

func pinterestDestinationURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != "" && parsed.User == nil
}

func pinterestPinURL(pinID string) string {
	pinID = strings.TrimSpace(pinID)
	if pinID == "" {
		return ""
	}
	for _, char := range pinID {
		if char < '0' || char > '9' {
			return ""
		}
	}
	return "https://www.pinterest.com/pin/" + pinID + "/"
}

func pinterestVideoPinPayload(req *PublishRequest) (map[string]any, error) {
	if len(req.Media) != 1 || len(req.PlatformMediaIDs) != 1 || strings.ToLower(strings.TrimSpace(req.Media[0].MimeType)) != "video/mp4" {
		return nil, fmt.Errorf("pinterest video Pins require exactly one uploaded MP4 video")
	}
	mediaID := strings.TrimSpace(req.PlatformMediaIDs[0])
	if !pinterestProviderID.MatchString(mediaID) {
		return nil, fmt.Errorf("pinterest video Pin requires a valid uploaded media id")
	}
	coverURL := settingString(req.Settings, "cover_media_id")
	if !pinterestSafeHTTPSURL(coverURL) {
		return nil, fmt.Errorf("pinterest video Pin requires a public HTTPS cover image")
	}
	title := firstNonEmptyString(settingString(req.Settings, "pin_title"), req.Title)
	description := firstNonEmptyString(strings.TrimSpace(req.Description), strings.TrimSpace(req.Content))
	altText := firstNonEmptyString(settingString(req.Settings, "alt_text"), firstPinterestAltText(req.MediaAltTexts))
	if utf8.RuneCountInString(title) > 100 {
		return nil, fmt.Errorf("pinterest Pin title supports at most 100 characters")
	}
	if utf8.RuneCountInString(description) > 800 {
		return nil, fmt.Errorf("pinterest Pin description supports at most 800 characters")
	}
	if utf8.RuneCountInString(altText) > 500 {
		return nil, fmt.Errorf("pinterest Pin alt text supports at most 500 characters")
	}
	payload := map[string]any{
		"board_id":    settingString(req.Settings, "board_id"),
		"description": description,
		"media_source": map[string]any{
			"source_type":     "video_id",
			"media_id":        mediaID,
			"cover_image_url": coverURL,
		},
	}
	if title != "" {
		payload["title"] = title
	}
	if sectionID := settingString(req.Settings, "section_id"); sectionID != "" {
		payload["board_section_id"] = sectionID
	}
	if destination := settingString(req.Settings, "destination_link"); destination != "" {
		if !pinterestSafeDestinationURL(destination) {
			return nil, fmt.Errorf("pinterest destination link must be a safe HTTP or HTTPS URL")
		}
		payload["link"] = destination
	}
	if altText != "" {
		payload["alt_text"] = altText
	}
	if settingBool(req.Settings, "is_ai_generated") {
		payload["is_ai_generated"] = true
	}
	return payload, nil
}

func firstPinterestAltText(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return strings.TrimSpace(values[0])
}

func pinterestSafeHTTPSURL(raw string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	return err == nil && parsed.Scheme == "https" && parsed.Hostname() != "" && parsed.User == nil
}

func pinterestSafeDestinationURL(raw string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Hostname() != "" && parsed.User == nil
}

func pendingPinterestPinResult(pinID string) PublishResult {
	return PublishResult{
		SubmissionState:   PublishSubmissionPending,
		ProviderState:     "reconciling",
		ProviderReference: pinterestPinReferencePrefix + pinID,
		RetrySafety:       PublishRetryReconcileOnly,
		ReconcileAfter:    pinterestPinReconcileDelay,
	}
}

func pinterestPinIDFromReference(reference string) (string, error) {
	if !strings.HasPrefix(reference, pinterestPinReferencePrefix) {
		return "", fmt.Errorf("pinterest Pin reconciliation requires a versioned reference")
	}
	pinID := strings.TrimPrefix(reference, pinterestPinReferencePrefix)
	if !pinterestProviderID.MatchString(pinID) {
		return "", fmt.Errorf("pinterest Pin reconciliation reference is invalid")
	}
	return pinID, nil
}

func (p *PinterestAdapter) ReconcilePublish(ctx context.Context, accessToken, _ string, providerReference string) (PublishResult, error) {
	pinID, err := pinterestPinIDFromReference(strings.TrimSpace(providerReference))
	if err != nil {
		return PublishResult{SubmissionState: PublishSubmissionRejected, RetrySafety: PublishRetryNever}, err
	}
	body, err := DoRequest(ctx, http.MethodGet, pinterestAPIBaseURL+"/pins/"+url.PathEscape(pinID), nil, bearerHeaders(accessToken))
	if err != nil {
		var providerErr *HTTPError
		if errors.As(err, &providerErr) {
			if providerErr.StatusCode == http.StatusNotFound {
				pending := pendingPinterestPinResult(pinID)
				pending.ReconcileAfter = time.Minute
				return pending, nil
			}
			if providerErr.StatusCode >= 400 && providerErr.StatusCode < 500 &&
				providerErr.StatusCode != http.StatusRequestTimeout && providerErr.StatusCode != http.StatusTooManyRequests {
				return PublishResult{
					SubmissionState: PublishSubmissionRejected, ProviderState: "reconciliation_failed",
					ProviderReference: providerReference, RetrySafety: PublishRetryNever,
				}, fmt.Errorf("pinterest reconcile video Pin: %w", err)
			}
		}
		return pendingPinterestPinResult(pinID), fmt.Errorf("pinterest reconcile video Pin: %w", err)
	}
	var response struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return pendingPinterestPinResult(pinID), fmt.Errorf("decoding pinterest video Pin reconciliation: %w", err)
	}
	if response.ID != pinID {
		return pendingPinterestPinResult(pinID), fmt.Errorf("pinterest video Pin reconciliation returned a mismatched id")
	}
	result := AcceptedPublishResult(pinID)
	result.ProviderState = "published"
	result.ProviderReference = pinterestPinReferencePrefix + pinID
	result.ExternalURL = "https://www.pinterest.com/pin/" + pinID + "/"
	return result, nil
}

func validatePinterestMedia(media []MediaItem) []MediaValidationIssue {
	if len(media) == 0 {
		return []MediaValidationIssue{{Provider: providerPinterest, Severity: severityError, Message: "Pinterest requires media."}}
	}
	videos := 0
	issues := []MediaValidationIssue{}
	for _, item := range media {
		mimeType := strings.ToLower(strings.TrimSpace(item.MimeType))
		if mimeType == "video/mp4" {
			videos++
			if item.Size > pinterestVideoMaxSize {
				issues = append(issues, MediaValidationIssue{Provider: providerPinterest, MediaID: item.ID, Severity: severityError, Message: "Pinterest videos must not exceed 2 GiB."})
			}
			continue
		}
		if !pinterestImageMIME(mimeType) {
			issues = append(issues, MediaValidationIssue{Provider: providerPinterest, MediaID: item.ID, Severity: severityError, Message: "Pinterest supports JPEG, PNG, WebP, or MP4 media."})
			continue
		}
		if item.Size > 20*1024*1024 {
			issues = append(issues, MediaValidationIssue{Provider: providerPinterest, MediaID: item.ID, Severity: severityError, Message: "Pinterest images must be 20MB or smaller."})
		}
	}
	if videos > 0 && (videos != 1 || len(media) != 1) {
		issues = append(issues, MediaValidationIssue{Provider: providerPinterest, Severity: severityError, Message: "Pinterest video Pins require exactly one video."})
	}
	if videos == 0 && len(media) > 5 {
		issues = append(issues, MediaValidationIssue{Provider: providerPinterest, Severity: severityError, Message: "Pinterest supports at most five images."})
	}
	return issues
}

type pinterestBoard struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Privacy string `json:"privacy"`
	Owner   struct {
		Username string `json:"username"`
	} `json:"owner"`
}

type pinterestSection struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type pinterestPage[T any] struct {
	Items    []T    `json:"items"`
	Bookmark string `json:"bookmark"`
}

func (p *PinterestAdapter) listBoardsPage(ctx context.Context, accessToken, bookmark string, limit int) (pinterestPage[pinterestBoard], error) {
	limit = pinterestBoundedLimit(limit)
	query := url.Values{"page_size": {strconv.Itoa(limit)}, "privacy": {"ALL"}}
	if bookmark != "" {
		query.Set("bookmark", bookmark)
	}
	return pinterestGetPage[pinterestBoard](ctx, accessToken, pinterestAPIBaseURL+"/boards?"+query.Encode(), "boards")
}

func (p *PinterestAdapter) listAllBoards(ctx context.Context, accessToken string) ([]pinterestBoard, error) {
	items := []pinterestBoard{}
	seenIDs := map[string]struct{}{}
	bookmark := ""
	seenBookmarks := map[string]struct{}{}
	for {
		page, err := p.listBoardsPage(ctx, accessToken, bookmark, pinterestPageSize)
		if err != nil {
			return nil, err
		}
		for _, board := range page.Items {
			if board.ID == "" {
				continue
			}
			if _, duplicate := seenIDs[board.ID]; duplicate {
				continue
			}
			seenIDs[board.ID] = struct{}{}
			items = append(items, board)
		}
		if page.Bookmark == "" {
			return items, nil
		}
		if _, repeated := seenBookmarks[page.Bookmark]; repeated {
			return nil, fmt.Errorf("pinterest boards pagination returned a repeated bookmark")
		}
		seenBookmarks[page.Bookmark] = struct{}{}
		bookmark = page.Bookmark
	}
}

func (p *PinterestAdapter) getBoard(ctx context.Context, accessToken, boardID string) (pinterestBoard, error) {
	body, err := DoRequest(ctx, http.MethodGet, pinterestAPIBaseURL+"/boards/"+url.PathEscape(boardID), nil, bearerHeaders(accessToken))
	if err != nil {
		return pinterestBoard{}, err
	}
	var board pinterestBoard
	if err := json.Unmarshal(body, &board); err != nil {
		return pinterestBoard{}, fmt.Errorf("decoding pinterest board: %w", err)
	}
	if board.ID == "" {
		return pinterestBoard{}, fmt.Errorf("pinterest board response is missing an id")
	}
	return board, nil
}

func (p *PinterestAdapter) listSectionsPage(ctx context.Context, accessToken, boardID, bookmark string, limit int) (pinterestPage[pinterestSection], error) {
	limit = pinterestBoundedLimit(limit)
	query := url.Values{"page_size": {strconv.Itoa(limit)}}
	if bookmark != "" {
		query.Set("bookmark", bookmark)
	}
	endpoint := pinterestAPIBaseURL + "/boards/" + url.PathEscape(boardID) + "/sections?" + query.Encode()
	return pinterestGetPage[pinterestSection](ctx, accessToken, endpoint, "board sections")
}

func (p *PinterestAdapter) listAllSections(ctx context.Context, accessToken, boardID string) ([]pinterestSection, error) {
	items := []pinterestSection{}
	bookmark := ""
	seenBookmarks := map[string]struct{}{}
	for {
		page, err := p.listSectionsPage(ctx, accessToken, boardID, bookmark, pinterestPageSize)
		if err != nil {
			return nil, err
		}
		items = append(items, page.Items...)
		if page.Bookmark == "" {
			return items, nil
		}
		if _, repeated := seenBookmarks[page.Bookmark]; repeated {
			return nil, fmt.Errorf("pinterest board sections pagination returned a repeated bookmark")
		}
		seenBookmarks[page.Bookmark] = struct{}{}
		bookmark = page.Bookmark
	}
}

func pinterestGetPage[T any](ctx context.Context, accessToken, endpoint, label string) (pinterestPage[T], error) {
	body, err := DoRequest(ctx, http.MethodGet, endpoint, nil, bearerHeaders(accessToken))
	if err != nil {
		return pinterestPage[T]{}, fmt.Errorf("pinterest %s: %w", label, err)
	}
	var page pinterestPage[T]
	if err := json.Unmarshal(body, &page); err != nil {
		return pinterestPage[T]{}, fmt.Errorf("decoding pinterest %s: %w", label, err)
	}
	return page, nil
}

func pinterestBoardOptions(items []pinterestBoard) []DestinationOption {
	options := make([]DestinationOption, 0, len(items))
	for _, board := range items {
		if board.ID == "" {
			continue
		}
		options = append(options, DestinationOption{Value: board.ID, Label: firstNonEmptyString(board.Name, board.ID)})
	}
	return options
}

func pinterestSectionOptions(items []pinterestSection) []DestinationOption {
	options := make([]DestinationOption, 0, len(items))
	for _, section := range items {
		if section.ID == "" {
			continue
		}
		options = append(options, DestinationOption{Value: section.ID, Label: firstNonEmptyString(section.Name, section.ID)})
	}
	return options
}

func pinterestContextBoardID(contextValues map[string]string) string {
	raw := strings.TrimSpace(contextValues["value"])
	if raw == "" {
		return ""
	}
	var settings map[string]interface{}
	if json.Unmarshal([]byte(raw), &settings) != nil {
		return ""
	}
	return settingString(settings, "board_id")
}

func pinterestBoundedLimit(limit int) int {
	if limit <= 0 || limit > pinterestPageSize {
		return pinterestPageSize
	}
	return limit
}

func paginatePinterestOptions(options []DestinationOption, search, cursor string, limit int) PublishingOptionsPage {
	query := strings.ToLower(strings.TrimSpace(search))
	filtered := make([]DestinationOption, 0, len(options))
	for _, option := range options {
		if query == "" || strings.Contains(strings.ToLower(option.Label), query) {
			filtered = append(filtered, option)
		}
	}
	limit = pinterestBoundedLimit(limit)
	offset, _ := strconv.Atoi(cursor)
	if offset < 0 || offset > len(filtered) {
		offset = 0
	}
	end := min(offset+limit, len(filtered))
	page := PublishingOptionsPage{Options: filtered[offset:end]}
	if end < len(filtered) {
		page.NextCursor = strconv.Itoa(end)
	}
	return page
}
