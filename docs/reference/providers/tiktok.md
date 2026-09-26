# TikTok

This page is for operators configuring TikTok and users connecting an account.

TikTok supports video and photo posts through OAuth and the Content Posting API.

## What you need

- TikTok developer app
- Login Kit and Content Posting API access
- Social app entry with provider key `tiktok`
- Callback URL: `https://your-domain.com/api/v1/accounts/tiktok/callback`
- Public `OPENPOST_MEDIA_URL` or S3/R2 public media URL for Direct Post media URLs
- Publishing scopes: `user.info.basic`, `video.publish`, `video.upload`, plus photo-post access when using image posts
- Optional Display API scopes: `user.info.profile` (username), `user.info.stats` (account analytics), `video.list` (video metrics and public video ID reconciliation)

Example `OPENPOST_PROVIDER_APPS` entry:

```json
[
  {
    "provider": "tiktok",
    "client_id": "your-client-key",
    "client_secret": "your-client-secret",
    "redirect_uri": "https://your-domain.com/api/v1/accounts/tiktok/callback"
  }
]
```

## Support and limits

- New destinations default to Direct Post. Choose Upload explicitly to send a video to the TikTok inbox without publishing it.
- Direct Post supports one video.
- Inbox upload supports one video when enabled.
- Supports 1-35 JPEG or WebP photos, up to 20 MB each, when TikTok app access allows the photo-post path.
- Photo descriptions support up to 4,000 characters; video captions support up to 2,200 characters.
- Text-only posts are not supported.
- Pull-from-URL media must use public HTTPS URLs under a URL prefix or domain verified in the TikTok developer console.
- Test the real app and account after TikTok approves access.
- For Direct Post video, destination settings include a video preview for selecting the TikTok cover frame.

## Analytics

Analytics is an optional feature per connected TikTok account. It starts off for a new account. Enable it after connection or in Account details. OpenPost uses `user.info.stats` for follower, following, likes, and video totals and `video.list` for published-video likes, comments, shares, and views when enabled. Reconnect accounts created before these scopes were added. Disabling Analytics stops future TikTok analytics collection without deleting stored metrics or revoking authorization.

Direct messages, Comments and replies, and Grow are not available for TikTok. Analytics availability depends on provider support, required scopes, and plan access as distinct facts.

## Common issues

- `OPENPOST_MEDIA_URL` points at localhost or a private host.
- TikTok app lacks Content Posting API access or required scopes.
- The TikTok app's redirect URI does not exactly match OpenPost's callback URL.

## Without Display API approval

TikTok no longer offers the Display API to new apps. Those apps can still connect and publish: OpenPost needs only `user.info.basic`, `video.publish`, and `video.upload`. The connected account shows no username, analytics report the missing Display API scopes instead of failing the connection, and completed Direct Post videos keep the provider publish ID when the public video ID cannot be reconciled. Set `OPENPOST_DISABLE_TIKTOK_DISPLAY_API=true` so the authorization request asks only for the scopes TikTok can grant.
