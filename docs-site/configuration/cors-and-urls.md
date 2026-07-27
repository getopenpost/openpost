# CORS And URLs

These settings solve many deployment problems when they are set correctly.

## `OPENPOST_APP_URL`

The public URL users visit in the browser. This is also part of the default CORS allowlist.

## `OPENPOST_EXTRA_CORS_ORIGINS`

Extra origins to allow, as a comma-separated list. Use this if you have alternate domains, admin origins, or a separate dev frontend.

Self-hosted mode also allows local development and Capacitor origins by
default. Cloud mode is stricter: it allows `OPENPOST_APP_URL` and explicit
extra origins only, and rejects wildcard `*` origins at startup.

## `OPENPOST_MEDIA_URL`

The public base URL for uploaded media. This must be correct for Threads and should match your reverse proxy path.

## Provider callback URLs

These are configured in the provider developer portals and should point back to your public OpenPost domain. They are separate from browser CORS settings.

## Common mistakes

- `OPENPOST_APP_URL` still points at localhost in production
- Hosted/cloud mode relies on implicit localhost CORS origins instead of explicit `OPENPOST_EXTRA_CORS_ORIGINS`
- `OPENPOST_EXTRA_CORS_ORIGINS` contains `*` while credentials are enabled
- `OPENPOST_MEDIA_URL` points at an internal hostname
- Provider callback URLs still use the local development domain
- Reverse proxy serves a different hostname than the one configured in OAuth apps
