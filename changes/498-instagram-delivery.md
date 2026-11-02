### Fixed

- Instagram keeps ambiguous `media_publish` errors pending for read-only reconciliation, including Story sequence progress, rather than permitting another publish request.
- Instagram does not send a publish request for a container already reported as published, even when a later status read is inconsistent.
- Direct Instagram Login reads older messages through the conversation node and retains its nested pagination cursor.
- Graph `100/33` guidance describes inaccessible objects and unsupported actions without claiming that a Facebook Page was deleted or asking users to republish a live post.
- Instagram server diagnostics identify the failed Graph operation and endpoint template, a bounded object ID, and safe provider codes without logging tokens, captions, media URLs, or response bodies.
