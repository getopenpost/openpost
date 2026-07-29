# Settings

OpenPost groups settings by who or what they affect.

## Workspace

Workspace settings belong to the selected workspace.

- Connected social accounts
- Workspace timezone and week start
- Media cleanup policy
- Posting schedule and default slot behavior
- Natural posting delay
- Brand colors, marks, text styles, and custom WOFF2, TTF, or OTF fonts

Use this tab when the setting should differ between brands, clients, or projects.

## Account

Account settings follow your user login across every workspace.

- Display name and profile picture
- Password, two-factor authentication, and passkeys
- Active browser sessions
- CLI devices and API tokens
- MCP and ChatGPT App tokens/activity

Use an `mcp:read` token limited to one workspace when an AI tool only needs to read OpenPost. Use `mcp:full` only when it must create or change drafts and account versions, upload media, schedule, publish, cancel, reply, or moderate. You can remove either token. Check recent activity and remove access when the tool no longer needs it.

Use this tab when the setting is about you, not a workspace.

## Organization

Organization settings group collaboration and hosted billing.

- Workspace team members and pending invitations
- Seat usage
- Managed app plan, usage, checkout, and billing links
- OIDC identity providers, verified domains, SSO enforcement, provider assurance, and machine-token policy

Invite people from **Settings -> Organization**. Pending invitations reserve seats until they are accepted, revoked, or expired.

The **Single sign-on** tab is available for organization administration. Add an
exact OIDC issuer, copy the callback and back-channel logout URLs into the
provider, then test optional login before requiring SSO. Required mode checks
workspace access, password recovery, and API, CLI, and MCP credentials. Keep an
MFA-protected local instance administrator in
`OPENPOST_SSO_BREAK_GLASS_EMAILS` before enforcing SSO.

## Social app keys

Social app keys are server settings, not regular user settings. Set them with the older platform environment variables, `OPENPOST_PROVIDER_APPS`, or the instance-admin API. The web settings page does not have an Admin or Provider Apps section.

Self-hosted users need these settings when they bring their own OAuth keys. Mastodon is a common case because each server can need its own app. See [Platform Overview](/providers/overview) and [Mastodon](/providers/mastodon).
