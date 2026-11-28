package publisher

import (
	"context"
	"fmt"
	"io"
	"log"
	"path/filepath"
	"strings"
	"time"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/openpost/backend/internal/services/publicationauth"
	"github.com/openpost/backend/internal/textutil"
)

// writeReadiness is the readiness evidence resolved once per destination. Every
// provider write rechecks the live account against it, so write-time checks use
// the same policy mode as the authorization snapshot instead of re-deriving it
// from per-segment or per-reply settings.
type writeReadiness struct {
	connectorBacked bool
	capability      capabilities.Capability
	policyMode      string
	operation       providerreadiness.Operation
	intent          providerreadiness.ExecutionIntent
}

type providerWriteScope struct {
	operationID     string
	authorizationID string
	publicationID   string
	renditionID     string
	socialAccountID string
	targetKey       string
	operation       string
	contentHash     string
	mediaHash       string
	settingsHash    string
	readiness       *writeReadiness
}

func publicationWriteScope(authorization *models.PublicationAuthorization, subject, operation string) providerWriteScope {
	if authorization == nil {
		return providerWriteScope{operation: operation}
	}
	return providerWriteScope{
		operationID:     strings.Join([]string{"authorization", authorization.ID, subject, operation}, ":"),
		authorizationID: authorization.ID,
		publicationID:   authorization.PublicationID,
		renditionID:     authorization.RenditionID,
		socialAccountID: authorization.SocialAccountID,
		targetKey:       authorization.TargetKey,
		operation:       operation,
		contentHash:     authorization.ContentHash,
		mediaHash:       authorization.MediaHash,
		settingsHash:    authorization.SettingsHash,
	}
}

func publisherReadinessIntent(raw string) providerreadiness.ExecutionIntent {
	if providerreadiness.ExecutionIntent(strings.TrimSpace(raw)) == providerreadiness.ExecutionIntentCertificationTest {
		return providerreadiness.ExecutionIntentCertificationTest
	}
	return providerreadiness.ExecutionIntentProduction
}

func (s *Service) publishProvider(
	ctx context.Context,
	provider platform.Publisher,
	token, accountID string,
	req *platform.PublishRequest,
	media []models.MediaAttachment,
) (platform.PublishResult, error) {
	direct, ok := provider.(platform.DirectMediaPublisher)
	if !ok || len(media) == 0 {
		return provider.Publish(ctx, token, accountID, req)
	}
	if s.storage == nil {
		return platform.PublishResult{}, fmt.Errorf("media storage is not configured")
	}
	inputs := make([]platform.UploadMediaRequest, 0, len(media))
	readers := make([]io.ReadCloser, 0, len(media))
	defer func() {
		for _, reader := range readers {
			_ = reader.Close()
		}
	}()
	for _, item := range media {
		reader, err := s.storage.Open(ctx, filepath.Base(item.FilePath))
		if err != nil {
			return platform.PublishResult{}, fmt.Errorf("opening media file %s: %w", item.FilePath, err)
		}
		readers = append(readers, reader)
		inputs = append(inputs, platform.UploadMediaRequest{
			MimeType:   item.MimeType,
			Filename:   textutil.FirstNonEmptyRaw(item.OriginalFilename, filepath.Base(item.FilePath)),
			Size:       item.Size,
			Reader:     reader,
			Width:      item.Width,
			Height:     item.Height,
			DurationMS: item.DurationMS,
		})
	}
	return direct.PublishWithMedia(ctx, token, accountID, req, inputs)
}

func (s *Service) publishProviderWithUsage(
	ctx context.Context,
	workspaceID, providerName, subject, phase string,
	writeScope providerWriteScope,
	provider platform.Publisher,
	token, accountID string,
	req *platform.PublishRequest,
	media []models.MediaAttachment,
) (platform.PublishResult, error) {
	if writeScope.operationID == "" || writeScope.socialAccountID == "" || writeScope.targetKey == "" {
		return platform.PublishResult{}, fmt.Errorf("provider write ownership is required")
	}
	fingerprint, err := providerPublishFingerprint(writeScope, req, media)
	if err != nil {
		return platform.PublishResult{}, err
	}
	execution, _ := providerwrite.JobExecutionFromContext(ctx)
	input := providerwrite.Input{
		OperationID: writeScope.operationID, JobID: execution.ID,
		AuthorizationID: writeScope.authorizationID, WorkspaceID: workspaceID,
		PublicationID: writeScope.publicationID, RenditionID: writeScope.renditionID,
		SocialAccountID: writeScope.socialAccountID, TargetKey: writeScope.targetKey,
		Provider: providerName, Operation: writeScope.operation,
		PayloadFingerprint: fingerprint,
	}
	// dispatch performs one admitted provider call. Readiness and quota are
	// rechecked immediately before every send, including resumed sends.
	dispatch := func(dispatchCtx context.Context, control *providerwrite.Control, dispatchPhase string, call func(*platform.PublishRequest) (platform.PublishResult, error)) (platform.PublishResult, error) {
		if readinessErr := s.requireProviderWriteReadiness(dispatchCtx, workspaceID, providerName, writeScope); readinessErr != nil {
			return platform.PublishResult{}, readinessErr
		}
		reservation, reserveErr := s.reserveProviderDispatch(dispatchCtx, workspaceID, providerName, subject, dispatchPhase, writeScope, req)
		if reserveErr != nil {
			return platform.PublishResult{}, reserveErr
		}
		requestCopy := *req
		control.BindPublishRequest(&requestCopy)
		result, callErr := call(&requestCopy)
		s.settleProviderPublishCost(dispatchCtx, reservation, callErr)
		return result, callErr
	}
	send := func(sendCtx context.Context, control *providerwrite.Control) (platform.PublishResult, error) {
		return dispatch(sendCtx, control, phase, func(request *platform.PublishRequest) (platform.PublishResult, error) {
			return s.publishProvider(sendCtx, provider, token, accountID, request, media)
		})
	}
	var reconcile providerwrite.ReconcileFunc
	if reconciler, ok := provider.(platform.PublishRequestReconciler); ok {
		reconcile = func(reconcileCtx context.Context, reference string) (platform.PublishResult, error) {
			requestCopy := *req
			return reconciler.ReconcilePublishRequest(reconcileCtx, token, accountID, &requestCopy, reference)
		}
	} else if reconciler, ok := provider.(platform.PublishReconciler); ok {
		reconcile = func(reconcileCtx context.Context, reference string) (platform.PublishResult, error) {
			return reconciler.ReconcilePublish(reconcileCtx, token, accountID, reference)
		}
	}
	var resume providerwrite.ResumeFunc
	if resumer, ok := provider.(platform.PublishResumer); ok {
		resume = func(resumeCtx context.Context, control *providerwrite.Control, reference string) (platform.PublishResult, error) {
			return dispatch(resumeCtx, control, phase+"-resume", func(request *platform.PublishRequest) (platform.PublishResult, error) {
				return resumer.ResumePublish(resumeCtx, token, accountID, request, reference)
			})
		}
	}
	result, err := providerwrite.New(s.db).Execute(ctx, input, send, reconcile, resume)
	settleCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if settleErr := s.settleProviderUsage(settleCtx, workspaceID, writeScope); settleErr != nil {
		log.Printf("[Publisher] monthly usage settlement failed; reservation retained: %v", settleErr)
	}
	return result, err
}

// requireProviderWriteReadiness is the late fence before each provider call. It
// reloads the account inside its workspace so a destination moved, disabled,
// or degraded during a long thread stops before its next write.
func (s *Service) requireProviderWriteReadiness(
	ctx context.Context,
	workspaceID, providerName string,
	writeScope providerWriteScope,
) error {
	if s == nil || s.readiness == nil {
		return &providerreadiness.NotReadyError{
			Decision: providerreadiness.UnavailableDecision(providerreadiness.OperationPublishImmediate),
		}
	}
	if writeScope.readiness == nil {
		return fmt.Errorf("provider write readiness is required")
	}
	if writeScope.publicationID != "" {
		if err := publicationauth.RequireReview(ctx, s.db, writeScope.publicationID); err != nil {
			return err
		}
	}
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).
		Where("id = ?", writeScope.socialAccountID).
		Where("workspace_id = ?", workspaceID).
		Where("platform = ?", providerName).
		Scan(ctx); err != nil {
		return fmt.Errorf("loading provider readiness account: %w", err)
	}
	return s.decideWriteReadiness(ctx, account, *writeScope.readiness)
}

func (s *Service) decideWriteReadiness(ctx context.Context, account models.SocialAccount, readiness writeReadiness) error {
	if readiness.connectorBacked {
		return nil
	}
	if s == nil || s.readiness == nil {
		return &providerreadiness.NotReadyError{
			Decision: providerreadiness.UnavailableDecision(providerreadiness.OperationPublishImmediate),
		}
	}
	decision := s.readiness.DecideAccountPublication(
		ctx, account, readiness.capability, readiness.operation, readiness.intent, readiness.policyMode,
	)
	if !decision.Publishable {
		return &providerreadiness.NotReadyError{Decision: decision}
	}
	return nil
}

type providerPublishLogicalPayload struct {
	AuthorizationID string                            `json:"authorization_id,omitempty"`
	ContentHash     string                            `json:"content_hash,omitempty"`
	MediaHash       string                            `json:"media_hash,omitempty"`
	SettingsHash    string                            `json:"settings_hash,omitempty"`
	Content         string                            `json:"content"`
	Profile         string                            `json:"profile"`
	OutputProfile   string                            `json:"output_profile"`
	Title           string                            `json:"title"`
	Description     string                            `json:"description"`
	ReplyToID       string                            `json:"reply_to_id"`
	SettingsJSON    string                            `json:"settings_json,omitempty"`
	Settings        map[string]interface{}            `json:"settings,omitempty"`
	MediaAltTexts   []string                          `json:"media_alt_texts,omitempty"`
	MediaSettings   []map[string]interface{}          `json:"media_settings,omitempty"`
	Media           []providerPublishMediaFingerprint `json:"media"`
}

type providerPublishMediaFingerprint struct {
	ID               string `json:"id"`
	FileHash         string `json:"file_hash"`
	MimeType         string `json:"mime_type"`
	Size             int64  `json:"size"`
	DurationMS       int64  `json:"duration_ms"`
	OriginalFilename string `json:"original_filename"`
}

func providerPublishFingerprint(
	scope providerWriteScope,
	req *platform.PublishRequest,
	media []models.MediaAttachment,
) (string, error) {
	if req == nil {
		return "", fmt.Errorf("provider publish request is required")
	}
	payload := providerPublishLogicalPayload{
		AuthorizationID: scope.authorizationID,
		ContentHash:     scope.contentHash,
		MediaHash:       scope.mediaHash,
		SettingsHash:    scope.settingsHash,
		Content:         req.Content,
		Profile:         req.Profile,
		OutputProfile:   req.OutputProfile,
		Title:           req.Title,
		Description:     req.Description,
		ReplyToID:       req.ReplyToID,
		Media:           make([]providerPublishMediaFingerprint, 0, len(media)),
	}
	// Authorization receipts already hash the exact logical settings, media,
	// and ordered descriptors. Do not fingerprint hydrated provider URLs here:
	// their short-lived signatures change between safe retries even though the
	// authorized payload did not.
	if scope.authorizationID == "" {
		payload.SettingsJSON = req.SettingsJSON
		payload.Settings = req.Settings
		payload.MediaAltTexts = req.MediaAltTexts
		payload.MediaSettings = req.MediaSettings
	}
	for _, item := range media {
		payload.Media = append(payload.Media, providerPublishMediaFingerprint{
			ID: item.ID, FileHash: item.FileHash, MimeType: item.MimeType,
			Size: item.Size, DurationMS: item.DurationMS,
			OriginalFilename: item.OriginalFilename,
		})
	}
	return providerwrite.Fingerprint("provider-publish-v2", payload)
}
