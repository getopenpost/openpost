package main

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNormalizedRequestRoute(t *testing.T) {
	require.Equal(t, "/api/v1/publications/:id", normalizedRequestRoute(" /api/v1/publications/:id "))
	require.Equal(t, unmatchedRequestRoute, normalizedRequestRoute(""))
}

func TestRequestConsumerClass(t *testing.T) {
	tests := []struct {
		name      string
		route     string
		userAgent string
		want      string
	}{
		{name: "cli", userAgent: "openpost-cli/v4.5.6", want: "cli"},
		{name: "mcp proxy", userAgent: "openpost-mcp/v1.2.3", want: "mcp"},
		{name: "mcp route", route: "/api/v1/mcp", userAgent: "unknown", want: "mcp"},
		{name: "mcp media", userAgent: "openpost-mcp-media/v3.6.0", want: "mcp-media"},
		{name: "n8n", userAgent: "n8n-nodes-openpost/0.1.0", want: "n8n"},
		{name: "browser", userAgent: "Mozilla/5.0", want: "web"},
		{name: "other API client", userAgent: "curl/8.0", want: "api"},
		{name: "empty", want: "api"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, requestConsumerClass(tt.route, tt.userAgent))
		})
	}
}
