### Fixes

- Retry temporary Threads carousel assembly failures and Instagram media-not-ready rejections with bounded backoff, reusing the prepared media containers.
- Limit Meta propagation retries to confirmed readiness rejections so uncertain network or server failures cannot repeat a publish.
