### Fixed

- Announced the Video Editor timeline ruler playhead position as a timecode (for example `00:00:03:00`) through `aria-valuetext`, instead of exposing only the raw frame number to assistive technology. The text follows the same `formatTimelinePreviewTimecode` helper already used by the Color mini-timeline playhead and marker labels, and updates live while seeking.
