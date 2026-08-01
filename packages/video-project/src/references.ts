import {
  type PrimarySequenceItem,
  type SourceID,
  type VideoProjectDocumentV1,
} from "./types.js";
import { isPrimarySequenceClip } from "./timeline.js";

function addPrimarySource(
  result: Set<SourceID>,
  item: PrimarySequenceItem,
): void {
  if (isPrimarySequenceClip(item)) result.add(item.source_id);
}

export function referencedSourceIDs(
  project: VideoProjectDocumentV1,
): SourceID[] {
  const result = new Set<SourceID>();
  project.primary_sequence.forEach((item) => addPrimarySource(result, item));
  for (const track of project.visual_tracks) {
    for (const item of track.items) {
      if ("source_id" in item) result.add(item.source_id);
    }
  }
  for (const track of project.audio_tracks) {
    for (const item of track.items) result.add(item.source_id);
  }
  return [...result].filter((id) => Boolean(project.sources[id])).sort();
}

export function projectWithReferencedSourcesOnly(
  project: VideoProjectDocumentV1,
): VideoProjectDocumentV1 {
  const ids = new Set(referencedSourceIDs(project));
  const next = structuredClone(project);
  next.sources = Object.fromEntries(
    Object.entries(next.sources).filter(([sourceID]) => ids.has(sourceID)),
  );
  return next;
}
