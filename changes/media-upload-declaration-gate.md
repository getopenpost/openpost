### Fixed

- Media uploads with an empty filename or a malformed MIME declaration now fail before any byte is stored, at session reserve and every validation entry point.
- Uploads whose bytes sniff as a specific contradicting type (for example declared images containing HTML, or declared video containing JPEG bytes) are rejected instead of silently adopted. Generic fallbacks stay allowed for device captures.
