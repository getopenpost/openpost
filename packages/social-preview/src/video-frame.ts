import type { Attachment } from "svelte/attachments";

const LAST_FRAME_MARGIN_SECONDS = 0.001;

// A chosen cover frame supersedes the asset's default poster without playing it.
export function previewVideoFrame(seconds?: number): Attachment<HTMLVideoElement> {
  return (video) => {
    if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return;
    const seek = () => {
      const lastFrame = Number.isFinite(video.duration)
        ? Math.max(0, video.duration - LAST_FRAME_MARGIN_SECONDS)
        : seconds;
      const time = Math.min(seconds, lastFrame);
      if (Math.abs(video.currentTime - time) > LAST_FRAME_MARGIN_SECONDS) video.currentTime = time;
    };
    video.addEventListener("loadedmetadata", seek);
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) seek();
    return () => video.removeEventListener("loadedmetadata", seek);
  };
}
