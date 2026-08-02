package mcpstdio

import (
	"bufio"
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReadWriteFrameRoundTrip(t *testing.T) {
	var buf bytes.Buffer
	body := []byte(`{"jsonrpc":"2.0","id":1,"method":"initialize"}`)
	if err := WriteFrame(&buf, body); err != nil {
		t.Fatalf("WriteFrame: %v", err)
	}

	got, err := ReadFrame(bufio.NewReader(&buf))
	if err != nil {
		t.Fatalf("ReadFrame: %v", err)
	}
	if string(got) != string(body) {
		t.Fatalf("body mismatch: got %q want %q", got, body)
	}
}

func TestWriteFrameCompactsHTTPStyleJSON(t *testing.T) {
	var buf bytes.Buffer
	body := []byte("{\n  \"jsonrpc\": \"2.0\",\n  \"id\": 1,\n  \"result\": {}\n}\n")
	if err := WriteFrame(&buf, body); err != nil {
		t.Fatalf("WriteFrame: %v", err)
	}
	if got, want := buf.String(), "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n"; got != want {
		t.Fatalf("unexpected compact frame: got %q want %q", got, want)
	}
}

func TestReadFrameRejectsMissingContentLength(t *testing.T) {
	_, err := ReadFrame(bufio.NewReader(strings.NewReader("X-Test: yes\r\n\r\n{}")))
	if err == nil || !strings.Contains(err.Error(), "Content-Length") {
		t.Fatalf("expected Content-Length error, got %v", err)
	}
}

func TestProxyForwardUsesBearerAndMCPPath(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/mcp" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer token-1" {
			t.Fatalf("unexpected authorization header %q", got)
		}
		if got := r.Header.Get("User-Agent"); got != "openpost-mcp/v1.2.3" {
			t.Fatalf("unexpected user-agent header %q", got)
		}
		if got := r.Header.Get("Accept"); got != "application/json, text/event-stream" {
			t.Fatalf("unexpected accept header %q", got)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		if string(body) != `{"jsonrpc":"2.0","id":"a","method":"tools/list"}` {
			t.Fatalf("unexpected body %s", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":"a","result":{"tools":[]}}`))
	}))
	defer srv.Close()

	proxy := NewProxyWithVersion(srv.URL, "token-1", "v1.2.3")
	resp, err := proxy.Forward(context.Background(), []byte(`{"jsonrpc":"2.0","id":"a","method":"tools/list"}`))
	if err != nil {
		t.Fatalf("Forward: %v", err)
	}
	if string(resp) != `{"jsonrpc":"2.0","id":"a","result":{"tools":[]}}` {
		t.Fatalf("unexpected response %s", resp)
	}
}

func TestProxyServeForwardsNegotiatedProtocolVersion(t *testing.T) {
	t.Parallel()

	requestNumber := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestNumber++
		w.Header().Set("Content-Type", "application/json")
		switch requestNumber {
		case 1:
			if got := r.Header.Get("MCP-Protocol-Version"); got != "" {
				t.Fatalf("initialize must not send a negotiated version header, got %q", got)
			}
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"openpost","version":"test"}}}`))
		case 2:
			if got := r.Header.Get("MCP-Protocol-Version"); got != "2025-06-18" {
				t.Fatalf("unexpected negotiated protocol version %q", got)
			}
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}`))
		default:
			t.Fatalf("unexpected request %d", requestNumber)
		}
	}))
	defer srv.Close()

	proxy := NewProxy(srv.URL, "token")
	var in bytes.Buffer
	if err := WriteFrame(&in, []byte(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}`)); err != nil {
		t.Fatalf("WriteFrame initialize: %v", err)
	}
	if err := WriteFrame(&in, []byte(`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)); err != nil {
		t.Fatalf("WriteFrame tools/list: %v", err)
	}
	var out bytes.Buffer
	if err := proxy.Serve(context.Background(), &in, &out); err != nil {
		t.Fatalf("Serve: %v", err)
	}
	if !strings.HasPrefix(out.String(), "{") {
		t.Fatalf("expected standard newline-delimited JSON output, got %q", out.String())
	}
	reader := bufio.NewReader(&out)
	for range 2 {
		if _, err := ReadFrame(reader); err != nil {
			t.Fatalf("ReadFrame: %v", err)
		}
	}
}

func TestProxyServePreservesLegacyContentLengthFraming(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}`))
	}))
	defer srv.Close()

	proxy := NewProxy(srv.URL, "token")
	var in bytes.Buffer
	if err := writeLegacyFrame(&in, []byte(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)); err != nil {
		t.Fatalf("writeLegacyFrame: %v", err)
	}
	var out bytes.Buffer
	if err := proxy.Serve(context.Background(), &in, &out); err != nil {
		t.Fatalf("Serve: %v", err)
	}
	if !strings.HasPrefix(out.String(), "Content-Length:") {
		t.Fatalf("expected legacy response framing, got %q", out.String())
	}
}

func TestProxyServeWrapsHTTPErrorAsJSONRPCError(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
	}))
	defer srv.Close()

	proxy := NewProxy(srv.URL, "bad-token")
	var in bytes.Buffer
	if err := WriteFrame(&in, []byte(`{"jsonrpc":"2.0","id":"req-1","method":"initialize"}`)); err != nil {
		t.Fatalf("WriteFrame: %v", err)
	}
	var out bytes.Buffer
	if err := proxy.Serve(context.Background(), &in, &out); err != nil {
		t.Fatalf("Serve: %v", err)
	}
	frame, err := ReadFrame(bufio.NewReader(&out))
	if err != nil {
		t.Fatalf("ReadFrame: %v", err)
	}
	got := string(frame)
	if !strings.Contains(got, `"id":"req-1"`) || !strings.Contains(got, `"error"`) || !strings.Contains(got, "HTTP 401") {
		t.Fatalf("unexpected error frame %s", got)
	}
}

func TestProxyServeSkipsAcceptedNotificationResponse(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		if string(body) != `{"jsonrpc":"2.0","method":"notifications/initialized"}` {
			t.Fatalf("unexpected body %s", body)
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()

	proxy := NewProxy(srv.URL, "token")
	var in bytes.Buffer
	if err := WriteFrame(&in, []byte(`{"jsonrpc":"2.0","method":"notifications/initialized"}`)); err != nil {
		t.Fatalf("WriteFrame: %v", err)
	}
	var out bytes.Buffer
	if err := proxy.Serve(context.Background(), &in, &out); err != nil {
		t.Fatalf("Serve: %v", err)
	}
	if out.Len() != 0 {
		t.Fatalf("expected no stdio response for notification, got %q", out.String())
	}
}
