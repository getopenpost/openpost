### Added

- Added explicit `all`, `web`, `worker`, and `migrate` process roles so hosted deployments can migrate once and scale HTTP and durable jobs independently.

### Fixed

- Made shutdown drain readiness, HTTP requests, and workers under one deadline, while persisting interrupted job state with a fresh bounded context.
- Serialized schema setup across PostgreSQL replicas and SQLite processes.
