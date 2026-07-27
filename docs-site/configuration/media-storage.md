# Media Storage

OpenPost stores media through its `BlobStorage` abstraction. Local filesystem storage is the self-hosted default; S3-compatible storage is the cloud-ready driver path.

## Video processing dependency

OpenPost requires `ffmpeg` and `ffprobe` on `PATH` to verify uploaded videos and create posters. The official Docker image includes both tools, and the project Devenv supplies them for development. Install FFmpeg separately when running the standalone binary. A video stays unavailable for publishing if the server cannot complete this verification; Media shows the processing error and offers a retry after the dependency or file problem is fixed.

## Key settings

- `OPENPOST_MEDIA_PATH` controls where files are stored on disk.
- `OPENPOST_MEDIA_URL` controls how those files are exposed publicly.
- `OPENPOST_STORAGE_DRIVER` chooses `local` or `s3`.

## Recommended production values

```sh
OPENPOST_MEDIA_PATH=/data/media
OPENPOST_MEDIA_URL=https://openpost.example.com/media
```

## Why public media URLs matter

Threads requires the backend to hand Meta a publicly reachable media URL. If OpenPost cannot expose the file publicly, Threads media publishing will fail.

## Backups

Back up the media directory together with the SQLite database when using local storage. For S3/R2-style storage, back up the bucket or configure provider-side versioning and lifecycle protection.

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

`OPENPOST_S3_PUBLIC_BASE_URL` is required in cloud mode because provider APIs need stable, publicly reachable media URLs.

The S3-compatible storage driver supports direct browser-to-S3 upload sessions and bounded-memory multipart storage for large files.

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

Save the policy as `cors.json`, apply it with `wrangler r2 bucket cors set <bucket> --file cors.json`, and verify it with `wrangler r2 bucket cors list <bucket>`. Without this bucket policy, the browser rejects the presigned `PUT` during its preflight request and reports `Failed to fetch`.

Streaming upload flow:

1. Call `POST /api/v1/media/upload-session` with `workspace_id`, `filename`, `mime_type`, and `size`.
2. Upload the file to the returned `PUT` target with the returned headers.
3. Call `POST /api/v1/media/upload-session/{media_id}/complete` with the same `workspace_id`.

S3-compatible storage returns a presigned browser-to-bucket target for files within the provider's single-request limit. Larger files use an authenticated OpenPost target and are written to the bucket as 8 MiB multipart parts. Local storage uses the same authenticated streaming target and writes directly to disk. Configure the reverse proxy in front of OpenPost to accept the largest video size you intend to support; X subscribed accounts can upload videos as large as 16 GiB.

OpenPost reserves a pending media record before issuing the target, then finalizes the upload by streaming the stored object through metadata checks and the SHA-256 dedupe hash, creating thumbnails when possible, recording media-upload usage, and marking the media ready. Large files are not retained in application memory.

The web app uses upload sessions automatically for current local and S3-compatible deployments. It falls back to the legacy multipart endpoint only when the server does not advertise upload-session support.

OpenPost stores destination-scoped provider media state for uploaded media IDs
so failed destination retries can reuse an existing provider upload. Providers
that publish by public media URL, such as Threads, Instagram, Facebook, and
TikTok, are intentionally not cached so signed media URLs stay fresh.
