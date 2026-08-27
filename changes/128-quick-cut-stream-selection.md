### Added

- Quick Cut now has per-source audio and video track selection with durable export semantics. Probing enumerates every video and audio track and stores the selected track indices per source. Project parsing remains backward compatible and validates impossible selections. Preflight, stream copy, transcode, and merged export honor the selection and can produce audio-only or video-only output.
