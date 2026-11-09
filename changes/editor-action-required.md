### Fixed

- The `video_edit` and `image_edit` MCP tools no longer advertise `"required": null` for actions without required value fields (`text.style`, `item.transform`, `page.add`, `page.duplicate`, `page.delete`). MCP clients that validate tool schemas, such as Claude Code, rejected both tools and did not load them.
