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
	"strings"
	"time"
)

var httpClient = &http.Client{Timeout: 30 * time.Second}

// DoRequest executes an HTTP request and returns the response body.
// Non-2xx responses retain only status, stable provider code, and Retry-After.
func DoRequest(ctx context.Context, method, url string, body io.Reader, headers map[string]string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, NewHTTPError(resp.StatusCode, resp.Header, respBody)
	}

	return respBody, nil
}

// DoJSON marshals payload to JSON, sets Content-Type, and calls DoRequest.
func DoJSON(ctx context.Context, method, url string, payload any, headers map[string]string) ([]byte, error) {
	var bodyReader io.Reader
	if payload != nil {
		data, err := jsonMarshal(payload)
		if err != nil {
			return nil, fmt.Errorf("marshaling JSON: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	if headers == nil {
		headers = make(map[string]string)
	}
	if _, ok := headers[headerContentType]; !ok {
		headers[headerContentType] = contentTypeJSON
	}

	return DoRequest(ctx, method, url, bodyReader, headers)
}

// DoBearerJSON executes a JSON request with bearer auth and decodes the response.
func DoBearerJSON[T any](ctx context.Context, method, url, accessToken string, payload any, label string) (*T, error) {
	respBody, err := DoJSON(ctx, method, url, payload, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return nil, err
	}

	var result T
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("decoding %s: %w", label, err)
	}

	return &result, nil
}

// DoMultipart builds a multipart/form-data body with a single file field and calls DoRequest.
func DoMultipart(ctx context.Context, url string, fieldName string, reader io.Reader, filename string, extraFields map[string]string, headers map[string]string) ([]byte, error) {
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)

	// Write extra text fields first
	for k, v := range extraFields {
		if err := writer.WriteField(k, v); err != nil {
			return nil, fmt.Errorf("writing field %s: %w", k, err)
		}
	}

	part, err := writer.CreateFormFile(fieldName, filename)
	if err != nil {
		return nil, fmt.Errorf("creating form file: %w", err)
	}
	if _, err := io.Copy(part, reader); err != nil {
		return nil, fmt.Errorf("copying file data: %w", err)
	}

	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("closing multipart writer: %w", err)
	}

	if headers == nil {
		headers = make(map[string]string)
	}
	headers[headerContentType] = writer.FormDataContentType()

	return DoRequest(ctx, "POST", url, &buf, headers)
}

// DoFormURLEncoded encodes values as application/x-www-form-urlencoded and calls DoRequest.
func DoFormURLEncoded(ctx context.Context, method, url string, values map[string]string, headers map[string]string) ([]byte, error) {
	if headers == nil {
		headers = make(map[string]string)
	}
	if _, ok := headers[headerContentType]; !ok {
		headers[headerContentType] = contentTypeForm
	}

	body := encodeFormValues(values)
	return DoRequest(ctx, method, url, bytes.NewReader(body), headers)
}

// DoFormURLEncodedValues encodes url.Values (supports duplicate keys) and calls DoRequest.
func DoFormURLEncodedValues(ctx context.Context, method, url string, values url.Values, headers map[string]string) ([]byte, error) {
	if headers == nil {
		headers = make(map[string]string)
	}
	if _, ok := headers[headerContentType]; !ok {
		headers[headerContentType] = contentTypeForm
	}

	return DoRequest(ctx, method, url, strings.NewReader(values.Encode()), headers)
}

func encodeFormValues(values map[string]string) []byte {
	v := url.Values{}
	for k, val := range values {
		v.Set(k, val)
	}
	return []byte(v.Encode())
}

// jsonMarshal is a thin wrapper to allow overriding in tests if needed.
var jsonMarshal = json.Marshal
