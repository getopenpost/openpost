### Added

- Instance administrators can download a full backup of a self-hosted instance and restore it from **Settings → Instance → Backup and restore**. The backup is one ZIP file with a consistent snapshot of the SQLite database and every uploaded media file. A restore is checked first, applied on the next start, and keeps the replaced data as a restore point that can be deleted from the same page. Backups need the default SQLite database, local media storage, and a single server process; the encryption key is not included and must match.
