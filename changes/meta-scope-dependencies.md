### Fixed

- Fixed Facebook and Instagram connect failing with `Invalid Scopes: pages_read_user_content`. Facebook and Instagram OAuth now request Meta's dependency permissions `pages_read_user_content` and `pages_manage_metadata` alongside comment and messaging scopes, and the Meta app setup guides list them.
