### Added

- Video Editor audio effect rack: compressor, stereo pan, reverb, delay, chorus, flanger, and distortion share a deep typed effect-chain abstraction and run identically in realtime preview and offline export. The rack is ordered, bypassable, resettable, bounded for safety, persisted/migrated, clone-safe, and undoable as one gesture. Compact accessible UI uses shared controls with good defaults.

### Changed

- Preview and export audio graphs now apply the shared effect chain after EQ and before the mixer, preserving existing EQ, pitch, fades, and ducking and without creating extra AudioContexts.
