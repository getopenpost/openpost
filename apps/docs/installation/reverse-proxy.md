# Reverse Proxy

This page is for operators placing OpenPost behind a reverse proxy.

HTTPS and a stable public URL matter for social network sign-in, passkeys, MCP sign-in, and public media links.

## Why it matters

- Social networks check callback URLs exactly.
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

## Trusted proxy sign-in

Self-hosted platforms can let their authenticated user enter OpenPost without a
second sign-in. Set `OPENPOST_PROXY_AUTH_SECRET` to a random value of at least 32
characters, then have the trusted proxy add these headers:

- `X-OpenPost-Proxy-User`: a stable user ID or email address
- `X-OpenPost-Proxy-Secret`: the exact shared secret

OpenPost creates the user's personal workspace on first access and uses its
normal authorization rules after that. This mode is limited to
`OPENPOST_EDITION=selfhost`.

Treat the OpenPost process as a private upstream. The proxy must remove any
client-supplied copies of both headers before adding its own, and clients must
not be able to reach the OpenPost port directly. Prefer
`OPENPOST_PROXY_AUTH_SECRET_FILE` so the secret does not appear in environment
inspection output.

```nginx
location / {
  proxy_pass http://127.0.0.1:8081;
  proxy_set_header X-OpenPost-Proxy-User $trusted_user;
  proxy_set_header X-OpenPost-Proxy-Secret $openpost_proxy_secret;
}
```

If your proxy cannot guarantee those boundaries, keep OpenPost's built-in
sign-in instead.

## Nginx example

```nginx
server {
  listen 443 ssl http2;
  server_name openpost.example.com;
  client_max_body_size 16G;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_request_buffering off;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## Large video uploads

Set the proxy and any upstream CDN request-body limit to the largest video size you plan to accept. X subscribed accounts can use up to 16 GiB. Keep request buffering disabled so the proxy does not write a complete multi-gigabyte upload to temporary storage before OpenPost receives it. The Nginx example above shows both settings; Caddy does not impose a request-body limit unless you configure one.

S3-compatible deployments send files up to 5 GB directly to the bucket. Larger files and local-storage uploads pass through the reverse proxy as an authenticated stream. See [Media Storage](/configuration/media-storage) for the full flow.

## Social network callback URLs

Update your social network apps to use your public domain:

- `https://openpost.example.com/api/v1/accounts/x/callback`
- `https://openpost.example.com/api/v1/accounts/linkedin/callback`
- `https://openpost.example.com/api/v1/accounts/threads/callback`
- `https://openpost.example.com/api/v1/accounts/facebook/callback`
- `https://openpost.example.com/api/v1/accounts/instagram/callback`
- `https://openpost.example.com/api/v1/accounts/tiktok/callback`
- `https://openpost.example.com/api/v1/accounts/youtube/callback`

Mastodon uses `urn:ietf:wg:oauth:2.0:oob` by default, so you usually do not add a Mastodon callback URL unless you override `MASTODON_REDIRECT_URI`.

## Social networks that fetch media

Threads, Facebook, Instagram, and TikTok need to open the media link over public HTTPS. TikTok also requires proof that you own the link prefix or domain. If `OPENPOST_MEDIA_URL` points to a private host or local path, OpenPost blocks the post before it contacts the social network.

## Subpaths such as `https://example.com/openpost/`

**Not supported.** The SvelteKit frontend is built with
`@sveltejs/adapter-static` and the Go binary embeds the resulting
`build/` directory. Asset URLs (`/_app/...`, `/sw.js`,
`/manifest.webmanifest`, and others) start at the root. Sign-in callback
links also assume that OpenPost is served from the root.

Run OpenPost on its own subdomain, such as `https://openpost.example.com`.
