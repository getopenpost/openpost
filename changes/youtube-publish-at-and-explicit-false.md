### Added

- YouTube: per-post `publish_at` sets YouTube's public release time (`status.publishAt`) separately from OpenPost's upload schedule. It requires Private and an RFC 3339 timestamp with a timezone. Past times publish immediately.

### Fixed

- YouTube: explicit No answers for "Made for kids" and "Synthetic media" are sent as `false`. Both controls distinguish Yes, No, and Not specified. Absent and null disclosures remain omitted, preserving YouTube's audience defaults.
