# X

## What you need

- X developer app
- `X_CLIENT_ID`
- `X_CLIENT_SECRET`
- Callback URL: `https://your-domain.com/api/v1/accounts/x/callback`
- OAuth 1.0a user authentication enabled in the X developer portal

## Auth model

OpenPost currently uses X OAuth 1.0a end-to-end. Configure an app type that supports OAuth 1.0a user context and the callback URL above.

## Account-specific limits

OpenPost reads the connected account's `subscription_type` from the authenticated X profile and applies the matching publishing limits.

| Connected X account | Text limit | Video duration | Video size |
| --- | ---: | ---: | ---: |
| Standard, unknown, or stale tier | 280 weighted characters | 140 seconds | 512 MiB |
| Basic, Premium, or Premium+ | 25,000 weighted characters | 4 hours | 16 GiB |

X does not count every Unicode character as one. OpenPost follows X's weighted counting rules, treats URLs as 23 characters, normalizes composed text, and keeps emoji sequences together. The counter and server validation use the same rules.

The standard profile is the safe fallback. OpenPost uses it when X omits the subscription tier, the account profile cannot be refreshed, or cached account capability data is stale. Publishing validation refreshes the tier through the connected account before applying the final text and video limits.

These account limits do not replace X API access, quota, or format requirements. Test the formats you plan to publish with the production account.

X documents the [`subscription_type` user field](https://docs.x.com/x-api/fundamentals/data-dictionary), [weighted character counting](https://docs.x.com/fundamentals/counting-characters), and [longer Premium video limits](https://help.x.com/en/using-x/premium-longer-videos).

## Media upload

OpenPost streams images and videos to X through the OAuth 1.0a media upload API. Videos use chunked upload, so large subscribed-account uploads are not buffered fully in application memory.

## Local development callback

```txt
http://localhost:8080/api/v1/accounts/x/callback
```

## Common errors

- Callback URL mismatch in the X developer portal
- Missing OAuth 1.0a user auth enablement
- Wrong redirect URI override via `X_REDIRECT_URI`
- X profile permissions that do not return `subscription_type`; OpenPost will connect the account but use standard limits
