# Public build graph and generated-input cache qualification

The integrated implementation uses one Turbo invocation for marketing and docs,
after documentation input preparation. The dry graph schedules each shared task
once. Root install preparation and runtime revision inputs remain intact.

The generator owner caches OpenAPI, media limits and CLI reference outputs in
`.turbo/docs-inputs`. Keys include source/configuration, locks, formatter and tool
versions, Go environment and actual local Go/CGO/embed dependencies. Unknown local
module replacements, custom Go flags or failed probes regenerate without reuse.
Every cached output is hashed and checked before restoration. Generation failure
or changing inputs prevents cache publication.

Generator execution excludes deployment run IDs and revisions because the OpenAPI
command explicitly uses schema version `1.0.0` and CLI docs explicitly use `dev`.
Runtime app/public-site revision metadata remains in its consuming build, separate
from these generated inputs. Ignored files participating in the actual Go graph
are hashed; unrelated ignored development environments and frontend outputs do not
force perpetual misses.

Root verification: cache/source/config/toolchain regressions passed. A real run
with a cold docs-input cache and warm Go compiler cache took 3.151 seconds. Verified
reuse with changed CI/deployment identity took 0.703 seconds. All five output hashes
were identical. These are local measurements, not clean-runner or production timing
claims. Actions persists these content-verified entries across eligible runs.

The combined public build and all 15 public artifact contract tests passed locally,
including independent forced rebuilds. Recording-only output verification keeps all
output assertions while leaving compiler reproducibility to core CI and manual
qualification. Public deployment and source-map acceptance are tracked separately.
