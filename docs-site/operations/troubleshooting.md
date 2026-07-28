# Troubleshooting

## App does not start

Symptoms: container exits or the binary returns immediately.

Likely cause: bad env file, missing write permissions, or invalid path settings.

How to check: inspect logs and confirm `OPENPOST_DATABASE_PATH` and `OPENPOST_MEDIA_PATH`.

How to fix: correct the env vars and ensure the process can write to the target directories.

## Cannot connect a social account

Symptoms: auth flow starts but does not complete.

Likely cause: callback mismatch, missing credentials, or incorrect provider scopes.

How to check: compare the configured callback URL with the provider developer console and inspect backend logs.

How to fix: align the callback, client credentials, and scopes.

Provider-specific checks: see [Provider Troubleshooting](/providers/troubleshooting).

## OAuth callback mismatch

Symptoms: provider rejects the redirect or returns an invalid redirect error.

Likely cause: your public URL or callback path does not match exactly.

How to check: verify `OPENPOST_APP_URL`, provider callback settings, and any explicit redirect URI env vars.

How to fix: set the exact public callback URL and restart OpenPost.

## CORS errors

Symptoms: browser console shows blocked API requests.

Likely cause: incorrect `OPENPOST_APP_URL` or missing `OPENPOST_EXTRA_CORS_ORIGINS`.

How to check: inspect browser dev tools and confirm the origin OpenPost is serving.

How to fix: update the origin settings and restart the backend.

## Media uploads fail

Symptoms: uploads error before scheduling or provider publishing rejects media.

Likely cause: file too large, unsupported type, or unwritable media path.

How to check: inspect upload responses and verify filesystem permissions.

How to fix: correct permissions or reduce media size.

## Threads media publishing fails

Symptoms: Threads text posts work but media posts fail.

Likely cause: `OPENPOST_MEDIA_URL` is not public.

How to check: try opening a media URL from outside your local network.

How to fix: expose OpenPost through HTTPS and set a public media URL.

## Scheduled post did not publish

Symptoms: post remains queued or failed.

Likely cause: worker error, provider outage, or invalid account token.

How to check: inspect logs around the scheduled time and check account connectivity.

How to fix: resolve the provider or credential issue, then retry if your workflow supports it.

## Database path is wrong

Symptoms: empty app state after restart or startup errors.

Likely cause: database stored in the wrong path or on ephemeral storage.

How to check: confirm the actual file path mounted into the container or host.

How to fix: move to a persistent path and update `OPENPOST_DATABASE_PATH`.

## Database locked

Symptoms: intermittent write failures or queue delays.

Likely cause: filesystem issues or too many competing processes touching the same SQLite file.

How to check: confirm there is only one primary OpenPost process using the database.

How to fix: keep SQLite on local durable storage and avoid multiple writers.

## Reverse proxy redirects incorrectly

Symptoms: auth callbacks or login flows bounce to the wrong host.

Likely cause: mismatch between proxy hostname and OpenPost URL config.

How to check: compare browser URL, proxy config, and `OPENPOST_APP_URL`.

How to fix: normalize the public hostname and restart.

## Wrong public URL

Symptoms: pages work locally but provider callbacks or shared media links fail.

Likely cause: localhost or internal hostnames leaked into public-facing settings.

How to check: inspect `OPENPOST_APP_URL`, `OPENPOST_MEDIA_URL`, and provider callback entries.

How to fix: replace internal URLs with the real public HTTPS domain.
