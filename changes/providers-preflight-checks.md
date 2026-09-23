### Fixed

- YouTube uploads reject titles containing `<>` and descriptions over 5000 bytes before a resumable session is created.
- LinkedIn rejects malformed post ids in publish responses instead of storing ids that can never be reconciled; a missing id stays accepted for reconciliation.
- TikTok media URLs must parse as HTTPS with a host, no credentials, and no fragment. Custom ports stay allowed for self-hosted instances.
