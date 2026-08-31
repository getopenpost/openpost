package connectors

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/openpost/backend/internal/netguard"
)

const maxResponseBytes = 1 << 20

type Resolver interface {
	LookupIPAddr(context.Context, string) ([]net.IPAddr, error)
}

type ClientOptions struct {
	Timeout  time.Duration
	Resolver Resolver
}

type Client struct {
	installation InstallationConfig
	baseURL      *url.URL
	http         *http.Client
}

func NewClient(installation InstallationConfig, options ClientOptions) (*Client, error) {
	if !installationIDPattern.MatchString(installation.ID) {
		return nil, fmt.Errorf("connector installation id %q is invalid", installation.ID)
	}
	if strings.TrimSpace(installation.BearerToken) == "" {
		return nil, fmt.Errorf("connector bearer token is required")
	}
	baseURL, err := url.Parse(installation.Endpoint.BaseURL)
	if err != nil || baseURL.Hostname() == "" {
		return nil, fmt.Errorf("connector base URL is invalid")
	}
	timeout := options.Timeout
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	var transport http.RoundTripper
	switch installation.Endpoint.Mode {
	case TransportPublicHTTPS:
		policy := netguard.URLPolicy{
			Label: "connector endpoint", AllowedSchemes: []string{"https"}, Resolver: options.Resolver,
		}
		if err := netguard.ValidateURL(context.Background(), baseURL, policy); err != nil {
			return nil, err
		}
		transport = netguard.NewTransport(policy)
	case TransportPrivateAllow:
		transport, err = newPrivateTransport(installation.Endpoint, options.Resolver)
		if err != nil {
			return nil, err
		}
	case TransportUnixSocket:
		if installation.Endpoint.SocketPath == "" {
			return nil, fmt.Errorf("connector Unix socket path is required")
		}
		transport = newUnixTransport(installation.Endpoint.SocketPath)
	default:
		return nil, fmt.Errorf("unsupported connector transport %q", installation.Endpoint.Mode)
	}
	return &Client{
		installation: installation,
		baseURL:      baseURL,
		http: &http.Client{
			Timeout: timeout, Transport: transport,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}, nil
}

func (c *Client) Installation() InstallationConfig {
	return c.installation
}

func (c *Client) Manifest(ctx context.Context) (Manifest, error) {
	var response Manifest
	if err := c.doJSON(ctx, http.MethodGet, "/v1/manifest", nil, &response); err != nil {
		return Manifest{}, err
	}
	if err := ValidateManifest(&response); err != nil {
		return Manifest{}, fmt.Errorf("invalid connector manifest: %w", err)
	}
	return response, nil
}

func (c *Client) Health(ctx context.Context) error {
	var response HealthResponse
	if err := c.doJSON(ctx, http.MethodGet, "/v1/health", nil, &response); err != nil {
		return err
	}
	if response.Status != "ready" {
		return fmt.Errorf("connector health is %q", response.Status)
	}
	return nil
}

func (c *Client) Connect(ctx context.Context, request ConnectionRequest) (ConnectionResponse, error) {
	if strings.TrimSpace(request.WorkspaceID) == "" {
		return ConnectionResponse{}, fmt.Errorf("workspace id is required")
	}
	var response ConnectionResponse
	if err := c.doJSON(ctx, http.MethodPost, "/v1/connections", request, &response); err != nil {
		return ConnectionResponse{}, err
	}
	if err := validateConnectionResponse(response); err != nil {
		return ConnectionResponse{}, err
	}
	return response, nil
}

func (c *Client) ResolveCapabilities(ctx context.Context, request CapabilityResolveRequest) (CapabilityResolveResponse, error) {
	var response CapabilityResolveResponse
	if err := c.doJSON(ctx, http.MethodPost, "/v1/capabilities/resolve", request, &response); err != nil {
		return CapabilityResolveResponse{}, err
	}
	if !opaqueIDPattern.MatchString(response.CapabilityRevision) {
		return CapabilityResolveResponse{}, fmt.Errorf("connector returned an invalid capability revision")
	}
	return response, nil
}

func (c *Client) Publish(ctx context.Context, request PublishRequest) (PublishResponse, error) {
	if !opaqueIDPattern.MatchString(request.OperationID) {
		return PublishResponse{}, fmt.Errorf("connector operation id is invalid")
	}
	if strings.TrimSpace(request.ConnectionRef) == "" || len(request.ConnectionRef) > 512 {
		return PublishResponse{}, fmt.Errorf("connector connection reference is invalid")
	}
	if !opaqueIDPattern.MatchString(request.CapabilityRevision) || !opaqueIDPattern.MatchString(request.OutputProfile) {
		return PublishResponse{}, fmt.Errorf("connector publish capability identity is invalid")
	}
	if len(request.Content) > 1_000_000 || len(request.Title) > 100_000 || len(request.Description) > 100_000 {
		return PublishResponse{}, fmt.Errorf("connector publish content exceeds the protocol limit")
	}
	var response PublishResponse
	if err := c.doJSON(ctx, http.MethodPost, "/v1/publishes", request, &response); err != nil {
		return PublishResponse{}, err
	}
	if err := validatePublishResponse(response); err != nil {
		return PublishResponse{}, err
	}
	return response, nil
}

func (c *Client) Operation(ctx context.Context, operationID string) (PublishResponse, error) {
	if !opaqueIDPattern.MatchString(operationID) {
		return PublishResponse{}, fmt.Errorf("connector operation id is invalid")
	}
	var response PublishResponse
	if err := c.doJSON(ctx, http.MethodGet, "/v1/operations/"+url.PathEscape(operationID), nil, &response); err != nil {
		return PublishResponse{}, err
	}
	if err := validatePublishResponse(response); err != nil {
		return PublishResponse{}, err
	}
	return response, nil
}

func (c *Client) doJSON(ctx context.Context, method, path string, input, output any) error {
	endpoint := c.baseURL.ResolveReference(&url.URL{Path: path})
	var body io.Reader
	if input != nil {
		encoded, err := json.Marshal(input)
		if err != nil {
			return fmt.Errorf("encode connector request: %w", err)
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint.String(), body)
	if err != nil {
		return fmt.Errorf("create connector request: %w", err)
	}
	request.Header.Set("Accept", "application/json, application/problem+json")
	request.Header.Set("Authorization", "Bearer "+c.installation.BearerToken)
	if input != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := c.http.Do(request)
	if err != nil {
		return fmt.Errorf("connector request failed: %w", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		return fmt.Errorf("read connector response: %w", err)
	}
	if len(raw) > maxResponseBytes {
		return fmt.Errorf("connector response exceeds %d bytes", maxResponseBytes)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		problem := Problem{Status: response.StatusCode}
		_ = json.Unmarshal(raw, &problem)
		return &HTTPError{StatusCode: response.StatusCode, Problem: problem}
	}
	if output == nil {
		return nil
	}
	if len(raw) == 0 {
		return fmt.Errorf("connector returned an empty response")
	}
	if err := json.Unmarshal(raw, output); err != nil {
		return fmt.Errorf("decode connector response: %w", err)
	}
	return nil
}

func validateConnectionResponse(response ConnectionResponse) error {
	if response.State != "complete" {
		return fmt.Errorf("connector protocol 1.0 preconfigured connection must complete immediately")
	}
	if strings.TrimSpace(response.ConnectionRef) == "" || len(response.ConnectionRef) > 512 {
		return fmt.Errorf("connector returned an invalid connection reference")
	}
	if len(response.Accounts) == 0 || len(response.Accounts) > 100 {
		return fmt.Errorf("connector returned an invalid account count")
	}
	seen := make(map[string]struct{}, len(response.Accounts))
	for _, account := range response.Accounts {
		if err := validateConnectionAccount(account, seen); err != nil {
			return err
		}
	}
	return nil
}

func validateConnectionAccount(account ConnectionAccount, seen map[string]struct{}) error {
	if !opaqueIDPattern.MatchString(account.ID) {
		return fmt.Errorf("connector returned invalid account id %q", account.ID)
	}
	if _, ok := seen[account.ID]; ok {
		return fmt.Errorf("connector returned duplicate account id %q", account.ID)
	}
	seen[account.ID] = struct{}{}
	if err := validateOptionalText("account username", account.Username, 120); err != nil {
		return err
	}
	if err := validateOptionalText("account display_name", account.DisplayName, 120); err != nil {
		return err
	}
	if account.AvatarURL == "" {
		return nil
	}
	if err := validateHTTPSURL(account.AvatarURL); err != nil {
		return fmt.Errorf("connector returned an invalid account avatar URL")
	}
	return nil
}

func validatePublishResponse(response PublishResponse) error {
	if err := validatePublishStatus(response); err != nil {
		return err
	}
	if response.ExternalURL != "" {
		if err := validateHTTPSURL(response.ExternalURL); err != nil {
			return fmt.Errorf("connector returned an invalid external URL")
		}
	}
	if response.IdempotencyTTL < 0 || response.IdempotencyTTL > int((365*24*time.Hour)/time.Second) {
		return fmt.Errorf("connector returned an invalid idempotency TTL")
	}
	return nil
}

func validatePublishStatus(response PublishResponse) error {
	switch response.Status {
	case "published":
		if strings.TrimSpace(response.ExternalID) == "" || len(response.ExternalID) > 1024 {
			return fmt.Errorf("published connector response requires an external id")
		}
	case "pending":
		if strings.TrimSpace(response.ProviderReference) == "" || response.PollAfterSeconds < 1 || response.PollAfterSeconds > 3600 {
			return fmt.Errorf("pending connector response requires a provider reference and bounded poll delay")
		}
	case "failed":
		return fmt.Errorf("failed publish responses must use application/problem+json")
	default:
		return fmt.Errorf("connector returned unsupported publish status %q", response.Status)
	}
	return nil
}

func validateHTTPSURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
		return fmt.Errorf("invalid HTTPS URL")
	}
	return nil
}

func newPrivateTransport(endpoint EndpointConfig, resolver Resolver) (*http.Transport, error) {
	if resolver == nil {
		resolver = net.DefaultResolver
	}
	base, err := url.Parse(endpoint.BaseURL)
	if err != nil || base.Hostname() == "" {
		return nil, fmt.Errorf("private connector base URL is invalid")
	}
	if !slices.Contains(endpoint.AllowedHosts, strings.ToLower(base.Hostname())) {
		return nil, fmt.Errorf("private connector host is not allowlisted")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.TLSClientConfig = cloneTLSConfig(transport.TLSClientConfig)
	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		return dialPrivateConnector(ctx, network, address, endpoint, resolver, dialer)
	}
	return transport, nil
}

func dialPrivateConnector(
	ctx context.Context,
	network string,
	address string,
	endpoint EndpointConfig,
	resolver Resolver,
	dialer *net.Dialer,
) (net.Conn, error) {
	host, rawPort, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	if !slices.Contains(endpoint.AllowedHosts, strings.ToLower(host)) {
		return nil, fmt.Errorf("connector host is outside the private connector allowlist")
	}
	port, err := strconv.Atoi(rawPort)
	if err != nil || !slices.Contains(endpoint.AllowedPorts, port) {
		return nil, fmt.Errorf("connector port is outside the private connector allowlist")
	}
	addresses, err := allowedPrivateAddresses(ctx, resolver, host, endpoint.AllowedCIDRs)
	if err != nil {
		return nil, err
	}
	var lastErr error
	for _, candidate := range addresses {
		connection, dialErr := dialer.DialContext(
			ctx,
			network,
			net.JoinHostPort(candidate.IP.String(), rawPort),
		)
		if dialErr == nil {
			return connection, nil
		}
		lastErr = dialErr
	}
	return nil, lastErr
}

func allowedPrivateAddresses(
	ctx context.Context,
	resolver Resolver,
	host string,
	allowedCIDRs []netip.Prefix,
) ([]net.IPAddr, error) {
	addresses, err := resolver.LookupIPAddr(ctx, host)
	if err != nil || len(addresses) == 0 {
		return nil, fmt.Errorf("failed to resolve private connector host")
	}
	for _, address := range addresses {
		parsed, ok := netip.AddrFromSlice(address.IP)
		if !ok || !addressAllowed(parsed.Unmap(), allowedCIDRs) {
			return nil, fmt.Errorf("connector address is outside the private connector allowlist")
		}
	}
	return addresses, nil
}

func newUnixTransport(socketPath string) *http.Transport {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	transport.DialContext = func(ctx context.Context, _, _ string) (net.Conn, error) {
		return dialer.DialContext(ctx, "unix", socketPath)
	}
	return transport
}

func addressAllowed(address netip.Addr, prefixes []netip.Prefix) bool {
	for _, prefix := range prefixes {
		if prefix.Contains(address) {
			return true
		}
	}
	return false
}

func cloneTLSConfig(source *tls.Config) *tls.Config {
	if source == nil {
		return &tls.Config{MinVersion: tls.VersionTLS12}
	}
	result := source.Clone()
	if result.MinVersion < tls.VersionTLS12 {
		result.MinVersion = tls.VersionTLS12
	}
	return result
}

func fmtInt(value int) string {
	return strconv.Itoa(value)
}
