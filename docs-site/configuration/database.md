# Database

OpenPost uses SQLite by default when you run it yourself. Hosted installs can use Postgres by changing the database driver.

## Default path

The backend code defaults to:

```txt
file:openpost.db?cache=shared&mode=rwc
```

For container deployments, prefer an explicit file path such as:

```txt
/data/db/openpost.db
```

## Operational notes

- Persist the database on durable storage.
- Back up the database together with the media directory.
- Do not keep the database inside ephemeral container layers.
- SQLite is configured for a simple single-node deployment model.

## Driver settings

```sh
OPENPOST_DATABASE_DRIVER=sqlite
OPENPOST_DATABASE_PATH=file:openpost.db?cache=shared&mode=rwc
```

For Postgres-backed deployments:

```sh
OPENPOST_DATABASE_DRIVER=postgres
OPENPOST_DATABASE_URL=postgres://openpost:secret@db.internal:5432/openpost?sslmode=require
```

Postgres connection pools use explicit per-process limits. The combined
single-process role allows 20 open connections, web allows 16, worker allows 8,
and migration allows 2. Count these limits across every replica when sizing the
Postgres service. OpenPost logs the effective budget at startup. Every Postgres
process also reports new connection waits or a transition into pool saturation
through standard output.

## Cloud mode

When `OPENPOST_EDITION=cloud`, OpenPost refuses to start unless:

- `OPENPOST_DATABASE_DRIVER=postgres`
- `OPENPOST_DATABASE_URL` is set

This stops a hosted server from starting with a local SQLite file by mistake. SQLite remains the recommended choice for a small self-hosted server.
