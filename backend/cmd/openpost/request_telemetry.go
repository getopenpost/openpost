package main

import "strings"

const unmatchedRequestRoute = "unmatched"

func normalizedRequestRoute(route string) string {
	route = strings.TrimSpace(route)
	if route == "" {
		return unmatchedRequestRoute
	}
	return route
}

// requestConsumerClass keeps API reachability evidence low-cardinality and
// avoids retaining full User-Agent strings. It is an operational hint, not an
// authentication or billing boundary, because callers control the header.
func requestConsumerClass(route, userAgent string) string {
	route = strings.ToLower(strings.TrimSpace(route))
	userAgent = strings.ToLower(strings.TrimSpace(userAgent))

	switch {
	case strings.HasPrefix(userAgent, "openpost-cli/"):
		return "cli"
	case strings.HasPrefix(userAgent, "openpost-mcp-media/"):
		return "mcp-media"
	case strings.HasPrefix(userAgent, "openpost-mcp/") || strings.HasPrefix(route, "/api/v1/mcp"):
		return "mcp"
	case strings.HasPrefix(userAgent, "n8n-nodes-openpost/"):
		return "n8n"
	case strings.Contains(userAgent, "mozilla/"):
		return "web"
	default:
		return "api"
	}
}
