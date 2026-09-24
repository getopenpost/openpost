### Changed

- Releases no longer need a changelog preparation commit. Tag CI builds the draft notes from `CHANGELOG.md` plus `changes/` fragments, and a post-publish bot commit records the shipped section and consumes exactly the tagged fragments.
