#!/usr/bin/env bash
set -euo pipefail

backup_path=${OPENPOST_RESTORE_BACKUP:?Set OPENPOST_RESTORE_BACKUP to a .sql.gz database backup}
postgres_container=${OPENPOST_POSTGRES_CONTAINER:-openpost-postgres}
postgres_user=${OPENPOST_POSTGRES_USER:-openpost}
restore_database=${OPENPOST_RESTORE_DATABASE:-openpost_restore_drill_$(date -u +%Y%m%d_%H%M%S)}
podman_bin=${PODMAN_BIN:-podman}
media_snapshot=${OPENPOST_MEDIA_SNAPSHOT:-}
evidence_path=${OPENPOST_RESTORE_EVIDENCE:-}

if [[ ! -f "$backup_path" ]]; then
	echo "Backup does not exist: $backup_path" >&2
	exit 1
fi

if [[ ! "$restore_database" =~ ^openpost_restore_drill_[0-9]{8}_[0-9]{6}$ ]]; then
	echo "Restore database must match openpost_restore_drill_YYYYMMDD_HHMMSS" >&2
	exit 1
fi

gzip -t "$backup_path"

database_created=false
cleanup() {
	if [[ "$database_created" == true ]]; then
		"$podman_bin" exec "$postgres_container" dropdb --if-exists -U "$postgres_user" "$restore_database" >/dev/null
	fi
}
trap cleanup EXIT

existing_database=$(
	"$podman_bin" exec "$postgres_container" psql -Atqc \
		"SELECT 1 FROM pg_database WHERE datname = '$restore_database'" \
		-U "$postgres_user" -d postgres
)
if [[ -n "$existing_database" ]]; then
	echo "Refusing to overwrite existing restore database: $restore_database" >&2
	exit 1
fi

"$podman_bin" exec "$postgres_container" createdb -U "$postgres_user" "$restore_database"
database_created=true
gzip -dc "$backup_path" | "$podman_bin" exec -i "$postgres_container" psql \
	-v ON_ERROR_STOP=1 -U "$postgres_user" -d "$restore_database" >/dev/null

table_count=$(
	"$podman_bin" exec "$postgres_container" psql -Atqc \
		"SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" \
		-U "$postgres_user" -d "$restore_database"
)
user_count=$(
	"$podman_bin" exec "$postgres_container" psql -Atqc \
		"SELECT count(*) FROM users" -U "$postgres_user" -d "$restore_database"
)
workspace_count=$(
	"$podman_bin" exec "$postgres_container" psql -Atqc \
		"SELECT count(*) FROM workspaces" -U "$postgres_user" -d "$restore_database"
)
post_count=$(
	"$podman_bin" exec "$postgres_container" psql -Atqc \
		"SELECT count(*) FROM posts" -U "$postgres_user" -d "$restore_database"
)
database_media_count=$(
	"$podman_bin" exec "$postgres_container" psql -Atqc \
		"SELECT count(*) FROM media_attachments" -U "$postgres_user" -d "$restore_database"
)

if (( table_count < 10 )); then
	echo "Restore validation failed: expected at least 10 public tables, found $table_count" >&2
	exit 1
fi

media_status=not_checked
media_file_count=0
if [[ -n "$media_snapshot" ]]; then
	if [[ ! -d "$media_snapshot" ]]; then
		echo "Media snapshot does not exist: $media_snapshot" >&2
		exit 1
	fi
	media_file_count=$(find "$media_snapshot" -type f | wc -l | tr -d ' ')
	media_status=checked
	if (( database_media_count > 0 && media_file_count == 0 )); then
		echo "Restore contains media records but the media snapshot is empty" >&2
		exit 1
	fi
fi

checked_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
backup_size=$(wc -c < "$backup_path" | tr -d ' ')
backup_name=$(basename "$backup_path")

echo "restore_drill=passed"
echo "checked_at=$checked_at"
echo "backup=$backup_name"
echo "backup_bytes=$backup_size"
echo "public_tables=$table_count"
echo "users=$user_count"
echo "workspaces=$workspace_count"
echo "posts=$post_count"
echo "database_media=$database_media_count"
echo "media_snapshot=$media_status"
echo "media_files=$media_file_count"

if [[ -n "$evidence_path" ]]; then
	install -d -m 0750 "$(dirname "$evidence_path")"
	{
		printf '{\n'
		printf '  "status": "passed",\n'
		printf '  "checked_at": "%s",\n' "$checked_at"
		printf '  "backup": "%s",\n' "$backup_name"
		printf '  "backup_bytes": %s,\n' "$backup_size"
		printf '  "public_tables": %s,\n' "$table_count"
		printf '  "users": %s,\n' "$user_count"
		printf '  "workspaces": %s,\n' "$workspace_count"
		printf '  "posts": %s,\n' "$post_count"
		printf '  "database_media": %s,\n' "$database_media_count"
		printf '  "media_snapshot": "%s",\n' "$media_status"
		printf '  "media_files": %s\n' "$media_file_count"
		printf '}\n'
	} > "$evidence_path"
	chmod 0640 "$evidence_path"
fi
