package workflows

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/openpost/backend/internal/netguard"
)

var headerNamePattern = regexp.MustCompile("^[!#$%&'*+.^_`|~0-9a-zA-Z-]+$")

func forbiddenHeader(name string) bool {
	return slices.Contains([]string{"host", "content-length", "connection", "transfer-encoding", "upgrade", "proxy-authorization", "proxy-connection", "te", "trailer"}, strings.ToLower(name))
}
func secretHeader(name string) bool {
	name = strings.ToLower(name)
	return strings.Contains(name, "authorization") || strings.Contains(name, "cookie") || strings.Contains(name, "token") || strings.Contains(name, "secret") || strings.Contains(name, "api-key") || strings.Contains(name, "apikey")
}
func stringMap(value any) (map[string]string, error) {
	if value == nil || value == "" {
		return map[string]string{}, nil
	}
	var fields map[string]string
	encoded, err := json.Marshal(value)
	if text, ok := value.(string); ok {
		encoded = []byte(text)
	}
	if err != nil || json.Unmarshal(encoded, &fields) != nil || fields == nil || len(fields) > 50 {
		return nil, errors.New("enter a JSON object with at most 50 text values")
	}
	return fields, nil
}
func (s *Service) request(ctx context.Context, workspaceID, key string, inputs map[string]any) (map[string]any, error) {
	timeout, err := requestTimeout(inputs)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	request, err := prepareHTTPRequest(ctx, key, inputs)
	if err != nil {
		return nil, err
	}
	secret, err := s.authorizeRequest(ctx, workspaceID, request, textInput(inputs, "connection_id"))
	if err != nil {
		return nil, err
	}
	address := request.URL
	client := *s.client
	client.CheckRedirect = func(next *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("too many redirects")
		}
		if secret != "" && (next.URL.Host != address.Host || next.URL.Scheme != "https") {
			return errors.New("credentialed redirects must stay on the same HTTPS host")
		}
		return netguard.ValidateURL(next.Context(), next.URL, sourceURLPolicy)
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, errors.New("request did not complete; inspect the remote service before starting another run")
	}
	defer response.Body.Close()
	return decodeHTTPResponse(response, secret, textInput(inputs, "response_format"))
}

func requestTimeout(inputs map[string]any) (time.Duration, error) {
	timeout := 20.0
	var err error
	if value, ok := inputs["timeout"]; ok {
		timeout, err = number(value)
	}
	if err != nil || timeout < 1 || timeout > 30 {
		return 0, errors.New("request timeout must be between 1 and 30 seconds")
	}
	return time.Duration(timeout * float64(time.Second)), nil
}

func prepareHTTPRequest(ctx context.Context, key string, inputs map[string]any) (*http.Request, error) {
	address, err := url.Parse(textInput(inputs, "url"))
	if err != nil || address.User != nil {
		return nil, errors.New("enter an HTTP or HTTPS URL without credentials")
	}
	if err := netguard.ValidateURL(ctx, address, sourceURLPolicy); err != nil {
		return nil, errors.New("request URL must resolve to a public HTTP or HTTPS address")
	}
	method := textInput(inputs, "method")
	if !slices.Contains([]string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodHead, http.MethodOptions}, method) {
		return nil, errors.New("unsupported HTTP method")
	}
	query, err := stringMap(inputs["query"])
	if err != nil {
		return nil, err
	}
	params := address.Query()
	for k, v := range query {
		params.Set(k, v)
	}
	address.RawQuery = params.Encode()
	request, err := http.NewRequestWithContext(ctx, method, address.String(), strings.NewReader(textInput(inputs, "body")))
	if err != nil {
		return nil, errors.New("invalid request")
	}
	request.Header.Set("User-Agent", "OpenPost-Workflows")
	request.Header.Set("Idempotency-Key", key)
	if err := setRequestHeaders(request, inputs["headers"]); err != nil {
		return nil, err
	}
	return request, nil
}

func setRequestHeaders(request *http.Request, value any) error {
	headers, err := stringMap(value)
	if err != nil {
		return err
	}
	for name, value := range headers {
		if !headerNamePattern.MatchString(name) || forbiddenHeader(name) || strings.ContainsAny(value, "\r\n") {
			return errors.New("request contains an invalid header")
		}
		if secretHeader(name) {
			return errors.New("store authentication headers in Connections instead of the workflow")
		}
		request.Header.Set(name, value)
	}
	return nil
}

func (s *Service) authorizeRequest(ctx context.Context, workspaceID string, request *http.Request, id string) (string, error) {
	address := request.URL
	secret := ""
	if id != "" {
		var connection connectionRecord
		if err := s.db.NewSelect().Model(&connection).Where("id = ? AND workspace_id = ?", id, workspaceID).Scan(ctx); err != nil {
			return "", errors.New("request connection is unavailable")
		}
		if address.Scheme != "https" || address.Hostname() != connection.Host || address.Port() != "" {
			return "", errors.New("request credentials require their configured HTTPS host")
		}
		if s.encryptor == nil {
			return "", errors.New("credential storage is unavailable")
		}
		var err error
		secret, err = s.encryptor.Decrypt(connection.Ciphertext)
		if err != nil {
			return "", errors.New("request credentials could not be decrypted")
		}
		switch connection.Kind {
		case "bearer":
			request.Header.Set("Authorization", "Bearer "+secret)
		case "header":
			request.Header.Set(connection.HeaderName, secret)
		case "basic":
			request.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(secret)))
		default:
			return "", errors.New("choose an HTTP request connection")
		}
	}
	return secret, nil
}

func decodeHTTPResponse(response *http.Response, secret, format string) (map[string]any, error) {
	bytes, err := io.ReadAll(io.LimitReader(response.Body, maxDataBytes+1))
	if err != nil || len(bytes) > maxDataBytes {
		return nil, errors.New("request response could not be read within the 256 KB limit")
	}
	text := string(bytes)
	if secret != "" {
		text = strings.ReplaceAll(text, secret, "[redacted]")
		text = strings.ReplaceAll(text, base64.StdEncoding.EncodeToString([]byte(secret)), "[redacted]")
	}
	var body any = text

	if format == "json" || (format != "text" && strings.Contains(response.Header.Get("Content-Type"), "json")) {
		if err := json.Unmarshal([]byte(text), &body); err != nil {
			return nil, errors.New("response is not valid JSON")
		}
	}
	body = redactResponse(body, secret)
	safeHeaders := map[string]string{}
	for _, name := range []string{"Content-Type", "Content-Length", "ETag", "Last-Modified", "Retry-After"} {
		if value := response.Header.Get(name); value != "" {
			safeHeaders[name] = redactResponse(value, secret).(string)
		}
	}
	output := map[string]any{"status": response.StatusCode, "body": body, "headers": safeHeaders}
	if response.StatusCode >= 400 {
		return output, fmt.Errorf("request returned HTTP %d", response.StatusCode)
	}
	return output, nil
}

func redactResponse(value any, secret string) any {
	if secret == "" {
		return value
	}
	switch data := value.(type) {
	case string:
		return strings.ReplaceAll(strings.ReplaceAll(data, secret, "[redacted]"), base64.StdEncoding.EncodeToString([]byte(secret)), "[redacted]")
	case []any:
		for i, child := range data {
			data[i] = redactResponse(child, secret)
		}
		return data
	case map[string]any:
		result := make(map[string]any, len(data))
		for key, child := range data {
			safeKey := redactResponse(key, secret).(string)
			result[safeKey] = redactResponse(child, secret)
		}
		return result
	default:
		return value
	}
}
