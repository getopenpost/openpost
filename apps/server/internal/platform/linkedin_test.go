package platform

import (
	"context"

	"io"
	"net/http"

	"strings"
	"testing"
)

func TestLinkedInUploadDocumentInitializesUploadsAndWaitsForAvailability(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	requests := []string{}
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests = append(requests, req.Method+" "+req.URL.String())
		switch {
		case req.Method == "POST" && req.URL.String() == "https://api.linkedin.com/rest/documents?action=initializeUpload":
			return &http.Response{
				StatusCode: http.StatusOK,
				Body: io.NopCloser(strings.NewReader(`{
					"value": {
						"uploadUrl": "https://uploads.linkedin.example/document",
						"document": "urn:li:document:D5510AQFx87994pYx0Q"
					}
				}`)),
				Request: req,
			}, nil
		case req.Method == "PUT" && req.URL.String() == "https://uploads.linkedin.example/document":
			return &http.Response{
				StatusCode: http.StatusCreated,
				Body:       io.NopCloser(strings.NewReader("")),
				Request:    req,
			}, nil
		case req.Method == "GET" && req.URL.EscapedPath() == "/rest/documents/urn%3Ali%3Adocument%3AD5510AQFx87994pYx0Q":
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader(`{"status":"AVAILABLE"}`)),
				Request:    req,
			}, nil
		default:
			t.Fatalf("unexpected request %s %s", req.Method, req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewLinkedInAdapter("", "", "", false)
	urn, err := adapter.UploadMedia(context.Background(), "token", "abc", "application/pdf", strings.NewReader("pdf-data"))
	if err != nil {
		t.Fatalf("UploadMedia returned error: %v", err)
	}
	if urn != "urn:li:document:D5510AQFx87994pYx0Q" {
		t.Fatalf("expected document URN, got %q", urn)
	}
	if len(requests) != 3 {
		t.Fatalf("expected initialize, upload, status requests; got %#v", requests)
	}
}

func TestLinkedInCreatePostPreservesHashtagsWithoutAcceptingMarkup(t *testing.T) {
	tests := []struct{ name, content, want string }{
		{"tags and punctuation", "Launch (#OpenPost), #Go2026!", `Launch \({hashtag|\#|OpenPost}\), {hashtag|\#|Go2026}!`},
		{"unicode", "#café #日本語 #cafe\u0301 ＃中文", "{hashtag|\\#|café} {hashtag|\\#|日本語} {hashtag|\\#|cafe\u0301} {hashtag|＃|中文}"},
		{"emoji boundary", "❤️#love 1️⃣#first", `❤️{hashtag|\#|love} 1️⃣{hashtag|\#|first}`},
		{"ordinary hashes", "C# C#Sharp # #123 foo#bar ##tag", `C\# C\#Sharp \# \#123 foo\#bar \#\#tag`},
		{"unicode spaces after urls", "https://example.com\u00a0#OpenPost www.example.com\u3000#Go", "https://example.com\u00a0{hashtag|\\#|OpenPost} www.example.com\u3000{hashtag|\\#|Go}"},
		{"urls", "https://example.com/#docs HTTPS://example.com?q=#tag www.example.com/#guide /page#section", `https://example.com/\#docs HTTPS://example.com?q=\#tag www.example.com/\#guide /page\#section`},
		{"reserved markup", `@[Name](urn:li:person:123) {hashtag|#|fake} <x> *bold* _word_ ~hi~ \`, `\@\[Name\]\(urn:li:person:123\) \{hashtag\|\#\|fake\} \<x\> \*bold\* \_word\_ \~hi\~ \\`},
		{"underscore ends tag", "#machine_learning", `{hashtag|\#|machine}\_learning`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			payload := captureLinkedInCreatePostPayload(t, &PublishRequest{Content: test.content})
			if got := payload["commentary"]; got != test.want {
				t.Fatalf("commentary = %q, want %q", got, test.want)
			}
		})
	}
}
