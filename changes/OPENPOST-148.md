### Added

- Cloud Video Projects now keep portable authored state, Project Assets, versioned autosaves, named checkpoints, Trash, and explicit conflict branches inside the owning Workspace.
- The native mobile app can safely capture or import footage offline, then upload it with a non-destructive preparation recipe for completion in the web Video Editor.
- Quick Cut source projects and standalone or in-editor recordings now use the same Cloud Video Project and Project Asset contract, while keeping an explicit Local-only path.

### Changed

- Project Asset uploads use workspace storage limits and checksum reuse without appearing in the normal Media Library. Sync state reports pending work, active upload, saved state, or a storage problem instead of claiming success early.
- Cloud Video Project lists, history, conflicts, assets, and mobile captures now share cache-safe reads and refresh affected data after each change.
