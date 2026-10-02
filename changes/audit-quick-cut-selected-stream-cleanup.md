### Fixed

- Quick Cut cleanup now analyzes explicitly selected audio streams instead of failing to clone their reactive selection into a worker. Multiple selected streams still protect audible material in any retained stream. Failed dispatch also releases the worker (QMC001).
