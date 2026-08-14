# YouTube

This page is for operators configuring YouTube and users connecting a channel.

YouTube supports Shorts and long-form video uploads. It uses Google OAuth, asks the user to choose a channel, and stores the Google refresh token for scheduled uploads.

## Requirements

- Google Cloud OAuth app with the YouTube Data API v3 enabled
- OAuth redirect URL:

```text
https://your-domain.com/api/v1/accounts/youtube/callback
```

- OAuth scopes:
  - `https://www.googleapis.com/auth/userinfo.profile`
  - `https://www.googleapis.com/auth/userinfo.email`
  - `https://www.googleapis.com/auth/youtube.readonly`
  - `https://www.googleapis.com/auth/youtube.upload`
  - `https://www.googleapis.com/auth/youtube`
- One video attachment on the OpenPost post or YouTube-specific variant

## Configuration

Configure YouTube through the provider app registry. For bootstrap/self-hosting, use `OPENPOST_PROVIDER_APPS`:

```json
[
  {
    "provider": "youtube",
    "client_id": "your-google-oauth-client-id",
    "client_secret": "your-google-oauth-client-secret"
  }
]
```

If `redirect_uri` is omitted, OpenPost derives it from `OPENPOST_APP_URL`.

## Current Scope

- Connects a selected YouTube channel.
- Uploads one video through the YouTube Data API `videos.insert` endpoint with resumable-upload handling.
- Uploads videos as private by default, with YouTube-specific privacy settings available through publication/variant settings.
- Supports title, description, tags, category, made-for-kids, thumbnail, and playlist settings when provided. A thumbnail can be uploaded or captured from the attached video in destination settings.
- Uses the post or account version for a fallback title and description when those fields are empty.
- Supports scheduling and platform variants through the normal OpenPost post flow.
- Lists comments, sends replies, moderates comments, and deletes comments from the connected channel when Google grants access.

## Current Limits

- Comment and moderation actions require YouTube permissions and can vary by channel or comment.
- Test a live account before you rely on YouTube publishing, especially for app review, playlists, and thumbnails.

## Analytics

OpenPost collects channel subscribers, video count, and channel views plus published-video views, likes, and comments. Google may omit hidden subscriber counts. Accounts without `youtube.readonly` may need to reconnect.

## Troubleshooting

- `google account has no YouTube channels` usually means the authenticated Google user has no YouTube channel available to the OAuth app.
- `invalidTitle` usually means the first line of the post or variant is empty or invalid after trimming.
- `mediaBodyRequired` usually means the video file could not be read from OpenPost media storage.
- Upload permission errors usually mean the Google Cloud project lacks YouTube Data API v3 access or the OAuth app has not been verified for the requested scopes.
