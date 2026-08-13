# Local References

This directory is for local, gitignored source checkouts used as implementation references.

- `postiz/` is a shallow clone of <https://github.com/gitroomhq/postiz-app>. It is useful when comparing social provider OAuth, account selection, validation, posting, plug automation, multi-account reposts, and delayed workflows.
- `shoutrrr/` is a shallow clone of <https://github.com/coollabsio/shoutrrr>. It is useful when comparing durable repost jobs, engagement thresholds, delay ranges, plateau detection, and per-post overrides.
- `miniPaint/` is a shallow clone of <https://github.com/viliusle/miniPaint>. It is useful when comparing Image Editor raster tools, effects, import and export, snapping, shortcuts, and desktop or mobile editor behavior. Keep the source-grounded parity ledger in [`miniPaint-comparison.md`](miniPaint-comparison.md) current when the comparison materially changes.

Both checkouts are ignored by Git. Keep them in this directory as local implementation references; never vendor or commit their contents.

Refresh the checkout when needed:

```sh
git -C references/postiz pull --ff-only
git -C references/shoutrrr pull --ff-only
git -C references/miniPaint pull --ff-only
```
