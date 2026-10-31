### Fixed

- The MCP local media upload widget now resolves the host-exposed tool name before calling the upload-ticket tool, so it works behind MCP gateways that prefix tool names (such as Cloudflare MCP Server Portals) and falls back to the direct connection name when the host does not report one. Failures now show a clear message instead of a silent error.
