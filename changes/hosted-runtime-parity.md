### Fixed

- Hosted readiness now proves PostgreSQL and required S3 write, read, and delete access with bounded requests, while release CI exercises the production-shaped data plane without skipped PostgreSQL coverage.
- Blob operations now honor cancellation without corrupting local files, failed media writes roll back with bounded cleanup, and PostgreSQL pools have role-specific budgets plus saturation signals.
