### Added

- Desktop users can install OpenPost from the profile menu. Supported browsers offer a dismissible, one-time installation invitation; other desktop browsers show manual installation instructions.

### Fixed

- Production pages now link the PWA manifest and register the service worker from nested editor routes. Install icons include PNG and maskable variants.
- Service-worker updates wait for open windows to close. Public app caches exclude API responses, authorization URLs, query-bearing navigations, and original media. Updates remove the previous unrestricted page cache after activation.
- Cached local image designs can reopen and export offline without fetching server configuration. Uncached app pages show a translated offline page. Editor code and image models cache when used, without bulk downloads at installation.
