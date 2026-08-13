package platform

import (
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"
)

func TestValidateDiscordWebhookURL(t *testing.T) {
	valid := []string{
		"https://discord.com/api/webhooks/123/token",
		"https://discord.com/api/v10/webhooks/123/token.with-parts",
		"https://canary.discord.com/api/webhooks/123/token",
	}
	for _, raw := range valid {
		if _, _, err := validateDiscordWebhookURL(raw); err != nil {
			t.Errorf("expected %q to be valid: %v", raw, err)
		}
	}
	invalid := []string{
		"http://discord.com/api/webhooks/123/token",
		"https://discord.com.evil.example/api/webhooks/123/token",
		"https://discord.com:8443/api/webhooks/123/token",
		"https://user@discord.com/api/webhooks/123/token",
		"https://discord.com/api/webhooks/123/token/messages/456",
		"https://discord.com/api/webhooks/123/token#fragment",
	}
	for _, raw := range invalid {
		if _, _, err := validateDiscordWebhookURL(raw); err == nil {
			t.Errorf("expected %q to be rejected", raw)
		}
	}
}

func TestDiscordPublishWithMediaStreamsMultipart(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodPost || req.URL.Host != "discord.com" || req.URL.Query().Get("wait") != "true" {
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
		}
		reader, err := req.MultipartReader()
		if err != nil {
			t.Fatalf("reading multipart request: %v", err)
		}
		var payload map[string]any
		files := map[string]string{}
		for {
			part, err := reader.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Fatalf("reading multipart part: %v", err)
			}
			data, _ := io.ReadAll(part)
			if part.FormName() == "payload_json" {
				if err := json.Unmarshal(data, &payload); err != nil {
					t.Fatalf("decoding payload_json: %v", err)
				}
			} else {
				files[part.FileName()] = string(data)
			}
		}
		if payload["content"] != "Launch update" {
			t.Fatalf("unexpected payload %#v", payload)
		}
		allowed := payload["allowed_mentions"].(map[string]any)
		if len(allowed["parse"].([]any)) != 0 {
			t.Fatalf("expected mentions to be disabled: %#v", allowed)
		}
		attachments := payload["attachments"].([]any)
		first := attachments[0].(map[string]any)
		if first["description"] != "Dashboard screenshot" {
			t.Fatalf("expected attachment description: %#v", first)
		}
		if files["dashboard.png"] != "png-data" || files["notes.txt"] != "notes-data" {
			t.Fatalf("unexpected files %#v", files)
		}
		return jsonResponse(req, `{"id":"message-123"}`), nil
	})}

	adapter := NewDiscordAdapter()
	messageID, err := adapter.PublishWithMedia(
		context.Background(),
		"https://discord.com/api/webhooks/123/token",
		"",
		&PublishRequest{
			Content:       " Launch update ",
			MediaAltTexts: []string{"Dashboard screenshot", ""},
		},
		[]UploadMediaRequest{
			{Filename: "../dashboard.png", Reader: strings.NewReader("png-data")},
			{Filename: "notes.txt", Reader: strings.NewReader("notes-data")},
		},
	)
	if err != nil {
		t.Fatalf("PublishWithMedia returned error: %v", err)
	}
	if messageID.ExternalID != "message-123" {
		t.Fatalf("unexpected message ID %q", messageID)
	}
}

func TestDiscordWebhookVerificationDoesNotFollowRedirects(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()
	calls := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{
			StatusCode: http.StatusFound,
			Header:     http.Header{"Location": {"https://example.com/collect"}},
			Body:       io.NopCloser(strings.NewReader("")),
			Request:    req,
		}, nil
	})}

	_, err := NewDiscordAdapter().GetProfile(t.Context(), "https://discord.com/api/webhooks/123/secret")
	if err == nil {
		t.Fatal("expected redirect response to fail verification")
	}
	if calls != 1 {
		t.Fatalf("expected one Discord request, got %d", calls)
	}
}

func TestDiscordMultipartUsesDiscordFieldNames(t *testing.T) {
	body := &strings.Builder{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("files[0]", "file.txt")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write([]byte("body"))
	_ = writer.Close()
	if !strings.Contains(body.String(), `name="files[0]"`) {
		t.Fatalf("unexpected multipart field: %s", body.String())
	}
}
