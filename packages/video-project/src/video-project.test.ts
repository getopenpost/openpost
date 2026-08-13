import { describe, expect, it } from "vitest";
import {
  VideoProjectHistory,
  buildFocusZoomKeyframes,
  captionDisplayText,
  captionCutRange,
  createBlankVideoProject,
  deletePrimaryItemLeaveGap,
  defaultClipAudio,
  defaultCaptionStyle,
  defaultVideoPresentation,
  detachPrimaryClipAudio,
  derivePrimarySequence,
  duplicatePrimaryClip,
  fillerCandidates,
  frameToTimestampUS,
  insertFreezeFrame,
  interpolateKeyframes,
  projectDurationUS,
  reflowCaptionText,
  removePrimaryRanges,
  reorderPrimaryClip,
  rippleDeleteCaptionWords,
  rippleDeleteTimelineRanges,
  referencedSourceIDs,
  captionsToSRT,
  captionsToWebVTT,
  setClipSpeed,
  setCaptionCueText,
  setPrimaryClipSourceBoundary,
  setVariantPresentationOverride,
  silenceSuggestions,
  splitPrimaryClip,
  timestampUSToFrame,
  trimPrimaryClip,
  validateVideoProject,
  type PrimarySequenceClip,
  type VideoProjectDocumentV1,
} from "./index.js";

type ClipProject = VideoProjectDocumentV1 & {
  primary_sequence: PrimarySequenceClip[];
};

function clipAt(
  project: VideoProjectDocumentV1,
  index: number,
): PrimarySequenceClip {
  return project.primary_sequence[index] as PrimarySequenceClip;
}

function projectWithClips(): ClipProject {
  const project = createBlankVideoProject("Test");
  project.sources.source = {
    id: "source",
    kind: "video",
    locator: { type: "local-opfs", path: "projects/test/sources/source.mp4" },
    original_name: "source.mp4",
    mime_type: "video/mp4",
    size_bytes: 10,
    duration_us: 20_000_000,
    width: 1920,
    height: 1080,
    rotation: 0,
  };
  const clip = (
    id: string,
    start: number,
    end: number,
  ): PrimarySequenceClip => ({
    id,
    source_id: "source",
    mode: "source",
    source_in_us: start,
    source_out_us: end,
    speed: 1,
    video: defaultVideoPresentation(),
    audio: defaultClipAudio(),
    effects: [],
  });
  project.primary_sequence = [
    clip("a", 0, 4_000_000),
    clip("b", 4_000_000, 10_000_000),
  ];
  return project as ClipProject;
}

describe("video project document", () => {
  it("creates and validates the complete four-variant document", () => {
    const project = projectWithClips();
    expect(validateVideoProject(project)).toEqual({
      valid: true,
      issues: [],
      document: project,
    });
    expect(project.variants.map((variant) => variant.id)).toEqual([
      "portrait",
      "feed-portrait",
      "square",
      "landscape",
    ]);
  });

  it("accepts one-hour footage and rejects sources beyond two hours", () => {
    const project = projectWithClips();
    project.sources.source!.duration_us = 60 * 60 * 1_000_000;
    project.primary_sequence = [
      {
        ...project.primary_sequence[0]!,
        source_in_us: 0,
        source_out_us: 60 * 60 * 1_000_000,
      },
    ];
    expect(validateVideoProject(project).valid).toBe(true);

    project.sources.source!.duration_us = 2 * 60 * 60 * 1_000_000 + 1;
    clipAt(project, 0).source_out_us = 2 * 60 * 60 * 1_000_000 + 1;
    expect(validateVideoProject(project).valid).toBe(false);
  });

  it("rejects unknown root fields, missing sources, and invalid speed", () => {
    const project = projectWithClips() as ClipProject & {
      surprise?: boolean;
    };
    project.surprise = true;
    project.primary_sequence[0]!.source_id = "missing";
    project.primary_sequence[0]!.speed = 8;
    const result = validateVideoProject(project);
    expect(result.valid).toBe(false);
    expect(result.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["unknown-field", "source-reference", "speed"]),
    );
  });

  it("rejects unknown nested fields and invalid variant override keys", () => {
    const project = projectWithClips() as VideoProjectDocumentV1;
    const videoWithUnknown = clipAt(project, 0)
      .video as PrimarySequenceClip["video"] & {
      surprise?: boolean;
    };
    videoWithUnknown.surprise = true;
    (
      clipAt(project, 0) as PrimarySequenceClip & {
        variant_overrides: Record<string, unknown>;
      }
    ).variant_overrides = { cinema: { scale: 2 } };
    const result = validateVideoProject(project);
    expect(result.valid).toBe(false);
    expect(result.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["unknown-field", "variant"]),
    );
  });

  it("finds only sources referenced by renderable timeline items", () => {
    const project = projectWithClips();
    project.sources.unused = {
      ...project.sources.source!,
      id: "unused",
      original_name: "unused.mp4",
    };
    expect(referencedSourceIDs(project)).toEqual(["source"]);
  });
});

describe("derived sequence operations", () => {
  it("derives ripple timing and bounded transition overlap", () => {
    const project = projectWithClips();
    project.primary_sequence[0]!.transition_out = {
      type: "cross-dissolve",
      duration_us: 1_000_000,
      easing: "ease-in-out",
    };
    const derived = derivePrimarySequence(project);
    expect(derived[0]).toMatchObject({
      timeline_start_us: 0,
      timeline_end_us: 4_000_000,
    });
    expect(derived[1]).toMatchObject({
      timeline_start_us: 3_000_000,
      timeline_end_us: 9_000_000,
      transition_overlap_us: 1_000_000,
    });
    expect(projectDurationUS(project)).toBe(9_000_000);
  });

  it("splits at the playhead without changing duration", () => {
    const project = projectWithClips();
    const split = splitPrimaryClip(project, "a", 1_500_000, () => "a-right");
    expect(split.primary_sequence.map((clip) => clip.id)).toEqual([
      "a",
      "a-right",
      "b",
    ]);
    expect(clipAt(split, 0).source_out_us).toBe(1_500_000);
    expect(clipAt(split, 1).source_in_us).toBe(1_500_000);
    expect(projectDurationUS(split)).toBe(10_000_000);
  });

  it("trims source and freeze edges on frame boundaries", () => {
    const project = projectWithClips();
    const frameUS = Math.round(
      (1_000_000 * project.timebase.fps_denominator) /
        project.timebase.fps_numerator,
    );
    const trimmedStart = trimPrimaryClip(project, "a", "start", 1_010_000);
    expect(clipAt(trimmedStart, 0).source_in_us).toBe(frameUS * 30);
    expect(projectDurationUS(trimmedStart)).toBe(10_000_000 - frameUS * 30);

    const trimmedEnd = trimPrimaryClip(trimmedStart, "a", "end", -2_000_000);
    expect(clipAt(trimmedEnd, 0).source_out_us).toBe(4_000_000 - frameUS * 60);
    expect(projectDurationUS(trimmedEnd)).toBe(10_000_000 - frameUS * 90);

    const frozen = structuredClone(project);
    frozen.primary_sequence[0] = {
      ...frozen.primary_sequence[0]!,
      mode: "freeze",
      freeze_duration_us: 2_000_000,
    };
    const shortenedFreeze = trimPrimaryClip(frozen, "a", "start", 500_000);
    expect(clipAt(shortenedFreeze, 0).freeze_duration_us).toBe(
      2_000_000 - frameUS * 15,
    );
  });

  it("sets an exact packet boundary without project-frame quantization", () => {
    const project = projectWithClips();
    const exactKeyframeUS = 1_000_123;
    const trimmed = setPrimaryClipSourceBoundary(
      project,
      "a",
      "start",
      exactKeyframeUS,
    );
    expect(clipAt(trimmed, 0).source_in_us).toBe(exactKeyframeUS);
    expect(projectDurationUS(trimmed)).toBe(10_000_000 - exactKeyframeUS);
  });

  it("keeps adjoining transition durations valid while trimming", () => {
    const project = projectWithClips();
    const frameUS = Math.round(
      (1_000_000 * project.timebase.fps_denominator) /
        project.timebase.fps_numerator,
    );
    const transition = {
      type: "cross-dissolve" as const,
      duration_us: 1_800_000,
      easing: "ease-in-out" as const,
    };
    project.primary_sequence[0]!.transition_out = { ...transition };
    project.primary_sequence[1]!.transition_in = { ...transition };
    const trimmed = trimPrimaryClip(project, "a", "end", -3_000_000);
    const expectedMaximum = Math.floor(
      (4_000_000 - Math.round(3_000_000 / frameUS) * frameUS) / 2,
    );
    expect(clipAt(trimmed, 0).transition_out?.duration_us).toBe(
      expectedMaximum,
    );
    expect(clipAt(trimmed, 1).transition_in?.duration_us).toBe(expectedMaximum);
  });

  it("ripple-cuts across clip boundaries as one deterministic action", () => {
    const project = projectWithClips();
    const cut = removePrimaryRanges(
      project,
      [{ start_us: 3_000_000, end_us: 5_000_000 }],
      () => "new",
    );
    expect(clipAt(cut, 0).source_out_us).toBe(3_000_000);
    expect(clipAt(cut, 1).source_in_us).toBe(5_000_000);
    expect(projectDurationUS(cut)).toBe(8_000_000);
  });

  it("reorders clips and updates speed within beta bounds", () => {
    const project = projectWithClips();
    const reordered = reorderPrimaryClip(project, "b", 0);
    expect(reordered.primary_sequence.map((clip) => clip.id)).toEqual([
      "b",
      "a",
    ]);
    const sped = setClipSpeed(reordered, "b", 2);
    expect(projectDurationUS(sped)).toBe(7_000_000);
    expect(() => setClipSpeed(sped, "b", 5)).toThrow(/0.25/);
  });

  it("duplicates, freezes, and detaches clip audio without changing the source", () => {
    const project = projectWithClips();
    const duplicated = duplicatePrimaryClip(project, "a", () => "copy");
    expect(duplicated.primary_sequence.map((clip) => clip.id)).toEqual([
      "a",
      "copy",
      "b",
    ]);
    expect(clipAt(duplicated, 1).source_id).toBe("source");

    let id = 0;
    const frozen = insertFreezeFrame(
      project,
      "a",
      2_000_000,
      1_500_000,
      () => `new-${id++}`,
    );
    expect(
      frozen.primary_sequence.map((clip) =>
        "mode" in clip ? clip.mode : "gap",
      ),
    ).toEqual(["source", "freeze", "source", "source"]);
    expect(clipAt(frozen, 1).freeze_duration_us).toBe(1_500_000);
    expect(projectDurationUS(frozen)).toBe(11_500_000);

    const detached = detachPrimaryClipAudio(project, "a", () => "audio-item");
    expect(clipAt(detached, 0).audio.muted).toBe(true);
    expect(detached.audio_tracks[0]!.items[0]).toMatchObject({
      id: "audio-item",
      source_id: "source",
      timeline_start_us: 0,
      duration_us: 4_000_000,
    });
  });

  it("isolates per-variant presentation overrides", () => {
    const project = projectWithClips();
    const changed = setVariantPresentationOverride(project, "a", "portrait", {
      scale: 1.25,
    });
    expect(clipAt(changed, 0).variant_overrides?.portrait?.scale).toBe(1.25);
    expect(clipAt(changed, 0).variant_overrides?.square).toBeUndefined();
    expect(project.primary_sequence[0]!.variant_overrides).toBeUndefined();
  });

  it("replaces a clip with an explicit editable gap without changing duration", () => {
    const project = projectWithClips();
    const withGap = deletePrimaryItemLeaveGap(project, "a", () => "gap-a");
    expect(withGap.primary_sequence[0]).toEqual({
      id: "gap-a",
      kind: "gap",
      duration_us: 4_000_000,
    });
    expect(projectDurationUS(withGap)).toBe(10_000_000);
  });
});

describe("time, keyframes, captions, and suggestions", () => {
  it("round-trips rational frame timestamps without accumulated drift", () => {
    for (const frame of [0, 1, 29, 1_000, 35_964]) {
      const timestamp = frameToTimestampUS(frame, 30_000, 1_001);
      expect(timestampUSToFrame(timestamp, 30_000, 1_001)).toBe(frame);
    }
  });

  it("interpolates supported easing and hold keyframes", () => {
    const base = [
      { time_us: 0, value: 0, easing: "linear" as const },
      { time_us: 1_000_000, value: 10, easing: "hold" as const },
    ];
    expect(interpolateKeyframes(base, 500_000)).toBe(5);
    expect(
      interpolateKeyframes(
        [{ ...base[0]!, easing: "hold" }, base[1]!],
        500_000,
      ),
    ).toBe(0);
  });

  it("builds a bounded focus zoom with editable timing and focus", () => {
    const keyframes = buildFocusZoomKeyframes(
      defaultVideoPresentation(),
      2_000_000,
      {
        preset: "punch",
        local_time_us: 1_000_000,
        duration_us: 1_200_000,
        scale_multiplier: 1.5,
        focus_x: 0.8,
        focus_y: 0.2,
        easing: "focus-spring",
      },
    );
    expect(keyframes.scale).toHaveLength(3);
    expect(keyframes.scale?.[1]?.value).toBe(1.5);
    expect(keyframes.position_x?.[1]?.value).toBeLessThan(0.5);
    expect(keyframes.position_y?.[1]?.value).toBeGreaterThan(0.5);
    expect(keyframes.scale?.at(-1)?.time_us).toBeLessThanOrEqual(2_000_000);
  });

  it("reflows captions and links timed transcript selection to a padded cut", () => {
    expect(
      reflowCaptionText(
        "Make one clear social video without leaving the browser",
        18,
        2,
      ),
    ).toEqual(["Make one clear", "social video without leaving the browser"]);
    const cut = captionCutRange(
      [
        {
          id: "cue",
          start_us: 500_000,
          end_us: 2_000_000,
          text: "hello world",
          words: [
            { text: "hello", start_us: 500_000, end_us: 900_000 },
            { text: "world", start_us: 1_000_000, end_us: 1_500_000 },
          ],
        },
      ],
      [{ cue_id: "cue", word_index: 1 }],
    );
    expect(cut).toEqual({ start_us: 880_000, end_us: 1_620_000 });
  });

  it("ripple deletes a transcript word and keeps caption time aligned", () => {
    const project = projectWithClips();
    project.visual_tracks = [
      {
        id: "visual",
        name: "Visual",
        locked: false,
        hidden: false,
        items: [
          {
            id: "overlay-video",
            type: "media",
            source_id: "source",
            source_in_us: 1_000_000,
            speed: 1,
            timeline_start_us: 1_000_000,
            duration_us: 3_000_000,
            visible: true,
            presentation: defaultVideoPresentation(),
          },
          {
            id: "title",
            type: "text",
            text: "Keep this title aligned",
            style: {
              font_family: "Inter",
              font_size: 64,
              font_weight: 700,
              color: "#ffffff",
              align: "center",
              background_color: "#00000000",
              outline_color: "#000000",
              outline_width: 0,
              shadow_blur: 0,
              animation: "none",
            },
            timeline_start_us: 500_000,
            duration_us: 3_500_000,
            visible: true,
            presentation: {
              ...defaultVideoPresentation(),
              keyframes: {
                opacity: [
                  { time_us: 0, value: 0, easing: "linear" },
                  { time_us: 1_500_000, value: 0.4, easing: "linear" },
                  { time_us: 2_500_000, value: 0.8, easing: "linear" },
                  { time_us: 3_500_000, value: 1, easing: "linear" },
                ],
              },
            },
          },
        ],
      },
    ];
    project.audio_tracks = [
      {
        id: "music",
        name: "Music",
        role: "music",
        muted: false,
        items: [
          {
            id: "music-bed",
            source_id: "source",
            source_in_us: 1_000_000,
            timeline_start_us: 1_000_000,
            duration_us: 3_000_000,
            speed: 1,
            gain_db: -6,
            gain_db_keyframes: [
              { time_us: 0, value: -12, easing: "linear" },
              { time_us: 1_000_000, value: -6, easing: "linear" },
              { time_us: 2_000_000, value: -3, easing: "linear" },
              { time_us: 3_000_000, value: 0, easing: "linear" },
            ],
            fade_in_us: 250_000,
            fade_out_us: 250_000,
            muted: false,
            duck_others: false,
          },
        ],
      },
    ];
    project.markers = [
      { id: "before", time_us: 1_500_000, label: "Before", color: "#ffffff" },
      { id: "inside", time_us: 2_500_000, label: "Inside", color: "#ffffff" },
      { id: "after", time_us: 4_000_000, label: "After", color: "#ffffff" },
    ];
    project.caption_tracks = [
      {
        id: "captions",
        name: "Captions",
        language: "en",
        visible: true,
        cues: [],
        style: defaultCaptionStyle(),
      },
    ];
    project.caption_tracks[0]!.cues = [
      {
        id: "cue",
        start_us: 1_000_000,
        end_us: 4_000_000,
        text: "one two three",
        words: [
          { text: "one", start_us: 1_000_000, end_us: 2_000_000 },
          { text: "two", start_us: 2_000_000, end_us: 3_000_000 },
          { text: "three", start_us: 3_000_000, end_us: 4_000_000 },
        ],
      },
    ];

    let nextID = 0;
    const next = rippleDeleteCaptionWords(
      project,
      [{ cue_id: "cue", word_index: 1 }],
      () => `split-${++nextID}`,
    );

    expect(projectDurationUS(next)).toBe(9_000_000);
    expect(next.caption_tracks[0]!.cues[0]).toMatchObject({
      start_us: 1_000_000,
      end_us: 3_000_000,
      text: "one three",
      words: [
        { text: "one", start_us: 1_000_000, end_us: 2_000_000 },
        { text: "three", start_us: 2_000_000, end_us: 3_000_000 },
      ],
    });
    expect(next.visual_tracks[0]!.items).toMatchObject([
      {
        id: "overlay-video",
        timeline_start_us: 1_000_000,
        duration_us: 1_000_000,
        source_in_us: 1_000_000,
      },
      {
        id: "split-2",
        timeline_start_us: 2_000_000,
        duration_us: 1_000_000,
        source_in_us: 3_000_000,
      },
      {
        id: "title",
        timeline_start_us: 500_000,
        duration_us: 2_500_000,
      },
    ]);
    expect(next.audio_tracks[0]!.items).toMatchObject([
      {
        id: "music-bed",
        timeline_start_us: 1_000_000,
        duration_us: 1_000_000,
        source_in_us: 1_000_000,
      },
      {
        id: "split-3",
        timeline_start_us: 2_000_000,
        duration_us: 1_000_000,
        source_in_us: 3_000_000,
      },
    ]);
    expect(
      next.visual_tracks[0]!.items[2]!.presentation.keyframes?.opacity,
    ).toMatchObject([
      { time_us: 0, value: 0 },
      { time_us: 1_500_000, value: 0.8 },
      { time_us: 2_500_000, value: 1 },
    ]);
    expect(next.audio_tracks[0]!.items[1]!.gain_db_keyframes).toMatchObject([
      { time_us: 0, value: -3 },
      { time_us: 1_000_000, value: 0 },
    ]);
    expect(next.markers).toEqual([
      { id: "before", time_us: 1_500_000, label: "Before", color: "#ffffff" },
      { id: "after", time_us: 3_000_000, label: "After", color: "#ffffff" },
    ]);
    expect(validateVideoProject(next)).toEqual({
      valid: true,
      issues: [],
      document: next,
    });
  });

  it("ripple deletes explicit ranges through the shared timeline operation", () => {
    const project = projectWithClips();
    const next = rippleDeleteTimelineRanges(project, [
      { start_us: 4_000_000, end_us: 5_000_000 },
    ]);
    expect(projectDurationUS(next)).toBe(9_000_000);
  });

  it("keeps corrected caption text canonical and retimes word emphasis safely", () => {
    const cue = {
      id: "cue",
      start_us: 500_000,
      end_us: 2_500_000,
      text: "old words",
      words: [
        {
          text: "old",
          start_us: 500_000,
          end_us: 1_500_000,
          emphasis: true,
        },
        { text: "words", start_us: 1_500_000, end_us: 2_500_000 },
      ],
    };
    setCaptionCueText(cue, "A corrected caption");
    expect(captionDisplayText(cue)).toBe("A corrected caption");
    expect(cue.words.map((word) => word.text)).toEqual([
      "A",
      "corrected",
      "caption",
    ]);
    expect(cue.words[0]?.start_us).toBe(cue.start_us);
    expect(cue.words.at(-1)?.end_us).toBe(cue.end_us);

    cue.words[0]!.text = "stale";
    expect(captionDisplayText(cue)).toBe("A corrected caption");
  });

  it("serializes canonical caption cues as SRT and WebVTT", () => {
    const cues = [
      {
        id: "cue",
        start_us: 1_250_000,
        end_us: 2_500_000,
        text: "Local captions",
        words: [],
      },
    ];
    expect(captionsToSRT(cues)).toBe(
      "1\n00:00:01,250 --> 00:00:02,500\nLocal captions\n",
    );
    expect(captionsToWebVTT(cues)).toBe(
      "WEBVTT\n\n00:00:01.250 --> 00:00:02.500\nLocal captions\n",
    );
  });

  it("keeps VAD padding, merges short speech gaps, and requires filler confidence", () => {
    const silence = silenceSuggestions(
      [
        { start_us: 500_000, end_us: 1_000_000 },
        { start_us: 1_100_000, end_us: 1_500_000 },
        { start_us: 2_500_000, end_us: 3_000_000 },
      ],
      4_000_000,
    );
    expect(silence).toEqual([
      { start_us: 0, end_us: 380_000, duration_us: 380_000 },
      { start_us: 1_620_000, end_us: 2_380_000, duration_us: 760_000 },
      { start_us: 3_120_000, end_us: 4_000_000, duration_us: 880_000 },
    ]);
    expect(
      fillerCandidates(
        [
          { text: "Um", start_us: 0, end_us: 200_000, confidence: 0.95 },
          { text: "real", start_us: 250_000, end_us: 500_000, confidence: 0.9 },
          { text: "real", start_us: 520_000, end_us: 800_000, confidence: 0.9 },
          { text: "uh", start_us: 900_000, end_us: 1_000_000, confidence: 0.2 },
        ],
        "en",
      ).map((candidate) => candidate.reason),
    ).toEqual(["dictionary", "repeated-word"]);
  });
});

describe("history", () => {
  it("undoes and redoes compound project edits", () => {
    const history = new VideoProjectHistory();
    const original = projectWithClips();
    const changed = history.execute(original, {
      id: "speed",
      label: "Change speed",
      apply: (project) => setClipSpeed(project, "a", 2),
    });
    expect(projectDurationUS(changed)).toBe(8_000_000);
    const undone = history.undo(changed);
    expect(projectDurationUS(undone)).toBe(10_000_000);
    expect(projectDurationUS(history.redo(undone))).toBe(8_000_000);
  });
});
