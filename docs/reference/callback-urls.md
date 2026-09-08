# Callback URLs

This reference is for operators registering provider and identity callback URLs.

| Provider      | Local callback                                             | Production callback                                          |
| ------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| X             | `http://localhost:8080/api/v1/accounts/x/callback`         | `https://your-domain.com/api/v1/accounts/x/callback`         |
| Mastodon      | `urn:ietf:wg:oauth:2.0:oob` by default                     | `urn:ietf:wg:oauth:2.0:oob` by default                       |
| LinkedIn      | `http://localhost:8080/api/v1/accounts/linkedin/callback`  | `https://your-domain.com/api/v1/accounts/linkedin/callback`  |
| Threads       | `http://localhost:8080/api/v1/accounts/threads/callback`   | `https://your-domain.com/api/v1/accounts/threads/callback`   |
| Facebook      | `http://localhost:8080/api/v1/accounts/facebook/callback`  | `https://your-domain.com/api/v1/accounts/facebook/callback`  |
| Instagram     | `http://localhost:8080/api/v1/accounts/instagram/callback` | `https://your-domain.com/api/v1/accounts/instagram/callback` |
| TikTok        | `http://localhost:8080/api/v1/accounts/tiktok/callback`    | `https://your-domain.com/api/v1/accounts/tiktok/callback`    |
| YouTube       | `http://localhost:8080/api/v1/accounts/youtube/callback`   | `https://your-domain.com/api/v1/accounts/youtube/callback`   |
| Google login  | `http://localhost:8080/api/v1/auth/oidc/google/callback`   | `https://your-domain.com/api/v1/auth/oidc/google/callback`   |
| Instance OIDC | `http://localhost:8080/api/v1/auth/oidc/instance/callback` | `https://your-domain.com/api/v1/auth/oidc/instance/callback` |

Mastodon uses the OOB flow by default and exchanges the pasted authorization code through `/api/v1/accounts/mastodon/exchange`. Only configure a normal Mastodon callback URL if you also override `MASTODON_REDIRECT_URI`.

Organization OIDC providers use a provider-specific callback and back-channel
logout URL. Open **Settings → Organization → Single sign-on** and copy both URLs from the saved
provider. Register only those exact URLs with the identity provider.

Google login uses OpenID Connect with PKCE and the stable Google subject as the
external identity. OpenPost never links an existing user only because Google
returns the same email. Sign in to the existing OpenPost account and link Google
from **Settings → Personal → Security** instead.
