package main

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

const (
	protocolVersion    = "1.0"
	capabilityRevision = "directus-items-v1"
	maxBodyBytes       = 1 << 20
	maxSecretBytes     = 8 << 10
)

var directusName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type config struct {
	listenAddress    string
	connectorToken   string
	directusURL      *url.URL
	directusToken    string
	collection       string
	contentField     string
	titleField       string
	descriptionField string
	statusField      string
	operationField   string
	itemURLTemplate  string
}

type server struct {
	config config
	client *http.Client
}

type connectionResponse struct {
	State         string              `json:"state"`
	ConnectionRef string              `json:"connection_ref"`
	Accounts      []connectionAccount `json:"accounts"`
}

type connectionAccount struct {
	ID          string `json:"id"`
	Username    string `json:"username,omitempty"`
	DisplayName string `json:"display_name,omitempty"`
}

type capabilityRequest struct {
	ConnectionRef string         `json:"connection_ref"`
	OutputProfile string         `json:"output_profile"`
	Intent        string         `json:"intent"`
	Settings      map[string]any `json:"settings,omitempty"`
}

type publishRequest struct {
	OperationID        string         `json:"operation_id"`
	ConnectionRef      string         `json:"connection_ref"`
	CapabilityRevision string         `json:"capability_revision"`
	OutputProfile      string         `json:"output_profile"`
	Content            string         `json:"content"`
	Title              string         `json:"title,omitempty"`
	Description        string         `json:"description,omitempty"`
	Settings           map[string]any `json:"settings,omitempty"`
}

type publishResponse struct {
	Status         string `json:"status"`
	ExternalID     string `json:"external_id,omitempty"`
	ExternalURL    string `json:"external_url,omitempty"`
	IdempotencyTTL int    `json:"idempotency_ttl_seconds,omitempty"`
}

type problem struct {
	Title        string `json:"title"`
	Status       int    `json:"status"`
	Detail       string `json:"detail,omitempty"`
	Kind         string `json:"kind"`
	ProviderCode string `json:"provider_code,omitempty"`
	Action       string `json:"action,omitempty"`
	Outcome      string `json:"outcome,omitempty"`
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}
	srv := &server{config: cfg, client: &http.Client{Timeout: 15 * time.Second}}
	httpServer := &http.Server{
		Addr: cfg.listenAddress, Handler: srv.routes(),
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second,
		WriteTimeout: 20 * time.Second, IdleTimeout: 60 * time.Second,
	}
	log.Printf("Directus connector listening on %s for collection %s", cfg.listenAddress, cfg.collection)
	if err := httpServer.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func loadConfig() (config, error) {
	connectorToken, err := requiredSecret("CONNECTOR_BEARER_TOKEN_FILE", "CONNECTOR_BEARER_TOKEN")
	if err != nil {
		return config{}, err
	}
	directusToken, err := requiredSecret("DIRECTUS_TOKEN_FILE", "DIRECTUS_TOKEN")
	if err != nil {
		return config{}, err
	}
	rawURL := strings.TrimRight(strings.TrimSpace(os.Getenv("DIRECTUS_URL")), "/")
	directusURL, err := url.Parse(rawURL)
	if err != nil || directusURL.Hostname() == "" || directusURL.User != nil {
		return config{}, fmt.Errorf("DIRECTUS_URL must be an absolute URL without user information")
	}
	if directusURL.Scheme != "https" && !(directusURL.Scheme == "http" && os.Getenv("DIRECTUS_ALLOW_HTTP") == "true") {
		return config{}, fmt.Errorf("DIRECTUS_URL must use HTTPS unless DIRECTUS_ALLOW_HTTP=true")
	}
	cfg := config{
		listenAddress:  firstValue(os.Getenv("CONNECTOR_LISTEN_ADDRESS"), "127.0.0.1:8787"),
		connectorToken: connectorToken, directusURL: directusURL, directusToken: directusToken,
		collection:       strings.TrimSpace(os.Getenv("DIRECTUS_COLLECTION")),
		contentField:     firstValue(os.Getenv("DIRECTUS_CONTENT_FIELD"), "content"),
		titleField:       firstValue(os.Getenv("DIRECTUS_TITLE_FIELD"), "title"),
		descriptionField: firstValue(os.Getenv("DIRECTUS_DESCRIPTION_FIELD"), "description"),
		statusField:      firstValue(os.Getenv("DIRECTUS_STATUS_FIELD"), "status"),
		operationField:   firstValue(os.Getenv("DIRECTUS_OPERATION_FIELD"), "openpost_operation_id"),
		itemURLTemplate:  strings.TrimSpace(os.Getenv("DIRECTUS_ITEM_URL_TEMPLATE")),
	}
	for name, value := range map[string]string{
		"DIRECTUS_COLLECTION": cfg.collection, "DIRECTUS_CONTENT_FIELD": cfg.contentField,
		"DIRECTUS_TITLE_FIELD": cfg.titleField, "DIRECTUS_DESCRIPTION_FIELD": cfg.descriptionField,
		"DIRECTUS_STATUS_FIELD": cfg.statusField, "DIRECTUS_OPERATION_FIELD": cfg.operationField,
	} {
		if !directusName.MatchString(value) {
			return config{}, fmt.Errorf("%s is not a safe Directus name", name)
		}
	}
	return cfg, nil
}

func requiredSecret(fileEnvironment, valueEnvironment string) (string, error) {
	if path := strings.TrimSpace(os.Getenv(fileEnvironment)); path != "" {
		info, err := os.Stat(path)
		if err != nil {
			return "", fmt.Errorf("read %s: %w", fileEnvironment, err)
		}
		if info.Size() > maxSecretBytes {
			return "", fmt.Errorf("%s is too large", fileEnvironment)
		}
		value, err := os.ReadFile(path)
		if err != nil {
			return "", fmt.Errorf("read %s: %w", fileEnvironment, err)
		}
		if secret := strings.TrimSpace(string(value)); secret != "" {
			return secret, nil
		}
	}
	if secret := strings.TrimSpace(os.Getenv(valueEnvironment)); secret != "" {
		return secret, nil
	}
	return "", fmt.Errorf("%s or %s is required", fileEnvironment, valueEnvironment)
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/manifest", s.authorize(s.manifest))
	mux.HandleFunc("GET /v1/health", s.authorize(s.health))
	mux.HandleFunc("POST /v1/connections", s.authorize(s.connect))
	mux.HandleFunc("POST /v1/capabilities/resolve", s.authorize(s.resolveCapabilities))
	mux.HandleFunc("POST /v1/publishes", s.authorize(s.publish))
	mux.HandleFunc("GET /v1/operations/{operation_id}", s.authorize(s.operation))
	return mux
}

func (s *server) authorize(next http.HandlerFunc) http.HandlerFunc {
	return func(response http.ResponseWriter, request *http.Request) {
		provided := strings.TrimPrefix(request.Header.Get("Authorization"), "Bearer ")
		if subtle.ConstantTimeCompare([]byte(provided), []byte(s.config.connectorToken)) != 1 {
			writeProblem(response, http.StatusUnauthorized, "unauthorized", "Connector authentication failed.")
			return
		}
		next(response, request)
	}
}

func (s *server) manifest(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]any{
		"protocol_version": protocolVersion, "implementation_version": "0.1.0",
		"provider": map[string]any{
			"id": "io.directus.items", "display_name": "Directus",
			"description": "Create items in a configured Directus collection.",
		},
		"capability_revision": capabilityRevision,
		"connection":          map[string]any{"modes": []string{"preconfigured"}},
		"publishing": map[string]any{"output_profiles": []any{map[string]any{
			"id": "directus.item", "display_name": "Create Directus item", "profile": "short_text",
			"intents":     []string{"post"},
			"content":     map[string]any{"required": true, "max_length": 100000},
			"title":       map[string]any{"required": false, "max_length": 1000},
			"description": map[string]any{"required": false, "max_length": 10000},
			"media":       map[string]any{"min_items": 0, "max_items": 0},
			"settings": []any{map[string]any{
				"key": "status", "label": "Status", "help": "Directus item status",
				"control": "select", "required": true, "default": "draft",
				"options": []string{"draft", "published"},
			}},
		}}},
		"operations": map[string]any{"polling": true},
	})
}

func (s *server) health(response http.ResponseWriter, request *http.Request) {
	directusRequest, err := s.directusRequest(request.Context(), http.MethodGet, "/server/health", nil)
	if err != nil {
		writeProblem(response, http.StatusServiceUnavailable, "directus_unavailable", "Directus health check failed.")
		return
	}
	directusResponse, err := s.client.Do(directusRequest)
	if err != nil {
		writeProblem(response, http.StatusServiceUnavailable, "directus_unavailable", "Directus health check failed.")
		return
	}
	defer directusResponse.Body.Close()
	if directusResponse.StatusCode < 200 || directusResponse.StatusCode >= 300 {
		writeProblem(response, http.StatusServiceUnavailable, "directus_unavailable", "Directus is not ready.")
		return
	}
	writeJSON(response, http.StatusOK, map[string]string{"status": "ready"})
}

func (s *server) connect(response http.ResponseWriter, request *http.Request) {
	var input struct {
		WorkspaceID string `json:"workspace_id"`
	}
	if err := decodeJSON(request, &input); err != nil || strings.TrimSpace(input.WorkspaceID) == "" {
		writeProblem(response, http.StatusBadRequest, "invalid_connection", "workspace_id is required.")
		return
	}
	writeJSON(response, http.StatusOK, connectionResponse{
		State: "complete", ConnectionRef: "directus/" + s.config.collection,
		Accounts: []connectionAccount{{
			ID: s.config.collection, Username: s.config.collection,
			DisplayName: "Directus " + s.config.collection,
		}},
	})
}

func (s *server) resolveCapabilities(response http.ResponseWriter, request *http.Request) {
	var input capabilityRequest
	if err := decodeJSON(request, &input); err != nil || input.ConnectionRef != "directus/"+s.config.collection || input.OutputProfile != "directus.item" {
		writeProblem(response, http.StatusBadRequest, "invalid_capability_request", "The Directus destination is invalid.")
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"capability_revision": capabilityRevision, "available": true,
		"constraints": map[string]any{"collection": s.config.collection},
	})
}

func (s *server) publish(response http.ResponseWriter, request *http.Request) {
	var input publishRequest
	if err := decodeJSON(request, &input); err != nil {
		writeProblem(response, http.StatusBadRequest, "invalid_publish_request", "The publish request is invalid.")
		return
	}
	if input.OperationID == "" || input.ConnectionRef != "directus/"+s.config.collection ||
		input.CapabilityRevision != capabilityRevision || input.OutputProfile != "directus.item" || strings.TrimSpace(input.Content) == "" {
		writeProblem(response, http.StatusUnprocessableEntity, "invalid_destination", "The Directus destination or content is invalid.")
		return
	}
	result, found, err := s.findOperation(request.Context(), input.OperationID)
	if err != nil {
		writeDirectusError(response, err)
		return
	}
	if found {
		writeJSON(response, http.StatusOK, result)
		return
	}
	status, _ := input.Settings["status"].(string)
	if status == "" {
		status = "draft"
	}
	if status != "draft" && status != "published" {
		writeProblem(response, http.StatusUnprocessableEntity, "invalid_status", "Status must be draft or published.")
		return
	}
	payload := map[string]any{
		s.config.contentField: input.Content, s.config.titleField: input.Title,
		s.config.descriptionField: input.Description, s.config.statusField: status,
		s.config.operationField: input.OperationID,
	}
	itemID, err := s.createItem(request.Context(), payload)
	if err != nil {
		var providerError *directusError
		if errors.As(err, &providerError) && providerError.status == http.StatusConflict {
			result, found, lookupErr := s.findOperation(request.Context(), input.OperationID)
			if lookupErr != nil {
				writeDirectusError(response, lookupErr)
				return
			}
			if found {
				writeJSON(response, http.StatusOK, result)
				return
			}
		}
		writeDirectusError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, s.result(itemID))
}

func (s *server) operation(response http.ResponseWriter, request *http.Request) {
	operationID := request.PathValue("operation_id")
	result, found, err := s.findOperation(request.Context(), operationID)
	if err != nil {
		writeDirectusError(response, err)
		return
	}
	if !found {
		writeProblem(response, http.StatusNotFound, "operation_not_found", "No Directus item was found for this operation.")
		return
	}
	writeJSON(response, http.StatusOK, result)
}

type directusError struct {
	status int
	code   string
}

func (e *directusError) Error() string {
	return fmt.Sprintf("Directus request failed with status %d", e.status)
}

func (s *server) findOperation(ctx context.Context, operationID string) (publishResponse, bool, error) {
	query := url.Values{}
	query.Set("filter["+s.config.operationField+"][_eq]", operationID)
	query.Set("fields", "id")
	query.Set("limit", "1")
	path := "/items/" + url.PathEscape(s.config.collection) + "?" + query.Encode()
	request, err := s.directusRequest(ctx, http.MethodGet, path, nil)
	if err != nil {
		return publishResponse{}, false, err
	}
	response, err := s.client.Do(request)
	if err != nil {
		return publishResponse{}, false, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return publishResponse{}, false, &directusError{status: response.StatusCode}
	}
	var body struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, maxBodyBytes)).Decode(&body); err != nil {
		return publishResponse{}, false, err
	}
	if len(body.Data) == 0 {
		return publishResponse{}, false, nil
	}
	return s.result(fmt.Sprint(body.Data[0]["id"])), true, nil
}

func (s *server) createItem(ctx context.Context, payload map[string]any) (string, error) {
	request, err := s.directusRequest(ctx, http.MethodPost, "/items/"+url.PathEscape(s.config.collection), payload)
	if err != nil {
		return "", err
	}
	response, err := s.client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", &directusError{status: response.StatusCode}
	}
	var body struct {
		Data map[string]any `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, maxBodyBytes)).Decode(&body); err != nil {
		return "", err
	}
	id := strings.TrimSpace(fmt.Sprint(body.Data["id"]))
	if id == "" || id == "<nil>" {
		return "", fmt.Errorf("Directus response did not contain an item id")
	}
	return id, nil
}

func (s *server) directusRequest(ctx context.Context, method, path string, payload any) (*http.Request, error) {
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(encoded)
	}
	target := *s.config.directusURL
	target.Path = strings.TrimRight(target.Path, "/") + strings.Split(path, "?")[0]
	if index := strings.IndexByte(path, '?'); index >= 0 {
		target.RawQuery = path[index+1:]
	}
	request, err := http.NewRequestWithContext(ctx, method, target.String(), body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+s.config.directusToken)
	request.Header.Set("Accept", "application/json")
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	return request, nil
}

func (s *server) result(itemID string) publishResponse {
	externalURL := ""
	if s.config.itemURLTemplate != "" {
		externalURL = strings.ReplaceAll(s.config.itemURLTemplate, "{id}", url.PathEscape(itemID))
	}
	return publishResponse{Status: "published", ExternalID: itemID, ExternalURL: externalURL, IdempotencyTTL: 31536000}
}

func decodeJSON(request *http.Request, output any) error {
	defer request.Body.Close()
	decoder := json.NewDecoder(io.LimitReader(request.Body, maxBodyBytes+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(output); err != nil {
		return err
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return fmt.Errorf("request must contain one JSON value")
	}
	return nil
}

func writeDirectusError(response http.ResponseWriter, err error) {
	var providerError *directusError
	if errors.As(err, &providerError) {
		status := http.StatusBadGateway
		outcome := "unknown"
		if providerError.status >= 400 && providerError.status < 500 {
			status = http.StatusUnprocessableEntity
			outcome = "rejected"
		}
		writeJSON(response, status, problem{
			Title: "Directus rejected the item", Status: status, Kind: "provider_error",
			ProviderCode: fmt.Sprintf("directus_http_%d", providerError.status),
			Action:       "Check the Directus collection fields and access policy.", Outcome: outcome,
		})
		return
	}
	writeJSON(response, http.StatusBadGateway, problem{
		Title: "Directus request failed", Status: http.StatusBadGateway, Kind: "provider_transport_error",
		Action: "Check Directus availability before retrying.", Outcome: "unknown",
	})
}

func writeProblem(response http.ResponseWriter, status int, kind, detail string) {
	writeJSON(response, status, problem{Title: http.StatusText(status), Status: status, Detail: detail, Kind: kind})
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func firstValue(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}
