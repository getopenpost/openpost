# Single Binary

OpenPost can run as a single Go binary with the frontend embedded into the executable.

## 1. Download a release

Download the binary for your platform from [GitHub Releases](https://github.com/getopenpost/openpost/releases).

Expected release assets:

- Linux x86_64: `openpost-server-linux-amd64`
- macOS Apple Silicon: `openpost-server-darwin-arm64`
- Windows x86_64: `openpost-server-windows-amd64.exe`

## 2. Create `.env`

Create a working directory, generate two independent secrets, and write a
private `.env` file:

```bash
umask 077
jwt_secret="$(openssl rand -hex 32)"
encryption_key="$(openssl rand -hex 32)"

cat > .env <<EOF
OPENPOST_PORT=8080
OPENPOST_DATABASE_PATH=/var/lib/openpost/openpost.db
OPENPOST_MEDIA_PATH=/var/lib/openpost/media
OPENPOST_APP_URL=https://social.example.com
OPENPOST_PUBLIC_URL=https://social.example.com
OPENPOST_MEDIA_URL=https://social.example.com/media

OPENPOST_JWT_SECRET=${jwt_secret}
OPENPOST_ENCRYPTION_KEY=${encryption_key}

# Optional but commonly useful
OPENPOST_DISABLE_REGISTRATIONS=false

# Example provider config
# X_CLIENT_ID=
# X_CLIENT_SECRET=
# MASTODON_SERVERS='[{"name":"Personal","client_id":"...","client_secret":"...","instance_url":"https://mastodon.social"}]'
# LINKEDIN_CLIENT_ID=
# LINKEDIN_CLIENT_SECRET=
# THREADS_CLIENT_ID=
# THREADS_CLIENT_SECRET=
EOF

unset jwt_secret encryption_key
```

## 3. Prepare production paths

```bash
sudo mkdir -p /var/lib/openpost/media
sudo chown -R $(whoami) /var/lib/openpost
```

Recommended production locations:

- Database: `/var/lib/openpost/openpost.db`
- Media: `/var/lib/openpost/media`

On Windows, keep the binary, `.env`, database, and media under stable service-owned paths. For example:

```powershell
New-Item -ItemType Directory -Force C:\OpenPost, C:\OpenPost\data, C:\OpenPost\media
```

Use Windows paths in `.env`:

```dotenv
OPENPOST_DATABASE_PATH=C:\OpenPost\data\openpost.db
OPENPOST_MEDIA_PATH=C:\OpenPost\media
OPENPOST_APP_URL=https://social.example.com
OPENPOST_PUBLIC_URL=https://social.example.com
OPENPOST_MEDIA_URL=https://social.example.com/media
```

## 4. Install or rename it on Linux/macOS

```bash
mv ./openpost-server-linux-amd64 ./openpost
chmod +x ./openpost
```

On macOS Apple Silicon, use `openpost-server-darwin-arm64` instead of the Linux asset.

## 5. Run it

Linux/macOS:

```bash
./openpost
```

Windows PowerShell:

```powershell
cd C:\OpenPost
.\openpost-server-windows-amd64.exe
```

By default, OpenPost listens on `http://localhost:8080`.

With no argument, the binary runs the `all` role. `./openpost all` is the
explicit equivalent: it applies pending migrations, serves HTTP, and processes
durable jobs. This keeps the single-binary self-host workflow intact.

For a hosted or independently scaled formation, run these commands from the
same release and configuration:

```bash
./openpost migrate  # one bounded release command
./openpost web      # HTTP only
./openpost worker   # durable jobs and recurring schedules only
```

Run `migrate` once before starting the new `web` and `worker` processes. Those
long-lived roles only verify the schema and fail with an operator-facing error
if a migration is missing. Concurrent migration commands serialize across the
shared PostgreSQL database or SQLite volume.

OpenPost loads `.env` from the process working directory. When running it as a Windows service, either set the service working directory to the folder containing `.env` or configure the environment variables directly in the service wrapper.

## 6. Run it as a service

### Linux systemd

Example unit:

```ini
[Unit]
Description=OpenPost
After=network.target

[Service]
Type=simple
User=openpost
Group=openpost
WorkingDirectory=/opt/openpost
EnvironmentFile=/opt/openpost/.env
ExecStart=/opt/openpost/openpost
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Example install layout:

- Binary: `/opt/openpost/openpost`
- Environment file: `/opt/openpost/.env`
- Database: `/var/lib/openpost/openpost.db`
- Media: `/var/lib/openpost/media`

After creating the unit:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now openpost
sudo systemctl status openpost
```

### Windows

Use a standard Windows service wrapper such as NSSM or WinSW, or a Task Scheduler entry that starts at boot.

For NSSM, configure:

- Application: `C:\OpenPost\openpost-server-windows-amd64.exe`
- Startup directory: `C:\OpenPost`
- Service account: a dedicated local user with read access to `C:\OpenPost` and write access to `C:\OpenPost\data` and `C:\OpenPost\media`

If your wrapper does not load `.env`, set the same `OPENPOST_*` values as service environment variables.

## 7. Upgrade safely

1. Back up the database, media directory, and `.env` file first.
2. Stop the service: `sudo systemctl stop openpost`
3. Replace the binary with the new release asset.
4. Confirm ownership and execute permissions.
5. Start the service: `sudo systemctl start openpost`
6. Check logs and the health endpoint before considering the upgrade complete.

## Backup reminder

Do not upgrade without a restorable backup. See [Backups](/operations/backups).

## Notes

- Put the service behind HTTPS before enabling production OAuth callbacks. Set `OPENPOST_APP_URL` and `OPENPOST_PUBLIC_URL` to the same public browser origin unless you intentionally operate a split-origin deployment.
- Protect the `.env` file because `OPENPOST_ENCRYPTION_KEY` is required to decrypt stored provider tokens.
