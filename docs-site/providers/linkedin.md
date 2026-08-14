# LinkedIn

This page is for operators configuring LinkedIn and users connecting a member profile or Organization Page.

LinkedIn uses OAuth 2.0 and has more approval friction than most other providers.

## What you need

- LinkedIn developer app
- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- Callback URL: `https://your-domain.com/api/v1/accounts/linkedin/callback`

## Personal profiles and Organization Pages

OpenPost always offers the member profile returned by LinkedIn OpenID Connect. Organization Pages are an explicit operator opt-in because LinkedIn gates their permissions behind approved products:

```sh
OPENPOST_DISABLE_LINKEDIN_THREAD_REPLIES=false
OPENPOST_LINKEDIN_ORGANIZATIONS_ENABLED=true
```

If your LinkedIn app cannot obtain the permissions required for comment-style replies, set `OPENPOST_DISABLE_LINKEDIN_THREAD_REPLIES=true`. The legacy `LINKEDIN_DISABLE_THREAD_REPLIES` alias remains supported.

With organizations enabled, the app must be approved for `rw_organization_admin`, `w_organization_social`, and `r_organization_social`. OpenPost lists only Pages for which the member has an approved `ADMINISTRATOR` role. The callback lets the user select their personal profile and several Pages. Each selection becomes a separate OpenPost account, while the shared OAuth token remains encrypted at rest.

Leave `OPENPOST_LINKEDIN_ORGANIZATIONS_ENABLED=false` when the app lacks those products. Personal publishing remains available. If organization discovery fails, OpenPost keeps the personal choice instead of failing the whole connection.

OpenPost defaults `LINKEDIN_API_VERSION` to the previous calendar month to avoid requesting a version LinkedIn has not activated yet. Set it only when your LinkedIn application requires an explicit supported version.

## Threading caveat

LinkedIn thread child posts are implemented as comments on the first post rather than native threaded posts.

OpenPost can list comments, send replies, and delete comments where LinkedIn grants access. LinkedIn messages are not part of the OpenPost inbox.

## Media caveat

OpenPost uses LinkedIn's Images API for images and Videos API for videos. Video upload initializes with `fileSizeBytes`, uploads all returned byte ranges, and finalizes the upload before creating the post.

## Analytics

LinkedIn analytics require Community Management API access, so the operator must turn on Organization support and use an approved app. With that access:

- personal profiles can return followers plus post impressions, reach, reactions, comments, reposts, saves, and link clicks;
- Organization Pages can return followers plus the post numbers that LinkedIn provides.

The connected account also needs `r_member_profileAnalytics` and `r_member_postAnalytics` for profile analytics or `rw_organization_admin` for Organization Page analytics.

## Common issues

- Insufficient app approval for social actions
- Organization mode enabled before the app has approved organization products
- The LinkedIn member is not an approved Page administrator
- Callback URL mismatch
- Reply permissions missing for thread child posts
