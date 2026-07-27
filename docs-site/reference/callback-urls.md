# Callback URLs

| Provider | Local callback | Production callback |
|---|---|---|
| X | `http://localhost:8080/api/v1/accounts/x/callback` | `https://your-domain.com/api/v1/accounts/x/callback` |
| Mastodon | `urn:ietf:wg:oauth:2.0:oob` by default | `urn:ietf:wg:oauth:2.0:oob` by default |
| LinkedIn | `http://localhost:8080/api/v1/accounts/linkedin/callback` | `https://your-domain.com/api/v1/accounts/linkedin/callback` |
| Threads | `http://localhost:8080/api/v1/accounts/threads/callback` | `https://your-domain.com/api/v1/accounts/threads/callback` |
| Facebook | `http://localhost:8080/api/v1/accounts/facebook/callback` | `https://your-domain.com/api/v1/accounts/facebook/callback` |
| Instagram | `http://localhost:8080/api/v1/accounts/instagram/callback` | `https://your-domain.com/api/v1/accounts/instagram/callback` |
| TikTok | `http://localhost:8080/api/v1/accounts/tiktok/callback` | `https://your-domain.com/api/v1/accounts/tiktok/callback` |
| YouTube | `http://localhost:8080/api/v1/accounts/youtube/callback` | `https://your-domain.com/api/v1/accounts/youtube/callback` |

Mastodon uses the OOB flow by default and exchanges the pasted authorization code through `/api/v1/accounts/mastodon/exchange`. Only configure a normal Mastodon callback URL if you also override `MASTODON_REDIRECT_URI`.
