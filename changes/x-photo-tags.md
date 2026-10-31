### Fixed

- X destinations with "Tag people" now validate photo tags before publishing: at most 10 people per post, entries must be X handles or numeric user IDs, and tags require a photo attachment. OpenPost resolves handles to numeric X user IDs when publishing and caches the result per workspace, so retries do not repeat paid lookups. Over-limit lists are rejected at authoring readiness as well.
