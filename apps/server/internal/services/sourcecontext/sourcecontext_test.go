package sourcecontext

import (
	"context"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type resolverFunc func(context.Context, string) ([]net.IPAddr, error)

func (function resolverFunc) LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error) {
	return function(ctx, host)
}

func TestLoadRejectsPrivateLocalCredentialsAndCustomPorts(t *testing.T) {
	t.Parallel()

	loader, err := New(Config{})
	require.NoError(t, err)

	tests := []struct {
		name string
		url  string
		want error
	}{
		{name: "loopback IPv4", url: "http://127.0.0.1/private", want: ErrURLNotPublic},
		{name: "private IPv4", url: "http://10.0.0.8/private", want: ErrURLNotPublic},
		{name: "loopback IPv6", url: "http://[::1]/private", want: ErrURLNotPublic},
		{name: "local hostname", url: "http://localhost/private", want: ErrURLNotPublic},
		{name: "credentials", url: "https://user:secret@example.com/private", want: ErrCredentialsNotAllowed},
		{name: "custom port", url: "https://example.com:8443/private", want: ErrCustomPortNotAllowed},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, loadErr := loader.Load(t.Context(), test.url)
			require.ErrorIs(t, loadErr, test.want)
		})
	}
}

func TestLoadRejectsDialTimeDNSRebinding(t *testing.T) {
	t.Parallel()

	var mutex sync.Mutex
	lookups := 0
	resolver := resolverFunc(func(context.Context, string) ([]net.IPAddr, error) {
		mutex.Lock()
		defer mutex.Unlock()
		lookups++
		if lookups == 1 {
			return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
		}
		return []net.IPAddr{{IP: net.ParseIP("127.0.0.1")}}, nil
	})
	loader, err := newURLLoader(Config{Timeout: 250 * time.Millisecond}, resolver, nil)
	require.NoError(t, err)

	_, err = loader.Load(t.Context(), "http://rebind.example/article")
	require.ErrorIs(t, err, ErrFetchFailed)
	require.GreaterOrEqual(t, lookups, 2)
}
