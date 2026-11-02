### Fixed

- Clarify which YouTube data OpenPost accesses and stores, how users can request deletion, and the refresh or deletion duties that apply to downloaded reports and shared copies. Include source-fetch dates in post and grouped exports.
- Expire cached YouTube analytics, imports and comments before their 30-day deadline, and clear those caches when a destination is disconnected or its grant revoked. Refresh authorized channel profiles independently of analytics, expire stale profiles and abandoned channel selections, and remove copied notification data, cached avatars and revoked authorization metadata.
- Use current official YouTube artwork at its minimum display size on connection cards, with text attribution in compact controls instead of undersized marks.

- Keep revocations effective when cleanup retries, preserve comment operation receipts across reconnection, and fence expired import cursors without changing account opt-in or activation.
