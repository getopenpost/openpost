package telemetry

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"reflect"
	"regexp"
	"strings"
	"time"

	posthog "github.com/posthog/posthog-go"
)

const (
	EventPublicationScheduled          = "publication scheduled"
	EventPublicationQueued             = "publication queued"
	EventRenditionPublished            = "rendition published"
	EventRenditionFailed               = "rendition failed"
	EventBillingCheckoutCreated        = "billing checkout created"
	EventSignupCompleted               = "signup completed"
	EventPlanConfirmed                 = "plan confirmed"
	EventWorkspaceCreated              = "workspace created"
	EventCheckoutCompleted             = "checkout completed"
	EventDestinationConnected          = "destination connected"
	EventWorkspaceActivated            = "workspace activated"
	EventGrowthRefreshRequested        = "growth refresh requested"
	EventGrowthRefreshCompleted        = "growth refresh completed"
	EventGrowthRecommendationDismissed = "growth recommendation dismissed"
	EventGrowthFollowRequested         = "growth follow requested"
	EventGrowthFollowSucceeded         = "growth follow succeeded"
	EventGrowthFollowFailed            = "growth follow failed"
)

var eventPropertyAllowlists = map[string]map[string]struct{}{
	EventPublicationScheduled:          propertySet("publication_id", "job_id", "intent", "content_profile", "destination_count"),
	EventPublicationQueued:             propertySet("publication_id", "job_id", "intent", "content_profile", "destination_count"),
	EventRenditionPublished:            propertySet("publication_id", "rendition_id", "platform", "profile", "output_profile", "intent", "content_profile", "segment_count"),
	EventRenditionFailed:               propertySet("publication_id", "rendition_id", "platform", "profile", "output_profile", "intent", "content_profile", "error_kind", "error_code", "http_status", "retryable", "retry"),
	EventBillingCheckoutCreated:        propertySet("checkout_id", "organization_id", "plan_id", "billing_period", "provider"),
	EventSignupCompleted:               propertySet(),
	EventPlanConfirmed:                 propertySet("plan_id", "billing_period"),
	EventWorkspaceCreated:              propertySet(),
	EventCheckoutCompleted:             propertySet("plan_id", "billing_period"),
	EventDestinationConnected:          propertySet("platform", "account_count"),
	EventWorkspaceActivated:            propertySet(),
	EventGrowthRefreshRequested:        propertySet("platform"),
	EventGrowthRefreshCompleted:        propertySet("platform", "recommendation_count"),
	EventGrowthRecommendationDismissed: propertySet("platform", "mutual_count_bucket", "rank_bucket"),
	EventGrowthFollowRequested:         propertySet("platform", "mutual_count_bucket", "rank_bucket"),
	EventGrowthFollowSucceeded:         propertySet("platform", "follow_state"),
	EventGrowthFollowFailed:            propertySet("platform", "follow_state", "error_class"),
}

var firstUsePropertyValues = map[string]map[string]struct{}{
	"plan_id":             propertySet("starter", "founder", "pro", "team", "agency"),
	"billing_period":      propertySet("monthly", "annual"),
	"provider":            propertySet("paddle"),
	"mutual_count_bucket": propertySet("0", "1", "2-3", "4-6", "7+"),
	"rank_bucket":         propertySet("1-3", "4-6", "7-10", "11+"),
	"platform": propertySet(
		"bluesky", "facebook", "instagram", "linkedin", "mastodon", "pinterest",
		"reddit", "threads", "tiktok", "x", "youtube",
	),
}

var postHogAnonymousID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

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
	Alias(context.Context, string, string) error
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
		Endpoint:               config.Endpoint,
		DisableGeoIP:           posthog.Ptr(true),
		ShutdownTimeout:        5 * time.Second,
		DefaultEventProperties: defaultEventProperties(config),
		Callback:               deliveryCallback{},
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
	if err := ValidateEvent(event); err != nil {
		return err
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

func (r *noopRecorder) Capture(_ context.Context, event Event) error { return ValidateEvent(event) }

func (r *postHogRecorder) Alias(ctx context.Context, distinctID, alias string) error {
	if err := validateAlias(distinctID, alias); err != nil {
		return err
	}
	return posthog.EnqueueWithContext(ctx, r.client, posthog.Alias{
		DistinctId: strings.TrimSpace(distinctID), Alias: strings.TrimSpace(alias),
	})
}

func (r *noopRecorder) Alias(_ context.Context, distinctID, alias string) error {
	return validateAlias(distinctID, alias)
}

func BrowserDistinctID(ctx context.Context) string {
	requestContext, ok := posthog.RequestContextFromContext(ctx)
	if !ok {
		return ""
	}
	return strings.TrimSpace(requestContext.DistinctId)
}

func validateAlias(distinctID, alias string) error {
	distinctID = strings.TrimSpace(distinctID)
	alias = strings.TrimSpace(alias)
	if distinctID == "" || !IsAnonymousDistinctID(alias) || containsSensitiveValue(distinctID) {
		return fmt.Errorf("telemetry alias requires safe distinct IDs")
	}
	return nil
}

func IsAnonymousDistinctID(value string) bool {
	return postHogAnonymousID.MatchString(strings.ToLower(strings.TrimSpace(value)))
}

func (r *postHogRecorder) CaptureException(ctx context.Context, exception Exception) error {
	message := newExceptionMessage(exception, r.config, time.Now().UTC())
	return posthog.EnqueueWithContext(ctx, r.client, message)
}

func newExceptionMessage(exception Exception, config Config, timestamp time.Time) posthog.Exception {
	title := strings.TrimSpace(exception.Title)
	if title == "" {
		title = "OpenPost error"
	}
	description := strings.TrimSpace(exception.Description)
	if description == "" {
		description = "An OpenPost operation failed"
	}
	message := posthog.NewDefaultException(
		timestamp,
		exceptionDistinctID(exception.DistinctID, exception.WorkspaceID),
		title,
		description,
	)
	// posthog-go stores the title, description, stack trace, and debug images
	// outside Properties. Adding OpenPost context here must not replace those
	// SDK-owned exception fields.
	properties := copyProperties(exception.Properties)
	for key, value := range defaultEventProperties(config) {
		properties[key] = value
	}
	message.Properties = posthog.Properties(properties)
	if exception.WorkspaceID != "" {
		message.Properties["workspace_id"] = exception.WorkspaceID
	}
	return message
}

func defaultEventProperties(config Config) posthog.Properties {
	return posthog.Properties{
		"surface":                 "backend",
		"environment":             config.Environment,
		"edition":                 config.Edition,
		"version":                 config.Version,
		"revision":                config.Revision,
		"service":                 "openpost",
		"$process_person_profile": false,
	}
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

func ValidateEvent(event Event) error {
	allowed, known := eventPropertyAllowlists[event.Name]
	if !known {
		return fmt.Errorf("unknown telemetry event %q", event.Name)
	}
	for field, value := range map[string]string{
		"distinct_id": event.DistinctID, "workspace_id": event.WorkspaceID, "uuid": event.UUID,
	} {
		if containsSensitiveValue(value) {
			return fmt.Errorf("telemetry event %q field %q contains a sensitive value", event.Name, field)
		}
	}
	for key, value := range event.Properties {
		if _, ok := allowed[key]; !ok {
			return fmt.Errorf("telemetry event %q does not allow property %q", event.Name, key)
		}
		if containsSensitiveValue(value) {
			return fmt.Errorf("telemetry event %q property %q contains a sensitive value", event.Name, key)
		}
		if allowedValues, constrained := firstUsePropertyValues[key]; constrained {
			text, ok := value.(string)
			if !ok {
				return fmt.Errorf("telemetry event %q property %q has an invalid type", event.Name, key)
			}
			if _, ok := allowedValues[text]; !ok {
				return fmt.Errorf("telemetry event %q property %q has an invalid value", event.Name, key)
			}
		}
	}
	return nil
}

func propertySet(keys ...string) map[string]struct{} {
	result := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		result[key] = struct{}{}
	}
	return result
}

func containsSensitiveValue(value any) bool {
	switch typed := value.(type) {
	case string:
		return containsSensitiveString(typed)
	case []string:
		return containsSensitiveStrings(typed)
	case []any:
		return containsSensitiveItems(typed)
	case map[string]any:
		return containsSensitiveProperties(typed)
	}
	return false
}

func containsSensitiveString(value string) bool {
	normalized := strings.ToLower(value)
	return strings.Contains(normalized, "://") || strings.Contains(normalized, "@") ||
		strings.Contains(normalized, "token=") || strings.Contains(normalized, "secret=") ||
		strings.Contains(normalized, "password=") || strings.Contains(normalized, "authorization=") ||
		strings.HasPrefix(value, "eyJ") && strings.Count(value, ".") == 2
}

func containsSensitiveStrings(values []string) bool {
	for _, value := range values {
		if containsSensitiveString(value) {
			return true
		}
	}
	return false
}

func containsSensitiveItems(values []any) bool {
	for _, value := range values {
		if containsSensitiveValue(value) {
			return true
		}
	}
	return false
}

func containsSensitiveProperties(properties map[string]any) bool {
	for _, value := range properties {
		if containsSensitiveValue(value) {
			return true
		}
	}
	return false
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
