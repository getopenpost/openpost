package avatarfetch

import (
	"context"
	"net"

	"testing"
	"time"

	"github.com/openpost/backend/internal/netguard"
	"github.com/stretchr/testify/require"
)

type resolverFunc func(context.Context, string) ([]net.IPAddr, error)

func (fn resolverFunc) LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error) {
	return fn(ctx, host)
}

func publicResolver() netguard.Resolver {
	return resolverFunc(func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
	})
}

func TestFetchRejectsCredentialedURL(t *testing.T) {
	t.Parallel()

	_, err := Fetch(context.Background(), "https://user:secret@example.com/photo.jpg", Bounds{
		Label: "profile photo", Timeout: 5 * time.Second, MaxBytes: 4 * 1024 * 1024, Resolver: publicResolver(),
	})
	require.ErrorContains(t, err, "credential")
}
