# Settings

OpenPost groups settings by who or what they affect.

## Workspace

Workspace settings belong to the selected workspace.

- Connected social accounts
- Workspace timezone and week start
- Fixed media lifecycle policy and current Trash behavior
- Posting schedule and default slot behavior
- Natural posting delay
- Native auto repost rules, engagement gates, and account access grants
- Brand colors, marks, text styles, and custom WOFF2, TTF, or OTF fonts

Use this tab when the setting should differ between brands, clients, or projects.

The media lifecycle information is not a workspace control. Temporary post-specific media moves to Trash after its final successful publication or 14 days without use, and Trash is permanently removed after seven days. Favorites, organized media, active work, and editor projects remain protected. OpenPost keeps the periods fixed so an old client or stored workspace value cannot weaken the policy.

## Account

Account settings follow your user login across every workspace.

- Display name and profile picture
- Appearance, language, and interface sounds saved in the current browser
- Optional public-profile fields and privacy preview
- Sign-in email and its verified change flow
- Password, two-factor authentication, and passkeys
- Linked Google and organization sign-in identities
- Active browser sessions
- CLI devices and API tokens
- MCP and ChatGPT App tokens/activity
- Per-topic email frequency and the saved daily digest time and timezone
- Temporary account-wide and selected-Workspace email Mutes with exact end times

The Notifications page shows the same active Mutes and end-now action, so you can inspect or stop a Mute while reviewing notification history.

Use an `mcp:read` token limited to one workspace when an AI tool only needs to read OpenPost. Use `mcp:full` only when it must create or change drafts and account versions, upload media, schedule, publish, cancel, reply, or moderate. You can remove either token. Check recent activity and remove access when the tool no longer needs it.

Use this tab when the setting is about you, not a workspace.

Settings labels each boundary. Profile and security follow your account. Appearance, language, and sounds are saved in the current browser and apply to any workspace opened there; they do not sync to another browser or device. Timezone, week start, scheduling, and workspace identity stay with the selected workspace.

Authenticator setup does not finish until you save and acknowledge the one-time recovery codes. The codes are shown once and each works for one sign-in. Viewing the remaining count, replacing the set, and disabling the authenticator require a recent password, passkey, or linked-identity check. See [Account Security](/usage/account-security) for the complete setup and recovery flow.

OpenPost keeps account linking explicit. If a Google or organization account
uses the same email as an existing OpenPost user, sign in with the existing
method first. Open **Settings → Account → Security**, confirm your current
method, and link the external account there. You can then use either method to
sign in. OpenPost blocks unlinking the last usable sign-in method.

## Organization

Organization settings group collaboration and hosted billing.

- Workspace team members, active or inactive access, pending invitations, and
  access history
- Seat usage
- Hosted service plan, usage, checkout, and billing links
- OIDC identity providers, verified domains, SSO enforcement, provider assurance, and machine-token policy

Invite people from **Settings -> Organization**. Pending invitations reserve
seats until they are accepted, revoked, or expired. Active workspace admins can
change accepted roles, deactivate or restore access, permanently remove a
member, resend or revoke invitations, search and filter the team, and review the
access history. OpenPost blocks any change that would leave the workspace
without an active admin. Inactive members cannot open the workspace and do not
consume a seat.

### Plan and billing ownership

**Settings → Plan & usage** separates the facts OpenPost can show from the tasks Paddle owns. OpenPost shows its latest Paddle-backed plan, subscription status, billing contact, renewal or end date, and entitlement limits. It also shows OpenPost product usage for the current month. A fact stays hidden when the relevant provider snapshot does not contain it.

Paddle manages payment methods, invoices, receipts, discounts, tax, cancellation, and billing details. OpenPost does not manage or display card details, invoice copies, or receipts. Organization owners and administrators can open each Paddle task from **Plan & usage**. OpenPost asks Paddle for an exact payment-method or cancellation link. Invoice and billing-detail tasks, or an unavailable exact link, open a newly created general Paddle portal session instead. OpenPost never stores the temporary portal URL.

Plan cards show OpenPost's USD list-price estimates. Paddle shows the localized amount, discounts, and tax before checkout is confirmed. OpenPost does not present a subscription amount as final unless it has provider-backed amount data.

### Failed-payment recovery

When Paddle reports the organization subscription as `past_due`, OpenPost shows the same payment notice throughout the authenticated app and in **Settings → Plan & usage**. Paid-plan access remains restricted until a newer Paddle subscription snapshot confirms recovery.

Every member can see the notice, but only an organization owner or administrator can open billing recovery. Select **Update payment method** to create a fresh Paddle customer-portal link for the exact subscription. If Paddle does not return that exact link, OpenPost opens a new general portal session. OpenPost does not store or reuse either temporary link. If you are a member, ask an organization owner or administrator to complete the update.

Paddle controls retry timing and whether an unrecovered subscription is canceled. OpenPost does not show an estimated deadline. Return to OpenPost after updating the payment method; the notice clears after Paddle confirms that the subscription is active again.

The **Single sign-on** tab is available for organization administration. Add an
exact OIDC issuer, copy the callback and back-channel logout URLs into the
provider, then test optional login before requiring SSO. Required mode checks
workspace access, password recovery, and API, CLI, and MCP credentials. App
tokens can be denied or limited to one workspace with current SSO assurance;
required SSO does not support organization-wide app tokens. Keep an
MFA-protected local instance administrator in
`OPENPOST_SSO_BREAK_GLASS_EMAILS` before enforcing SSO.

### Organization ownership

The **Ownership** tab shows the current Organization Owner. Only that Owner can
nominate another active Organization member. Starting a transfer requires
recent authentication and the exact Organization name. The nominee receives an
expiring Transactional action and can accept or decline it. The current Owner
can revoke a pending transfer. The recipient action remains available to an
active Organization member who has no Workspace access and does not send them
through Workspace onboarding.

Ownership is Organization administration, not Workspace access. The tab loads
the Organizations you own and lets you select one even when you cannot open any
of its Workspaces. It shows the current Owner's identity before any transfer
action.

Nomination does not change access. Decline, expiry, and revocation leave the
current Owner in place. Acceptance changes both roles in one database
transaction: the nominee becomes the only Owner and the prior Owner becomes an
Organization Administrator. Creator authority moves to the nominee in the same
transaction, while the Organization's subscription remains attached to it.
Initiation and every terminal outcome appear in
Organization audit evidence without exposing the action link or member email.
Expiry is recorded by a durable Job, so it does not depend on someone opening
the page.

The in-app nomination notice follows the active English or Portuguese
interface. The required email includes both supported languages. If OpenPost
cannot load the current transfer state, the page reports the failure and hides
all nomination actions until a successful refresh.

Database upgrades apply migration 097 automatically. It adds ownership transfer
and audit state; no operator action is required.

### Delete an Organization permanently

Only the current Organization Owner can delete it. Open **Settings → Ownership**,
select any Organization you own, and choose **Delete Organization** to load a
current preview. This route remains available when you do not belong to one of
the Organization's Workspaces. **Settings → General** provides the same action
for the current Workspace's Organization. The preview names
every owned Workspace, shows the local Paddle subscription state and counts
pending provider writes, durable Jobs, and cleanup Jobs. It also explains the
access that ends, the limited evidence retained, the data lost permanently, and
every blocker.

Resolve every subscription state other than `canceled` and wait for Paddle to
confirm that terminal state. Use **Cancel pending checkout** in the deletion
preview for attempts that have not produced a Paddle subscription. OpenPost
then rejects any attempt to reopen that checkout and retains its opaque ID as a
billing boundary. If an already-open Paddle checkout completes late, OpenPost
uses that boundary to cancel the new subscription immediately, including after
Organization deletion. Revoke or complete
a pending ownership transfer. Publishing, provider-scheduled work, provider,
and cleanup work must reach a safe terminal state. OpenPost adds no separate
waiting period after these blockers are resolved.

Deletion requires the exact canonical Organization name and recent password,
passkey, or linked-identity authentication. The server locks the Organization
and repeats the Owner, name, billing, transfer, and external-work checks in the
same transaction that removes all owned Workspaces, memberships, scoped
credentials, Jobs, media records, and provider-write state. A failed request
rolls back the complete transaction and leaves the dialog and Organization
available.

Success ends affected Organization and Workspace access immediately. OpenPost
keeps one content-free lifecycle record with the Organization ID and canonical
name, actor, Workspace count, final local billing state, action, and time for
instance-administrator audit. It also keeps required billing reconciliation
evidence after a canceled checkout is resolved: the opaque checkout and
Organization IDs, provider name, opaque subscription ID, cancellation time,
and resolution time. OpenPost does not currently expire this content-free
evidence. It does not retain deleted content, provider
credentials, invitation links, or media in that record. Blob deletion runs from
durable cleanup Jobs created by the successful transaction. The Organization
and its Workspaces cannot be recovered.

### Organization audit evidence

The **Organization audit** tab is available only to the Organization Owner. It
combines permission-safe evidence from identity and access administration,
impersonation grants scoped to the Organization when created, billing checkout, MCP calls, Publication lifecycle and
authorization, and provider writes. An Owner can select an Organization even
when they are not a member of one of its Workspaces. Organization ownership
allows the Owner to inspect this administrative evidence across the
Organization; it does not grant access to a Workspace's Publications, media,
messages, or other content.

Filter by exact action, opaque actor ID, Workspace ID, resource type, or time.
Use **Load older evidence** to continue through stable pages. JSON and CSV
exports apply the same filters as the visible list. The app downloads exports
through the authenticated API, including in the Android wrapper.

The view and both exports include actor and effective actor IDs, action,
resource, result, time, and allowlisted changed fields such as role, access
state, SSO mode, or a verified Organization domain. They exclude user email
addresses, authored content, tokens, invitation links, credentials, arbitrary
identity detail, and raw provider responses.

## Instance

Instance settings are available only to instance administrators.

- **Overview** shows account growth, publishing activity, and the running release.
- **Configuration** manages optional account policy, authentication, email delivery, OpenPost Image Editor, feedback, provider behavior, and OAuth provider applications.
- **AI prompts** manages the base and platform-specific writing instructions used by AI social-post generation.
- **Users** shows instance-wide account, plan, access, and activity details.
- **Instance audit** uses the Organization audit vocabulary across every Organization. Filter by Organization, Workspace, actor, action, resource, result, or time, then export the same safe facts as JSON or CSV.

The instance audit requires an unscoped instance-administrator browser session.
Organization Owners, Workspace members, and API, CLI, or MCP credentials cannot
open it, even when a credential belongs to an instance administrator. The
projection names actor and effective actor separately and keeps success,
failure, and pending results explicit. Organization and Workspace IDs provide
scope without granting access to their content.

The Configuration screen identifies whether each value comes from the environment, an encrypted admin override, or the application default. Instance administrators can replace an allowlisted environment-backed value. Before and after saving, the screen names the environment source and clearly labels that the admin value will override or is overriding it. Removing the admin override restores the environment value or default after a server restart. Database, encryption, network, and storage settings remain deployment-only because OpenPost needs them before this screen can load.

The AI prompts screen applies changes to the next generated draft without a server restart. It keeps the source-controlled base and platform defaults visible, records the last administrator and update time, and lets an administrator restore each built-in prompt. OpenPost keeps the JSON response schema and destination validation outside the editable text, so prompt changes cannot alter the response shape required by the composer. Prompt overrides are encrypted in the database. The screen and API require an unscoped instance-administrator browser session; API, CLI, MCP, and Workspace-scoped credentials are rejected.

Self-hosted users need provider apps when they bring their own OAuth keys. Provider apps keep environment-first precedence and remain read-only when defined by the deployment. Mastodon is a common case because each server can need its own app. See [Environment Variables](/configuration/environment-variables), [Platform Overview](/providers/), and [Mastodon](/providers/mastodon).
