### Fixed

- Token refresh jobs now fail loudly with a recorded error when the token manager is not configured, instead of being marked completed without attempting a refresh. Expired credentials now surface in job history and telemetry rather than only as downstream publishing auth errors.
