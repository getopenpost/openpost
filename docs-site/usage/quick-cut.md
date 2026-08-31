# Quick Cut

Quick Cut removes ranges from one or more media files with the least processing possible. Open `/quick-cut`, choose source files, mark the sections to keep, and export them individually or as one merged output.

Use [OpenPost Video Editor](/usage/video-editor) when the edit changes pixels, speed, audio levels, transitions, captions, overlays, or effects.

## Make a cut

Open one or more video or audio files. Set In and Out points from the player or time fields, then add a segment. Segments can be enabled, reordered, previewed in sequence, and looped. The stream panel shows the video, audio, subtitle, data, and unknown tracks found in each source.

**Nearest keyframe** snaps an eligible segment start to a verified source keyframe so encoded packets can be copied. **Exact time** keeps the requested boundary and uses precise transcoding when stream copy cannot represent it. The preflight states which segments can be copied, which require encoding, and why an output is blocked.

## Export without hidden loss

Stream copy keeps supported encoded video and audio packets instead of decoding and encoding them again. It preserves the compatible source container and codecs, so an eligible MOV stays MOV and an eligible WebM stays WebM. It also avoids the generation loss and render time of a transcode.

Quick Cut rejects plans that would silently drop unsupported subtitle, data, unknown-audio, or extra-video streams. Merged export requires compatible selected streams across its sources. If exact boundaries or incompatible inputs require rendering, choose the precise path or move the edit to the full editor.

Exports can download directly or save into the selected Video Editor workspace. A Quick Cut project file keeps source metadata, segment order, cut mode, and export choices. Reopening still requires access to the original source files.

## Send to OpenPost

When signed in with an OpenPost Workspace selected, **Send to OpenPost** uploads the finished output to Media. It does not upload the Quick Cut project or source files.

Quick Cut uses browser media and file APIs. Current Chrome or Edge gives the most complete file, codec, and workspace support.
