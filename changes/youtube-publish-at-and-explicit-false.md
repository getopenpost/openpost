### Added

- YouTube: `publish_at` setting uploads a video as private now and lets YouTube publish it at that time (`status.publishAt`).

### Fixed

- YouTube: "Made for kids" and "Synthetic media" set to off are now sent as `false` instead of being dropped, so videos no longer stay "audience not set". Leaving them unset still uses the channel default.
