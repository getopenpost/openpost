### Fixed

- Mastodon posts are measured the way Mastodon measures them: every link counts as 23 characters and a remote mention such as `@alice@example.social` counts as `@alice`, in publishing validation and in the composer counter. A post with a long link no longer shows as over the 500-character limit while Mastodon would accept it.
