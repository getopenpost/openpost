# Media Storage

OpenPost stores media on the local file system by default. It can also use S3 or R2 storage.

## Video processing dependency

OpenPost requires `ffmpeg` and `ffprobe` on `PATH` to verify uploaded videos and create posters. The official Docker image includes both tools, and the project Devenv supplies them for development. Install FFmpeg separately when running the standalone binary. A video stays unavailable for publishing if the server cannot complete this verification; Media shows the processing error and offers a retry after the dependency or file problem is fixed.

## Key settings

- `OPENPOST_MEDIA_PATH` controls where files are stored on disk.
- `OPENPOST_MEDIA_URL` controls how those files are exposed publicly. Its default
  `/media` path is resolved against `OPENPOST_PUBLIC_URL`, which falls back to
  `OPENPOST_APP_URL`.
- `OPENPOST_STORAGE_DRIVER` chooses `local` or `s3`.

## Recommended production values

```sh
OPENPOST_MEDIA_PATH=/data/media
OPENPOST_APP_URL=https://openpost.example.com
OPENPOST_PUBLIC_URL=https://openpost.example.com
```

The default `OPENPOST_MEDIA_URL=/media` becomes
`https://openpost.example.com/media`. Set an absolute `OPENPOST_MEDIA_URL` when
media uses a separate domain or path.

## Why public media URLs matter

Threads, Facebook, Instagram, and some TikTok posts need a public HTTPS link to the media. Those posts will fail if the social network cannot open the file.

## Backups

Back up the media directory together with the SQLite database when using local storage. For S3/R2-style storage, back up the bucket or configure provider-side versioning and lifecycle protection.

## Lifecycle cleanup

OpenPost applies a fixed application-level lifecycle to local and S3-compatible storage:

- Post-specific temporary media moves to Trash after its final successful publication or 14 days without use.
- Trash remains recoverable for seven days, then becomes eligible for permanent removal.
- Favorites, tags, collections, brand files, active posts and publications, retryable work, source relationships, and live editor projects protect their media from automatic cleanup.

These periods are not workspace or environment settings. The deprecated `media_cleanup_days` API field remains only for old clients: reads return `14` and writes are ignored. Old queued cleanup jobs that contain a `days` value also use the fixed 14-day policy.

Each cleanup run computes protection once for a bounded database batch. OpenPost commits database changes before it asks local or remote object storage to delete bytes, so a slow storage service does not keep a SQLite or PostgreSQL transaction open.

## S3-compatible storage

Use these settings for S3/R2-style storage:

```sh
OPENPOST_STORAGE_DRIVER=s3
OPENPOST_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
OPENPOST_S3_REGION=auto
OPENPOST_S3_BUCKET=openpost-media
OPENPOST_S3_ACCESS_KEY_ID=...
OPENPOST_S3_SECRET_ACCESS_KEY=...
OPENPOST_S3_PUBLIC_BASE_URL=https://media.openpost.example
OPENPOST_S3_FORCE_PATH_STYLE=false
```

## Cloud mode

When `OPENPOST_EDITION=cloud`, OpenPost refuses to start unless:

- `OPENPOST_STORAGE_DRIVER=s3`
- `OPENPOST_S3_REGION` is set
- `OPENPOST_S3_BUCKET` is set
- `OPENPOST_S3_ACCESS_KEY_ID` is set
- `OPENPOST_S3_SECRET_ACCESS_KEY` is set
- `OPENPOST_S3_PUBLIC_BASE_URL` is set

`OPENPOST_S3_PUBLIC_BASE_URL` is required in cloud mode because social networks need stable public media links.

The browser can upload straight to S3 or R2. OpenPost sends larger files in parts without loading the whole file into memory.

For direct browser uploads, the bucket must allow CORS requests from the OpenPost app origin. For Cloudflare R2, apply a bucket CORS rule like this, replacing the origin with your `OPENPOST_APP_URL`:

```json
{
  "rules": [
    {
      "allowed": {
        "origins": ["https://app.openpost.example"],
        "methods": ["PUT"],
        "headers": ["Content-Type"]
      },
      "exposeHeaders": ["ETag"],
      "maxAgeSeconds": 3600
    }
  ]
}
```

Save the rule as `cors.json`, apply it with `wrangler r2 bucket cors set <bucket> --file cors.json`, and verify it with `wrangler r2 bucket cors list <bucket>`. Without this rule, the browser blocks the upload and reports `Failed to fetch`.

Streaming upload flow:

1. Call `POST /api/v1/media/upload-session` with `workspace_id`, `filename`, `mime_type`, and `size`.
2. Upload the file to the returned `PUT` target with the returned headers. For a relative OpenPost target, use the same OpenPost bearer credential or browser session. For an absolute presigned bucket target, send only the returned upload headers; never send the OpenPost bearer token or session cookie to the storage host.
3. Call `POST /api/v1/media/upload-session/{media_id}/complete` with the same `workspace_id`.

S3-compatible storage returns a presigned browser-to-bucket target for files within the provider's single-request limit. Larger files use an authenticated OpenPost target and are written to the bucket as 8 MiB multipart parts. Local storage uses the same authenticated streaming target and writes directly to disk. Configure the reverse proxy in front of OpenPost to accept the largest video size you intend to support; X subscribed accounts can upload videos as large as 16 GiB.

OpenPost makes a pending Media item first. After upload, it checks the saved file, finds matching files with SHA-256, makes a thumbnail when possible, records usage, and marks the file ready. It does not keep a large file in app memory.

The web app uses upload sessions automatically for current local and S3-compatible deployments. It falls back to the legacy multipart endpoint only when the server does not advertise upload-session support.

OpenPost can reuse a file it already sent to a social network when one account
needs a retry. Networks that fetch a public media link, such as Threads,
Instagram, Facebook, and TikTok, get a fresh link instead.
