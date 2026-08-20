---
description: Configure Meta OAuth and publish images, carousels, Stories, and Reels to an Instagram professional account.
---

# Instagram

This page is for operators configuring Instagram and users connecting a professional account.

Instagram professional publishing uses Meta OAuth, asks the user to choose a Business or Creator account connected to a Facebook Page, and stores the selected Page access token.

## Requirements

- Meta developer app with Facebook Login configured
- Instagram Business or Creator account connected to a Facebook Page
- OAuth redirect URL:

```text
https://your-domain.com/api/v1/accounts/instagram/callback
```

- App permissions:
  - `instagram_basic`
  - `instagram_content_publish`
  - `instagram_manage_comments`
  - `instagram_manage_messages`
  - `instagram_manage_insights`
  - `pages_show_list`
  - `pages_read_engagement`
- Public `OPENPOST_MEDIA_URL` or S3/R2 public media URL for image and Reel video posts

## Configuration

Configure Instagram through the provider app registry. For bootstrap/self-hosting, use `OPENPOST_PROVIDER_APPS`:

```json
[
  {
    "provider": "instagram",
    "client_id": "your-meta-app-id",
    "client_secret": "your-meta-app-secret"
  }
]
```

If `redirect_uri` is omitted, OpenPost derives it from `OPENPOST_APP_URL`.

## Current Scope

- Connects a selected Instagram Business or Creator account behind a Facebook Page.
- Publishes a single image URL with a caption.
- Publishes a single video URL as a Reel.
- Lets you choose a Reel cover frame or upload a separate cover image from destination settings.
- Publishes 2-10 media items as a carousel when multiple compatible media items are attached.
- Publishes Stories and lists, replies to, hides, and deletes eligible comments when Comments and replies is enabled for that account.
- Supports inbox collection for Direct messages when enabled and replies within Meta's reply window. Direct messages and Comments and replies are separate per-account choices that start off.
- Grow is not available for Instagram.
- Supports scheduling and platform variants through the normal OpenPost post flow.

Direct messages, Comments and replies, and Analytics are optional and per connected account. Disabling a feature stops future provider reads and writes without deleting history or revoking provider authorization. Availability depends on provider support, required scopes, and plan access as distinct facts.

## Current Limits

- No text-only Instagram posts.
- Media URLs must be public HTTPS URLs.
- Account discovery currently uses Pages returned by the authenticated Meta user.
- Live-account verification is still recommended before relying on production Instagram publishing.

## Analytics

Analytics is an optional feature per connected Instagram account. It starts off for a new account. Enable it after connection or in Account details. OpenPost collects account followers and media count plus post likes, comments, and the views, reach, saves, and shares that Meta returns for the media type when enabled. Reconnect accounts created before `instagram_manage_insights` was added. Disabling Analytics stops future Instagram analytics collection without deleting stored metrics or revoking authorization.

## Troubleshooting

- `facebook account has no connected instagram business accounts` usually means the Meta user has no eligible Pages with connected Instagram Business accounts, or the app lacks the required scopes.
- Media publish failures usually mean the media URL is not public HTTPS or Meta cannot fetch it.
- Permission errors usually require Meta app review for the Instagram and Page permissions above.
