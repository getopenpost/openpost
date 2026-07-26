# Reverse Proxy

HTTPS and a stable public URL matter for provider OAuth, passkeys, MCP OAuth discovery, and public-URL media publishing.

## Why it matters

- Providers validate callback URLs exactly.
- `OPENPOST_APP_URL` should match what users open in the browser.
- `OPENPOST_PUBLIC_URL` must match the externally visible origin for passkeys and MCP metadata.
- `OPENPOST_MEDIA_URL` must be public HTTPS for Threads, Facebook, Instagram, and TikTok pull-from-URL publishing.

## Required app settings

- `OPENPOST_APP_URL=https://openpost.example.com`
- `OPENPOST_PUBLIC_URL=https://openpost.example.com`
- `OPENPOST_MEDIA_URL=https://openpost.example.com/media`

## Caddy example

```txt
openpost.example.com {
  reverse_proxy localhost:8080
}
```

## Nginx example

```nginx
server {
  listen 443 ssl http2;
  server_name openpost.example.com;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## Callback URLs

Update your provider apps to use your public domain:

- `https://openpost.example.com/api/v1/accounts/x/callback`
- `https://openpost.example.com/api/v1/accounts/linkedin/callback`
- `https://openpost.example.com/api/v1/accounts/threads/callback`
- `https://openpost.example.com/api/v1/accounts/facebook/callback`
- `https://openpost.example.com/api/v1/accounts/instagram/callback`
- `https://openpost.example.com/api/v1/accounts/tiktok/callback`
- `https://openpost.example.com/api/v1/accounts/youtube/callback`

Mastodon uses `urn:ietf:wg:oauth:2.0:oob` by default, so you usually do not add a Mastodon callback URL unless you override `MASTODON_REDIRECT_URI`.

## Public-media providers

Threads, Facebook, Instagram, and TikTok need the media endpoint to be publicly reachable over HTTPS. TikTok additionally requires ownership verification for the configured URL prefix/domain. If `OPENPOST_MEDIA_URL` points to a private hostname or local path, capability validation blocks publishing before the provider request.

## Subpath mounts (e.g. `https://example.com/openpost/`)

**Not supported in v1.x.** The SvelteKit frontend is built with
`@sveltejs/adapter-static` and the Go binary embeds the resulting
`build/` directory. Asset URLs (`/_app/...`, `/sw.js`,
`/manifest.webmanifest`, etc.) are emitted as absolute paths starting
with `/`, not as paths relative to the mount point. The OAuth callback
`Location` header (now fixed to be absolute) also assumes the SPA is
served from the root.

If you need to share a host with other apps, run OpenPost on its own
subdomain (`https://openpost.example.com`) and let the reverse proxy
terminate at the root. This is the only configuration exercised by
the maintainers and the only one the CI matrix covers.

If you absolutely must try a subpath mount, you will need to:

- Strip the prefix in the proxy (e.g. `location /openpost/ { proxy_pass http://127.0.0.1:8080/; }`).
- Manually rewrite every absolute asset path in the SvelteKit build
  output (search-and-replace `/openpost` → `/` in `build/` before
  embedding). This is fragile and not part of the supported
  install path.
- Expect OAuth callbacks to land on `/accounts?status=success`
  (the URL the binary sets), not `/openpost/accounts?status=success`.
  Browser will follow the redirect to a 404 unless the proxy also
  rewrites the response `Location` header.

Track subpath support on the
[ROADMAP](https://github.com/rodrgds/openpost/blob/main/ROADMAP.md)
before requesting it.
