package connectors

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/openpost/backend/internal/platform"
)

type Publisher struct {
	client             *Client
	connectionRef      string
	capabilityRevision string
}

func NewPublisher(client *Client, connectionRef, capabilityRevision string) *Publisher {
	return &Publisher{
		client: client, connectionRef: connectionRef, capabilityRevision: capabilityRevision,
	}
}

func (p *Publisher) Publish(
	ctx context.Context,
	_, _ string,
	request *platform.PublishRequest,
) (platform.PublishResult, error) {
	if p == nil || p.client == nil {
		return platform.PublishResult{}, fmt.Errorf("connector publisher is unavailable")
	}
	if request == nil {
		return platform.PublishResult{}, fmt.Errorf("connector publish request is required")
	}
	prepared := platform.PublishResult{
		SubmissionState:   platform.PublishSubmissionUnknown,
		ProviderState:     "connector_sending",
		ProviderReference: request.OperationID,
		RetrySafety:       platform.PublishRetryReconcileOnly,
	}
	if err := request.BeginWrite(prepared); err != nil {
		return platform.PublishResult{}, err
	}
	response, err := p.client.Publish(ctx, PublishRequest{
		OperationID: request.OperationID, ConnectionRef: p.connectionRef,
		CapabilityRevision: p.capabilityRevision, OutputProfile: request.OutputProfile,
		Content: request.Content, Title: request.Title, Description: request.Description,
		ReplyTo: request.ReplyToID, Settings: request.Settings,
	})
	if err != nil {
		return prepared, connectorPublishError(err)
	}
	result, err := publishResult(response, request.OperationID)
	if err != nil {
		return prepared, err
	}
	if err := request.Checkpoint(result); err != nil {
		return result, err
	}
	return result, nil
}

func (p *Publisher) ReconcilePublish(
	ctx context.Context,
	_, _, operationID string,
) (platform.PublishResult, error) {
	if p == nil || p.client == nil {
		return platform.PublishResult{}, fmt.Errorf("connector publisher is unavailable")
	}
	response, err := p.client.Operation(ctx, operationID)
	if err != nil {
		return platform.PublishResult{}, connectorPublishError(err)
	}
	return publishResult(response, operationID)
}

func publishResult(response PublishResponse, operationID string) (platform.PublishResult, error) {
	result := platform.PublishResult{
		ExternalID: response.ExternalID, ExternalURL: response.ExternalURL,
		IdempotencyTTL: response.IdempotencyDuration(),
	}
	switch response.Status {
	case "published":
		result.SubmissionState = platform.PublishSubmissionAccepted
		result.ProviderState = "published"
		result.ProviderReference = operationID
		result.RetrySafety = platform.PublishRetryNever
	case "pending":
		result.SubmissionState = platform.PublishSubmissionPending
		result.ProviderState = safeProviderState(response.ProviderReference)
		result.ProviderReference = operationID
		result.RetrySafety = platform.PublishRetryReconcileOnly
		result.ReconcileAfter = response.PollAfter()
	default:
		return platform.PublishResult{}, fmt.Errorf("unsupported connector publish status %q", response.Status)
	}
	return result, nil
}

func connectorPublishError(err error) error {
	var connectorErr *HTTPError
	if !errors.As(err, &connectorErr) {
		return err
	}
	code := strings.TrimSpace(connectorErr.Problem.ProviderCode)
	if code == "" {
		code = strings.TrimSpace(connectorErr.Problem.Kind)
	}
	return &platform.HTTPError{
		StatusCode: connectorErr.StatusCode,
		Code:       code,
		RetryAfter: time.Duration(connectorErr.Problem.RetryAfter) * time.Second,
	}
}

func safeProviderState(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 128 {
		value = value[:128]
	}
	return value
}
