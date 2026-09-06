### Fixed

- Bluesky accounts hosted on a self-hosted or third-party PDS can now be connected and used: OpenPost resolves the PDS from the handle's DID document at sign-in and talks to that server for the account. Sign in with the handle, not an email. Accounts on bsky.social are unchanged. Video uploads still go through Bluesky's video service and are not covered for accounts on other PDSes. When the PDS cannot be resolved, sign-in now fails instead of falling back to bsky.social.
