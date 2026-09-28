### Fixed

- TikTok file uploads larger than 64 MiB follow TikTok's chunk rules: `total_chunk_count` is `video_size / chunk_size` rounded down and the final chunk carries the trailing bytes, instead of an extra small chunk of leftover bytes that the declared count does not allow.
