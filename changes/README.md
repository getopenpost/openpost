# Changes fragments

Create per-ticket changelog entries here as `changes/<name>.md`
(descriptive names are fine; parallel tickets never conflict).

Each file should group items under `### Added`, `### Changed`, `### Fixed`, etc.:

```
### Fixed

- Describe the user-visible fix.
```

`feat` and `fix` commits need a fragment. Pull request CI fails when none of
the pull request's commits adds one; pushes to `main` only warn. Scopes that
never reach users (`build`, `ci`, `deps`, `docs`, `e2e`, `marketing`,
`release`, `tasks`, `test`, `tests`) are exempt, and any other commit can opt
out with a `Changelog: none` trailer.

Before tagging, `bun run release -- ship` stops on `feat` and `fix` commits
since the last published release that no fragment covers. A commit is covered
by a fragment it adds or edits, by a fragment named after an issue in its
subject (`<issue>.md`), or by another commit that adds a fragment and names the
same issue. Add fragments for the user-visible ones, then rerun with
`OPENPOST_RELEASE_ALLOW_UNDOCUMENTED=1` if the rest do not affect users.

Tag CI merges fragments with the `CHANGELOG.md` `[Unreleased]` section in
memory to build the draft release notes, so releases need no changelog
commit. After the release publishes, the release workflow records the
shipped section into `CHANGELOG.md` as a bot commit and deletes exactly the
fragments the tag contained. Fragments added after the tag stay for the next
release.

`bun scripts/release-notes.mjs <tag>` previews the notes for a tag from the
current working tree. `bun scripts/record-release-changelog.mjs <tag>` is the
CI recorder; it pins fragments to the tag and refuses empty releases.
