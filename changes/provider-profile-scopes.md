### Fixed

- TikTok connections with Display API disabled now request only basic profile fields. Connections also recover from HTTP scope denials for optional username access without hiding invalid-token failures.
- YouTube profile checks use the authorized channel API without requiring Google profile or email permissions.
- Provider setup guides match the requested TikTok, YouTube, and Threads scopes.
