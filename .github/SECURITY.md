# Security Policy

## Supported Versions

Security patches are currently provided for the latest OpenPost release.

| Version        | Supported |
| -------------- | --------- |
| Latest release | Yes       |
| Older releases | No        |

We recommend always using the latest release for security patches and improvements.

## Reporting a Vulnerability

Please do not create a public GitHub issue for security vulnerabilities.

Email the maintainer at `openpost+security@rgo.pt` and include:

- Description of the vulnerability
- Steps to reproduce the issue
- Potential impact
- Any suggested fixes, if available

## Security Best Practices for Self-Hosters

### Secrets Management

- Never commit `.env` files to version control.
- Use strong, randomly generated secrets, for example `openssl rand -base64 32`.
- Rotate secrets periodically.
- Use Docker secrets, Kubernetes secrets, or a secrets manager in production where possible.
- Restrict access to `OPENPOST_ENCRYPTION_KEY`, `.env`, backup archives, and service configuration files.

### Network Security

- Run behind a reverse proxy with TLS.
- Configure a proper firewall.
- Do not expose the OpenPost port directly to the internet unless that is part of your deliberate reverse-proxy setup.
- For Threads media publishing, confirm that Meta can reach the public media endpoint.
- Use HTTPS before configuring production OAuth callbacks for X, Mastodon, LinkedIn, Threads, Facebook, Instagram, TikTok, or YouTube.

### Data Protection

- Back up the database and media directory regularly.
- Back up secrets together with the database and media directory.
- Store backups in a secure location.
- Consider encrypting backups at rest.
- Restrict filesystem permissions on the SQLite database, media folder, and backup artifacts.

### OAuth Provider Security

- Regularly review connected accounts.
- Rotate OAuth tokens and secrets periodically.
- Revoke access for accounts no longer in use.

### Assistant And Automation Access

- Prefer an `mcp:read` token when a client only needs to inspect workspaces, accounts, media, drafts, schedules, or delivery state. The MCP server omits mutation tools for this scope and rejects cached or direct mutation calls.
- Use `mcp:full` only when the client must create drafts or renditions, upload media, schedule, publish, reply, or moderate. OpenPost separates read operations from `execute_operation`, but the MCP client controls whether and when it asks for approval.
- Limit each MCP token to one workspace when possible. Create a separate token per client and revoke it from Settings when the connection is no longer needed.
- Treat API tokens as secrets. OpenPost stores only their hashes and shows the raw value once.
- Connected-provider credentials remain on the OpenPost server and are not returned through MCP responses.

## Security Features in OpenPost

OpenPost includes:

- Encrypted provider access and refresh tokens at rest
- Bcrypt password hashing
- JWT authentication
- Account MFA with TOTP
- WebAuthn passkeys
- OAuth 1.0a for X account connections
- Revocable, expiring API tokens with optional workspace boundaries
- Server-enforced read-only MCP access, separate read and mutation tools, and MCP tool-call audit records
- A self-contained server binary with no required external queue or database service

## Third-Party Dependencies

OpenPost uses Go modules, Bun/npm frontend dependencies, and Docker base images. Keep deployments updated to receive dependency fixes.

## Scope

This policy applies to the OpenPost server, embedded frontend, and OAuth integrations. It does not cover third-party OAuth providers, deployment infrastructure, or external storage services you configure.
