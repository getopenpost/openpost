Public-site builds prepare documentation inputs, then schedule marketing and docs
in one Turbo invocation. Shared dependency tasks have one scheduler and one writer.
Root dependency-install preparation and existing revision/environment cache inputs
remain unchanged.

The sync-docs-openapi owner now caches all five OpenAPI, media-limits and CLI-reference
outputs under the ignored `.turbo/docs-inputs` directory. Keys include repository
server/CLI files, config, generator helpers, dependency locks, formatter config,
Go environment/toolchain, C compiler version, Bun and formatter versions, and provenance settings.
Only Go's random compiler scratch prefix is normalized. Unknown workspace/local
module replacements, custom Go flags, ignored Go-tree files, unreadable inputs and
failed tool probes disable reuse. Missing or corrupt cache entries regenerate;
verified entries restore missing outputs. Generation failures never publish a
cache entry, and input changes during generation prevent publication.

Validation: the public graph regression failed before implementation. Task tests
and cache tests exercise scheduling, restoration, corruption, source/config/helper,
toolchain setting and provenance invalidation. Real generator commands measured
2.474s with no docs-input cache entry and 0.333s on verified reuse, with identical
SHA-256 hashes for all five outputs. Warm reuse runs tool identity probes but no
Go generation or formatting. These are local generator timings with an existing
Go compiler cache, not clean-machine compilation or full-site build timings.

This is a local verified cache, not a configured authenticated remote cache.
Full cold/warm public-site builds and deployment remain the parent delivery lane's
qualification. Existing package Turbo outputs and root postinstall are unchanged.
