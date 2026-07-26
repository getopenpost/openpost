# Threads

Threads supports text, single media, replies, and 2-10 item media carousels, but the media URL requirement makes deployment details matter.

## What you need

- Meta developer app
- Threads API product enabled
- `THREADS_CLIENT_ID`
- `THREADS_CLIENT_SECRET`
- Callback URL: `https://your-domain.com/api/v1/accounts/threads/callback`
- Public `OPENPOST_MEDIA_URL`
- Scopes: `threads_basic`, `threads_content_publish`, `threads_manage_replies`

## Important requirement

Threads requires publicly reachable media URLs. Set:

```sh
OPENPOST_MEDIA_URL=https://your-domain.com/media
```

OpenPost passes stored media MIME types to the Threads publisher and serves public media URLs with file extensions where possible. Threads still fetches media from your URL server-side, so the URL must be reachable by Meta and return the correct media bytes.

Carousel publishing creates and waits for each child media container, then creates and publishes the parent carousel. A single-media rendition remains a normal image or video post.

## Local development

For local testing, expose OpenPost through a tunnel such as ngrok so the callback URL and `/media/...` paths are publicly reachable.

## Common issues

- Media URL points at localhost
- Reverse proxy serves a different host than the callback configuration
- Meta app missing the Threads API product or scopes
