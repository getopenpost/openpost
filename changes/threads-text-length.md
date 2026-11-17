### Fixed

- Threads text length now counts one per character and counts only emoji by their UTF-8 bytes, as Meta documents, so Japanese and other non-ASCII posts are no longer rejected as `text_too_long` at about a third of the 500-character limit.
