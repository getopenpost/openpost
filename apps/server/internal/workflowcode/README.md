# Workflow JavaScript runtime

`qjs.wasm` is the unmodified QuickJS WebAssembly engine distributed in `github.com/fastschema/qjs` v0.0.6 (MIT). Preserve both license files when updating it. OpenPost calls its small evaluation ABI through Wazero instead of the Go wrapper, because that wrapper mounts the host working directory.

Each evaluation has a fresh guest, a 64 MiB total linear-memory ceiling, a 32 MiB JavaScript heap ceiling, a two-second execution deadline, and 256 KiB input/output limits. It receives no filesystem preopens, environment variables, sockets, stdin, or host callbacks. Wazero compilation is cached across evaluations. The engine ABI and sandbox guarantees are exercised through the production evaluator tests.
