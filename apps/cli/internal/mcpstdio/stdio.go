package mcpstdio

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const contentLengthHeader = "content-length"
const defaultVersion = "dev"
const maxFrameBytes = 16 * 1024 * 1024

type frameFormat int

const (
	frameFormatNewline frameFormat = iota
	frameFormatContentLength
)

type Proxy struct {
	Endpoint  string
	Token     string
	HTTP      *http.Client
	UserAgent string

	mu              sync.RWMutex
	protocolVersion string
}

func NewProxyWithVersion(instance, token, version string) *Proxy {
	version = strings.TrimSpace(version)
	if version == "" {
		version = defaultVersion
	}
	return &Proxy{
		Endpoint:  strings.TrimRight(instance, "/") + "/mcp",
		Token:     token,
		HTTP:      &http.Client{Timeout: 60 * time.Second},
		UserAgent: "openpost-mcp/" + version,
	}
}

func (p *Proxy) Serve(ctx context.Context, in io.Reader, out io.Writer) error {
	reader := bufio.NewReader(in)
	for {
		frame, format, err := readFrame(reader)
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
		resp, err := p.forward(ctx, frame)
		if err != nil {
			resp = jsonRPCError(frame, err)
		}
		if len(resp) == 0 {
			continue
		}
		if err := writeFrame(out, resp, format); err != nil {
			return err
		}
	}
}

func (p *Proxy) forward(ctx context.Context, frame []byte) ([]byte, error) {
	if strings.TrimSpace(p.Endpoint) == "" {
		return nil, fmt.Errorf("endpoint is required")
	}
	if _, err := url.ParseRequestURI(p.Endpoint); err != nil {
		return nil, fmt.Errorf("invalid endpoint: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.Endpoint, bytes.NewReader(frame))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("User-Agent", p.UserAgent)
	isInitialize := mcpInitializeRequest(frame)
	if protocolVersion := p.negotiatedProtocolVersion(); protocolVersion != "" && !isInitialize {
		req.Header.Set("MCP-Protocol-Version", protocolVersion)
	}
	if p.Token != "" {
		req.Header.Set("Authorization", "Bearer "+p.Token)
	}

	client := p.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message := strings.TrimSpace(string(body))
		if message == "" {
			message = resp.Status
		}
		return nil, fmt.Errorf("remote MCP returned HTTP %d: %s", resp.StatusCode, message)
	}
	if isInitialize {
		p.setNegotiatedProtocolVersion(mcpInitializeResponseVersion(body))
	}
	return body, nil
}

func readFrame(r *bufio.Reader) ([]byte, frameFormat, error) {
	firstLine, err := readMCPLine(r)
	if err != nil {
		return nil, frameFormatNewline, err
	}
	for len(bytes.TrimSpace(firstLine)) == 0 {
		firstLine, err = readMCPLine(r)
		if err != nil {
			return nil, frameFormatNewline, err
		}
	}
	if json.Valid(firstLine) {
		return bytes.TrimSpace(firstLine), frameFormatNewline, nil
	}

	headers := map[string]string{}
	line := string(firstLine)
	for line != "" {
		name, value, ok := strings.Cut(line, ":")
		if !ok {
			return nil, frameFormatContentLength, fmt.Errorf("invalid newline-delimited JSON or legacy MCP header line %q", line)
		}
		headers[strings.ToLower(strings.TrimSpace(name))] = strings.TrimSpace(value)
		nextLine, err := readMCPLine(r)
		if err != nil {
			return nil, frameFormatContentLength, err
		}
		line = string(nextLine)
	}

	rawLength := headers[contentLengthHeader]
	if rawLength == "" {
		return nil, frameFormatContentLength, fmt.Errorf("missing Content-Length header in legacy MCP frame")
	}
	length, err := strconv.Atoi(rawLength)
	if err != nil || length < 0 || length > maxFrameBytes {
		return nil, frameFormatContentLength, fmt.Errorf("invalid Content-Length %q", rawLength)
	}
	body := make([]byte, length)
	if _, err := io.ReadFull(r, body); err != nil {
		return nil, frameFormatContentLength, err
	}
	if !json.Valid(body) {
		return nil, frameFormatContentLength, fmt.Errorf("legacy MCP frame body is not valid JSON")
	}
	return body, frameFormatContentLength, nil
}

func writeFrame(w io.Writer, body []byte, format frameFormat) error {
	if len(body) > maxFrameBytes {
		return fmt.Errorf("MCP frame exceeds %d-byte limit", maxFrameBytes)
	}
	if !json.Valid(body) {
		return fmt.Errorf("MCP frame body is not valid JSON")
	}
	if format == frameFormatContentLength {
		if _, err := fmt.Fprintf(w, "Content-Length: %d\r\n\r\n", len(body)); err != nil {
			return err
		}
		_, err := w.Write(body)
		return err
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, body); err != nil {
		return fmt.Errorf("compact newline-delimited MCP frame: %w", err)
	}
	if _, err := w.Write(compact.Bytes()); err != nil {
		return err
	}
	_, err := io.WriteString(w, "\n")
	return err
}

func readMCPLine(r *bufio.Reader) ([]byte, error) {
	line := make([]byte, 0, 1024)
	for {
		part, prefix, err := r.ReadLine()
		if err != nil {
			return nil, err
		}
		if len(line)+len(part) > maxFrameBytes {
			return nil, fmt.Errorf("MCP frame exceeds %d-byte limit", maxFrameBytes)
		}
		line = append(line, part...)
		if !prefix {
			return line, nil
		}
	}
}

func mcpInitializeRequest(frame []byte) bool {
	var message struct {
		Method string `json:"method"`
	}
	return json.Unmarshal(frame, &message) == nil && message.Method == "initialize"
}

func mcpInitializeResponseVersion(frame []byte) string {
	var message struct {
		Result struct {
			ProtocolVersion string `json:"protocolVersion"`
		} `json:"result"`
	}
	if json.Unmarshal(frame, &message) != nil {
		return ""
	}
	return strings.TrimSpace(message.Result.ProtocolVersion)
}

func (p *Proxy) negotiatedProtocolVersion() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.protocolVersion
}

func (p *Proxy) setNegotiatedProtocolVersion(version string) {
	version = strings.TrimSpace(version)
	if version == "" {
		return
	}
	p.mu.Lock()
	p.protocolVersion = version
	p.mu.Unlock()
}

func jsonRPCError(request []byte, cause error) []byte {
	var in struct {
		ID any `json:"id,omitempty"`
	}
	_ = json.Unmarshal(request, &in)
	payload := struct {
		JSONRPC string `json:"jsonrpc"`
		ID      any    `json:"id,omitempty"`
		Error   struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}{
		JSONRPC: "2.0",
		ID:      in.ID,
	}
	payload.Error.Code = -32000
	payload.Error.Message = cause.Error()
	out, err := json.Marshal(payload)
	if err != nil {
		return []byte(`{"jsonrpc":"2.0","error":{"code":-32000,"message":"proxy error"}}`)
	}
	return out
}
