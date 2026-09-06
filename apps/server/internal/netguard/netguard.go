package netguard

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"slices"
	"strings"
	"time"
)

type Resolver interface {
	LookupIPAddr(context.Context, string) ([]net.IPAddr, error)
}

type URLPolicy struct {
	Label            string
	AllowedSchemes   []string
	AllowCustomPorts bool
	Resolver         Resolver
}

type lookupResolver struct{}

func (lookupResolver) LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error) {
	return net.DefaultResolver.LookupIPAddr(ctx, host)
}

var blockedPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("169.254.0.0/16"),
	netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.168.0.0/16"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("224.0.0.0/4"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("::/128"),
	netip.MustParsePrefix("::1/128"),
	netip.MustParsePrefix("100::/64"),
	netip.MustParsePrefix("fc00::/7"),
	netip.MustParsePrefix("fe80::/10"),
	netip.MustParsePrefix("ff00::/8"),
	netip.MustParsePrefix("2001:db8::/32"),
}

func ValidateURL(ctx context.Context, remote *url.URL, policy URLPolicy) error {
	label := policy.label()
	if remote == nil || remote.Hostname() == "" {
		return fmt.Errorf("%s must be absolute", label)
	}
	if !slices.Contains(policy.AllowedSchemes, remote.Scheme) {
		return fmt.Errorf("%s scheme must be %s", label, formatSchemes(policy.AllowedSchemes))
	}
	if !policy.AllowCustomPorts && remote.Port() != "" && remote.Port() != defaultPort(remote.Scheme) {
		return fmt.Errorf("%s cannot include a custom port", label)
	}
	if _, err := resolvePublicHost(ctx, remote.Hostname(), policy); err != nil {
		return err
	}
	return nil
}

func NewHTTPClient(timeout time.Duration, policy URLPolicy) *http.Client {
	return &http.Client{
		Timeout:   timeout,
		Transport: NewTransport(policy),
		CheckRedirect: func(req *http.Request, _ []*http.Request) error {
			return ValidateURL(req.Context(), req.URL, policy)
		},
	}
}

func NewTransport(policy URLPolicy) *http.Transport {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	dialer := &net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := resolvePublicHost(ctx, host, policy)
		if err != nil {
			return nil, err
		}
		var lastErr error
		for _, addr := range ips {
			conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(addr.IP.String(), port))
			if err == nil {
				return conn, nil
			}
			lastErr = err
		}
		if lastErr != nil {
			return nil, lastErr
		}
		return nil, fmt.Errorf("%s host did not resolve", policy.label())
	}
	return transport
}

func resolvePublicHost(ctx context.Context, host string, policy URLPolicy) ([]net.IPAddr, error) {
	label := policy.label()
	resolver := policy.Resolver
	if resolver == nil {
		resolver = lookupResolver{}
	}
	ips, err := resolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve %s host", label)
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("%s host did not resolve", label)
	}
	for _, addr := range ips {
		if !IsPublicAddress(addr.IP) {
			return nil, fmt.Errorf("%s host resolves to a private or local address", label)
		}
	}
	return ips, nil
}

func IsPublicAddress(ip net.IP) bool {
	addr, ok := netip.AddrFromSlice(ip)
	if !ok {
		return false
	}
	addr = addr.Unmap()
	for _, prefix := range blockedPrefixes {
		if prefix.Contains(addr) {
			return false
		}
	}
	return addr.IsGlobalUnicast()
}

func (p URLPolicy) label() string {
	if p.Label == "" {
		return "url"
	}
	return p.Label
}

func defaultPort(scheme string) string {
	switch scheme {
	case "http":
		return "80"
	case "https":
		return "443"
	default:
		return ""
	}
}

func formatSchemes(schemes []string) string {
	switch len(schemes) {
	case 0:
		return "a supported scheme"
	case 1:
		return schemes[0]
	case 2:
		return schemes[0] + " or " + schemes[1]
	default:
		return strings.Join(schemes[:len(schemes)-1], ", ") + ", or " + schemes[len(schemes)-1]
	}
}
