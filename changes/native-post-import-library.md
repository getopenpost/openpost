### Added

- Native post imports as a separate opt-in library, independent of Analytics. Enabling imports on a Bluesky or Mastodon account stores its native posts (published after opt-in only, never backfilled) in a read-only imported-posts library with per-account checkpoints, daily read budgets, and loop protection against posts published through OpenPost. X native reads stay disabled by the read-cost policy; Threads, Instagram, Facebook, LinkedIn, TikTok, YouTube, and Pinterest are explicit TODOs.
