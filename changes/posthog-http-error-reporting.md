### Fixed

- HTTP failures report once when request logging and Echo handle the same error. Interrupted response streams retain their actual HTTP status and a separate failure diagnostic; request cancellation is distinguished from independent storage and server timeouts.
