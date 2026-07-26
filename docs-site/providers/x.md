# X

## What you need

- X developer app
- `X_CLIENT_ID`
- `X_CLIENT_SECRET`
- Callback URL: `https://your-domain.com/api/v1/accounts/x/callback`
- OAuth 1.0a user authentication enabled in the X developer portal

## Auth model

OpenPost currently uses X OAuth 1.0a end-to-end. Configure an app type that supports OAuth 1.0a user context and the callback URL above.

## Local development callback

```txt
http://localhost:8080/api/v1/accounts/x/callback
```

## Common errors

- Callback URL mismatch in the X developer portal
- Missing OAuth 1.0a user auth enablement
- Wrong redirect URI override via `X_REDIRECT_URI`
