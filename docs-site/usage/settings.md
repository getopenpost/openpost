# Settings

OpenPost settings are split by ownership so personal account changes do not get mixed with workspace or organization changes.

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

Use a workspace-scoped `mcp:read` token when an assistant only needs to inspect OpenPost. Use `mcp:full` only when it must create or change drafts and renditions, upload media, schedule, publish, cancel, reply, or moderate. Both scopes are revocable; review recent activity here and remove access when the integration no longer needs it.

Use this tab when the setting is about you, not a workspace.

## Organization

Organization settings group collaboration and hosted billing.

- Workspace team members and pending invitations
- Seat usage
- OpenPost Cloud plan, usage, checkout, and portal links

Invite people from **Settings -> Organization**. Pending invitations reserve seats until they are accepted, revoked, or expired.

## Provider credentials

Provider credentials are operator-level configuration, not regular user settings. Configure them with legacy provider env vars, `OPENPOST_PROVIDER_APPS`, or the instance-admin provider app API. The current web settings UI has no Admin tab or Provider Apps panel.

Most self-hosted users only need operator-managed provider credentials when they want to bring their own OAuth keys. Mastodon custom instances are the most prominent case because each server can need its own app registration. See [Provider Overview](/providers/overview) and [Mastodon](/providers/mastodon).
