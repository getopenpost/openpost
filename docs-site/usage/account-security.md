# Account Security

Open **Settings → Account → Security** to manage your password, authenticator app, recovery codes, passkeys, linked sign-in identities, and active browser sessions. These settings belong to your login and apply in every workspace.

## Sign-in sessions

Web sign-in creates a persistent, HTTP-only session cookie that expires after seven days. OpenPost does not show a cosmetic “Remember me” option because there is currently one server-enforced lifetime. Sign out when you finish on a shared device. You can review and revoke active browser sessions from **Settings → Account → Security**; revocation invalidates that session before its normal expiry.

## Change the sign-in email

Open **Settings → Security → Change sign-in email**, enter the new address, and confirm your current password, passkey, or linked sign-in identity. OpenPost sends a six-digit code to the new address and a notice to the current address. The current address remains the active sign-in identity until the code is confirmed.

The code expires after 15 minutes and repeated attempts or resends are limited. OpenPost uses a generic conflict message when an address cannot be used, but the different success and conflict status codes can still reveal whether an address is available to an authenticated user. On confirmation, OpenPost changes the sign-in email, invalidates unused password-reset links, and revokes other browser sessions. It attempts to send completion notices to both addresses. Those post-confirmation notices are currently best effort: delivery failures are logged, but the application does not yet queue a durable retry.

Changing the sign-in identity does not silently change billing, legal, workspace-invitation, or notification contacts. Update those separately where the product exposes them.

## Linked sign-in identities and logout

Linked Google or organization identities are login methods. They are separate from the social publishing accounts under **Settings → Accounts**. The Security page shows the provider, linked name and address, link date, and last use. Disconnect requires recent reauthentication, and OpenPost blocks removal of the final usable password, passkey, or linked identity.

OpenPost always revokes its own session when an authenticated provider logout is requested. If the provider advertises an OIDC end-session endpoint, OpenPost also returns that provider logout URL; otherwise logout ends at OpenPost. Configured providers can also send standards-based back-channel logout to the provider-specific URL shown in SSO settings. Support depends on the provider exposing and correctly configuring those endpoints; OpenPost does not claim that every provider performs remote logout.

## Required organization SSO and app tokens

When an organization requires SSO, its administrator can either deny API, CLI, and MCP tokens or limit each token to one workspace. A token for an SSO-protected workspace must inherit a current assurance from an approved identity provider. It cannot access another workspace or organization-level resources, and it stops working when that assurance exceeds the organization's maximum age.

Migration 084 changes the retired whole-organization token setting to workspace-scoped access. It does not guess a workspace for an existing unbound token, so that token can no longer access required-SSO resources. Revoke it and issue one assured token per required workspace, or choose the deny policy.

## Set up an authenticator app

1. Choose **Authenticator app** as your two-factor sign-in method.
2. Confirm your current password, passkey, or linked sign-in identity.
3. Keep the OpenPost page open, add OpenPost in your authenticator app, and scan the QR code. If you cannot scan it, choose manual entry in the app and use **Copy setup key**. You can switch between the apps without losing the setup.
4. Return to OpenPost and enter the current six-digit code from the app.
5. Copy or download the recovery codes and store them somewhere safe and separate from the authenticator.
6. Confirm that the recovery codes are saved. OpenPost then enables the authenticator app.

The setup key gives the same access as the QR code. Keep it private. If browser clipboard access is unavailable, select the read-only key field and copy it manually.

The authenticator app is not enabled after step 4. Setup finishes only after you confirm that the recovery codes are saved. If you close or discard the one-time code list first, restart setup to get a new authenticator secret and recovery-code set.

OpenPost displays each recovery-code set once and stores only hashes. Each code can finish one sign-in, after which it cannot be used again. Keep the codes private and separate from the device that holds your authenticator app.

## Sign in with a recovery code

After entering your email and password, choose **Use a recovery code** on the verification screen. Enter one unused code exactly as saved. Spaces, letter case, and the displayed hyphens do not affect verification.

OpenPost removes the code from the available sign-in set after a successful use. If no unused codes remain, the recovery-code option is no longer offered.

## Check or replace recovery codes

The Security page does not show the remaining count until you confirm your current password, passkey, or linked sign-in identity. Choose **Check remaining codes** to see the number of unused codes.

Choose **Generate new recovery codes** when the saved set may be exposed, lost, or nearly exhausted. The replacement set is displayed once. Your current codes remain valid while you copy or download the replacement. After you confirm that the new set is saved, OpenPost activates it and revokes every code in the old set.

If you discard the replacement before confirming it, the current set stays active. Start replacement again to receive another new set.

## Disable the authenticator app

Disabling the authenticator app requires the same recent identity check used for recovery-code management. Disabling it also revokes every recovery code and cancels unfinished authenticator or replacement setup.

Resetting a password does not bypass an enabled second factor. After a password reset, use the authenticator app, a saved recovery code, or a passkey to finish signing in.

## Store codes safely

- Prefer a password manager, encrypted vault, or offline copy that you can reach without the authenticator device.
- Do not store the only copy in the same phone, browser profile, or unencrypted notes app as the authenticator.
- Replace the set immediately if someone else may have seen it.
- Check the remaining count after using a code so you can replace the set before it is empty.
