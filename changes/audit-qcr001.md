## Fixes

- Reordered Quick Cut previews play the final short part instead of stopping at its start. Segment-end checks wait for the next source seek and playback to settle, while cancelled previews remain fenced. (QCR001)
