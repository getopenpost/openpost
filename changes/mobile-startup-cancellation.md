### Fixed

- Fixed Android startup failing with “undefined is not a function.” Startup, sign-in, and shared queries now support React Native's cancellation APIs, including runtimes without `AbortSignal.throwIfAborted` or `DOMException`.
