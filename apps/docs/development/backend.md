# Backend

The backend uses Echo for HTTP handling, Huma for OpenAPI generation, and Bun ORM for database access. SQLite is the self-hosted default; Postgres is the cloud deployment path.

This page is for contributors changing server code, storage behavior, or HTTP boundaries.

## Layering

- Handlers
- Services
- Database/models

## Expectations

- Platform logic must stay inside `internal/platform/`
- Prefer Bun ORM over raw SQL for normal queries
- Use dependency injection patterns from `main.go`
