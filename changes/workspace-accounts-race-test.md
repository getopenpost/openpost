### Fixed

- Re-enabled the skipped workspace-switcher race test proving a slow previous-workspace accounts response cannot replace the newly selected workspace's account data. It passes with no code changes: the earlier workspace-selection fixes plus per-workspace query keys already isolate the late response.
