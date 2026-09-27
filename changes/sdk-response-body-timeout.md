### Fixed

- SDK request timeouts now include reading response bodies, so a server that sends headers but stalls its body cannot leave calls pending indefinitely.
