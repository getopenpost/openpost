# Configuration Overview

OpenPost configuration falls into a few practical groups:

- Server: port, public frontend URL, extra CORS origins
- Database: SQLite path by default, or Postgres URL for cloud deployments
- Secrets: JWT signing and token encryption
- Media: local filesystem path by default, or S3-compatible storage for cloud deployments
- Providers: client credentials, redirect URIs, and instance-specific settings
- Platform-specific behavior: options such as LinkedIn thread reply disabling

For the full list, start with [Environment Variables](/configuration/environment-variables).
