# Product Surface Parity

This reference is for contributors and automation authors choosing an OpenPost client surface.

OpenPost exposes one backend through several purpose-built clients. “Supported” means the surface has a first-class workflow; all clients still use the same workspace authorization, validation, quota, and audit rules.

| Workflow                                          | Web app                     | CLI                                          | MCP                            | HTTP API                 |
| ------------------------------------------------- | --------------------------- | -------------------------------------------- | ------------------------------ | ------------------------ |
| Sign in and manage account security               | Full                        | Device login and token profiles              | OAuth or API token             | Full                     |
| List and switch workspaces                        | Full                        | Full                                         | Full                           | Full                     |
| Connect social accounts                           | Full                        | Not exposed; use web OAuth/app-password flow | Not exposed                    | Full                     |
| List and disconnect accounts                      | Full                        | Full                                         | List only                      | Full                     |
| Inspect provider readiness and capabilities       | Full                        | Full                                         | Readiness and provider catalog | Full                     |
| Create, edit, schedule, and delete standard posts | Full                        | Full                                         | Full                           | Full                     |
| Create and publish format-first publications      | Full                        | Full                                         | Full                           | Full                     |
| Upload and reuse media                            | Full                        | Full                                         | Upload-by-URL and reuse by ID  | Full                     |
| Manage posting-slot definitions                   | Full                        | Full                                         | Reads next slot for scheduling | Full                     |
| Review jobs and publication activity              | Full                        | Full                                         | Publication events only        | Full                     |
| Review account and publication analytics          | Full                        | Not exposed                                  | Not exposed                    | Full                     |
| Reply to and moderate provider comments           | Full                        | Supported providers                          | Supported providers            | Full                     |
| Manage billing                                    | Full on hosted instances    | Status, checkout, and portal                 | Not exposed                    | Full on hosted instances |
| Configure provider applications                   | Operator configuration only | Not exposed                                  | Readiness only                 | Instance-admin API       |

The CLI command reference is generated from Cobra, and the HTTP reference is generated from Huma/OpenAPI. CI regenerates both and fails when committed contracts drift.

## Intentional differences

- Provider OAuth belongs in a browser because providers require redirects, consent, and sometimes account selection.
- MCP advertises compact `search_operations`, read-only `query_operation`, and mutation-only `execute_operation` tools so assistants discover operation schemas on demand while hosts retain a hard approval boundary.
- The CLI favors stable IDs, slugs, JSON output, and explicit confirmation suitable for terminals and automation.
- The web app owns visual editing, previews, drag-and-drop media, security ceremonies, and provider consent UX.
