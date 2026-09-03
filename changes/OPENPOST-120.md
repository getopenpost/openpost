### Fixed

- Paginate the Publications Activity, failed-jobs, and publication-history lists with cached infinite queries. Loaded pages stay in the Query cache under the workspace and bucket key, so revisits and tab switches reuse them instead of refetching page one.
- Invalidate exact activity buckets on publication moves. Reschedules, retries, dismissals, restores, publishes, draft deletes, and day-dialog deletes carry old and new buckets, so unrelated buckets and the failed-jobs list no longer refetch. Generic refreshes keep the previous whole-workspace behavior.
- Give the publication detail route a stable loading chrome. The cold detail load renders inside the shared page container instead of a bare loader.
- Add a lint boundary against effect-driven fetching. `scripts/check-query-effect-fetch.mjs` fails on transport or imperative Query reads inside render-path effects, with named exceptions; it runs in the Query migration policy stage next to the raw-GET gate.

### Changed

- Record the editors hub as the one multi-section loading exception in the server-state query migration spec. Each image and video section keeps its own delayed boundary while the shared header and search stay mounted.
