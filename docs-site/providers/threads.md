# Threads

Threads supports text, single media, replies, and 2-20 item media carousels, but the media URL requirement makes deployment details matter.

## What you need

- Meta developer app
- Threads API product enabled
- `THREADS_CLIENT_ID`
- `THREADS_CLIENT_SECRET`
- Callback URL: `https://your-domain.com/api/v1/accounts/threads/callback`
- Public `OPENPOST_MEDIA_URL`
- Scopes: `threads_basic`, `threads_content_publish`, `threads_manage_replies`, `threads_manage_insights`, `threads_location_tagging`

## Important requirement

Threads requires publicly reachable media URLs. Set:

```sh
OPENPOST_MEDIA_URL=https://your-domain.com/media
```

OpenPost passes stored media MIME types to the Threads publisher and serves public media URLs with file extensions where possible. Threads still fetches media from your URL server-side, so the URL must be reachable by Meta and return the correct media bytes.

For a carousel, OpenPost prepares each media item before it publishes the full carousel. An account version with one media item stays a normal image or video post.

## Comments

OpenPost can list replies, send replies, and hide replies. The Threads API path in OpenPost does not delete replies. Threads messages are not part of the OpenPost inbox.

## Analytics

OpenPost collects follower counts and supported post views, likes, replies, reposts, quotes, and shares. Accounts connected before `threads_manage_insights` was added must be reconnected before collection can start.

## Location tags

Threads location search requires `threads_location_tagging`. Accounts connected before this scope was added must be reconnected before locations can be searched or attached to a post. Your Meta app may also need access to this permission before non-test users can grant it.

## Local development

For local testing, expose OpenPost through a tunnel such as ngrok so the callback URL and `/media/...` paths are publicly reachable.

## Common issues

- Media URL points at localhost
- Reverse proxy serves a different host than the callback configuration
- Meta app missing the Threads API product or scopes
