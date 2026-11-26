package netguard

import (
	"fmt"
	"net/netip"
)

// ParseTrustedProxyPrefix keeps CIDRs in the same address family as unmapped
// socket peers. Mapped ranges wider than IPv4's mapped namespace are invalid.
func ParseTrustedProxyPrefix(cidr string) (netip.Prefix, error) {
	return parseUnmappedPrefix(cidr, "proxy")
}

func parseUnmappedPrefix(cidr, kind string) (netip.Prefix, error) {
	prefix, err := netip.ParsePrefix(cidr)
	if err != nil {
		return netip.Prefix{}, err
	}
	if prefix.Addr().Is4In6() {
		if prefix.Bits() < 96 {
			return netip.Prefix{}, fmt.Errorf("IPv4-mapped %s CIDR must have at least 96 prefix bits", kind)
		}
		prefix = netip.PrefixFrom(prefix.Addr().Unmap(), prefix.Bits()-96)
	}
	return prefix.Masked(), nil
}
