package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func (x *XAdapter) UploadMediaResumable(ctx context.Context, token, _ string, req UploadMediaRequest, state ResumableMediaUploadState, checkpoint MediaUploadCheckpoint) (mediaID string, uploadErr error) {
	defer func() { uploadErr = classifyXMediaUploadError(uploadErr, state) }()
	if checkpoint == nil {
		return "", fmt.Errorf("x media checkpoint is required")
	}
	if req.Size <= 0 || req.Reader == nil {
		return "", fmt.Errorf("x media requires a reader and known size")
	}
	if err := validateXMediaCheckpoint(state, req.Size); err != nil {
		return "", err
	}
	if state.Status == MediaUploadReady && state.ProviderMediaID != "" {
		return state.ProviderMediaID, nil
	}
	category := xMediaCategory(req.MimeType)
	if state.ProviderMediaID == "" && category == "tweet_image" && req.Size <= xMediaUploadChunkSize {
		var err error
		state, err = x.uploadSimpleMediaRequest(ctx, token, req)
		if err != nil {
			return "", err
		}
		if err := checkpoint(state); err != nil {
			return "", err
		}
		return state.ProviderMediaID, nil
	}
	source, err := openXMediaSource(req, state)
	if err != nil {
		return "", err
	}
	defer source.Close()
	return x.uploadMediaChunkedResumable(ctx, token, req.MimeType, category, source, req.Size, state, func(next ResumableMediaUploadState) error { state = next; return checkpoint(next) })
}

func classifyXMediaUploadError(err error, state ResumableMediaUploadState) error {
	if err == nil || state.ProviderMediaID != "" {
		return err
	}
	var mediaErr *MediaUploadError
	if errors.As(err, &mediaErr) {
		return err
	}
	var providerErr *HTTPError
	if errors.As(err, &providerErr) && (providerErr.StatusCode == 402 || providerErr.StatusCode == 429 || providerErr.StatusCode >= 500) {
		return &MediaUploadError{RetryClassification: MediaRetrySafeResume, Err: err}
	}
	return err
}

func validateXMediaCheckpoint(state ResumableMediaUploadState, size int64) error {
	if state.ProviderMediaID == "" {
		return nil
	}
	if !state.SessionExpiresAt.IsZero() && !time.Now().UTC().Before(state.SessionExpiresAt) {
		return &MediaUploadError{RetryClassification: MediaRetryTerminal, Err: fmt.Errorf("x media upload expired")}
	}
	if state.Status == MediaUploadReady {
		return nil
	}
	if state.TotalBytes != size || state.UploadedBytes < 0 || state.UploadedBytes > size {
		return &MediaUploadError{RetryClassification: MediaRetryTerminal, Err: fmt.Errorf("x media checkpoint does not match its source")}
	}
	switch state.OpaqueState {
	case "appending", "append_started", "finalizing", "processing":
		return nil
	default:
		return &MediaUploadError{RetryClassification: MediaRetryTerminal, Err: fmt.Errorf("unsupported X media checkpoint")}
	}
}

func xMediaCategory(mimeType string) string {
	if isVideoMime(mimeType) {
		return "tweet_video"
	}
	if strings.EqualFold(strings.TrimSpace(mimeType), "image/gif") {
		return "tweet_gif"
	}
	return "tweet_image"
}
func openXMediaSource(req UploadMediaRequest, state ResumableMediaUploadState) (io.ReadCloser, error) {
	if state.ProviderMediaID == "" || state.OpaqueState != "appending" || state.UploadedBytes == 0 {
		return io.NopCloser(req.Reader), nil
	}
	if req.OpenReaderAt == nil {
		return nil, fmt.Errorf("x upload resume requires a reader at its byte offset")
	}
	return req.OpenReaderAt(state.UploadedBytes)
}
func (x *XAdapter) uploadSimpleMediaRequest(ctx context.Context, token string, req UploadMediaRequest) (ResumableMediaUploadState, error) {
	data, err := io.ReadAll(io.LimitReader(req.Reader, req.Size+1))
	if err != nil {
		return ResumableMediaUploadState{}, err
	}
	if int64(len(data)) != req.Size {
		return ResumableMediaUploadState{}, fmt.Errorf("x image size changed before upload")
	}
	return x.uploadMediaSimpleResult(ctx, token, data, "tweet_image")
}

func (x *XAdapter) resumeMediaProcessing(ctx context.Context, token string, state ResumableMediaUploadState) (string, error) {
	info, err := x.mediaProcessingStatus(ctx, token, state.ProviderMediaID)
	if err != nil {
		return "", err
	}
	if info == nil || (state.OpaqueState == "append_started" && info.State != "succeeded") {
		return "", &MediaUploadError{RetryClassification: MediaRetryReconcile, Err: fmt.Errorf("x media operation remains unresolved")}
	}
	if err := x.waitForMediaProcessing(ctx, token, state.ProviderMediaID, info); err != nil {
		return "", err
	}
	return state.ProviderMediaID, nil
}

func (x *XAdapter) mediaProcessingStatus(ctx context.Context, token, mediaID string) (*xMediaProcessingInfo, error) {
	endpoint := x.uploadURL("/1.1/media/upload.json") + "?command=STATUS&media_id=" + url.QueryEscape(mediaID)
	body, err := x.doSignedRequest(ctx, token, http.MethodGet, endpoint, nil, nil)
	if err != nil {
		return nil, fmt.Errorf("x media status: %w", err)
	}
	var response struct {
		ProcessingInfo *xMediaProcessingInfo `json:"processing_info"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, err
	}
	return response.ProcessingInfo, nil
}

var _ ResumableMetadataMediaUploader = (*XAdapter)(nil)

func (x *XAdapter) initChunkedMedia(ctx context.Context, accessToken, mimeType, mediaCategory string, totalBytes int64, checkpoint MediaUploadCheckpoint) (ResumableMediaUploadState, error) {
	var state ResumableMediaUploadState
	initValues := url.Values{}
	initValues.Set("command", "INIT")
	initValues.Set("total_bytes", strconv.FormatInt(totalBytes, 10))
	initValues.Set("media_type", mimeType)
	initValues.Set("media_category", mediaCategory)

	respBody, err := x.doSignedRequest(ctx, accessToken, "POST", x.uploadURL("/1.1/media/upload.json"), strings.NewReader(initValues.Encode()), map[string]string{
		headerContentType: contentTypeForm,
	})
	if err != nil {
		return ResumableMediaUploadState{}, fmt.Errorf("x INIT failed: %w", err)
	}

	var initResp struct {
		MediaIDString    string                `json:"media_id_string"`
		ExpiresAfterSecs int                   `json:"expires_after_secs"`
		ProcessingInfo   *xMediaProcessingInfo `json:"processing_info"`
	}
	if unmarshalErr := json.Unmarshal(respBody, &initResp); unmarshalErr != nil {
		return ResumableMediaUploadState{}, fmt.Errorf("decoding X INIT: %w", unmarshalErr)
	}
	if initResp.MediaIDString == "" {
		return ResumableMediaUploadState{}, fmt.Errorf("missing media_id_string in X INIT")
	}
	mediaID := initResp.MediaIDString
	state.ProviderMediaID = mediaID
	state.TotalBytes = totalBytes
	state.Status = MediaUploadUploading
	state.RetryClassification = MediaRetrySafeResume
	state.OpaqueState = "appending"
	if initResp.ExpiresAfterSecs > 0 {
		state.SessionExpiresAt = time.Now().UTC().Add(time.Duration(initResp.ExpiresAfterSecs) * time.Second)
	}
	if err := checkpoint(state); err != nil {
		return ResumableMediaUploadState{}, err
	}
	return state, nil
}

func (x *XAdapter) appendMediaChunks(ctx context.Context, accessToken string, reader io.Reader, state ResumableMediaUploadState, checkpoint MediaUploadCheckpoint) (ResumableMediaUploadState, error) {
	segmentIndex := int(state.UploadedBytes / xMediaUploadChunkSize)
	remaining := state.TotalBytes - state.UploadedBytes
	chunk := make([]byte, xMediaUploadChunkSize)
	for remaining > 0 {
		chunkBytes := int64(len(chunk))
		if remaining < chunkBytes {
			chunkBytes = remaining
		}
		n, readErr := io.ReadFull(reader, chunk[:chunkBytes])
		if readErr != nil {
			return state, fmt.Errorf("reading X media segment %d: %w", segmentIndex, readErr)
		}

		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		_ = writer.WriteField("command", "APPEND")
		_ = writer.WriteField("media_id", state.ProviderMediaID)
		_ = writer.WriteField("segment_index", strconv.Itoa(segmentIndex))
		part, createErr := writer.CreateFormFile("media", "chunk.bin")
		if createErr != nil {
			return state, fmt.Errorf("x APPEND create form file: %w", createErr)
		}
		if _, writeErr := part.Write(chunk[:n]); writeErr != nil {
			return state, fmt.Errorf("x APPEND write segment %d: %w", segmentIndex, writeErr)
		}
		if closeErr := writer.Close(); closeErr != nil {
			return state, fmt.Errorf("x APPEND close writer: %w", closeErr)
		}

		state.OpaqueState = "append_started"
		state.RetryClassification = MediaRetryReconcile
		if err := checkpoint(state); err != nil {
			return state, err
		}
		_, err := x.doSignedRequest(ctx, accessToken, "POST", x.uploadURL("/1.1/media/upload.json"), &body, map[string]string{
			headerContentType: writer.FormDataContentType(),
		})
		if err != nil {
			return state, fmt.Errorf("x APPEND segment %d: %w", segmentIndex, err)
		}
		segmentIndex++
		remaining -= int64(n)
		state.UploadedBytes += int64(n)
		state.OpaqueState = "appending"
		state.RetryClassification = MediaRetrySafeResume
		if err := checkpoint(state); err != nil {
			return state, err
		}
	}

	return state, nil
}
