### Fixed

- Prevent an older open composer from silently overwriting a newer draft and deleting its thread replies. Saves now use the revision of the content shown in the editor, so concurrent changes open the existing conflict dialog.
- Preserve revision-conflict details in publication API responses so the composer can offer reload, save-as-copy, and overwrite recovery.
