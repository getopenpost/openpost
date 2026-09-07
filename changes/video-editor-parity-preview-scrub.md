# Video editor scrub + capture parity (preview-scrub)

- Scrub seeks share one deduped filmstrip decode per media + timestamp
  (generation counter + inflight map), prewarm filmstrips when a seek
  fallback starts, and drop superseded clones instead of flashing stale
  frames — matching FreeCut's schedule/warm/dispose behavior.
- New text-only scrub overlay: while paused with a preview frame, visible
  text/subtitle items paint through the shared canvas raster (one paint per
  animation frame, pointer-events-none) instead of forcing full media seeks.
- Save-frame now resolves its source frame with FreeCut's ±2-frame rule:
  paused scrub captures use the preview frame instead of the committed
  playhead.
