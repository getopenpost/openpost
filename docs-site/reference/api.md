---
description: Find the rendered HTTP API reference and the authoritative OpenAPI JSON contract generated from the Huma routes.
---

# API Reference

This page is for developers who need the rendered or machine-readable API contract.

Use this page as a pointer only. The generated OpenAPI document is the authoritative operation and schema contract.

The full OpenAPI reference now lives in the developer docs:

- Rendered reference: [/development/api-reference](/development/api-reference)
- Raw spec on a running instance: [`/openapi.json`](/openapi.json)

The docs build regenerates the checked-in backend spec from the Huma route registrar, then syncs it into the docs site. The frontend client types are generated from that same `frontend/openapi.json` artifact.
