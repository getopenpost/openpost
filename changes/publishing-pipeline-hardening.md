### Fixed

- Hardened post publishing, retries, and background workers against lost-lease overwrites, stalled queues, and concurrent database lock deadlocks: workers now cancel in-flight work on lease loss, preserve confirmed post IDs when a slow upload finishes near stale recovery, clear stale retry indicators once retries exhaust, isolate malformed stale jobs, and validate every unpublished thread part before the first write.
- Fixed Pixelfed text-card publishing ownership checks, cross-part caption isolation in threads, Telegram and Discord bot replies, YouTube/TikTok reply policy checks, deleting partially published failed posts, preserving other variants' scheduled or pending jobs during **Retry failed**, and transient token-refresh errors falsely triggering reconnect alerts.
