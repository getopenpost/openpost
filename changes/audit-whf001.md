### Fixed

- Failed workflow HTTP JSON parsing retains the response status and bounded, redacted Content-Type for inspection, and explains how to correct the response format. Malformed response bodies are not retained in diagnostics, and failed requests are not retried automatically.
