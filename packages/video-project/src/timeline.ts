import {
  VIDEO_PROJECT_LIMITS,
  VIDEO_TICKS_PER_SECOND,
  type AudioTrackItem,
  type CaptionCue,
  type DerivedPrimaryClip,
  type EasingName,
  type NumericKeyframe,
  type PrimarySequenceClip,
  type PrimarySequenceGap,
  type PrimarySequenceItem,
  type VariantID,
  type VideoPresentationOverride,
  type VideoPresentation,
  type VideoProjectDocumentV1,
  type VisualTrackItem,
} from "./types.js";

export function cloneVideoProject(
  project: VideoProjectDocumentV1,
): VideoProjectDocumentV1 {
  return structuredClone(project);
}

export function clipDurationUS(clip: PrimarySequenceClip): number {
  if (clip.mode === "freeze") return Math.max(0, clip.freeze_duration_us ?? 0);
  return Math.max(
    0,
    Math.round((clip.source_out_us - clip.source_in_us) / clip.speed),
  );
}

export function isPrimarySequenceGap(
  item: PrimarySequenceItem,
): item is PrimarySequenceGap {
  return item.kind === "gap";
}

export function isPrimarySequenceClip(
  item: PrimarySequenceItem,
): item is PrimarySequenceClip {
  return item.kind !== "gap";
}

export function primaryItemDurationUS(item: PrimarySequenceItem): number {
  return isPrimarySequenceGap(item)
    ? Math.max(0, item.duration_us)
    : clipDurationUS(item);
}

function transitionOverlapUS(
  previous: PrimarySequenceItem | undefined,
  current: PrimarySequenceItem,
): number {
  if (
    !previous ||
    !isPrimarySequenceClip(previous) ||
    !isPrimarySequenceClip(current)
  )
    return 0;
  const outgoing = previous.transition_out?.duration_us ?? 0;
  const incoming = current.transition_in?.duration_us ?? 0;
  const requested = Math.max(outgoing, incoming);
  return Math.min(
    requested,
    Math.floor(clipDurationUS(previous) / 2),
    Math.floor(clipDurationUS(current) / 2),
  );
}

export function derivePrimarySequence(
  project: Pick<VideoProjectDocumentV1, "primary_sequence">,
): DerivedPrimaryClip[] {
  const derived: DerivedPrimaryClip[] = [];
  let cursorUS = 0;
  for (let index = 0; index < project.primary_sequence.length; index++) {
    const clip = project.primary_sequence[index]!;
    const durationUS = primaryItemDurationUS(clip);
    const overlapUS = transitionOverlapUS(
      project.primary_sequence[index - 1],
      clip,
    );
    const startUS = Math.max(0, cursorUS - overlapUS);
    const endUS = startUS + durationUS;
    derived.push({
      clip_id: clip.id,
      kind: isPrimarySequenceGap(clip) ? "gap" : "clip",
      index,
      timeline_start_us: startUS,
      timeline_end_us: endUS,
      duration_us: durationUS,
      transition_overlap_us: overlapUS,
    });
    cursorUS = endUS;
  }
  return derived;
}

export function projectDurationUS(
  project: Pick<
    VideoProjectDocumentV1,
    "primary_sequence" | "visual_tracks" | "audio_tracks" | "caption_tracks"
  >,
): number {
  const primaryEnd =
    derivePrimarySequence(project).at(-1)?.timeline_end_us ?? 0;
  const visualEnd = Math.max(
    0,
    ...project.visual_tracks.flatMap((track) =>
      track.items.map((item) => item.timeline_start_us + item.duration_us),
    ),
  );
  const audioEnd = Math.max(
    0,
    ...project.audio_tracks.flatMap((track) =>
      track.items.map((item) => item.timeline_start_us + item.duration_us),
    ),
  );
  const captionEnd = Math.max(
    0,
    ...project.caption_tracks.flatMap((track) =>
      track.cues.map((cue) => cue.end_us),
    ),
  );
  return Math.max(primaryEnd, visualEnd, audioEnd, captionEnd);
}

export function splitPrimaryClip(
  project: VideoProjectDocumentV1,
  clipID: string,
  timelineUS: number,
  createID: () => string = () => crypto.randomUUID(),
): VideoProjectDocumentV1 {
  const next = cloneVideoProject(project);
  const index = next.primary_sequence.findIndex((clip) => clip.id === clipID);
  if (index < 0) throw new Error("The selected clip no longer exists.");
  const clip = next.primary_sequence[index]!;
  if (isPrimarySequenceGap(clip))
    throw new Error("Gaps cannot be split. Adjust their duration.");
  if (clip.mode === "freeze")
    throw new Error("Freeze frames cannot be split. Adjust their duration.");
  const derived = derivePrimarySequence(next)[index]!;
  const relativeUS = timelineUS - derived.timeline_start_us;
  if (relativeUS <= 0 || relativeUS >= derived.duration_us) {
    throw new Error("Place the playhead inside the clip before splitting.");
  }
  const sourceSplitUS = Math.round(clip.source_in_us + relativeUS * clip.speed);
  const left: PrimarySequenceClip = {
    ...structuredClone(clip),
    source_out_us: sourceSplitUS,
  };
  delete left.transition_out;
  const right: PrimarySequenceClip = {
    ...structuredClone(clip),
    id: createID(),
    source_in_us: sourceSplitUS,
  };
  delete right.transition_in;
  next.primary_sequence.splice(index, 1, left, right);
  return next;
}

export function trimPrimaryClip(
  project: VideoProjectDocumentV1,
  clipID: string,
  edge: "start" | "end",
  deltaTimelineUS: number,
): VideoProjectDocumentV1 {
  if (!Number.isFinite(deltaTimelineUS)) {
    throw new Error("Trim offset must be a finite number.");
  }
  const next = cloneVideoProject(project);
  const index = next.primary_sequence.findIndex((clip) => clip.id === clipID);
  if (index < 0) throw new Error("The selected clip no longer exists.");
  const clip = next.primary_sequence[index]!;
  if (isPrimarySequenceGap(clip))
    throw new Error("Select a clip before trimming.");
  const frameUS = Math.max(
    1,
    Math.round(
      (VIDEO_TICKS_PER_SECOND * next.timebase.fps_denominator) /
        next.timebase.fps_numerator,
    ),
  );
  const snappedTimelineUS = Math.round(deltaTimelineUS / frameUS) * frameUS;
  if (snappedTimelineUS === 0) return next;

  if (clip.mode === "freeze") {
    const current = clip.freeze_duration_us ?? frameUS;
    clip.freeze_duration_us = Math.max(
      frameUS,
      edge === "start"
        ? current - snappedTimelineUS
        : current + snappedTimelineUS,
    );
  } else {
    const minimumSourceUS = Math.max(1, Math.round(frameUS * clip.speed));
    const sourceDeltaUS = Math.round(snappedTimelineUS * clip.speed);
    if (edge === "start") {
      clip.source_in_us = Math.max(
        0,
        Math.min(
          clip.source_out_us - minimumSourceUS,
          clip.source_in_us + sourceDeltaUS,
        ),
      );
    } else {
      const source = next.sources[clip.source_id];
      clip.source_out_us = Math.max(
        clip.source_in_us + minimumSourceUS,
        Math.min(
          source?.duration_us ?? clip.source_out_us,
          clip.source_out_us + sourceDeltaUS,
        ),
      );
    }
  }

  clampTransitionBoundary(next.primary_sequence[index - 1], clip);
  clampTransitionBoundary(clip, next.primary_sequence[index + 1]);
  return next;
}

/**
 * Sets an exact source boundary without quantizing it to the project frame rate.
 *
 * Full editor trims are timeline operations and intentionally snap to the project
 * timebase. Quick Cut, however, works on encoded packet boundaries. Reusing the
 * timeline trim operation for packet timestamps can move a verified keyframe by
 * a fraction of a frame and make an otherwise lossless cut impossible.
 */
export function setPrimaryClipSourceBoundary(
  project: VideoProjectDocumentV1,
  clipID: string,
  edge: "start" | "end",
  sourceTimestampUS: number,
): VideoProjectDocumentV1 {
  if (!Number.isFinite(sourceTimestampUS)) {
    throw new Error("Source boundary must be a finite number.");
  }
  const next = cloneVideoProject(project);
  const index = next.primary_sequence.findIndex((item) => item.id === clipID);
  if (index < 0) throw new Error("The selected clip no longer exists.");
  const clip = next.primary_sequence[index]!;
  if (isPrimarySequenceGap(clip) || clip.mode !== "source") {
    throw new Error("Exact source boundaries require a source clip.");
  }
  const source = next.sources[clip.source_id];
  const boundedTimestampUS = Math.round(
    Math.max(
      0,
      Math.min(source?.duration_us ?? clip.source_out_us, sourceTimestampUS),
    ),
  );
  const minimumDurationUS = 1;
  if (edge === "start") {
    clip.source_in_us = Math.min(
      clip.source_out_us - minimumDurationUS,
      boundedTimestampUS,
    );
  } else {
    clip.source_out_us = Math.max(
      clip.source_in_us + minimumDurationUS,
      boundedTimestampUS,
    );
  }
  clampTransitionBoundary(next.primary_sequence[index - 1], clip);
  clampTransitionBoundary(clip, next.primary_sequence[index + 1]);
  return next;
}

function clampTransitionBoundary(
  left: PrimarySequenceItem | undefined,
  right: PrimarySequenceItem | undefined,
): void {
  if (
    !left ||
    !right ||
    !isPrimarySequenceClip(left) ||
    !isPrimarySequenceClip(right) ||
    (!left.transition_out && !right.transition_in)
  )
    return;
  const maximumUS = Math.max(
    0,
    Math.min(
      Math.floor(clipDurationUS(left) / 2),
      Math.floor(clipDurationUS(right) / 2),
    ),
  );
  const durationUS = Math.min(
    Math.max(
      left.transition_out?.duration_us ?? 0,
      right.transition_in?.duration_us ?? 0,
    ),
    maximumUS,
  );
  if (left.transition_out) left.transition_out.duration_us = durationUS;
  if (right.transition_in) right.transition_in.duration_us = durationUS;
}

export function removePrimaryRanges(
  project: VideoProjectDocumentV1,
  ranges: Array<{ start_us: number; end_us: number }>,
  createID: () => string = () => crypto.randomUUID(),
): VideoProjectDocumentV1 {
  let next = cloneVideoProject(project);
  const normalized = mergeTimeRanges(ranges)
    .filter((range) => range.end_us > range.start_us)
    .sort((left, right) => right.start_us - left.start_us);

  for (const range of normalized) {
    const derived = derivePrimarySequence(next);
    for (let index = derived.length - 1; index >= 0; index--) {
      const item = derived[index]!;
      if (
        item.timeline_end_us <= range.start_us ||
        item.timeline_start_us >= range.end_us
      )
        continue;
      const clip = next.primary_sequence[index]!;
      if (isPrimarySequenceGap(clip)) {
        const removedUS =
          Math.min(item.timeline_end_us, range.end_us) -
          Math.max(item.timeline_start_us, range.start_us);
        clip.duration_us = Math.max(0, clip.duration_us - removedUS);
        if (!clip.duration_us) next.primary_sequence.splice(index, 1);
        continue;
      }
      if (clip.mode === "freeze") {
        if (
          range.start_us <= item.timeline_start_us &&
          range.end_us >= item.timeline_end_us
        ) {
          next.primary_sequence.splice(index, 1);
        } else {
          const removedUS =
            Math.min(item.timeline_end_us, range.end_us) -
            Math.max(item.timeline_start_us, range.start_us);
          clip.freeze_duration_us = Math.max(0, item.duration_us - removedUS);
          if (!clip.freeze_duration_us) next.primary_sequence.splice(index, 1);
        }
        continue;
      }

      const localStartUS = Math.max(0, range.start_us - item.timeline_start_us);
      const localEndUS = Math.min(
        item.duration_us,
        range.end_us - item.timeline_start_us,
      );
      const sourceCutStartUS = Math.round(
        clip.source_in_us + localStartUS * clip.speed,
      );
      const sourceCutEndUS = Math.round(
        clip.source_in_us + localEndUS * clip.speed,
      );

      if (localStartUS <= 0 && localEndUS >= item.duration_us) {
        next.primary_sequence.splice(index, 1);
      } else if (localStartUS <= 0) {
        clip.source_in_us = sourceCutEndUS;
        delete clip.transition_in;
      } else if (localEndUS >= item.duration_us) {
        clip.source_out_us = sourceCutStartUS;
        delete clip.transition_out;
      } else {
        const right: PrimarySequenceClip = {
          ...structuredClone(clip),
          id: createID(),
          source_in_us: sourceCutEndUS,
        };
        delete right.transition_in;
        clip.source_out_us = sourceCutStartUS;
        delete clip.transition_out;
        next.primary_sequence.splice(index + 1, 0, right);
      }
    }
  }
  return next;
}

export function rippleDeleteCaptionWords(
  project: VideoProjectDocumentV1,
  selections: Array<{ cue_id: string; word_index: number }>,
  createID: () => string = () => crypto.randomUUID(),
): VideoProjectDocumentV1 {
  const selected = new Set(
    selections.map(
      (selection) => `${selection.cue_id}:${selection.word_index}`,
    ),
  );
  const ranges = mergeTimeRanges(
    project.caption_tracks.flatMap((track) =>
      track.cues.flatMap((cue) =>
        cue.words.flatMap((word, index) =>
          selected.has(`${cue.id}:${index}`)
            ? [{ start_us: word.start_us, end_us: word.end_us }]
            : [],
        ),
      ),
    ),
  ).filter((range) => range.end_us > range.start_us);
  if (!ranges.length) return cloneVideoProject(project);

  return rippleDeleteTimelineRanges(project, ranges, createID);
}

interface TimelineRange {
  start_us: number;
  end_us: number;
}

function keptTimelineSegments(
  startUS: number,
  durationUS: number,
  ranges: TimelineRange[],
): TimelineRange[] {
  const endUS = startUS + durationUS;
  const segments: TimelineRange[] = [];
  let cursorUS = startUS;
  for (const range of ranges) {
    if (range.end_us <= cursorUS) continue;
    if (range.start_us >= endUS) break;
    if (range.start_us > cursorUS) {
      segments.push({
        start_us: cursorUS,
        end_us: Math.min(endUS, range.start_us),
      });
    }
    cursorUS = Math.max(cursorUS, range.end_us);
    if (cursorUS >= endUS) break;
  }
  if (cursorUS < endUS) segments.push({ start_us: cursorUS, end_us: endUS });
  return segments.filter((segment) => segment.end_us > segment.start_us);
}

function timestampIsRemoved(
  timestampUS: number,
  ranges: TimelineRange[],
): boolean {
  return ranges.some(
    (range) => timestampUS >= range.start_us && timestampUS < range.end_us,
  );
}

function retimeKeyframes(
  keyframes: NumericKeyframe[],
  itemStartUS: number,
  segments: TimelineRange[],
  ranges: TimelineRange[],
  nextStartUS: number,
): NumericKeyframe[] {
  if (!keyframes.length || !segments.length) return [];
  const byTime = new Map<number, NumericKeyframe>();
  for (const segment of segments) {
    const localStartUS = segment.start_us - itemStartUS;
    const localEndUS = segment.end_us - itemStartUS;
    const candidates = [
      {
        time_us: localStartUS,
        value: interpolateKeyframes(keyframes, localStartUS),
        easing:
          keyframes.find((keyframe) => keyframe.time_us >= localStartUS)
            ?.easing ?? keyframes.at(-1)!.easing,
      },
      ...keyframes.filter(
        (keyframe) =>
          keyframe.time_us > localStartUS &&
          keyframe.time_us < localEndUS &&
          !timestampIsRemoved(itemStartUS + keyframe.time_us, ranges),
      ),
      {
        time_us: localEndUS,
        value: interpolateKeyframes(keyframes, localEndUS),
        easing:
          keyframes.find((keyframe) => keyframe.time_us >= localEndUS)
            ?.easing ?? keyframes.at(-1)!.easing,
      },
    ];
    for (const keyframe of candidates) {
      const timeUS =
        retimeAfterRemovedRanges(itemStartUS + keyframe.time_us, ranges) -
        nextStartUS;
      byTime.set(Math.max(0, timeUS), {
        ...keyframe,
        time_us: Math.max(0, timeUS),
      });
    }
  }
  return [...byTime.values()].sort(
    (left, right) => left.time_us - right.time_us,
  );
}

function retimePresentationKeyframes<
  T extends VideoPresentation | VideoPresentationOverride,
>(
  presentation: T,
  itemStartUS: number,
  segments: TimelineRange[],
  ranges: TimelineRange[],
  nextStartUS: number,
): T {
  const next = structuredClone(presentation);
  if (!next.keyframes) return next;
  next.keyframes = Object.fromEntries(
    Object.entries(next.keyframes).flatMap(([property, keyframes]) =>
      keyframes
        ? [
            [
              property,
              retimeKeyframes(
                keyframes,
                itemStartUS,
                segments,
                ranges,
                nextStartUS,
              ),
            ],
          ]
        : [],
    ),
  ) as T["keyframes"];
  return next;
}

function retimeVisualItemAnimations(
  item: VisualTrackItem,
  originalStartUS: number,
  segments: TimelineRange[],
  ranges: TimelineRange[],
): void {
  item.presentation = retimePresentationKeyframes(
    item.presentation,
    originalStartUS,
    segments,
    ranges,
    item.timeline_start_us,
  );
  for (const override of Object.values(item.variant_overrides ?? {})) {
    if (override?.presentation) {
      override.presentation = retimePresentationKeyframes(
        override.presentation,
        originalStartUS,
        segments,
        ranges,
        item.timeline_start_us,
      );
    }
  }
}

function rippleVisualItem(
  item: VisualTrackItem,
  ranges: TimelineRange[],
  createID: () => string,
): VisualTrackItem[] {
  const segments = keptTimelineSegments(
    item.timeline_start_us,
    item.duration_us,
    ranges,
  );
  if (!segments.length) return [];
  const originalStartUS = item.timeline_start_us;
  if (item.type !== "media" && item.type !== "camera") {
    const next = structuredClone(item);
    next.timeline_start_us = retimeAfterRemovedRanges(
      segments[0]!.start_us,
      ranges,
    );
    next.duration_us = segments.reduce(
      (durationUS, segment) => durationUS + segment.end_us - segment.start_us,
      0,
    );
    retimeVisualItemAnimations(next, originalStartUS, segments, ranges);
    return [next];
  }
  return segments.map((segment, index) => {
    const next = structuredClone(item);
    next.id = index === 0 ? item.id : createID();
    next.timeline_start_us = retimeAfterRemovedRanges(segment.start_us, ranges);
    next.duration_us = segment.end_us - segment.start_us;
    next.source_in_us = Math.round(
      item.source_in_us + (segment.start_us - originalStartUS) * item.speed,
    );
    retimeVisualItemAnimations(next, originalStartUS, [segment], ranges);
    return next;
  });
}

function rippleAudioItem(
  item: AudioTrackItem,
  ranges: TimelineRange[],
  createID: () => string,
): AudioTrackItem[] {
  const originalStartUS = item.timeline_start_us;
  const originalEndUS = item.timeline_start_us + item.duration_us;
  const segments = keptTimelineSegments(
    originalStartUS,
    item.duration_us,
    ranges,
  );
  return segments.map((segment, index) => {
    const next = structuredClone(item);
    next.id = index === 0 ? item.id : createID();
    next.timeline_start_us = retimeAfterRemovedRanges(segment.start_us, ranges);
    next.duration_us = segment.end_us - segment.start_us;
    next.source_in_us = Math.round(
      item.source_in_us + (segment.start_us - originalStartUS) * item.speed,
    );
    next.fade_in_us = Math.min(
      next.duration_us,
      Math.max(0, item.fade_in_us - (segment.start_us - originalStartUS)),
    );
    next.fade_out_us = Math.min(
      next.duration_us,
      Math.max(0, item.fade_out_us - (originalEndUS - segment.end_us)),
    );
    if (item.gain_db_keyframes) {
      next.gain_db_keyframes = retimeKeyframes(
        item.gain_db_keyframes,
        originalStartUS,
        [segment],
        ranges,
        next.timeline_start_us,
      );
    }
    return next;
  });
}

export function rippleDeleteTimelineRanges(
  project: VideoProjectDocumentV1,
  ranges: TimelineRange[],
  createID: () => string = () => crypto.randomUUID(),
): VideoProjectDocumentV1 {
  const normalized = mergeTimeRanges(
    ranges.map((range) => ({
      start_us: Math.max(0, range.start_us),
      end_us: Math.max(0, range.end_us),
    })),
  );
  if (!normalized.length) return cloneVideoProject(project);

  const next = removePrimaryRanges(project, normalized, createID);
  next.visual_tracks = project.visual_tracks.map((track) => ({
    ...structuredClone(track),
    items: track.items.flatMap((item) =>
      rippleVisualItem(item, normalized, createID),
    ),
  }));
  next.audio_tracks = project.audio_tracks.map((track) => ({
    ...structuredClone(track),
    items: track.items.flatMap((item) =>
      rippleAudioItem(item, normalized, createID),
    ),
  }));
  next.caption_tracks = project.caption_tracks.map((track) => ({
    ...structuredClone(track),
    cues: track.cues.flatMap((cue) => {
      const words = cue.words
        .filter(
          (word) =>
            !normalized.some(
              (range) =>
                word.end_us > range.start_us && word.start_us < range.end_us,
            ),
        )
        .map((word) => ({
          ...word,
          start_us: retimeAfterRemovedRanges(word.start_us, normalized),
          end_us: retimeAfterRemovedRanges(word.end_us, normalized),
        }))
        .filter((word) => word.end_us > word.start_us);
      if (cue.words.length > 0) {
        if (!words.length) return [];
        return [
          {
            ...structuredClone(cue),
            start_us: words[0]!.start_us,
            end_us: words.at(-1)!.end_us,
            text: words.map((word) => word.text).join(" "),
            words,
          },
        ];
      }
      const startUS = retimeAfterRemovedRanges(cue.start_us, normalized);
      const endUS = retimeAfterRemovedRanges(cue.end_us, normalized);
      return endUS > startUS
        ? [{ ...structuredClone(cue), start_us: startUS, end_us: endUS }]
        : [];
    }),
  }));
  next.markers = project.markers
    .filter((marker) => !timestampIsRemoved(marker.time_us, normalized))
    .map((marker) => ({
      ...structuredClone(marker),
      time_us: retimeAfterRemovedRanges(marker.time_us, normalized),
    }));
  return next;
}

function retimeAfterRemovedRanges(
  timestampUS: number,
  ranges: Array<{ start_us: number; end_us: number }>,
): number {
  let removedUS = 0;
  for (const range of ranges) {
    if (timestampUS <= range.start_us) break;
    removedUS += Math.min(timestampUS, range.end_us) - range.start_us;
    if (timestampUS < range.end_us) break;
  }
  return Math.max(0, timestampUS - removedUS);
}

export function reorderPrimaryClip(
  project: VideoProjectDocumentV1,
  clipID: string,
  targetIndex: number,
): VideoProjectDocumentV1 {
  const next = cloneVideoProject(project);
  const from = next.primary_sequence.findIndex((clip) => clip.id === clipID);
  if (from < 0) throw new Error("The selected clip no longer exists.");
  const [clip] = next.primary_sequence.splice(from, 1);
  const bounded = Math.max(
    0,
    Math.min(targetIndex, next.primary_sequence.length),
  );
  next.primary_sequence.splice(bounded, 0, clip!);
  return next;
}

export function duplicatePrimaryClip(
  project: VideoProjectDocumentV1,
  clipID: string,
  createID: () => string = () => crypto.randomUUID(),
): VideoProjectDocumentV1 {
  const next = cloneVideoProject(project);
  const index = next.primary_sequence.findIndex((clip) => clip.id === clipID);
  if (index < 0) throw new Error("The selected clip no longer exists.");
  const duplicate = structuredClone(next.primary_sequence[index]!);
  duplicate.id = createID();
  if (isPrimarySequenceClip(duplicate)) {
    delete duplicate.transition_in;
    delete duplicate.transition_out;
  }
  next.primary_sequence.splice(index + 1, 0, duplicate);
  return next;
}

export function deletePrimaryItemLeaveGap(
  project: VideoProjectDocumentV1,
  itemID: string,
  createID: () => string = () => crypto.randomUUID(),
): VideoProjectDocumentV1 {
  const next = cloneVideoProject(project);
  const index = next.primary_sequence.findIndex((item) => item.id === itemID);
  if (index < 0)
    throw new Error("The selected timeline item no longer exists.");
  const item = next.primary_sequence[index]!;
  const durationUS = primaryItemDurationUS(item);
  if (durationUS <= 0)
    throw new Error("The selected timeline item has no duration.");
  next.primary_sequence.splice(index, 1, {
    id: createID(),
    kind: "gap",
    duration_us: durationUS,
  });
  clampTransitionBoundary(
    next.primary_sequence[index - 1],
    next.primary_sequence[index],
  );
  return next;
}

export function resizePrimaryGap(
  project: VideoProjectDocumentV1,
  gapID: string,
  durationUS: number,
): VideoProjectDocumentV1 {
  if (!Number.isInteger(durationUS) || durationUS <= 0) {
    throw new Error(
      "Gap duration must be a positive integer number of microseconds.",
    );
  }
  const next = cloneVideoProject(project);
  const gap = next.primary_sequence.find((item) => item.id === gapID);
  if (!gap || !isPrimarySequenceGap(gap)) {
    throw new Error("The selected gap no longer exists.");
  }
  gap.duration_us = durationUS;
  return next;
}

export function insertFreezeFrame(
  project: VideoProjectDocumentV1,
  clipID: string,
  timelineUS: number,
  durationUS = 2_000_000,
  createID: () => string = () => crypto.randomUUID(),
): VideoProjectDocumentV1 {
  if (
    !Number.isInteger(durationUS) ||
    durationUS < 100_000 ||
    durationUS > 60_000_000
  ) {
    throw new Error("Freeze duration must be between 0.1 and 60 seconds.");
  }
  const next = cloneVideoProject(project);
  const index = next.primary_sequence.findIndex((clip) => clip.id === clipID);
  if (index < 0) throw new Error("The selected clip no longer exists.");
  const clip = next.primary_sequence[index]!;
  if (isPrimarySequenceGap(clip))
    throw new Error("Select a clip before adding a freeze frame.");
  if (clip.mode === "freeze")
    throw new Error("The selected item is already a freeze frame.");
  const timing = derivePrimarySequence(next)[index]!;
  const relativeUS = timelineUS - timing.timeline_start_us;
  if (relativeUS <= 0 || relativeUS >= timing.duration_us) {
    throw new Error(
      "Place the playhead inside the clip before adding a freeze frame.",
    );
  }
  const sourceUS = Math.round(clip.source_in_us + relativeUS * clip.speed);
  const left: PrimarySequenceClip = {
    ...structuredClone(clip),
    source_out_us: sourceUS,
  };
  delete left.transition_out;
  const freeze: PrimarySequenceClip = {
    ...structuredClone(clip),
    id: createID(),
    mode: "freeze",
    source_in_us: sourceUS,
    source_out_us: sourceUS,
    freeze_duration_us: durationUS,
    speed: 1,
    audio: { ...structuredClone(clip.audio), muted: true },
  };
  delete freeze.transition_in;
  delete freeze.transition_out;
  const right: PrimarySequenceClip = {
    ...structuredClone(clip),
    id: createID(),
    source_in_us: sourceUS,
  };
  delete right.transition_in;
  next.primary_sequence.splice(index, 1, left, freeze, right);
  return next;
}

export function detachPrimaryClipAudio(
  project: VideoProjectDocumentV1,
  clipID: string,
  createID: () => string = () => crypto.randomUUID(),
): VideoProjectDocumentV1 {
  const next = cloneVideoProject(project);
  const index = next.primary_sequence.findIndex((clip) => clip.id === clipID);
  if (index < 0) throw new Error("The selected clip no longer exists.");
  const clip = next.primary_sequence[index]!;
  if (isPrimarySequenceGap(clip)) throw new Error("Gaps do not contain audio.");
  if (clip.mode === "freeze")
    throw new Error("Freeze frames do not contain audio.");
  const timing = derivePrimarySequence(next)[index]!;
  let track = next.audio_tracks.find(
    (candidate) => candidate.id === "detached-audio",
  );
  if (!track) {
    if (next.audio_tracks.length >= VIDEO_PROJECT_LIMITS.maxAudioTracks) {
      throw new Error("Remove an audio track before detaching more audio.");
    }
    track = {
      id: "detached-audio",
      name: "Detached audio",
      role: "other",
      muted: false,
      items: [],
    };
    next.audio_tracks.push(track);
  }
  track.items.push({
    id: createID(),
    source_id: clip.source_id,
    timeline_start_us: timing.timeline_start_us,
    source_in_us: clip.source_in_us,
    duration_us: timing.duration_us,
    speed: clip.speed,
    gain_db: clip.audio.gain_db,
    fade_in_us: clip.audio.fade_in_us,
    fade_out_us: clip.audio.fade_out_us,
    muted: false,
    duck_others: clip.audio.duck_others,
  });
  clip.audio.muted = true;
  return next;
}

export function setClipSpeed(
  project: VideoProjectDocumentV1,
  clipID: string,
  speed: number,
): VideoProjectDocumentV1 {
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
    throw new Error("Clip speed must be between 0.25× and 4×.");
  }
  const next = cloneVideoProject(project);
  const clip = next.primary_sequence.find(
    (candidate) => candidate.id === clipID,
  );
  if (!clip) throw new Error("The selected clip no longer exists.");
  if (isPrimarySequenceGap(clip))
    throw new Error("Gaps do not have playback speed.");
  if (clip.mode === "freeze")
    throw new Error("Freeze frames do not have playback speed.");
  clip.speed = speed;
  return next;
}

export function setVariantPresentationOverride(
  project: VideoProjectDocumentV1,
  clipID: string,
  variantID: VariantID,
  override: VideoPresentationOverride,
): VideoProjectDocumentV1 {
  const next = cloneVideoProject(project);
  const clip = next.primary_sequence.find(
    (candidate) => candidate.id === clipID,
  );
  if (!clip) throw new Error("The selected clip no longer exists.");
  if (isPrimarySequenceGap(clip))
    throw new Error("Gaps do not have presentation properties.");
  clip.variant_overrides = {
    ...(clip.variant_overrides ?? {}),
    [variantID]: {
      ...(clip.variant_overrides?.[variantID] ?? {}),
      ...structuredClone(override),
    },
  };
  return next;
}

export function mergeTimeRanges(
  ranges: Array<{ start_us: number; end_us: number }>,
): Array<{ start_us: number; end_us: number }> {
  const sorted = ranges
    .filter(
      (range) =>
        Number.isFinite(range.start_us) &&
        Number.isFinite(range.end_us) &&
        range.end_us > range.start_us,
    )
    .map((range) => ({ ...range }))
    .sort((left, right) => left.start_us - right.start_us);
  const merged: Array<{ start_us: number; end_us: number }> = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.start_us <= previous.end_us) {
      previous.end_us = Math.max(previous.end_us, range.end_us);
    } else {
      merged.push(range);
    }
  }
  return merged;
}

export function frameToTimestampUS(
  frame: number,
  fpsNumerator: number,
  fpsDenominator: number,
): number {
  return Math.round(
    (frame * VIDEO_TICKS_PER_SECOND * fpsDenominator) / fpsNumerator,
  );
}

export function timestampUSToFrame(
  timestampUS: number,
  fpsNumerator: number,
  fpsDenominator: number,
): number {
  return Math.round(
    (timestampUS * fpsNumerator) / (VIDEO_TICKS_PER_SECOND * fpsDenominator),
  );
}

export function interpolateKeyframes(
  keyframes: NumericKeyframe[],
  timestampUS: number,
): number {
  if (!keyframes.length) return 0;
  const sorted = [...keyframes].sort(
    (left, right) => left.time_us - right.time_us,
  );
  if (timestampUS <= sorted[0]!.time_us) return sorted[0]!.value;
  if (timestampUS >= sorted.at(-1)!.time_us) return sorted.at(-1)!.value;
  const rightIndex = sorted.findIndex(
    (keyframe) => keyframe.time_us >= timestampUS,
  );
  const left = sorted[rightIndex - 1]!;
  const right = sorted[rightIndex]!;
  const progress =
    (timestampUS - left.time_us) / (right.time_us - left.time_us);
  return (
    left.value + (right.value - left.value) * applyEasing(progress, left.easing)
  );
}

export function applyEasing(progress: number, easing: EasingName): number {
  const value = Math.max(0, Math.min(1, progress));
  switch (easing) {
    case "hold":
      return 0;
    case "ease-in":
      return value * value * value;
    case "ease-out":
      return 1 - Math.pow(1 - value, 3);
    case "ease-in-out":
      return value < 0.5
        ? 4 * value * value * value
        : 1 - Math.pow(-2 * value + 2, 3) / 2;
    case "focus-spring": {
      const damped = 1 - Math.exp(-7 * value) * Math.cos(10 * value);
      return Math.max(0, Math.min(1.04, damped));
    }
    default:
      return value;
  }
}

export interface FocusZoomOptions {
  preset: "in" | "out" | "punch";
  local_time_us: number;
  duration_us: number;
  scale_multiplier: number;
  focus_x: number;
  focus_y: number;
  easing: EasingName;
}

export function buildFocusZoomKeyframes(
  presentation: VideoPresentation,
  clipDurationUS: number,
  options: FocusZoomOptions,
): NonNullable<VideoPresentation["keyframes"]> {
  const clipDuration = Math.max(1, Math.round(clipDurationUS));
  const duration = Math.max(
    100_000,
    Math.min(clipDuration, Math.round(options.duration_us)),
  );
  const localTime = Math.max(
    0,
    Math.min(clipDuration, Math.round(options.local_time_us)),
  );
  const start = Math.max(
    0,
    Math.min(clipDuration - duration, localTime - Math.round(duration * 0.3)),
  );
  const end = Math.min(clipDuration, start + duration);
  const peak =
    options.preset === "punch"
      ? Math.min(end, start + Math.round(duration * 0.38))
      : end;
  const baseScale = presentation.scale;
  const focusScale = Math.max(
    0.05,
    Math.min(4, baseScale * Math.max(1.01, options.scale_multiplier)),
  );
  const focusX = Math.max(0, Math.min(1, options.focus_x));
  const focusY = Math.max(0, Math.min(1, options.focus_y));
  const focusPositionX = Math.max(
    0,
    Math.min(
      1,
      presentation.position_x + (0.5 - focusX) * (focusScale - baseScale),
    ),
  );
  const focusPositionY = Math.max(
    0,
    Math.min(
      1,
      presentation.position_y + (0.5 - focusY) * (focusScale - baseScale),
    ),
  );
  const pair = (baseValue: number, focusValue: number): NumericKeyframe[] => {
    if (options.preset === "in") {
      return [
        { time_us: start, value: baseValue, easing: options.easing },
        { time_us: end, value: focusValue, easing: "ease-out" },
      ];
    }
    if (options.preset === "out") {
      return [
        { time_us: start, value: focusValue, easing: options.easing },
        { time_us: end, value: baseValue, easing: "ease-out" },
      ];
    }
    return [
      { time_us: start, value: baseValue, easing: options.easing },
      { time_us: peak, value: focusValue, easing: options.easing },
      { time_us: end, value: baseValue, easing: "ease-out" },
    ];
  };
  return {
    scale: pair(baseScale, focusScale),
    position_x: pair(presentation.position_x, focusPositionX),
    position_y: pair(presentation.position_y, focusPositionY),
  };
}

export function reflowCaptionText(
  text: string,
  maxCharacters = 34,
  maxLines: 1 | 2 | 3 = 2,
): string[] {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current) {
      lines.push(word);
    } else if (
      `${current} ${word}`.length <= maxCharacters ||
      lines.length >= maxLines
    ) {
      lines[lines.length - 1] = `${current} ${word}`;
    } else {
      lines.push(word);
    }
  }
  return lines.slice(0, maxLines);
}

export function captionDisplayText(cue: CaptionCue): string {
  return (
    cue.text.trim() ||
    cue.words
      .map((word) => word.text)
      .join(" ")
      .trim()
  );
}

export function setCaptionCueText(cue: CaptionCue, text: string): void {
  cue.text = text;
  const tokens = text.trim().split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) {
    cue.words = [];
    return;
  }
  if (tokens.length === cue.words.length) {
    cue.words = cue.words.map((word, index) => ({
      ...word,
      text: tokens[index]!,
    }));
    return;
  }
  const durationUS = Math.max(tokens.length, cue.end_us - cue.start_us);
  cue.words = tokens.map((token, index) => {
    const previous =
      cue.words[
        Math.min(
          cue.words.length - 1,
          Math.floor((index * cue.words.length) / tokens.length),
        )
      ];
    return {
      text: token,
      start_us: cue.start_us + Math.floor((durationUS * index) / tokens.length),
      end_us:
        cue.start_us + Math.floor((durationUS * (index + 1)) / tokens.length),
      ...(previous?.emphasis ? { emphasis: true } : {}),
    };
  });
}

export function captionCutRange(
  cues: CaptionCue[],
  selectedWordIDs: Array<{ cue_id: string; word_index: number }>,
  paddingUS = 120_000,
): { start_us: number; end_us: number } | null {
  const words = selectedWordIDs
    .map(
      ({ cue_id, word_index }) =>
        cues.find((cue) => cue.id === cue_id)?.words[word_index],
    )
    .filter((word): word is NonNullable<typeof word> => Boolean(word));
  if (!words.length) return null;
  return {
    start_us: Math.max(
      0,
      Math.min(...words.map((word) => word.start_us)) - paddingUS,
    ),
    end_us: Math.min(
      VIDEO_PROJECT_LIMITS.maxDurationUS,
      Math.max(...words.map((word) => word.end_us)) + paddingUS,
    ),
  };
}
