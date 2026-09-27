### Fixed

- Worker recovery checks the lease again before failing a stale job or marking its provider writes ambiguous. A renewed worker lease keeps the job active.
