### Fixed

- Meta analytics preserve permission, token, rate-limit, and unavailable-object errors instead of treating them as missing metrics. Requests where every metric fails also retain their error.
