### Fixed

- Wait at least one second between X video and GIF STATUS polls when the provider omits `check_after_secs` or sends 0, so uploads do not busy-loop the media endpoint and fail as rate-limited.
