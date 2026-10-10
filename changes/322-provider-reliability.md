### Fixed

- Keep Instagram containers pending when Meta is still preparing them, and treat missing processing status as unknown. Explain Trial Reel limits.
- Preserve Facebook video upload IDs through interrupted transfers and processing. Confirm video publication after the finish acknowledgement.
- Keep TikTok inbox delivery separate from publication, retain its receipt for reconciliation, and use photo URLs for photo posts. Resolve public identities from provider receipts instead of captions. Preserve structured OAuth errors.
- Resume X media processing from its saved media ID and explain depleted X developer credits. Check Bluesky email verification before video uploads while keeping text and image posting available.
- Exclude provider-confirmed Facebook and TikTok identity aliases from native imports. Defer ambiguous import pages within a bounded 30-day identity window.

### Changed

- Schema migration 153 preserves existing delivery receipts while adding the user-action state for TikTok inbox drafts. Older binaries do not understand that state; a downgrade requires the pre-upgrade database backup.
