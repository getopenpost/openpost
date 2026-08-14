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
- Managed app plan, usage, checkout, and billing links
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

## Instance

Instance settings are available only to instance administrators.

- **Overview** shows account growth, publishing activity, and the running release.
- **Configuration** manages optional account policy, authentication, email delivery, OpenPost Image Editor, feedback, provider behavior, and OAuth provider applications.
- **Users** shows instance-wide account, plan, access, and activity details.

The Configuration screen identifies whether each value comes from the environment, an encrypted admin override, or the application default. Instance administrators can replace an allowlisted environment-backed value. Before and after saving, the screen names the environment source and clearly labels that the admin value will override or is overriding it. Removing the admin override restores the environment value or default after a server restart. Database, encryption, network, and storage settings remain deployment-only because OpenPost needs them before this screen can load.

Self-hosted users need provider apps when they bring their own OAuth keys. Provider apps keep environment-first precedence and remain read-only when defined by the deployment. Mastodon is a common case because each server can need its own app. See [Environment Variables](/configuration/environment-variables), [Platform Overview](/providers/overview), and [Mastodon](/providers/mastodon).
