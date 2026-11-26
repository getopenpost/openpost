package netguard

import (
	"net"
	"net/netip"
	"slices"
	"sync/atomic"
)

var allowedPrivateNetworks atomic.Pointer[[]netip.Prefix]

// ParsePrivateNetworkPrefix parses an operator network for AllowPrivateNetworks.
// Addresses are compared unmapped, so IPv4-mapped CIDRs are unmapped too.
func ParsePrivateNetworkPrefix(cidr string) (netip.Prefix, error) {
	return parseUnmappedPrefix(cidr, "private network")
}

// AllowPrivateNetworks replaces the operator networks that outbound requests
// may reach although they are private or local, such as a sibling service on
// the same host or a VPN mesh. It applies to every URLPolicy, at validation,
// dial and redirect time. IsPublicAddress is unaffected because it answers
// whether third parties can reach an address.
func AllowPrivateNetworks(prefixes []netip.Prefix) {
	allowed := slices.Clone(prefixes)
	allowedPrivateNetworks.Store(&allowed)
}

func isAllowedPrivateAddress(ip net.IP) bool {
	allowed := allowedPrivateNetworks.Load()
	if allowed == nil {
		return false
	}
	addr, ok := netip.AddrFromSlice(ip)
	if !ok {
		return false
	}
	addr = addr.Unmap()
	return slices.ContainsFunc(*allowed, func(prefix netip.Prefix) bool {
		return prefix.Contains(addr)
	})
}
