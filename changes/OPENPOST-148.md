### Added

- Cloud Video Projects now keep portable authored state, Project Assets, versioned autosaves, named checkpoints, Trash, and explicit conflict branches inside the owning Workspace.
- The native mobile app can safely capture or import footage offline, then upload it with a non-destructive preparation recipe for completion in the web Video Editor.

### Changed

- Project Asset uploads use workspace storage limits and checksum reuse without appearing in the normal Media Library. Sync state reports pending work, active upload, saved state, or a storage problem instead of claiming success early.
