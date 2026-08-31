package connectors

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
)

const (
	configVersion       = 1
	maxConfigBytes      = 1 << 20
	maxBearerTokenBytes = 8 << 10
)

const (
	TransportPublicHTTPS  = "public_https"
	TransportPrivateAllow = "private_allowlist"
	TransportUnixSocket   = "unix_socket"
)

var installationIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)

type Config struct {
	Version       int
	Installations []InstallationConfig
}

type InstallationConfig struct {
	ID                 string
	Required           bool
	WorkspaceAllowlist []string
	Endpoint           EndpointConfig
	BearerTokenFile    string
	BearerToken        string
}

type EndpointConfig struct {
	Mode         string
	BaseURL      string
	SocketPath   string
	AllowedHosts []string
	AllowedCIDRs []netip.Prefix
	AllowedPorts []int
}

type configFile struct {
	Version       int                      `json:"version"`
	Installations []installationConfigFile `json:"installations"`
}

type installationConfigFile struct {
	ID                 string             `json:"id"`
	Required           bool               `json:"required"`
	WorkspaceAllowlist []string           `json:"workspace_allowlist"`
	Endpoint           endpointConfigFile `json:"endpoint"`
	Auth               authConfigFile     `json:"auth"`
}

type endpointConfigFile struct {
	Mode         string   `json:"mode"`
	BaseURL      string   `json:"base_url"`
	SocketPath   string   `json:"socket_path"`
	AllowedHosts []string `json:"allowed_hosts"`
	AllowedCIDRs []string `json:"allowed_cidrs"`
	AllowedPorts []int    `json:"allowed_ports"`
}

type authConfigFile struct {
	BearerTokenFile string `json:"bearer_token_file"`
}

func LoadConfig(path string) (Config, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return Config{Version: configVersion}, nil
	}
	if !filepath.IsAbs(path) {
		return Config{}, fmt.Errorf("connector config path must be an absolute path")
	}
	raw, err := readBoundedFile(path, maxConfigBytes)
	if err != nil {
		return Config{}, fmt.Errorf("read connector config: %w", err)
	}
	var source configFile
	if err := decodeStrictJSON(raw, &source); err != nil {
		return Config{}, fmt.Errorf("decode connector config: %w", err)
	}
	if source.Version != configVersion {
		return Config{}, fmt.Errorf("unsupported connector config version %d", source.Version)
	}

	result := Config{Version: source.Version, Installations: make([]InstallationConfig, 0, len(source.Installations))}
	seen := make(map[string]struct{}, len(source.Installations))
	for index, item := range source.Installations {
		installation, err := loadInstallation(item)
		if err != nil {
			return Config{}, fmt.Errorf("connector installation %d: %w", index, err)
		}
		if _, ok := seen[installation.ID]; ok {
			return Config{}, fmt.Errorf("duplicate connector installation id %q", installation.ID)
		}
		seen[installation.ID] = struct{}{}
		result.Installations = append(result.Installations, installation)
	}
	return result, nil
}

func loadInstallation(source installationConfigFile) (InstallationConfig, error) {
	id := strings.TrimSpace(source.ID)
	if !installationIDPattern.MatchString(id) {
		return InstallationConfig{}, fmt.Errorf("id %q must match %s", id, installationIDPattern)
	}
	endpoint, err := normalizeEndpoint(source.Endpoint)
	if err != nil {
		return InstallationConfig{}, err
	}
	tokenFile := strings.TrimSpace(source.Auth.BearerTokenFile)
	if !filepath.IsAbs(tokenFile) {
		return InstallationConfig{}, fmt.Errorf("bearer_token_file must be an absolute path")
	}
	tokenBytes, err := readBoundedFile(tokenFile, maxBearerTokenBytes)
	if err != nil {
		return InstallationConfig{}, fmt.Errorf("read bearer_token_file: %w", err)
	}
	token := strings.TrimSpace(string(tokenBytes))
	if token == "" {
		return InstallationConfig{}, fmt.Errorf("bearer_token_file is empty")
	}
	if strings.ContainsRune(token, '\x00') || strings.ContainsAny(token, "\r\n") {
		return InstallationConfig{}, fmt.Errorf("bearer_token_file must contain one token")
	}
	workspaces, err := normalizedUniqueStrings(source.WorkspaceAllowlist, "workspace_allowlist")
	if err != nil {
		return InstallationConfig{}, err
	}
	return InstallationConfig{
		ID: id, Required: source.Required, WorkspaceAllowlist: workspaces,
		Endpoint: endpoint, BearerTokenFile: tokenFile, BearerToken: token,
	}, nil
}

func normalizeEndpoint(source endpointConfigFile) (EndpointConfig, error) {
	mode := strings.TrimSpace(source.Mode)
	baseURL := strings.TrimRight(strings.TrimSpace(source.BaseURL), "/")
	socketPath := strings.TrimSpace(source.SocketPath)
	hosts, err := normalizeAllowedHosts(source.AllowedHosts)
	if err != nil {
		return EndpointConfig{}, err
	}
	ports, err := normalizeAllowedPorts(source.AllowedPorts)
	if err != nil {
		return EndpointConfig{}, err
	}
	prefixes, err := normalizeAllowedCIDRs(source.AllowedCIDRs)
	if err != nil {
		return EndpointConfig{}, err
	}

	result := EndpointConfig{
		Mode: mode, BaseURL: baseURL, SocketPath: socketPath,
		AllowedHosts: hosts, AllowedCIDRs: prefixes, AllowedPorts: ports,
	}
	if err := validateEndpointConfig(&result); err != nil {
		return EndpointConfig{}, err
	}
	return result, nil
}

func normalizeAllowedHosts(values []string) ([]string, error) {
	hosts, err := normalizedUniqueStrings(values, "allowed_hosts")
	if err != nil {
		return nil, err
	}
	for index := range hosts {
		hosts[index] = strings.ToLower(hosts[index])
	}
	return hosts, nil
}

func normalizeAllowedPorts(values []int) ([]int, error) {
	ports := slices.Clone(values)
	slices.Sort(ports)
	ports = slices.Compact(ports)
	for _, port := range ports {
		if port < 1 || port > 65535 {
			return nil, fmt.Errorf("allowed port %d is outside 1 through 65535", port)
		}
	}
	return ports, nil
}

func normalizeAllowedCIDRs(values []string) ([]netip.Prefix, error) {
	prefixes := make([]netip.Prefix, 0, len(values))
	for _, raw := range values {
		prefix, err := netip.ParsePrefix(strings.TrimSpace(raw))
		if err != nil {
			return nil, fmt.Errorf("invalid allowed CIDR %q", raw)
		}
		prefixes = append(prefixes, prefix.Masked())
	}
	return prefixes, nil
}

func validateEndpointConfig(endpoint *EndpointConfig) error {
	switch endpoint.Mode {
	case TransportPublicHTTPS:
		return validatePublicEndpoint(*endpoint)
	case TransportPrivateAllow:
		return validatePrivateEndpoint(*endpoint)
	case TransportUnixSocket:
		return validateUnixEndpoint(endpoint)
	default:
		return fmt.Errorf("unsupported endpoint mode %q", endpoint.Mode)
	}
}

func validatePublicEndpoint(endpoint EndpointConfig) error {
	if err := validateBaseURL(endpoint.BaseURL, "https"); err != nil {
		return err
	}
	if endpoint.SocketPath != "" || len(endpoint.AllowedHosts) != 0 || len(endpoint.AllowedCIDRs) != 0 || len(endpoint.AllowedPorts) != 0 {
		return fmt.Errorf("public_https cannot include private or Unix allowlist fields")
	}
	return nil
}

func validatePrivateEndpoint(endpoint EndpointConfig) error {
	if err := validateBaseURL(endpoint.BaseURL, "http", "https"); err != nil {
		return err
	}
	parsed, _ := url.Parse(endpoint.BaseURL)
	if !slices.Contains(endpoint.AllowedHosts, strings.ToLower(parsed.Hostname())) {
		return fmt.Errorf("private base_url host must appear in allowed_hosts")
	}
	if len(endpoint.AllowedCIDRs) == 0 {
		return fmt.Errorf("private_allowlist requires allowed_cidrs")
	}
	if !slices.Contains(endpoint.AllowedPorts, endpointPort(parsed)) {
		return fmt.Errorf("private base_url port must appear in allowed_ports")
	}
	if endpoint.SocketPath != "" {
		return fmt.Errorf("private_allowlist cannot include socket_path")
	}
	return nil
}

func endpointPort(endpoint *url.URL) int {
	if endpoint.Port() != "" {
		return parsePort(endpoint.Port())
	}
	if endpoint.Scheme == "https" {
		return 443
	}
	return 80
}

func validateUnixEndpoint(endpoint *EndpointConfig) error {
	if !filepath.IsAbs(endpoint.SocketPath) {
		return fmt.Errorf("socket_path must be an absolute path")
	}
	if endpoint.BaseURL != "" || len(endpoint.AllowedHosts) != 0 || len(endpoint.AllowedCIDRs) != 0 || len(endpoint.AllowedPorts) != 0 {
		return fmt.Errorf("unix_socket cannot include HTTP allowlist fields")
	}
	endpoint.BaseURL = "http://connector"
	return nil
}

func validateBaseURL(raw string, schemes ...string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Hostname() == "" {
		return fmt.Errorf("base_url must be an absolute URL")
	}
	if !slices.Contains(schemes, parsed.Scheme) {
		return fmt.Errorf("base_url scheme must be %s", strings.Join(schemes, " or "))
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return fmt.Errorf("base_url cannot include credentials, a path, query, or fragment")
	}
	return nil
}

func parsePort(raw string) int {
	var port int
	_, _ = fmt.Sscanf(raw, "%d", &port)
	return port
}

func normalizedUniqueStrings(values []string, label string) ([]string, error) {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			return nil, fmt.Errorf("%s cannot contain an empty value", label)
		}
		if _, ok := seen[value]; ok {
			return nil, fmt.Errorf("%s contains duplicate value %q", label, value)
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result, nil
}

func readBoundedFile(path string, limit int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("file exceeds %d bytes", limit)
	}
	return data, nil
}

func decodeStrictJSON(raw []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		if err == nil {
			return fmt.Errorf("multiple JSON values are not allowed")
		}
		return err
	}
	return nil
}

func installationFingerprint(installation InstallationConfig) string {
	cidrs := make([]string, 0, len(installation.Endpoint.AllowedCIDRs))
	for _, prefix := range installation.Endpoint.AllowedCIDRs {
		cidrs = append(cidrs, prefix.String())
	}
	payload := struct {
		ID                 string   `json:"id"`
		Required           bool     `json:"required"`
		WorkspaceAllowlist []string `json:"workspace_allowlist"`
		Mode               string   `json:"mode"`
		BaseURL            string   `json:"base_url"`
		SocketPath         string   `json:"socket_path"`
		AllowedHosts       []string `json:"allowed_hosts"`
		AllowedCIDRs       []string `json:"allowed_cidrs"`
		AllowedPorts       []int    `json:"allowed_ports"`
		BearerTokenFile    string   `json:"bearer_token_file"`
	}{
		ID: installation.ID, Required: installation.Required,
		WorkspaceAllowlist: installation.WorkspaceAllowlist,
		Mode:               installation.Endpoint.Mode, BaseURL: installation.Endpoint.BaseURL,
		SocketPath: installation.Endpoint.SocketPath, AllowedHosts: installation.Endpoint.AllowedHosts,
		AllowedCIDRs: cidrs, AllowedPorts: installation.Endpoint.AllowedPorts,
		BearerTokenFile: installation.BearerTokenFile,
	}
	encoded, _ := json.Marshal(payload)
	digest := sha256.Sum256(encoded)
	return fmt.Sprintf("sha256:%x", digest)
}
