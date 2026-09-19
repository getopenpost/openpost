### Added

- Quick Cut now has a large preview, waveform timeline, focused editing panels, markers, and undo/redo. Choose Quick Cut or Video Editor when starting a video from the composer.
- Edit Quick Cut videos by selecting transcript words to remove. Transcripts and markers save with the project without adding subtitles.
- Both video editors can detect speech locally with Silero or find silence from audio levels without an AI model. Review suggested cuts and adjust pause length and padding before applying them.

### Fixed

- Videos sent from the composer now import into the selected editor. Silence analysis retains audible stereo channels and all selected Quick Cut audio tracks.
- Exact merged exports trim encoded audio padding at each cut, preventing overlapping timestamps from stopping the export.
