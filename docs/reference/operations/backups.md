# Backups

This page is for Hosted service and self-hosted operators planning backup and restore work.

## Hosted service boundary

The Hosted backup design streams daily Postgres dumps and media archives over Tailscale and restricted SSH directly to the NAS. It does not keep full routine database dumps or media mirrors on the application VPS. Each NAS snapshot contains the compressed data and a manifest. The receiver verifies the complete transfer, SHA-256, size, gzip integrity, and archive framing before publishing a snapshot. Failed uploads do not replace successful snapshots.

The NAS receiver and authorized-key configuration are root-owned. Access to the backup tree is restricted to NAS administrators and the backup account through both private Unix modes and a private DSM ACL. The dedicated SSH key permits only the receiver's bounded upload, download, and OpenPost prune operations. Application users and the OpenPost container do not receive access to the backup tree. Check effective DSM permissions, including inherited and child rules; Unix modes alone do not prove that unrelated NAS services lack access.

OpenPost does not add a separate application-level encryption layer to backup artifacts. Do not describe them as encrypted. There is no artifact-encryption key to rotate or recover. The application encryption key remains necessary to use encrypted provider credentials after a restore and is kept separately through the host's secret-management configuration. SSH protects transfer to the NAS; its transport protection does not establish encryption of stored artifacts.

### Routine retention and rollout

The receiver keeps at most seven successful snapshots per dataset. The planned OpenPost policy also expires database and media snapshots six calendar days after their receiver-issued UTC timestamp. Uploading or copying an older snapshot does not renew its source data's retention period. An independent hourly prune removes expired OpenPost snapshots even if daily uploads fail, including the last remaining snapshot. Successful uploads also apply expiry. Other datasets retain their separate policies.

The six-day age limit and hourly expiry are the reviewed policy in Home configuration commit `0482f2a`. They are not a claim that production has already activated that policy. Before enabling expiry, deploy and verify the OpenPost cleanup, create fresh database and media snapshots, and pass the existing restore drill. Then install and verify the matching NAS receiver, run its restricted OpenPost prune commands, and activate the VPS hourly prune timer. Follow `modules/shared/nas-backup/README.md` in the Home configuration checkout for the rollout and failure procedure. Installation and runtime verification remain separate steps from source and receiver-test verification.

The hourly timer depends on the VPS and NAS connection. An outage can delay expiry. Monitor backup freshness and prune failures, restore connectivity promptly, and verify that overdue snapshots were removed. Expiry continues without a newer successful backup once activated, so a prolonged upload failure can leave no retained recovery snapshot. Do not extend a YouTube privacy deadline to preserve a backup. Enforcement while the VPS is offline requires a separately verified NAS-local schedule using the same restricted prune operations.

### Restore verification

The weekly Hosted drill downloads and verifies the NAS database snapshot, restores it in a disposable PostgreSQL container, checks schema and core row counts, and verifies the matching media archive. The container has no network, production volumes, host mounts, or production credentials. Its root filesystem is read-only, and its temporary storage and resources are bounded. The drill removes the disposable container on completion or interruption and records non-sensitive evidence at `/var/backup/openpost/restore-drill-latest.json` on the VPS. A successful transfer is not a restore test, and a database-only test does not prove media recovery.

### Exceptional snapshots and YouTube deletion

Repair, migration, and incident snapshots outside the receiver's managed dataset directories do not expire through its routine snapshot rules. Before creating one, identify its owner, purpose, storage locations, source-data age, and deletion deadline. Restrict access as for routine backups. Prefer sanitized evidence that omits YouTube API data when the full data is not needed.

For every exceptional snapshot containing YouTube API data:

1. Determine when the oldest included YouTube data was fetched or refreshed. Delete or refresh that data within 30 calendar days of that source fetch or refresh. Snapshot creation, copying, and restoration do not restart the clock. If the source date cannot be established, remove the affected data. A refresh requires a valid authorization and a fresh YouTube API response; changing a timestamp is not a refresh.
2. On a user's deletion request, account deletion, or revocation through OpenPost, remove the affected YouTube data from primary storage, routine backups, and exceptional copies as soon as possible and within seven calendar days. Revocation through Google security settings requires deletion as soon as possible and within 30 calendar days of revocation. These deadlines override any later routine or exceptional retention date.
3. If an artifact cannot be safely edited, create and verify a sanitized replacement, then delete the original and its other copies before the deadline. Preserve only evidence that no longer contains the affected YouTube data. Do not retain the original merely because the incident or recovery work continues.
4. Before restoring service from a snapshot, apply current retention cleanup and outstanding deletion or revocation requests to the restored data. Do not reconnect revoked grants or expose expired fetched data. Verify the resulting database and media state before admitting traffic, and remove temporary restore files and containers.

Record completion without copying the deleted content into logs or tickets. A routine snapshot's six-day age limit alone does not prove that its oldest YouTube data meets the 30-day limit. The primary-data cleanup and backup expiry must both be active and verified. Deleting OpenPost's copies does not delete content stored by YouTube.

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
