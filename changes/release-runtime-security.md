### Fixed

- Update the server and CLI to Go 1.26.9 and the server's HTTP networking dependency to include the October security fixes. Production image builds and hosted database checks use digest-pinned Docker Official Images from their public ECR mirror to avoid Docker Hub's anonymous pull quota.

### Maintenance

- Browser component tests now use full Chromium by default, matching application browser tests. Mobile upload tests share one filesystem fixture so their results do not depend on test discovery order. The reverse-audio continuity fixture now uses its recording's actual nine-second duration.
