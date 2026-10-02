### Fixed

- Workflow Preview, Live, and node tests report malformed sample JSON in Test data before checking node variables. The sample field keeps its text and receives focus; corrected JSON can run without an empty-object fallback. Full runs still require an object, while node tests preserve valid JSON values. (WFA-001)
