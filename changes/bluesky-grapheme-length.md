### Fixed

- Count Bluesky post text in grapheme clusters, the unit of its 300-character limit, in both publishing validation and the composer counter. Emoji with skin tones, flags and ZWJ sequences were counted as two to seven characters each, so posts Bluesky accepts were rejected as over the limit.
