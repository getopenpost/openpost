---
type: Fixed
---

Duplicate migration version numbers no longer silently skip migrations. Versions 094 and 108 were each assigned to two files, so `108_idempotency_records.sql` never ran (requests carrying an `Idempotency-Key` failed with 503 "no such table: idempotency_records") and `094_workspace_invitation_delivery.sql` was skipped on upgraded databases. The skipped migrations are renumbered to 110 and 111 so existing installations heal on their next start, and the migration runner now refuses to start when two files share a version.
