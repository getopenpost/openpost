package connectors

import "time"

type HealthResponse struct {
	Status string `json:"status"`
}

type ConnectionRequest struct {
	WorkspaceID string `json:"workspace_id"`
}

type ConnectionResponse struct {
	State         string              `json:"state"`
	ConnectionRef string              `json:"connection_ref"`
	Accounts      []ConnectionAccount `json:"accounts"`
}

type ConnectionAccount struct {
	ID          string            `json:"id"`
	Username    string            `json:"username,omitempty"`
	DisplayName string            `json:"display_name,omitempty"`
	AvatarURL   string            `json:"avatar_url,omitempty"`
	Metadata    map[string]string `json:"metadata,omitempty"`
}

type CapabilityResolveRequest struct {
	ConnectionRef string         `json:"connection_ref"`
	OutputProfile string         `json:"output_profile"`
	Intent        string         `json:"intent"`
	Settings      map[string]any `json:"settings,omitempty"`
}

type CapabilityResolveResponse struct {
	CapabilityRevision string         `json:"capability_revision"`
	Available          bool           `json:"available"`
	UnavailableReason  string         `json:"unavailable_reason,omitempty"`
	Constraints        map[string]any `json:"constraints,omitempty"`
}

type PublishRequest struct {
	OperationID        string         `json:"operation_id"`
	ConnectionRef      string         `json:"connection_ref"`
	CapabilityRevision string         `json:"capability_revision"`
	OutputProfile      string         `json:"output_profile"`
	Content            string         `json:"content"`
	Title              string         `json:"title,omitempty"`
	Description        string         `json:"description,omitempty"`
	ReplyTo            string         `json:"reply_to,omitempty"`
	Settings           map[string]any `json:"settings,omitempty"`
}

type PublishResponse struct {
	Status            string `json:"status"`
	ExternalID        string `json:"external_id,omitempty"`
	ExternalURL       string `json:"external_url,omitempty"`
	ProviderReference string `json:"provider_reference,omitempty"`
	PollAfterSeconds  int    `json:"poll_after_seconds,omitempty"`
	IdempotencyTTL    int    `json:"idempotency_ttl_seconds,omitempty"`
}

func (r PublishResponse) PollAfter() time.Duration {
	return time.Duration(r.PollAfterSeconds) * time.Second
}

func (r PublishResponse) IdempotencyDuration() time.Duration {
	return time.Duration(r.IdempotencyTTL) * time.Second
}

type Problem struct {
	Type         string `json:"type,omitempty"`
	Title        string `json:"title,omitempty"`
	Status       int    `json:"status,omitempty"`
	Detail       string `json:"detail,omitempty"`
	Kind         string `json:"kind"`
	ProviderCode string `json:"provider_code,omitempty"`
	RetryAfter   int    `json:"retry_after,omitempty"`
	Action       string `json:"action,omitempty"`
	Outcome      string `json:"outcome,omitempty"`
}

type HTTPError struct {
	StatusCode int
	Problem    Problem
}

func (e *HTTPError) Error() string {
	if e == nil {
		return "connector request failed"
	}
	if e.Problem.Kind != "" {
		return "connector request failed: " + e.Problem.Kind
	}
	return "connector request failed with HTTP status " + httpStatusText(e.StatusCode)
}

func httpStatusText(status int) string {
	if status == 0 {
		return "unknown"
	}
	return fmtInt(status)
}
