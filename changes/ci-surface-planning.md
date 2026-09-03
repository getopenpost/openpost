### Changed

- CI now runs the full release-candidate matrix for release tags instead of every push to `main`. Main pushes plan from the pushed diff, so untouched surfaces (for example the Android candidate) skip their jobs, and the release workflow waits for the tag's own CI run before promoting its artifacts.
- Backend tests run once with the race detector and coverage together instead of as two separate suites.
