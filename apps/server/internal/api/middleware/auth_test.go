package middleware

import (
	"context"

	"net/http"
	"net/http/httptest"

	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"

	"github.com/stretchr/testify/require"
)

// fakeAuthenticator stands in for the real composite authenticator.
// Each test sets nextErr/nextPrincipal to drive the middleware's
// behavior.
type fakeAuthenticator struct {
	principal *Principal
	err       error
	gotToken  string
}

func (f *fakeAuthenticator) AuthenticateBearer(_ context.Context, token string) (*Principal, error) {
	f.gotToken = token
	return f.principal, f.err
}

type humaAuthTestInput struct{}

type humaAuthTestOutput struct {
	Body struct {
		OK bool `json:"ok"`
	}
}

func newHumaAuthed(authenticator Authenticator, called *bool) *echo.Echo {
	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	huma.Register(api, huma.Operation{
		OperationID: "middleware-auth-test",
		Method:      http.MethodGet,
		Path:        "/auth-test",
		Middlewares: huma.Middlewares{AuthMiddleware(api, authenticator)},
	}, func(context.Context, *humaAuthTestInput) (*humaAuthTestOutput, error) {
		*called = true
		output := &humaAuthTestOutput{}
		output.Body.OK = true
		return output, nil
	})
	return e
}

func TestSessionBearerRejectsForeignOrigin(t *testing.T) {
	for _, origin := range []string{"https://evil.example", "http://app.openpost.test", "https://app.openpost.test:444"} {
		t.Run(origin, func(t *testing.T) {
			called := false
			e := newHumaAuthed(&fakeAuthenticator{principal: &Principal{UserID: "user", SessionID: "session"}}, &called)
			req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "https://app.openpost.test/api/v1/auth-test", nil)
			req.Header.Set("Authorization", "Bearer session-token")
			req.Header.Set("Origin", origin)
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, req)
			require.Equal(t, http.StatusForbidden, rec.Code)
			require.False(t, called)
		})
	}
}

func TestTrustedProxyNetworkAssertions(t *testing.T) {
	for _, tc := range []struct{ name, peer, forwarded, wantIP, proto, wantProto, prefix string }{
		{"direct spoof", "203.0.113.4:5000", "1.2.3.4", "203.0.113.4", "https", "", "10.0.0.0/24"},
		{"trusted hop", "10.0.0.2:5000", "1.2.3.4, 203.0.113.4", "203.0.113.4", "https", "https", "10.0.0.0/24"},
		{"trusted chain", "10.0.0.2:5000", "203.0.113.4, 10.0.0.1", "203.0.113.4", "https", "https", "10.0.0.0/24"},
		{"mapped CIDR", "10.0.0.2:5000", "203.0.113.4", "203.0.113.4", "https", "https", "::ffff:10.0.0.0/120"},
		{"mapped peer", "[::ffff:10.0.0.2]:5000", "203.0.113.4", "203.0.113.4", "https", "https", "::ffff:10.0.0.0/120"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			called := false
			e := echo.New()
			UseTrustedProxies(e, []string{tc.prefix})
			e.GET("/", func(c echo.Context) error {
				called = true
				require.Equal(t, tc.wantIP, c.RealIP())
				require.Equal(t, tc.wantProto, c.Request().Header.Get("X-Forwarded-Proto"))
				expectedScheme := tc.wantProto
				if expectedScheme == "" {
					expectedScheme = "http"
				}
				require.Equal(t, expectedScheme, c.Scheme())
				return c.NoContent(200)
			})
			req := httptest.NewRequestWithContext(t.Context(), "GET", "http://app.openpost.test/", nil)
			req.RemoteAddr = tc.peer
			req.Header.Set("X-Forwarded-For", tc.forwarded)
			req.Header.Set("X-Forwarded-Proto", tc.proto)
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, req)
			require.True(t, called, "trusted proxy middleware must forward the request")
			require.Equal(t, http.StatusOK, rec.Code)
		})
	}
	for header, value := range map[string]string{"X-Forwarded-Protocol": "https", "X-Forwarded-Ssl": "on", "X-Url-Scheme": "https"} {
		for _, peer := range []string{"203.0.113.4:5000", "10.0.0.2:5000"} {
			t.Run(header+"/"+peer, func(t *testing.T) {
				called := false
				e := echo.New()
				UseTrustedProxies(e, []string{"10.0.0.0/24"})
				e.GET("/", func(c echo.Context) error {
					called = true
					require.Equal(t, "http", c.Scheme())
					return c.NoContent(http.StatusOK)
				})
				req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "http://app.openpost.test/", nil)
				req.RemoteAddr = peer
				req.Header.Set(header, value)
				req.Header.Set("X-Forwarded-Proto", "malicious-proto")
				rec := httptest.NewRecorder()
				e.ServeHTTP(rec, req)
				require.True(t, called, "trusted proxy middleware must forward the request")
				require.Equal(t, http.StatusOK, rec.Code)
			})
		}
	}
}
