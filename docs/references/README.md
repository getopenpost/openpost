# Local References

This directory is for local, gitignored source checkouts used as implementation references.

- `postiz/` is a shallow clone of <https://github.com/gitroomhq/postiz-app>. Use it for social provider and publishing workflows.
- `shoutrrr/` is a shallow clone of <https://github.com/coollabsio/shoutrrr>. Use it for durable repost jobs and engagement gates.
- `miniPaint/` is a shallow clone of <https://github.com/viliusle/miniPaint>. Use it for Image Editor tools and workflows. Keep [`miniPaint-comparison.md`](miniPaint-comparison.md) current when the comparison changes.
- `openscreen/` is a shallow clone of <https://github.com/getopenscreen/openscreen>. Use it for cross-platform capture, cursor metadata, demo recording, native media, and export.
- `capptivo/` is a shallow clone of <https://github.com/SECHAK-AG/capptivo>. Use it for recorder/editor boundaries, cursor sidecars, and crash-safe recording ideas.
- `cap/` is a shallow clone of <https://github.com/CapSoftware/Cap>. Use it for capture, audio, camera, cursor, and desktop/cloud boundaries. Audit each crate's license before porting code.
- `freecut/` is a shallow clone of <https://github.com/walterlow/freecut> (MIT). Use it for timeline commands, sequences, keyframes, effects, and editor tests.
- `losslesscut/` is a shallow clone of <https://github.com/mifi/losslesscut> (**GPL-2.0**). Behavioral/product reference only for Quick Cut (segments, keyframe cuts, stream copy); never port its source into OpenPost.
- `kdenlive/` is a shallow clone of <https://invent.kde.org/multimedia/kdenlive>. Use it for mature NLE semantics, proxies, recovery, and export edge cases.
- `shotcut/` is a shallow clone of <https://github.com/mltframework/shotcut>. Use it for mature cross-platform editing and media-pipeline behavior.
- `opencut/` and `opencut-classic/` are shallow clones of <https://github.com/OpenCut-app/OpenCut> and <https://github.com/OpenCut-app/opencut-classic>. Use them for editor API direction and accessible timeline UX.
- `openvid/` is a shallow clone of <https://github.com/CristianOlivera1/openvid>. Use it for polished product-demo interactions. Check its license before copying code.
- `openreel-video/` is a shallow clone of <https://github.com/Augani/openreel-video>. Use it as a feature inventory, not an architectural source of truth.
- `qcut/` is a shallow clone of <https://github.com/Quriosity-agent/qcut>. Use it for product and interaction ideas only until its source license permits more.

All checkout directories are ignored by Git. Keep them shallow and local. Never commit or vendor them. Audit the exact source revision and license before porting any code.

Refresh a checkout when needed with `git -C docs/references/<name> pull --ff-only`.
