### Added

- Video Editor export dialog: one-click presets (Master / Archive, Web 1080p, Social, Draft preview) that set container, codec, quality, and resolution atomically; manual dropdowns remain as overrides.
- Video Editor export preflight now announces slow render paths before export: main-thread fallback when background rendering is unavailable, animated-image fallback, and audio-mix fallback, plus a warning when the codec was auto-switched.
- Video Editor storage settings now show the live session proxy-cache size next to the proxy controls.
