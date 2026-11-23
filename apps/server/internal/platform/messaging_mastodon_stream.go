package platform

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/openpost/backend/internal/textutil"

	"github.com/openpost/backend/internal/netguard"
)

// MessageStreamAdapter opens an official live transport. connected must repair
// REST gaps before live events are applied. Each reconnection calls it again.
// The caller owns supervision, eligibility, and an account-wide durable lease.
type MessageStreamAdapter interface {
	StreamMessageEvents(context.Context, string, string, func(context.Context) error, func(context.Context, FetchMessageEventsResult) error) error
}

// StreamMessageEvents uses a dedicated HTTP client: the ordinary provider
// client has a 30-second total timeout and buffers responses.
func (m *MastodonAdapter) StreamMessageEvents(ctx context.Context, token, accountID string, connected func(context.Context) error, consume func(context.Context, FetchMessageEventsResult) error) error {
	endpoint, err := m.messageStreamURL(ctx)
	if err != nil {
		return err
	}
	policy := netguard.URLPolicy{Label: "Mastodon streaming URL", AllowedSchemes: []string{"https"}, AllowCustomPorts: true}
	if err = netguard.ValidateURL(ctx, endpoint, policy); err != nil {
		return err
	}
	transport := netguard.NewTransport(policy)
	transport.ResponseHeaderTimeout = 15 * time.Second
	transport.TLSHandshakeTimeout = 10 * time.Second
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	return m.consumeMessageStream(ctx, client, endpoint.String(), token, accountID, connected, consume)
}

func (m *MastodonAdapter) messageStreamURL(ctx context.Context) (*url.URL, error) {
	raw, err := m.messageStreamOrigin(ctx)
	if err != nil {
		return nil, err
	}
	endpoint, err := url.Parse(raw)
	if err != nil || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" {
		return nil, errors.New("invalid Mastodon streaming endpoint")
	}
	// The instance advertises a WebSocket origin; the same service owns SSE.
	if endpoint.Scheme == "wss" {
		endpoint.Scheme = "https"
	}
	if endpoint.Scheme != "https" {
		return nil, errors.New("mastodon streaming endpoint requires HTTPS")
	}
	endpoint.Path = strings.TrimRight(endpoint.Path, "/") + "/api/v1/streaming/direct"
	return endpoint, nil
}

func (m *MastodonAdapter) messageStreamOrigin(ctx context.Context) (string, error) {
	for _, path := range []string{"/api/v2/instance", "/api/v1/instance"} {
		body, err := DoRequest(ctx, http.MethodGet, strings.TrimRight(m.compat.instanceURL, "/")+path, nil, nil)
		if err != nil {
			var status *HTTPError
			if errors.As(err, &status) && status.StatusCode == http.StatusNotFound {
				continue
			}
			return "", err
		}
		var info struct {
			Configuration struct {
				URLs struct {
					Streaming string `json:"streaming"`
				} `json:"urls"`
			} `json:"configuration"`
			URLs struct {
				StreamingAPI string `json:"streaming_api"`
			} `json:"urls"`
		}
		if json.Unmarshal(body, &info) != nil {
			return "", errors.New("invalid Mastodon instance metadata")
		}
		if raw := textutil.FirstNonEmpty(info.Configuration.URLs.Streaming, info.URLs.StreamingAPI); raw != "" {
			return raw, nil
		}
	}
	return "", errors.New("mastodon instance does not advertise a streaming endpoint")
}

func (m *MastodonAdapter) consumeMessageStream(ctx context.Context, client *http.Client, endpoint, token, accountID string, connected func(context.Context) error, consume func(context.Context, FetchMessageEventsResult) error) error {
	if connected == nil || consume == nil {
		return errors.New("mastodon stream requires repair and event consumers")
	}
	streamCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	request, err := http.NewRequestWithContext(streamCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return errors.New("invalid Mastodon streaming request")
	}
	request.Header.Set("Authorization", bearerPrefix+token)
	request.Header.Set("Accept", "text/event-stream")
	response, err := client.Do(request)
	if err != nil {
		return sanitizeTransportError(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return NewHTTPError(response.StatusCode, response.Header, nil)
	}
	if !strings.HasPrefix(response.Header.Get("Content-Type"), "text/event-stream") {
		return errors.New("mastodon stream did not return event-stream")
	}
	// Reset on every byte chunk, including heartbeat comments. No whole-stream
	// timeout; an upstream that stops all traffic is canceled after 90 seconds.
	idle := time.AfterFunc(90*time.Second, cancel)
	defer idle.Stop()
	reader := &mastodonStreamReader{reader: response.Body, touch: func() { idle.Reset(90 * time.Second) }}
	if err = connected(streamCtx); err != nil {
		return err
	}
	return readMastodonMessageStream(reader, func(kind, payload string) error {
		return m.applyMessageStreamEvent(streamCtx, token, accountID, kind, payload, consume)
	})
}

func (m *MastodonAdapter) applyMessageStreamEvent(ctx context.Context, token, accountID, kind, payload string, consume func(context.Context, FetchMessageEventsResult) error) error {
	switch kind {
	case "conversation":
		var conversation mastodonMessageConversation
		if err := json.Unmarshal([]byte(payload), &conversation); err != nil {
			return errors.New("invalid Mastodon conversation event")
		}
		if conversation.ID == "" {
			return errors.New("missing Mastodon conversation identity")
		}
		result, err := m.hydrateMessageConversations(ctx, token, accountID, []mastodonMessageConversation{conversation})
		if err != nil {
			return err
		}
		return consume(ctx, FetchMessageEventsResult{Conversations: result.Conversations})
	case "delete":
		id := strings.Trim(payload, "\"")
		if id == "" {
			return errors.New("missing Mastodon deleted message identity")
		}
		// Core resolves an empty conversation ID by the account-scoped message ID.
		return consume(ctx, FetchMessageEventsResult{DeletedMessages: []DeletedProviderMessage{{MessageID: id}}})
	}
	return nil
}

func readMastodonMessageStream(reader io.Reader, consume func(string, string) error) error {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 4096), 1<<20)
	var kind string
	var data strings.Builder
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if data.Len() > 0 {
				if err := consume(kind, strings.TrimSuffix(data.String(), "\n")); err != nil {
					return err
				}
			}
			kind = ""
			data.Reset()
			continue
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		field, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		value = strings.TrimPrefix(value, " ")
		switch field {
		case "event":
			kind = value
		case "data":
			if data.Len()+len(value) > 1<<20 {
				return errors.New("mastodon stream event exceeds limit")
			}
			data.WriteString(value)
			data.WriteByte('\n')
		}
	}
	if err := scanner.Err(); err != nil {
		return sanitizeTransportError(err)
	}
	return io.ErrUnexpectedEOF
}

type mastodonStreamReader struct {
	reader io.Reader
	touch  func()
}

func (r *mastodonStreamReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	if n > 0 {
		r.touch()
	}
	return n, err
}
