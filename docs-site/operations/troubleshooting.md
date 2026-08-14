---
description: Diagnose startup, database, media, provider, publishing, and delivery problems on a self-hosted OpenPost instance.
---

# Troubleshooting

Diagnose startup, database, media, provider, publishing, and delivery problems on a self-hosted OpenPost instance.

## App does not start

Symptoms: container exits or the binary returns immediately.

Likely cause: bad env file, missing write permissions, or invalid path settings.

How to check: inspect logs and confirm `OPENPOST_DATABASE_PATH` and `OPENPOST_MEDIA_PATH`.

How to fix: correct the env vars and ensure the process can write to the target directories.

## Cannot connect a social account

Symptoms: auth flow starts but does not complete.

Likely cause: callback mismatch, missing app keys, or missing social network access.

How to check: compare the callback URL with the social network's developer page and inspect server logs.

How to fix: correct the callback, app keys, and requested access.

Provider-specific checks: see [Provider Troubleshooting](/providers/troubleshooting).

## OAuth callback mismatch

Symptoms: the social network rejects the redirect or returns an invalid redirect error.

Likely cause: your public URL or callback path does not match exactly.

How to check: verify `OPENPOST_APP_URL`, social network callback settings, and any callback environment variables.

How to fix: set the exact public callback URL and restart OpenPost.

## CORS errors

Symptoms: browser console shows blocked API requests.

Likely cause: incorrect `OPENPOST_APP_URL` or missing `OPENPOST_EXTRA_CORS_ORIGINS`.

How to check: inspect browser dev tools and confirm the origin OpenPost is serving.

How to fix: update the origin settings and restart the backend.

## Media uploads fail

Symptoms: an upload fails before scheduling or a social network rejects the media.

Likely cause: file too large, unsupported type, or unwritable media path.

How to check: inspect upload responses and verify filesystem permissions.

How to fix: correct permissions or reduce media size.

## A social network cannot fetch media

Symptoms: text posts work, but media posts to Threads, Facebook, Instagram, or TikTok fail.

Likely cause: `OPENPOST_MEDIA_URL` is not public.

How to check: try opening a media URL from outside your local network.

How to fix: expose OpenPost through HTTPS and set a public media URL.

## Scheduled post did not publish

Symptoms: post remains queued or failed.

Likely cause: a saved job failed, the social network is down, or the account token is no longer valid.

How to check: inspect logs and Activity around the scheduled time, then check the account connection.

How to fix: fix the social network or account problem, then retry the failed account.

## Database path is wrong

Symptoms: empty app state after restart or startup errors.

Likely cause: the database is in the wrong path or in storage that is lost with the container.

How to check: confirm the actual file path mounted into the container or host.

How to fix: move to a persistent path and update `OPENPOST_DATABASE_PATH`.

## Database locked

Symptoms: intermittent write failures or queue delays.

Likely cause: filesystem issues or too many competing processes touching the same SQLite file.

How to check: confirm there is only one primary OpenPost process using the database.

How to fix: keep SQLite on local durable storage and avoid multiple writers.

## Reverse proxy redirects incorrectly

Symptoms: auth callbacks or login flows bounce to the wrong host.

Likely cause: the proxy host name and OpenPost URL do not match.

How to check: compare browser URL, proxy config, and `OPENPOST_APP_URL`.

How to fix: use the same public host name and restart OpenPost.

## Wrong public URL

Symptoms: pages work locally, but social network callbacks or shared media links fail.

Likely cause: localhost or internal hostnames leaked into public-facing settings.

How to check: inspect `OPENPOST_APP_URL`, `OPENPOST_MEDIA_URL`, and social network callback entries.

How to fix: replace internal URLs with the real public HTTPS domain.
