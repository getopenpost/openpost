### Changed

- Interface sounds use the new cuelume cue set. Signature, Velvet and Crisp now map to cuelume's warm, trackpad and mechanical materials, and each sound follows its interface job: selecting, confirming, closing, toggling on or off, deleting and errors.
- The server is built with Go 1.27.3 on Alpine 3.24.4, with refreshed Go and JavaScript dependencies.

### Fixed

- Feedback, diagnostics and meme requests accept bodies up to their documented limit exactly; the previous allowance of one extra byte is gone.
