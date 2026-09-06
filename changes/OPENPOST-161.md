### Fixed

- Release builds now place server, CLI, and MCP binaries where the upload step expects them.

### Changed

- GitHub releases contain binaries and the signed Android APK. Scan reports stay in Actions; redundant release and Android manifests are removed.
- Workflow checks use actionlint.
