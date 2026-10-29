### Changed

- Run affected checks on main and pull requests while keeping complete release qualification on tags and nightly runs. Separate mobile source feedback from Android packaging and preserve production release gates.
- Select shared package consumers through declared dependencies, avoid unrelated public-site builds, and retain browser test timing reports for regression and selection audits.
- Check unpushed changes locally before releases; retain full local rehearsal as an explicit command.
