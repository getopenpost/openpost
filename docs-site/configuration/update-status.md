# Update Status

OpenPost can show self-hosted instance admins whether a newer stable release is available. Open **Settings → Instance** to see the running version, build revision, latest stable release, and last check time.

The feature is read-only. It does not download files, run commands, change containers, or install updates. Use your normal deployment process after reviewing the linked release notes.

## Network and privacy boundary

The server makes a `GET` request to the fixed public GitHub endpoint for the latest stable `rodrgds/openpost` release. It sends a generic `openpost-update-checker` user agent and GitHub API headers. It does not send:

- the OpenPost version or build
- the instance hostname or public URL
- user, workspace, or account data
- post or media content
- cookies, provider tokens, or other credentials

Release checks use a three-second timeout and accept at most 64 KiB. Redirects are limited to the same host, and the release link must point to the official OpenPost GitHub repository.

Successful checks are cached for 24 hours. Failures retry after 15 minutes. If a cached successful result exists, a failed refresh marks it as stale instead of discarding it.

## Configuration

`OPENPOST_UPDATE_CHECK_ENABLED` defaults to `true`. Set it to `false` to disable outbound release checks:

```env
OPENPOST_UPDATE_CHECK_ENABLED=false
```

Cloud mode disables release checks regardless of this setting because hosted deployments use their operator-managed release process. The API requires a signed-in browser session for an unscoped instance administrator. API, CLI, and MCP bearer tokens are rejected.
