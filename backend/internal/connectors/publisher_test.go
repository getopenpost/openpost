package connectors

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

func TestPublisherEntersWriteFenceBeforeConnectorMutation(t *testing.T) {
	t.Parallel()

	var fenceEntered atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		require.True(t, fenceEntered.Load(), "write fence must be durable before the connector receives the request")
		response.Header().Set("Content-Type", "application/json")
		require.NoError(t, json.NewEncoder(response).Encode(PublishResponse{
			Status: "published", ExternalID: "directus-item-42", ExternalURL: "https://cms.example/items/42",
		}))
	}))
	defer server.Close()
	client := newPrivateTestClient(t, server.URL)
	publisher := NewPublisher(client, "directus/posts", "directus-items-v1")
	req := &platform.PublishRequest{
		OperationID: "authorization:one:rendition:publish", OutputProfile: "directus.item",
		Content: "Published through a connector", Settings: map[string]any{"status": "published"},
	}
	var checkpoint platform.PublishResult
	req.SetWriteFence(func(prepared platform.PublishResult) error {
		fenceEntered.Store(true)
		require.Equal(t, platform.PublishRetryReconcileOnly, prepared.RetrySafety)
		require.Equal(t, req.OperationID, prepared.ProviderReference)
		return nil
	}, func(result platform.PublishResult) error {
		checkpoint = result
		return nil
	})

	result, err := publisher.Publish(context.Background(), "", "posts", req)
	require.NoError(t, err)
	require.Equal(t, platform.PublishSubmissionAccepted, result.SubmissionState)
	require.Equal(t, "directus-item-42", result.ExternalID)
	require.Equal(t, result, checkpoint)
}

func TestPublisherMapsPendingResponseToReconciliation(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		require.NoError(t, json.NewEncoder(response).Encode(PublishResponse{
			Status: "pending", ProviderReference: "directus-job-8", PollAfterSeconds: 4,
		}))
	}))
	defer server.Close()
	publisher := NewPublisher(newPrivateTestClient(t, server.URL), "directus/posts", "directus-items-v1")
	req := &platform.PublishRequest{
		OperationID: "authorization:one:rendition:publish", OutputProfile: "directus.item", Content: "Pending",
	}
	req.SetWriteFence(func(platform.PublishResult) error { return nil }, func(platform.PublishResult) error { return nil })

	result, err := publisher.Publish(context.Background(), "", "posts", req)
	require.NoError(t, err)
	require.Equal(t, platform.PublishSubmissionPending, result.SubmissionState)
	require.Equal(t, req.OperationID, result.ProviderReference)
	require.Equal(t, "directus-job-8", result.ProviderState)
	require.Equal(t, platform.PublishRetryReconcileOnly, result.RetrySafety)
}

func TestPublisherUsesOperationIDForReadOnlyReconciliation(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		require.Equal(t, "/v1/operations/authorization:one:rendition:publish", request.URL.Path)
		response.Header().Set("Content-Type", "application/json")
		require.NoError(t, json.NewEncoder(response).Encode(PublishResponse{
			Status: "published", ExternalID: "directus-item-42",
		}))
	}))
	defer server.Close()
	publisher := NewPublisher(newPrivateTestClient(t, server.URL), "directus/posts", "directus-items-v1")

	result, err := publisher.ReconcilePublish(context.Background(), "", "posts", "authorization:one:rendition:publish")
	require.NoError(t, err)
	require.Equal(t, platform.PublishSubmissionAccepted, result.SubmissionState)
	require.Equal(t, "directus-item-42", result.ExternalID)
}
