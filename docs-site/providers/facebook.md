# Facebook

This page is for operators configuring Facebook and users connecting a Page.

Facebook Pages uses Meta OAuth, asks the user to choose a Page, and stores the selected Page access token.

## Requirements

- Meta developer app with Facebook Login configured
- OAuth redirect URL:

```text
https://your-domain.com/api/v1/accounts/facebook/callback
```

- App permissions:
  - `pages_show_list`
  - `pages_read_engagement`
  - `pages_manage_engagement`
  - `pages_manage_posts`
  - `pages_messaging`
- Public `OPENPOST_MEDIA_URL` or S3/R2 public media URL for image and video posts

## Configuration

Configure Facebook through the provider app registry. For bootstrap/self-hosting, use `OPENPOST_PROVIDER_APPS`:

```json
[
  {
    "provider": "facebook",
    "client_id": "your-meta-app-id",
    "client_secret": "your-meta-app-secret"
  }
]
```

If `redirect_uri` is omitted, OpenPost derives it from `OPENPOST_APP_URL`.

## Current Scope

- Connects a selected Facebook Page.
- Publishes text-only Page feed posts.
- Publishes one image URL through the Page photos endpoint.
- Publishes 2-10 images as an unpublished-photo set attached to one Page feed post.
- Publishes one video URL through the Page videos endpoint.
- Publishes one image or video as a Page Story when the Story profile is selected.
- Lists, replies to, hides, and deletes eligible Page comments when Comments and replies is enabled for that Page.
- Supports Page inbox collection for Direct messages when enabled and replies within Meta's reply window. Direct messages and Comments and replies are separate per-account choices that start off.
- Grow is not available for Facebook.
- Supports scheduling and platform variants through the normal OpenPost post flow.

Direct messages, Comments and replies, and Analytics are optional and per connected Page. Disabling a feature stops future provider reads and writes without deleting history or revoking provider authorization. Availability depends on provider support, required scopes, and plan access as distinct facts.

## Current Limits

- Multi-photo publishing creates a feed post, not a persistent Page album.
- Comment actions depend on Meta's permission for that Page and comment.
- Media URLs must be public HTTPS URLs.
- Live-account verification is still recommended before relying on production Page publishing.

## Analytics

Analytics is an optional feature per connected Facebook Page. It starts off for a new account. Enable it after connection or in Account details. OpenPost collects Page follower totals and published-post reactions, comments, and shares when enabled. It uses `pages_read_engagement`, keeps missing counters distinct from measured zero, and does not use deprecated Page impression metrics. Disabling Analytics stops future Facebook analytics collection without deleting stored metrics or revoking authorization.

## Troubleshooting

- `facebook account has no manageable pages` usually means the authenticated user has no eligible Pages or the app lacks `pages_show_list`.
- Media publish failures usually mean the media URL is not public HTTPS or Meta cannot fetch it.
- Permission errors usually require Meta app review for the Pages permissions above.
