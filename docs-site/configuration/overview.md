---
description: Configure the database, media storage, public URLs, provider applications, updates, feedback, and telemetry.
---

# Configuration Overview

Use this page when configuring a self-hosted or managed OpenPost instance.

This overview does not replace the complete environment-variable and provider-application references.

OpenPost settings fall into these groups:

- Server: port, public frontend URL, extra CORS origins
- Database: SQLite path by default, or Postgres URL for cloud deployments
- Secrets: JWT signing and token encryption
- Media: local filesystem path by default, or S3-compatible storage for cloud deployments
- Social networks: [provider application](/configuration/provider-applications) ownership, client keys, callback addresses, and server-specific settings
- Operations: self-hosted update checks and cloud-only limits on social network costs
- Platform-specific behavior: options such as LinkedIn thread reply disabling

For the full list, start with [Environment Variables](/configuration/environment-variables).
