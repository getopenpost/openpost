package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// peertubeUploadChunkSize bounds each resumable PUT so interrupted workers
// resume from a recent offset instead of restarting the file.
const peertubeUploadChunkSize = 8 * 1024 * 1024

type peertubeUploadSession struct {
	UploadURL        string `json:"upload_url"`
	ThumbnailApplied bool   `json:"thumbnail_applied,omitempty"`
	CaptionApplied   bool   `json:"caption_applied,omitempty"`
}

type peertubeRawResponse struct {
	status int
	header http.Header
	body   []byte
}

func peertubeRawRequest(ctx context.Context, method, rawURL string, headers map[string]string, body io.Reader) (peertubeRawResponse, error) {
	req, err := http.NewRequestWithContext(ctx, method, rawURL, body)
	if err != nil {
		return peertubeRawResponse{}, fmt.Errorf("creating peertube request: %w", err)
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return peertubeRawResponse{}, &MediaUploadError{RetryClassification: MediaRetrySafeResume, Err: fmt.Errorf("peertube request failed: %w", sanitizeTransportError(err))}
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return peertubeRawResponse{}, &MediaUploadError{RetryClassification: MediaRetrySafeResume, Err: fmt.Errorf("reading peertube response: %w", err)}
	}
	return peertubeRawResponse{status: resp.StatusCode, header: resp.Header, body: respBody}, nil
}

func peertubeAuthHeaders(accessToken string) map[string]string {
	return map[string]string{headerAuthorization: bearerPrefix + accessToken}
}

func peertubeUploadError(status int, body []byte, label string) error {
	classification := MediaRetryTerminal
	if status == http.StatusTooManyRequests || status >= 500 {
		classification = MediaRetrySafeResume
	}
	return &MediaUploadError{
		RetryClassification: classification,
		Err:                 fmt.Errorf("%s: %w", label, NewHTTPError(status, nil, body)),
	}
}

// UploadMediaWithMetadata streams the video through PeerTube's resumable
// upload protocol and applies the thumbnail and captions afterwards. Every
// durable stage is checkpointed before the next remote mutation, so a worker
// restart reconciles the server session instead of duplicating the video.
func (p *PeerTubeAdapter) UploadMediaWithMetadata(ctx context.Context, accessToken, accountID string, req UploadMediaRequest) (string, error) {
	if req.Reader == nil && req.OpenReaderAt == nil {
		return "", fmt.Errorf("peertube upload requires a video reader")
	}
	if !isVideoMime(req.MimeType) {
		return "", fmt.Errorf("peertube upload requires a video attachment")
	}
	cleanup := func() {}
	if req.OpenReaderAt == nil {
		var err error
		cleanup, err = spoolPeerTubeMedia(&req)
		if err != nil {
			return "", err
		}
	}
	defer cleanup()
	total := req.Size
	if total <= 0 {
		return "", fmt.Errorf("peertube upload requires a non-empty video")
	}
	// The account ID is the connected channel; an explicit setting wins
	// when one post targets a different channel on the same account.
	channel := peertubeChannelForRequest(accountID, req.Settings)
	if channel == "" {
		return "", fmt.Errorf("peertube upload requires a channel: set one for this post")
	}
	channelID, err := p.resolveChannelID(ctx, accessToken, channel)
	if err != nil {
		return "", err
	}
	metadata, err := peertubeUploadMetadata(req, channelID)
	if err != nil {
		return "", err
	}
	state := ResumableMediaUploadState{Status: MediaUploadPending, RetryClassification: MediaRetrySafeResume, TotalBytes: total}
	session := peertubeUploadSession{}
	uuid, err := p.runPeerTubeUpload(ctx, accessToken, req, metadata, total, state, session)
	if err != nil {
		return "", err
	}
	return uuid, nil
}

func spoolPeerTubeMedia(req *UploadMediaRequest) (func(), error) {
	file, err := os.CreateTemp("", "openpost-peertube-*")
	if err != nil {
		return nil, fmt.Errorf("creating peertube upload file: %w", err)
	}
	cleanup := func() { _ = os.Remove(file.Name()) }
	read, copyErr := io.Copy(file, req.Reader)
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil || (req.Size > 0 && req.Size != read) {
		cleanup()
		switch {
		case copyErr != nil:
			return nil, fmt.Errorf("reading peertube media: %w", copyErr)
		case closeErr != nil:
			return nil, fmt.Errorf("closing peertube upload file: %w", closeErr)
		default:
			return nil, fmt.Errorf("peertube upload size mismatch: expected %d bytes, read %d", req.Size, read)
		}
	}
	req.Size = read
	req.OpenReaderAt = func(offset int64) (io.ReadCloser, error) {
		reader, err := os.Open(file.Name())
		if err != nil {
			return nil, err
		}
		if _, err := reader.Seek(offset, io.SeekStart); err != nil {
			_ = reader.Close()
			return nil, err
		}
		return reader, nil
	}
	return cleanup, nil
}

func peertubeUploadMetadata(req UploadMediaRequest, channelID int64) (map[string]any, error) {
	title := strings.TrimSpace(firstNonEmptyString(req.Title, settingString(req.Settings, "title")))
	if title == "" {
		return nil, fmt.Errorf("peertube upload requires an explicit title")
	}
	if len([]rune(title)) < 3 {
		return nil, fmt.Errorf("peertube titles must be at least 3 characters")
	}
	privacy, err := peertubePrivacy(req.Settings)
	if err != nil {
		return nil, err
	}
	metadata := map[string]any{
		"filename":  firstNonEmptyString(req.Filename, "video.mp4"),
		"name":      title,
		"channelId": channelID,
		"privacy":   privacy,
	}
	if description := strings.TrimSpace(firstNonEmptyString(req.Description, settingString(req.Settings, "description"))); description != "" {
		metadata["description"] = description
	}
	if language := settingString(req.Settings, "language"); language != "" {
		metadata["language"] = language
	}
	if category := settingInt(req.Settings, "category"); category > 0 {
		metadata["category"] = category
	}
	if licence := settingInt(req.Settings, "licence"); licence > 0 {
		metadata["licence"] = licence
	}
	if settingBool(req.Settings, "nsfw") {
		metadata["nsfw"] = true
		if summary := settingString(req.Settings, "nsfw_summary"); summary != "" {
			metadata["nsfwSummary"] = summary
		}
	}
	if tags := peertubeUploadTags(req.Settings); len(tags) > 0 {
		metadata["tags"] = tags
	}
	if commentsPolicy := peertubeCommentsPolicy(req.Settings); commentsPolicy > 0 {
		metadata["commentsPolicy"] = commentsPolicy
	}
	if _, ok := req.Settings["download_enabled"]; ok {
		metadata["downloadEnabled"] = settingBool(req.Settings, "download_enabled")
	}
	if support := settingString(req.Settings, "support"); support != "" {
		metadata["support"] = support
	}
	return metadata, nil
}

func peertubeUploadTags(settings map[string]interface{}) []string {
	raw := settingString(settings, "tags")
	if raw == "" {
		return nil
	}
	seen := map[string]struct{}{}
	tags := []string{}
	for _, part := range strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == '\n' }) {
		tag := strings.TrimSpace(part)
		if len([]rune(tag)) < 2 || len([]rune(tag)) > 30 {
			continue
		}
		if _, duplicate := seen[tag]; duplicate {
			continue
		}
		seen[tag] = struct{}{}
		tags = append(tags, tag)
		if len(tags) == 5 {
			break
		}
	}
	return tags
}

func peertubeCommentsPolicy(settings map[string]interface{}) int {
	switch strings.ToLower(settingString(settings, "comments_policy")) {
	case "disabled":
		return peertubeCommentsDisabled
	case "approval", "requires_approval":
		return peertubeCommentsRequiresApproval
	case "enabled":
		return peertubeCommentsEnabled
	default:
		return 0
	}
}

// UploadMediaResumable implements the durable resumable path used by media
// workers. The opaque state carries the server upload URL plus thumbnail and
// caption flags; every retry reconciles that URL before sending bytes.
func (p *PeerTubeAdapter) UploadMediaResumable(
	ctx context.Context,
	accessToken, accountID string,
	req UploadMediaRequest,
	state ResumableMediaUploadState,
	checkpoint MediaUploadCheckpoint,
) (string, error) {
	if req.OpenReaderAt == nil {
		return "", fmt.Errorf("peertube resumable upload requires a ranged media reader")
	}
	total := req.Size
	if total <= 0 {
		return "", fmt.Errorf("peertube resumable upload requires a known non-empty video size")
	}
	channel := peertubeChannelForRequest(accountID, req.Settings)
	if channel == "" {
		return "", fmt.Errorf("peertube resumable upload requires a channel in settings")
	}
	channelID, err := p.resolveChannelID(ctx, accessToken, channel)
	if err != nil {
		return "", err
	}
	metadata, err := peertubeUploadMetadata(req, channelID)
	if err != nil {
		return "", err
	}
	if state.ProviderMediaID != "" {
		return state.ProviderMediaID, nil
	}
	session, err := decodePeerTubeUploadSession(state.OpaqueState)
	if err != nil {
		return "", err
	}
	state.TotalBytes = total
	if checkpoint == nil {
		checkpoint = func(ResumableMediaUploadState) error { return nil }
	}
	return p.runPeerTubeUploadWithCheckpoint(ctx, accessToken, req, metadata, total, state, session, checkpoint)
}

func decodePeerTubeUploadSession(opaque string) (peertubeUploadSession, error) {
	if strings.TrimSpace(opaque) == "" {
		return peertubeUploadSession{}, nil
	}
	var session peertubeUploadSession
	if err := json.Unmarshal([]byte(opaque), &session); err != nil {
		return peertubeUploadSession{}, &MediaUploadError{
			RetryClassification: MediaRetryTerminal,
			Err:                 fmt.Errorf("decoding peertube upload session: %w", err),
		}
	}
	return session, nil
}

func encodePeerTubeUploadSession(session peertubeUploadSession) (string, error) {
	encoded, err := json.Marshal(session)
	if err != nil {
		return "", fmt.Errorf("encoding peertube upload session: %w", err)
	}
	return string(encoded), nil
}

func (p *PeerTubeAdapter) runPeerTubeUpload(
	ctx context.Context,
	accessToken string,
	req UploadMediaRequest,
	metadata map[string]any,
	total int64,
	state ResumableMediaUploadState,
	session peertubeUploadSession,
) (string, error) {
	return p.runPeerTubeUploadWithCheckpoint(ctx, accessToken, req, metadata, total, state, session, func(ResumableMediaUploadState) error {
		return nil
	})
}

func (p *PeerTubeAdapter) runPeerTubeUploadWithCheckpoint(
	ctx context.Context,
	accessToken string,
	req UploadMediaRequest,
	metadata map[string]any,
	total int64,
	state ResumableMediaUploadState,
	session peertubeUploadSession,
	checkpoint MediaUploadCheckpoint,
) (string, error) {
	mimeType := firstNonEmptyString(req.MimeType, videoTypeMP4)
	if session.UploadURL == "" {
		uploadURL, existed, err := p.initPeerTubeUpload(ctx, accessToken, metadata, total, mimeType)
		if err != nil {
			return "", err
		}
		if existed {
			return "", &MediaUploadError{
				RetryClassification: MediaRetryTerminal,
				Err:                 fmt.Errorf("peertube reports this file was already uploaded"),
			}
		}
		session.UploadURL = uploadURL
		state.Status = MediaUploadUploading
		state.UploadedBytes = 0
		state.RetryClassification = MediaRetrySafeResume
		if encoded, err := encodePeerTubeUploadSession(session); err == nil {
			state.OpaqueState = encoded
			state.LastCheckedAt = time.Now().UTC()
			if err := checkpoint(state); err != nil {
				return "", err
			}
		}
	}
	uuid, err := p.sendPeerTubeChunks(ctx, accessToken, session.UploadURL, total, req.OpenReaderAt, &state, checkpoint)
	if err != nil {
		return "", err
	}
	state.ProviderMediaID = uuid
	state.Status = MediaUploadUploaded
	state.RetryClassification = MediaRetryReconcile
	if encoded, err := encodePeerTubeUploadSession(session); err == nil {
		state.OpaqueState = encoded
		state.LastCheckedAt = time.Now().UTC()
		if err := checkpoint(state); err != nil {
			return "", err
		}
	}
	if err := p.finalizePeerTubeUpload(ctx, accessToken, uuid, req, &session, &state, checkpoint); err != nil {
		return "", err
	}
	return uuid, nil
}

func (p *PeerTubeAdapter) initPeerTubeUpload(ctx context.Context, accessToken string, metadata map[string]any, total int64, mimeType string) (string, bool, error) {
	payload, err := json.Marshal(metadata)
	if err != nil {
		return "", false, fmt.Errorf("encoding peertube upload metadata: %w", err)
	}
	headers := peertubeAuthHeaders(accessToken)
	headers["X-Upload-Content-Length"] = strconv.FormatInt(total, 10)
	headers["X-Upload-Content-Type"] = mimeType
	headers[headerContentType] = contentTypeJSON
	resp, err := peertubeRawRequest(ctx, http.MethodPost, p.instanceURL+"/api/v1/videos/upload-resumable", headers, bytes.NewReader(payload))
	if err != nil {
		return "", false, err
	}
	location := strings.TrimSpace(resp.header.Get("Location"))
	switch resp.status {
	case http.StatusCreated:
		if location == "" {
			return "", false, &MediaUploadError{RetryClassification: MediaRetryTerminal, Err: fmt.Errorf("peertube upload init returned no upload url")}
		}
		return resolvePeerTubeUploadURL(p.instanceURL, location), false, nil
	case http.StatusOK:
		// The server already holds this file; without an upload URL to
		// resume against, the safe outcome is a terminal error rather than
		// a blind re-upload that could duplicate the video.
		if location != "" {
			return resolvePeerTubeUploadURL(p.instanceURL, location), true, nil
		}
		return "", true, nil
	default:
		return "", false, peertubeUploadError(resp.status, resp.body, "peertube upload init")
	}
}

func resolvePeerTubeUploadURL(instanceURL, location string) string {
	if strings.HasPrefix(location, "http://") || strings.HasPrefix(location, "https://") {
		return location
	}
	if !strings.HasPrefix(location, "/") {
		location = "/" + location
	}
	return strings.TrimRight(instanceURL, "/") + location
}

func (p *PeerTubeAdapter) sendPeerTubeChunks(
	ctx context.Context,
	accessToken, uploadURL string,
	total int64,
	openReaderAt func(int64) (io.ReadCloser, error),
	state *ResumableMediaUploadState,
	checkpoint MediaUploadCheckpoint,
) (string, error) {
	offset := state.UploadedBytes
	buffer := make([]byte, peertubeUploadChunkSize)
	for offset < total {
		end := offset + peertubeUploadChunkSize
		if end > total {
			end = total
		}
		headers := peertubeAuthHeaders(accessToken)
		headers["Content-Type"] = contentTypeOctet
		headers["Content-Range"] = fmt.Sprintf("bytes %d-%d/%d", offset, end-1, total)
		reader, err := openReaderAt(offset)
		if err != nil {
			return "", fmt.Errorf("opening peertube media at byte %d: %w", offset, err)
		}
		_, readErr := io.ReadFull(reader, buffer[:end-offset])
		closeErr := reader.Close()
		if readErr != nil {
			return "", fmt.Errorf("reading peertube media at byte %d: %w", offset, readErr)
		}
		if closeErr != nil {
			return "", fmt.Errorf("closing peertube media at byte %d: %w", offset, closeErr)
		}
		resp, err := peertubeRawRequest(ctx, http.MethodPut, uploadURL, headers, bytes.NewReader(buffer[:end-offset]))
		if err != nil {
			return "", err
		}
		switch resp.status {
		case http.StatusOK:
			uuid, err := peertubeUploadResponseUUID(resp.body)
			if err != nil {
				return "", err
			}
			state.UploadedBytes = total
			return uuid, nil
		case 308:
			next, err := parsePeerTubeRangeHeader(resp.header.Get("Range"))
			if err != nil {
				return "", err
			}
			if next <= offset {
				return "", &MediaUploadError{RetryClassification: MediaRetryTerminal, Err: fmt.Errorf("peertube upload made no progress")}
			}
			offset = next
			state.UploadedBytes = offset
			state.LastCheckedAt = time.Now().UTC()
			if err := checkpoint(*state); err != nil {
				return "", err
			}
		case http.StatusNotFound, http.StatusGone:
			return "", &MediaUploadError{RetryClassification: MediaRetrySafeResume, Err: fmt.Errorf("peertube upload session expired")}
		case http.StatusConflict:
			return "", &MediaUploadError{RetryClassification: MediaRetrySafeResume, Err: fmt.Errorf("peertube upload offset mismatch")}
		default:
			return "", peertubeUploadError(resp.status, resp.body, "peertube upload chunk")
		}
	}
	return "", &MediaUploadError{RetryClassification: MediaRetryTerminal, Err: fmt.Errorf("peertube upload ended without a video id")}
}

func peertubeUploadResponseUUID(body []byte) (string, error) {
	var result struct {
		Video struct {
			UUID string `json:"uuid"`
			ID   int64  `json:"id"`
		} `json:"video"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", &MediaUploadError{RetryClassification: MediaRetryReconcile, Err: fmt.Errorf("decoding peertube upload response: %w", err)}
	}
	if strings.TrimSpace(result.Video.UUID) == "" {
		return "", &MediaUploadError{RetryClassification: MediaRetryReconcile, Err: fmt.Errorf("peertube upload response missing video id")}
	}
	return result.Video.UUID, nil
}

func parsePeerTubeRangeHeader(value string) (int64, error) {
	value = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(value), "bytes="))
	parts := strings.Split(value, "-")
	if len(parts) != 2 {
		return 0, &MediaUploadError{RetryClassification: MediaRetrySafeResume, Err: fmt.Errorf("invalid peertube upload range %q", value)}
	}
	last, err := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64)
	if err != nil || last < 0 {
		return 0, &MediaUploadError{RetryClassification: MediaRetrySafeResume, Err: fmt.Errorf("invalid peertube upload range %q", value)}
	}
	return last + 1, nil
}

// finalizePeerTubeUpload applies the thumbnail and captions after the bytes
// land. Each step flips a durable flag so retries never re-apply them.
func (p *PeerTubeAdapter) finalizePeerTubeUpload(
	ctx context.Context,
	accessToken, uuid string,
	req UploadMediaRequest,
	session *peertubeUploadSession,
	state *ResumableMediaUploadState,
	checkpoint MediaUploadCheckpoint,
) error {
	if err := p.finalizePeerTubeThumbnail(ctx, accessToken, uuid, req, session, state, checkpoint); err != nil {
		return err
	}
	return p.finalizePeerTubeCaption(ctx, accessToken, uuid, req, session, state, checkpoint)
}

func (p *PeerTubeAdapter) finalizePeerTubeThumbnail(ctx context.Context, accessToken, uuid string, req UploadMediaRequest, session *peertubeUploadSession, state *ResumableMediaUploadState, checkpoint MediaUploadCheckpoint) error {
	if req.ThumbnailReader == nil || session.ThumbnailApplied {
		return nil
	}
	thumbnail, err := io.ReadAll(req.ThumbnailReader)
	if err != nil {
		return fmt.Errorf("reading peertube thumbnail: %w", err)
	}
	if len(thumbnail) > 0 {
		if err := p.uploadPeerTubeThumbnail(ctx, accessToken, uuid, thumbnail, req); err != nil {
			return err
		}
	}
	session.ThumbnailApplied = true
	return checkpointPeerTubeFinalization(*session, state, checkpoint)
}

func (p *PeerTubeAdapter) finalizePeerTubeCaption(ctx context.Context, accessToken, uuid string, req UploadMediaRequest, session *peertubeUploadSession, state *ResumableMediaUploadState, checkpoint MediaUploadCheckpoint) error {
	if req.CaptionReader == nil || session.CaptionApplied {
		return nil
	}
	caption, err := io.ReadAll(req.CaptionReader)
	if err != nil {
		return fmt.Errorf("reading peertube captions: %w", err)
	}
	if len(caption) > 0 {
		language := firstNonEmptyString(settingString(req.Settings, "caption_language"), "en")
		if err := p.uploadPeerTubeCaption(ctx, accessToken, uuid, language, caption, req); err != nil {
			return err
		}
	}
	session.CaptionApplied = true
	return checkpointPeerTubeFinalization(*session, state, checkpoint)
}

func checkpointPeerTubeFinalization(session peertubeUploadSession, state *ResumableMediaUploadState, checkpoint MediaUploadCheckpoint) error {
	encoded, err := encodePeerTubeUploadSession(session)
	if err != nil {
		return err
	}
	state.OpaqueState = encoded
	state.LastCheckedAt = time.Now().UTC()
	return checkpoint(*state)
}

func (p *PeerTubeAdapter) uploadPeerTubeThumbnail(ctx context.Context, accessToken, uuid string, thumbnail []byte, req UploadMediaRequest) error {
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("thumbnailfile", firstNonEmptyString(req.ThumbnailFilename, "thumbnail.jpg"))
	if err != nil {
		return fmt.Errorf("building peertube thumbnail upload: %w", err)
	}
	if _, err := part.Write(thumbnail); err != nil {
		return fmt.Errorf("building peertube thumbnail upload: %w", err)
	}
	if err := writer.Close(); err != nil {
		return fmt.Errorf("building peertube thumbnail upload: %w", err)
	}
	headers := peertubeAuthHeaders(accessToken)
	headers[headerContentType] = writer.FormDataContentType()
	resp, err := peertubeRawRequest(ctx, http.MethodPut, p.instanceURL+"/api/v1/videos/"+url.PathEscape(uuid), headers, &buf)
	if err != nil {
		return err
	}
	if resp.status < 200 || resp.status >= 300 {
		return peertubeUploadError(resp.status, resp.body, "peertube thumbnail upload")
	}
	return nil
}

func (p *PeerTubeAdapter) uploadPeerTubeCaption(ctx context.Context, accessToken, uuid, language string, caption []byte, req UploadMediaRequest) error {
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	if err := writer.WriteField("language", language); err != nil {
		return fmt.Errorf("building peertube caption upload: %w", err)
	}
	part, err := writer.CreateFormFile("captionfile", firstNonEmptyString(req.CaptionFilename, "captions.vtt"))
	if err != nil {
		return fmt.Errorf("building peertube caption upload: %w", err)
	}
	if _, err := part.Write(caption); err != nil {
		return fmt.Errorf("building peertube caption upload: %w", err)
	}
	if err := writer.Close(); err != nil {
		return fmt.Errorf("building peertube caption upload: %w", err)
	}
	headers := peertubeAuthHeaders(accessToken)
	headers[headerContentType] = writer.FormDataContentType()
	resp, err := peertubeRawRequest(ctx, http.MethodPost, p.instanceURL+"/api/v1/videos/"+url.PathEscape(uuid)+"/captions", headers, &buf)
	if err != nil {
		return err
	}
	if resp.status < 200 || resp.status >= 300 {
		return peertubeUploadError(resp.status, resp.body, "peertube caption upload")
	}
	return nil
}
