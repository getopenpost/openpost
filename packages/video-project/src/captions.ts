import type { CaptionCue } from "./types.js";
import { captionDisplayText } from "./timeline.js";

function srtTimestamp(timestampUS: number): string {
  const milliseconds = Math.max(0, Math.round(timestampUS / 1_000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const remainder = milliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(remainder).padStart(3, "0")}`;
}

function vttTimestamp(timestampUS: number): string {
  return srtTimestamp(timestampUS).replace(",", ".");
}

function normalizedCues(cues: CaptionCue[]): CaptionCue[] {
  return [...cues]
    .filter((cue) => cue.end_us > cue.start_us && captionDisplayText(cue))
    .sort((left, right) => left.start_us - right.start_us);
}

export function captionsToSRT(cues: CaptionCue[]): string {
  return `${normalizedCues(cues)
    .map(
      (cue, index) =>
        `${index + 1}\n${srtTimestamp(cue.start_us)} --> ${srtTimestamp(cue.end_us)}\n${captionDisplayText(cue)}`,
    )
    .join("\n\n")}\n`;
}

export function captionsToWebVTT(cues: CaptionCue[]): string {
  const body = normalizedCues(cues)
    .map(
      (cue) =>
        `${vttTimestamp(cue.start_us)} --> ${vttTimestamp(cue.end_us)}\n${captionDisplayText(cue)}`,
    )
    .join("\n\n");
  return `WEBVTT\n\n${body}${body ? "\n" : ""}`;
}
