export const VIDEO_PROJECT_SCHEMA_VERSION = 1 as const;
export const VIDEO_TICKS_PER_SECOND = 1_000_000 as const;

export const VIDEO_PROJECT_LIMITS = {
  maxDurationUS: 2 * 60 * 60 * VIDEO_TICKS_PER_SECOND,
  maxSources: 250,
  maxTimelineItems: 2_000,
  maxCaptionCues: 5_000,
  maxVisualTracks: 4,
  maxAudioTracks: 8,
  maxCaptionTracks: 2,
  maxDocumentBytes: 5 * 1024 * 1024,
} as const;

export type SourceID = string;
export type ClipID = string;
export type VariantID = "portrait" | "feed-portrait" | "square" | "landscape";
export type TrackID = string;

export type VideoSourceKind =
  | "video"
  | "audio"
  | "image"
  | "recording-screen"
  | "recording-camera"
  | "recording-microphone"
  | "recording-system-audio";

export interface StockMediaProvenance {
  provider: string;
  external_id: string;
  source_url: string;
  creator_name: string;
  creator_url: string;
  license_name: string;
  license_url: string;
  attribution_text: string;
}

export type VideoSourceLocator =
  | { type: "local-opfs"; path: string }
  | { type: "openpost-media"; media_id: string };

export interface VideoSource {
  id: SourceID;
  kind: VideoSourceKind;
  locator: VideoSourceLocator;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  duration_us: number;
  width: number;
  height: number;
  rotation: number;
  video_codec?: string;
  audio_codec?: string;
  content_hash?: string;
  provenance?: StockMediaProvenance;
}

export type EasingName =
  "hold" | "linear" | "ease-in" | "ease-out" | "ease-in-out" | "focus-spring";

export interface NumericKeyframe {
  time_us: number;
  value: number;
  easing: EasingName;
}

export interface CropRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VideoPresentation {
  position_x: number;
  position_y: number;
  scale: number;
  rotation: number;
  opacity: number;
  crop: CropRectangle;
  flip_x: boolean;
  flip_y: boolean;
  corner_radius: number;
  border_width: number;
  border_color: string;
  shadow_blur: number;
  shadow_opacity: number;
  background_color: string;
  keyframes?: Partial<
    Record<
      | "position_x"
      | "position_y"
      | "scale"
      | "rotation"
      | "opacity"
      | "crop_x"
      | "crop_y"
      | "crop_width"
      | "crop_height",
      NumericKeyframe[]
    >
  >;
}

export type VideoPresentationOverride = Partial<
  Omit<VideoPresentation, "keyframes"> & {
    keyframes: VideoPresentation["keyframes"];
    visible: boolean;
  }
>;

export interface ClipAudioSettings {
  muted: boolean;
  gain_db: number;
  gain_db_keyframes?: NumericKeyframe[];
  fade_in_us: number;
  fade_out_us: number;
  duck_others: boolean;
}

export type VideoEffect =
  | { type: "exposure"; value: number }
  | { type: "contrast"; value: number }
  | { type: "saturation"; value: number }
  | { type: "temperature"; value: number }
  | { type: "tint"; value: number }
  | { type: "blur"; value: number; keyframes?: NumericKeyframe[] }
  | { type: "vignette"; value: number };

export type TransitionKind =
  | "cut"
  | "cross-dissolve"
  | "dip-black"
  | "dip-white"
  | "slide"
  | "push"
  | "zoom-blur";

export interface Transition {
  type: TransitionKind;
  duration_us: number;
  easing: EasingName;
}

export interface PrimarySequenceClip {
  kind?: "clip";
  id: ClipID;
  source_id: SourceID;
  mode: "source" | "freeze";
  source_in_us: number;
  source_out_us: number;
  freeze_duration_us?: number;
  speed: number;
  video: VideoPresentation;
  audio: ClipAudioSettings;
  effects: VideoEffect[];
  transition_in?: Transition;
  transition_out?: Transition;
  variant_overrides?: Partial<Record<VariantID, VideoPresentationOverride>>;
}

export interface PrimarySequenceGap {
  id: string;
  kind: "gap";
  duration_us: number;
}

export type PrimarySequenceItem = PrimarySequenceClip | PrimarySequenceGap;

export interface BaseTimelineItem {
  id: string;
  timeline_start_us: number;
  duration_us: number;
  visible: boolean;
  variant_overrides?: Partial<
    Record<
      VariantID,
      { visible?: boolean; presentation?: VideoPresentationOverride }
    >
  >;
}

export type VisualTrackItem =
  | (BaseTimelineItem & {
      type: "media" | "camera";
      source_id: SourceID;
      source_in_us: number;
      speed: number;
      presentation: VideoPresentation;
    })
  | (BaseTimelineItem & {
      type: "text";
      text: string;
      style: TextStyle;
      presentation: VideoPresentation;
    })
  | (BaseTimelineItem & {
      type: "shape" | "annotation";
      shape: ShapeStyle;
      presentation: VideoPresentation;
    });

export interface TextStyle {
  font_family: string;
  font_size: number;
  font_weight: number;
  color: string;
  align: "left" | "center" | "right";
  background_color: string;
  outline_color: string;
  outline_width: number;
  shadow_blur: number;
  animation: "none" | "fade" | "rise" | "pop" | "typewriter";
}

export interface ShapeStyle {
  kind:
    | "rectangle"
    | "ellipse"
    | "arrow"
    | "highlight"
    | "click-pulse"
    | "redaction"
    | "progress";
  fill: string;
  stroke: string;
  stroke_width: number;
  blur: number;
}

export interface VisualTrack {
  id: TrackID;
  name: string;
  locked: boolean;
  hidden: boolean;
  items: VisualTrackItem[];
}

export interface AudioTrackItem {
  id: string;
  source_id: SourceID;
  timeline_start_us: number;
  source_in_us: number;
  duration_us: number;
  speed: number;
  gain_db: number;
  gain_db_keyframes?: NumericKeyframe[];
  fade_in_us: number;
  fade_out_us: number;
  muted: boolean;
  duck_others: boolean;
}

export interface AudioTrack {
  id: TrackID;
  name: string;
  role: "voice" | "music" | "system" | "effects" | "other";
  muted: boolean;
  items: AudioTrackItem[];
}

export interface CaptionWord {
  text: string;
  start_us: number;
  end_us: number;
  confidence?: number;
  emphasis?: boolean;
}

export interface CaptionCue {
  id: string;
  start_us: number;
  end_us: number;
  text: string;
  words: CaptionWord[];
  speaker?: string;
  review_required?: boolean;
}

export interface CaptionStyle {
  preset: "clean" | "bold" | "karaoke" | "boxed";
  font_family: string;
  font_size: number;
  font_weight: number;
  color: string;
  emphasis_color: string;
  background_color: string;
  position: "top" | "middle" | "bottom";
  max_lines: 1 | 2 | 3;
}

export interface CaptionTrack {
  id: TrackID;
  name: string;
  language: string;
  visible: boolean;
  style: CaptionStyle;
  cues: CaptionCue[];
  variant_overrides?: Partial<Record<VariantID, Partial<CaptionStyle>>>;
}

export interface VideoVariant {
  id: VariantID;
  name: string;
  width: number;
  height: number;
  safe_area: { top: number; right: number; bottom: number; left: number };
  background_color: string;
}

export interface TimelineMarker {
  id: string;
  time_us: number;
  label: string;
  color: string;
}

export interface ExportDefaults {
  variant_ids: VariantID[];
  format: "mp4" | "webm";
  video_codec: "avc" | "vp9";
  audio_codec: "aac" | "opus";
  frame_rate: {
    numerator: 24 | 25 | 30 | 50 | 60;
    denominator: 1 | 1001;
  };
  video_bitrate: number;
  audio_bitrate: number;
  loudness_normalization: boolean;
}

export interface VideoProjectDocumentV1 {
  schema_version: typeof VIDEO_PROJECT_SCHEMA_VERSION;
  editing_mode?: "quick-cut" | "editor";
  title: string;
  timebase: {
    ticks_per_second: typeof VIDEO_TICKS_PER_SECOND;
    fps_numerator: 24 | 25 | 30 | 50 | 60;
    fps_denominator: 1 | 1001;
  };
  sources: Record<SourceID, VideoSource>;
  primary_sequence: PrimarySequenceItem[];
  visual_tracks: VisualTrack[];
  audio_tracks: AudioTrack[];
  caption_tracks: CaptionTrack[];
  variants: VideoVariant[];
  markers: TimelineMarker[];
  export_defaults: ExportDefaults;
}

export interface DerivedPrimaryClip {
  clip_id: ClipID;
  kind: "clip" | "gap";
  index: number;
  timeline_start_us: number;
  timeline_end_us: number;
  duration_us: number;
  transition_overlap_us: number;
}

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface VideoProjectValidation {
  valid: boolean;
  issues: ValidationIssue[];
  document?: VideoProjectDocumentV1;
}
