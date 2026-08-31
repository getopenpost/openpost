# Workspaces

Use a workspace to keep one brand, client, or project separate.

## What belongs to a workspace

- Connected social accounts
- Uploaded media
- Posts and threads
- Prompts and scheduling settings
- Team members and pending invitations

## Why they matter

They keep brands, teams, and personal work from sharing social account keys or media by mistake.

## Manage workspace access

Workspace admins manage accepted members and invitations from **Settings → Workspace →
Members**. Other active members can review the team, but OpenPost hides the
invite form and access-changing actions from them.

Workspace roles have separate permissions:

- **Admin** can manage workspace access and settings, and can create or change
  workspace content.
- **Editor** can create and change workspace content, but cannot manage access.
- **Viewer** has read-only workspace access.

Use the team search and role or status filters to find accepted members and any
invitation. Invitation state shows Created, Queued, Sent, Delivered, Delivery
failed, Copy link only, Expired, Revoked, or Accepted. **Sent** means the email
provider accepted the request. Only an authenticated delivery callback can mark
it **Delivered**.

### Invite someone

1. Open **Settings → Workspace → Members**.
2. Enter the collaborator email and role.
3. Check the invitation email state. OpenPost queues one expiring Transactional
   email whether or not the recipient already has an account.
4. Copy the one-time invite link as a fallback while it is visible.

Invitation email includes the Workspace, inviter, role, expiry, and acceptance
link. Optional notification preferences do not suppress access email. The
configured email provider and Workspace invitation controls still apply. If
email is unavailable or cannot be queued, Settings keeps the pending invitation
and its reserved seat, shows the failure, and leaves the copy link available.
Resend rotates the secret and queues a new delivery without creating another
active invitation. OpenPost permits one resend per minute and five per hour for
each invitation and administrator. A limited response includes the exact UTC
time when the administrator can try again. Concurrent resends use one atomic
generation change, so only one request can replace the current link.

The invited user must sign in with the invited email address before accepting
the link. Accepted invites add the user to the workspace immediately and open
that Workspace without sending existing users through plan selection or checkout.
Viewers receive invitation orientation without destination-connection or
publishing setup actions.

Pending invitations count toward team seats until they are accepted, revoked, or
expire. An admin can resend an invitation to rotate its secret and extend its
expiry, or revoke it to free the reserved seat. Only the newest link returned by
a resend can be accepted.

Expired, revoked, unknown, and wrong-email links return the same safe acceptance
error. This avoids revealing whether an email address or invitation exists.

OpenPost stores only the invitation token hash on the invitation. The raw token
is limited to the acceptance link returned once. Durable email jobs encrypt that
link with the application encryption key and decrypt it only in the delivery
worker. The token is not returned as a separate API field and is excluded from
the team list, access history, logs, and telemetry.

### Change accepted access

An admin can change an accepted member's role, deactivate access temporarily,
restore an inactive member, or remove the member permanently. Inactive members
cannot open the workspace and do not consume a team seat. Restoring one reserves
a seat again, so OpenPost rechecks the current plan limit before the change.

OpenPost never allows a role change, deactivation, or removal to leave a
workspace without an active admin. This safeguard also applies when an admin
changes or removes their own access. Use deactivation when access may be needed
again; removal deletes the workspace membership instead.

The access history records invitation, role, status, and removal changes. Only
active workspace admins can view it.

## Delete a Workspace permanently

Only the Organization Owner can delete a Workspace. Open **Settings → Workspace → General**
and choose **Delete workspace** to inspect the current deletion preview. The
preview lists the content and access that will be removed, the billing, audit,
tax, or legal records that may remain, whether recovery is possible, and every
blocker that must be resolved first.

Deletion is permanent. OpenPost requires the exact current Workspace name and a
recent password, passkey, or linked sign-in check. The server checks ownership
before deletion, then repeats the name and blocker checks inside the deletion
transaction. Accepting a browser confirmation by itself never deletes data.

An Organization must keep at least one Workspace. An active billing subscription
assigned to the Workspace, an unfinished provider write, or an active cleanup
job also blocks deletion. Follow the blocker text to create another Workspace,
move or cancel billing, or wait for the pending work to reach a safe outcome.
If deletion fails, the dialog keeps the entered name and the current Workspace
selected, and OpenPost does not remove its data.

After successful deletion, OpenPost records Organization-scoped audit evidence
with the Workspace ID, canonical name, actor, and time. That evidence remains
available to the Organization Owner even though the Workspace and its content
cannot be recovered.
