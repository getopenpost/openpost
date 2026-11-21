### Added

- Developer API tokens can be created without an expiry. Choose **Never** in **Settings → Personal → Developer**, or send `never_expires: true` to `POST /api/v1/api-tokens`. These tokens work until they are revoked, and `openpost auth token list` shows them as `never`. The default stays 90 days, dated tokens still last at most one year, and an organization's token lifetime policy still applies.
