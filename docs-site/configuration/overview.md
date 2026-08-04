# Configuration Overview

OpenPost settings fall into these groups:

- Server: port, public frontend URL, extra CORS origins
- Database: SQLite path by default, or Postgres URL for cloud deployments
- Secrets: JWT signing and token encryption
- Media: local filesystem path by default, or S3-compatible storage for cloud deployments
- Stock media: optional Pexels, Unsplash, and Pixabay search with server-owned API keys
- Social networks: client keys, callback addresses, and server-specific settings
- Operations: self-hosted update checks and cloud-only limits on social network costs
- Platform-specific behavior: options such as LinkedIn thread reply disabling

For the full list, start with [Environment Variables](/configuration/environment-variables). See [Stock Media Providers](/configuration/stock-media) for provider registration, free limits, production approval, and storage costs.
