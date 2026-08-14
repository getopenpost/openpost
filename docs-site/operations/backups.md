# Backups

This page is for managed-service and self-hosted operators planning backup and restore work.

## Managed-service boundary

The managed OpenPost service makes daily Postgres dumps and a daily synchronized copy of Cloudflare R2 media in a root-owned directory on the application host. The directory is not public or application-served. The deployment configuration restricts its directory and newly created file modes, validates database compression before an atomic rename, disables SSH password and direct root login, and grants the named operator access through authorized SSH keys and `sudo`. Application users, support requests, and the OpenPost container do not receive backup-directory access.

OpenPost does not add a separate application-level encryption layer to each managed backup artifact. Do not describe those artifacts as encrypted. There is no artifact-encryption key to rotate or recover. The application encryption key is still required to use encrypted provider credentials after a restore and is stored separately through the host's secret-management configuration. Transport to R2 uses its HTTPS endpoint; local Postgres dumps and the local media copy remain inside the host boundary. Provider-managed infrastructure controls do not change this application-level statement.

Routine database dumps and changed or deleted media versions are pruned by daily jobs after they become more than 14 days old, so removal occurs on the first daily run after that threshold. The current media mirror follows the live bucket; an object removed from the live bucket moves into a dated version directory before that version expires. Operator-created repair, migration, or incident snapshots are not routine backups. They require a stated recovery, security, or legal purpose and a separate review and deletion decision when that purpose ends; the routine filename-based job does not silently delete them.

The database-backup, media-backup, and restore-drill units expose their last result and next timer run through systemd. A weekly drill validates the newest compressed database dump, restores it into a uniquely named temporary database, checks the schema and core row counts, checks that a non-empty database media inventory has a non-empty media snapshot, writes root-readable evidence, and drops the temporary database on exit. On 9 August 2026, the controlled host drill passed those database and media-inventory checks. This proves that the tested database and media copy were readable together; it is not proof of a separate encryption layer.

Self-hosted operators choose and must document their own storage encryption, access, retention, deletion, monitoring, key recovery, and restore process. If a deployment adds artifact encryption, its restore drill must start from the encrypted artifact and test current and rotated-key recovery before that deployment describes backups as encrypted.

You need the database, media objects, and secrets for a usable backup. The exact
commands depend on whether you run the self-hosted SQLite/local-storage default
or a hosted Postgres/S3-compatible deployment.

## What to back up

- SQLite database files or a Postgres dump
- Local media directory or S3-compatible bucket objects
- Your `.env` file or secret-management equivalent
- File ownership and permissions for the runtime directories

## Self-hosted SQLite and local media

This is the default self-hosting path.

Stop OpenPost first if you want the simplest backup path:

```bash
sudo systemctl stop openpost
```

If your deployment keeps SQLite in WAL mode, copy the database together with any `-wal` and `-shm` files that exist. Those extra files can contain committed data that has not yet been checkpointed into the main `.db` file.

### Database

```bash
cp /var/lib/openpost/openpost.db openpost-backup-$(date +%Y%m%d).db
cp /var/lib/openpost/openpost.db-wal openpost-backup-$(date +%Y%m%d).db-wal 2>/dev/null || true
cp /var/lib/openpost/openpost.db-shm openpost-backup-$(date +%Y%m%d).db-shm 2>/dev/null || true
```

### Media

```bash
tar -czf media-backup-$(date +%Y%m%d).tar.gz /var/lib/openpost/media/
```

### Secrets

```bash
cp /opt/openpost/.env openpost-env-backup-$(date +%Y%m%d)
```

Restart when the backup finishes:

```bash
sudo systemctl start openpost
```

## Postgres-backed deployments

For hosted or cloud-mode deployments, back up Postgres with the database tools
provided by your host. A plain `pg_dump` is portable and easy to restore:

```bash
pg_dump "$OPENPOST_DATABASE_URL" \
  --format=custom \
  --file="openpost-postgres-$(date +%Y%m%d).dump"
```

For a restore drill:

```bash
createdb openpost_restore
pg_restore \
  --dbname="postgres://openpost:secret@localhost:5432/openpost_restore?sslmode=disable" \
  "openpost-postgres-20260518.dump"
```

Confirm that the same or newer OpenPost migrations have been applied to the restore target before
you point traffic at it.

## S3-compatible media

For S3/R2-style storage, back up the bucket or configure provider-side
versioning/replication. A simple object copy is enough for a manual snapshot:

```bash
aws s3 sync "s3://openpost-media" "./openpost-media-$(date +%Y%m%d)"
```

For Cloudflare R2 or another S3-compatible endpoint, pass the endpoint URL:

```bash
aws s3 sync \
  --endpoint-url "$OPENPOST_S3_ENDPOINT" \
  "s3://$OPENPOST_S3_BUCKET" \
  "./openpost-media-$(date +%Y%m%d)"
```

Back up object metadata and bucket policy if your provider keeps public access,
custom domains, lifecycle rules, or CORS outside the object data itself.

## Restore process

1. Stop OpenPost.
2. Restore the database files or Postgres dump.
3. Restore the media directory or bucket objects.
4. Restore `.env` or the equivalent secrets source.
5. Fix ownership and permissions.
6. Start OpenPost.
7. Confirm login, media access, and scheduled-post visibility.

## Automated database restore drill

For a Postgres deployment, `scripts/restore-drill.sh` restores a compressed SQL backup into a
uniquely named temporary database, checks the schema and core row counts, writes non-sensitive JSON
evidence when requested, and drops the temporary database on exit. It refuses to overwrite any
database whose name does not match the dedicated restore-drill pattern.

Run it on the database host with an explicit backup:

```bash
sudo env \
  OPENPOST_RESTORE_BACKUP=/var/backup/openpost/openpost_20260722_000000.sql.gz \
  OPENPOST_RESTORE_EVIDENCE=/var/backup/openpost/restore-drill-latest.json \
  PODMAN_BIN=/run/current-system/sw/bin/podman \
  ./scripts/restore-drill.sh
```

Set `OPENPOST_MEDIA_SNAPSHOT` to the local media-backup directory to include its file count in the
same evidence. A database-only pass is not proof that uploaded media can be recovered; the output
states `media_snapshot=not_checked` when no media snapshot is supplied.

### Hosted restore test

On 22 July 2026, a hosted Postgres backup was restored into an isolated temporary
database. Compressed-backup integrity, public schema restoration, and core account, workspace, and
post queries passed. The hosted R2 bucket was copied to a separate local snapshot and `rclone check`
reported no differences before the same drill verified that snapshot. The temporary database was
dropped after validation. Non-sensitive machine-readable evidence is stored on the host at
`/var/backup/openpost/restore-drill-latest.json`.

### Example restore

```bash
sudo systemctl stop openpost
sudo mkdir -p /var/lib/openpost/media /opt/openpost
sudo cp openpost-backup-20260518.db /var/lib/openpost/openpost.db
sudo cp openpost-backup-20260518.db-wal /var/lib/openpost/openpost.db-wal 2>/dev/null || true
sudo cp openpost-backup-20260518.db-shm /var/lib/openpost/openpost.db-shm 2>/dev/null || true
sudo tar -xzf media-backup-20260518.tar.gz -C /
sudo cp openpost-env-backup-20260518 /opt/openpost/.env
sudo chown -R openpost:openpost /var/lib/openpost /opt/openpost
sudo chmod 600 /opt/openpost/.env
sudo systemctl start openpost
```

## Migrate to another server

1. Install the new OpenPost binary or container deployment first.
2. Stop OpenPost on both the old and new server.
3. Copy the database, any `-wal` and `-shm` files or Postgres dump, the media directory or bucket data, and `.env`.
4. Restore ownership and permissions on the new server.
5. Start OpenPost on the new server.
6. Verify provider callbacks, media URLs, and scheduled posts before switching traffic.

If the hostname changes, update your reverse proxy, provider callback URLs, and `OPENPOST_MEDIA_URL` before making the new server live.

## Test restore checklist

- Can you log in with an existing account?
- Do previously uploaded media items load?
- Are connected accounts still listed?
- Are drafts and scheduled posts present?
- Does `GET /api/v1/ready` return `{"status":"ready","database":"ok"}`?
- Does `openpost instance health --instance <restored-url>` succeed against the restored URL?
- If the server hostname changed: do provider callbacks and public media URLs still point at the new host?

## Notes

- Test restores, not just backups.
- Keep database and media snapshots reasonably aligned in time.
- Protect backup copies of `.env`: encrypted provider tokens still depend on `OPENPOST_ENCRYPTION_KEY`.
- In cloud mode, do not treat a database dump without matching media objects and secrets as a complete backup.
