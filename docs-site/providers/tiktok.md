# TikTok

This page is for operators configuring TikTok and users connecting an account.

TikTok supports video and photo posts through OAuth and the Content Posting API.

## What you need

- TikTok developer app
- Login Kit and Content Posting API access
- Social app entry with provider key `tiktok`
- Callback URL: `https://your-domain.com/api/v1/accounts/tiktok/callback`
- Public `OPENPOST_MEDIA_URL` or S3/R2 public media URL for Direct Post media URLs
- Scopes: `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list`, `video.publish`, `video.upload`, and photo-post access when using image posts

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

OpenPost uses `user.info.stats` for follower, following, likes, and video totals. It uses `video.list` for published-video likes, comments, shares, and views. Reconnect accounts created before these scopes were added.

## Common issues

- `OPENPOST_MEDIA_URL` points at localhost or a private host.
- TikTok app lacks Content Posting API access or required scopes.
- The TikTok app's redirect URI does not exactly match OpenPost's callback URL.
