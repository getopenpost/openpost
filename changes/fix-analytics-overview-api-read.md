### Fixed

- Workspace-scoped `api:read` tokens can now call the stored analytics overview (`GET /api/v1/analytics`). The operation was missing from the read automation catalogue, so valid read-only tokens received `403`.
- Admitted the same class of stored-data workspace reads to the `api:read` catalogue: job listing, notification inbox, engagement and conversation lists, growth recommendations, repost automation settings, account feature reads, voice profiles (including the read-only effective-profile resolver), and writing prompts. Each remains workspace-scoped and read-only at the handler layer; mutations stay excluded.
- Hardened the notification inbox for workspace-bound credentials: account-wide rows (for example invitations from other workspaces) are now excluded when the calling token is bound to a workspace. Browser sessions and unscoped credentials keep the existing combined inbox.
