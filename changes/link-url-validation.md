### Fixed

- Text posts with a link in them publish to Threads, Mastodon and other providers that take a native link again. Publish checks rejected the link the composer had attached with "url is not supported for Threads post" (or Mastodon post), so posts without media that contained a URL were blocked.
