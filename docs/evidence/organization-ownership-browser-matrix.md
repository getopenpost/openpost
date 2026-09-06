# Organization ownership browser evidence

The production browser test `tests/app/organization-ownership.spec.ts` covers the
Organization ownership journey at 1280 × 900 and 320 × 760. It removes all
Workspace results while retaining an owned Organization, then verifies that the
Ownership tab remains reachable, identifies the current Owner, selects a real
successor, enters the exact Organization name and current password, and submits
the visible nomination form. The browser observes successful password
reauthentication and ownership-transfer requests before the UI shows the exact
pending outcome. The two viewport runs enter
through `/settings#ownership` and `/settings?tab=ownership` respectively, so
both supported direct links prove the zero-Workspace bootstrap exemption.

The same journey forces the transfer-state request to fail with a server error,
then verifies that the error remains visible and every nomination action is
suppressed. This distinguishes an unavailable transfer state from a confirmed
absence (`404`).

Each passing run writes full-page `organization-ownership-desktop.png`,
`organization-ownership-phone.png`,
`organization-ownership-recipient-desktop.png`, and
`organization-ownership-recipient-phone.png` attachments through Playwright's
test output. Both recipient sizes assert settled content, no application
navigation chrome, no horizontal overflow, and no browser console errors.
The same test creates a real nominee, accepts then removes their Workspace
membership while preserving active Organization membership, and verifies the
account has zero Workspaces. That nominee can still open the standalone action,
resolve and accept the transfer, and see the resulting Owner and Administrator
roles without entering Workspace onboarding. It then follows same-page links
from the accepted result to a different transfer, declines it, follows another
same-page link, and finally removes the transfer ID. Each change clears the
previous action and result before showing the new prompt or the missing-ID
error.
