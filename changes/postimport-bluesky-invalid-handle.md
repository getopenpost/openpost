### Fixed

- Link an imported Bluesky post through the account's DID when Bluesky reports its handle as `handle.invalid`, which it does when a custom-domain handle stops verifying. The post's link was built from that handle and did not open.
