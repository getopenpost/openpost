### Fixed

- Prevent a delayed GitHub run status from failing release CI coordination. Retry pending tag status briefly and retain main CI when tag liveness cannot be confirmed, while keeping full release qualification required.
