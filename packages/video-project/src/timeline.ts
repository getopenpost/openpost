import {
  VIDEO_PROJECT_LIMITS,
  VIDEO_TICKS_PER_SECOND,
  type CaptionCue,
  type DerivedPrimaryClip,
  type EasingName,
  type NumericKeyframe,
  type PrimarySequenceClip,
  type PrimarySequenceGap,
  type PrimarySequenceItem,
  type VariantID,
  type VideoPresentationOverride,
  type VideoProjectDocumentV1,
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
