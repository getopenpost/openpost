### Added

- TikTok authorization is now capability-driven: the login request asks for the publishing scopes (`user.info.basic`, `video.publish`, `video.upload`) plus the optional Display API scopes (`user.info.profile`, `user.info.stats`, `video.list`). Set `OPENPOST_DISABLE_TIKTOK_DISPLAY_API=true` when the TikTok app has no Display API approval so the request asks only for what TikTok can grant.

### Fixed

- TikTok accounts connect with the publishing scopes alone. The profile falls back to the Login Kit identity fields when the Display API username scope is missing, completed Direct Post videos keep the provider publish ID when `video.list` reconciliation is unavailable, and analytics explain the missing Display API scopes instead of blocking the connection.
