---
description: Configure the database, media storage, public URLs, provider applications, updates, feedback, and telemetry.
---

# Configuration

Use this page when configuring a self-hosted deployment or the Hosted service.

Use the linked references for complete environment-variable and provider-application details.

OpenPost settings fall into these groups:

- Server: port, public frontend URL, extra CORS origins
- Database: SQLite path by default, or Postgres URL for cloud deployments
- Secrets: JWT signing and token encryption
- Media: local filesystem path by default, or S3-compatible storage for cloud deployments
- Social networks: [provider application](/configuration/provider-applications) ownership, client keys, callback addresses, and server-specific settings
- Custom destinations: [connector](/configuration/custom-connectors) services installed by a self-hosted operator
- Operations: self-hosted update checks and cloud-only limits on social network costs
- Platform-specific behavior: options such as LinkedIn thread reply disabling

For the full list, start with [Environment Variables](/configuration/environment-variables).
