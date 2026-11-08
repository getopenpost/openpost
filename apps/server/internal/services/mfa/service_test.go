package mfa

import "testing"

// Self-hosted instances served from an IP address must still start; browsers
// simply offer no passkeys there.
func TestNewServiceAcceptsIPHostedInstances(t *testing.T) {
	if _, err := NewService("OpenPost", RelyingPartyConfig{
		Name:    "OpenPost",
		ID:      "192.168.1.10",
		Origins: []string{"http://192.168.1.10:8080"},
	}); err != nil {
		t.Fatalf("NewService rejected an IP-hosted instance: %v", err)
	}
}
