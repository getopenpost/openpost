package telemetry

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"reflect"
	"strings"
	"time"

	posthog "github.com/posthog/posthog-go"
)

const (
	EventPublicationScheduled   = "publication scheduled"
	EventPublicationQueued      = "publication queued"
	EventRenditionPublished     = "rendition published"
	EventRenditionFailed        = "rendition failed"
	EventBillingCheckoutCreated = "billing checkout created"
)

// Config is the complete server and browser-safe telemetry contract. The project
// token is intentionally browser-safe; personal and project secret keys never
// belong here.
type Config struct {
	Enabled         bool
	ProjectToken    string
	Endpoint        string
	BrowserEndpoint string
	UIHost          string
	Environment     string
	Edition         string
	Version         string
	Revision        string
}

type BrowserConfig struct {
	Enabled      bool   `json:"enabled" doc:"Whether browser telemetry is enabled for this OpenPost instance"`
	ProjectToken string `json:"project_token,omitempty" doc:"Browser-safe PostHog project token"`
	APIHost      string `json:"api_host,omitempty" doc:"PostHog browser ingestion endpoint or proxy"`
	UIHost       string `json:"ui_host,omitempty" doc:"PostHog user interface host used for generated links"`
	Environment  string `json:"environment" doc:"Deployment environment attached to telemetry"`
	Edition      string `json:"edition" doc:"Configured OpenPost edition"`
	Version      string `json:"version" doc:"Running OpenPost version"`
	Revision     string `json:"revision" doc:"Running OpenPost source revision"`
}

type Event struct {
	Name        string
	DistinctID  string
	WorkspaceID string
	UUID        string
	Timestamp   time.Time
	Properties  map[string]any
}

type Exception struct {
	DistinctID  string
	WorkspaceID string
	Title       string
	Description string
	Properties  map[string]any
}

// Recorder is the application-owned telemetry port. Callers do not depend on
// PostHog and tests can use MemoryRecorder without network access.
type Recorder interface {
	Enabled() bool
	PublicConfig() BrowserConfig
	Capture(context.Context, Event) error
	CaptureException(context.Context, Exception) error
	WrapHTTP(http.Handler) http.Handler
	Close() error
}

type postHogRecorder struct {
	client posthog.Client
	config Config
}

type noopRecorder struct {
	config Config
}

func New(config Config) (Recorder, error) {
	config.ProjectToken = strings.TrimSpace(config.ProjectToken)
	config.Endpoint = strings.TrimRight(strings.TrimSpace(config.Endpoint), "/")
	config.BrowserEndpoint = strings.TrimRight(strings.TrimSpace(config.BrowserEndpoint), "/")
	config.UIHost = strings.TrimRight(strings.TrimSpace(config.UIHost), "/")
	config.Environment = strings.TrimSpace(config.Environment)
	if config.Environment == "" {
		config.Environment = "unknown"
	}
	if !config.Enabled {
		return &noopRecorder{config: config}, nil
	}
	if config.ProjectToken == "" {
		return nil, fmt.Errorf("PostHog project token is required when telemetry is enabled")
	}
	if config.Endpoint == "" {
		return nil, fmt.Errorf("PostHog server endpoint is required when telemetry is enabled")
	}
	if config.BrowserEndpoint == "" {
		return nil, fmt.Errorf("PostHog browser endpoint is required when telemetry is enabled")
	}

	client, err := posthog.NewWithConfig(config.ProjectToken, posthog.Config{
		Endpoint:        config.Endpoint,
		DisableGeoIP:    posthog.Ptr(true),
		ShutdownTimeout: 5 * time.Second,
		DefaultEventProperties: posthog.Properties{
			"surface":                 "backend",
			"environment":             config.Environment,
			"edition":                 config.Edition,
			"version":                 config.Version,
			"revision":                config.Revision,
			"service":                 "openpost",
			"$process_person_profile": false,
		},
		Callback: deliveryCallback{},
	})
	if err != nil {
		return nil, fmt.Errorf("initialize PostHog telemetry: %w", err)
	}
	return &postHogRecorder{client: client, config: config}, nil
}

func (r *postHogRecorder) Enabled() bool { return true }
func (r *noopRecorder) Enabled() bool    { return false }

func publicConfig(config Config) BrowserConfig {
	enabled := config.Enabled && config.ProjectToken != "" && config.BrowserEndpoint != ""
	result := BrowserConfig{
		Enabled:     enabled,
		Environment: config.Environment,
		Edition:     config.Edition,
		Version:     config.Version,
		Revision:    config.Revision,
	}
	if enabled {
		result.ProjectToken = config.ProjectToken
		result.APIHost = config.BrowserEndpoint
		result.UIHost = config.UIHost
	}
	return result
}

func (r *postHogRecorder) PublicConfig() BrowserConfig { return publicConfig(r.config) }
func (r *noopRecorder) PublicConfig() BrowserConfig    { return publicConfig(r.config) }

func (r *postHogRecorder) Capture(ctx context.Context, event Event) error {
	if strings.TrimSpace(event.Name) == "" {
		return fmt.Errorf("telemetry event name is required")
	}
	properties := copyProperties(event.Properties)
	if event.WorkspaceID != "" {
		properties["workspace_id"] = event.WorkspaceID
	}
	return posthog.EnqueueWithContext(ctx, r.client, posthog.Capture{
		Uuid:       event.UUID,
		DistinctId: distinctID(event.DistinctID, event.WorkspaceID),
		Event:      event.Name,
		Timestamp:  event.Timestamp,
		Properties: posthog.Properties(properties),
	})
}

func (r *noopRecorder) Capture(context.Context, Event) error { return nil }

func (r *postHogRecorder) CaptureException(ctx context.Context, exception Exception) error {
	title := strings.TrimSpace(exception.Title)
	if title == "" {
		title = "OpenPost error"
	}
	description := strings.TrimSpace(exception.Description)
	if description == "" {
		description = "An OpenPost operation failed"
	}
	message := posthog.NewDefaultException(
		time.Now().UTC(),
		exceptionDistinctID(exception.DistinctID, exception.WorkspaceID),
		title,
		description,
	)
	message.Properties = posthog.Properties(copyProperties(exception.Properties))
	if exception.WorkspaceID != "" {
		message.Properties["workspace_id"] = exception.WorkspaceID
	}
	return posthog.EnqueueWithContext(ctx, r.client, message)
}

func (r *noopRecorder) CaptureException(context.Context, Exception) error { return nil }

func (r *postHogRecorder) WrapHTTP(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if next == nil || request == nil {
			return
		}
		requestContext := posthog.ExtractRequestContext(request, true)
		// OpenPost propagates only the browser identity and session. The SDK's
		// default request metadata includes the concrete path, user agent, and IP;
		// our privacy contract permits only application-owned route templates.
		requestContext.Properties = posthog.NewProperties()
		ctx := posthog.WithFreshRequestContext(request.Context(), requestContext)
		next.ServeHTTP(writer, request.WithContext(ctx))
	})
}

func (r *noopRecorder) WrapHTTP(next http.Handler) http.Handler { return next }

func (r *postHogRecorder) Close() error { return r.client.Close() }
func (r *noopRecorder) Close() error    { return nil }

func distinctID(explicit, workspaceID string) string {
	if explicit = strings.TrimSpace(explicit); explicit != "" {
		return explicit
	}
	if workspaceID = strings.TrimSpace(workspaceID); workspaceID != "" {
		return "workspace:" + workspaceID
	}
	return "openpost-server"
}

func exceptionDistinctID(explicit, workspaceID string) string {
	if explicit = strings.TrimSpace(explicit); explicit != "" {
		return explicit
	}
	if workspaceID = strings.TrimSpace(workspaceID); workspaceID != "" {
		return "workspace:" + workspaceID
	}
	// Empty lets EnqueueWithContext inherit the browser ID. When none is
	// present, posthog-go generates a personless ID for this request.
	return ""
}

func copyProperties(properties map[string]any) map[string]any {
	result := make(map[string]any, len(properties))
	for key, value := range properties {
		result[key] = value
	}
	return result
}

func ErrorType(err error) string {
	if err == nil {
		return ""
	}
	return reflect.TypeOf(err).String()
}

type deliveryCallback struct{}

func (deliveryCallback) Success(posthog.APIMessage) {}

func (deliveryCallback) Failure(message posthog.APIMessage, err error) {
	log.Printf("PostHog delivery failed type=%T error=%v", message, err)
}
