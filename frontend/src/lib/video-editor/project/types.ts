/**
 * Project document model for the OpenPost Video Editor.
 *
 * Ported from FreeCut (MIT) - types/project.ts - adapted to the current surface:
 * video / audio / image / Lottie / text / subtitle / shape / adjustment / controller /
 * composition items and reusable nested sequences.
 */

import type {
	BezierPoints as TransitionBezierPoints,
	TransitionPresentation,
	TransitionTiming,
	WipeDirection as TransitionDirection
} from '../transitions/types';
import type { AudioEqFieldSource } from '../audio/audio-eq';
import type { AudioEqSettings } from '../audio/types';
import type { AudioPitchFieldSource } from '../audio/audio-pitch';

export type {
	BezierPoints as TransitionBezierPoints,
	TransitionTiming,
	WipeDirection as TransitionDirection
} from '../transitions/types';

export interface AudioDuckingSettings {
	duckOthersDb: number;
	attackSec?: number;
	releaseSec?: number;
	targetTrackIds?: string[];
}

export const TIMELINE_ITEM_KINDS = [
	'video',
	'audio',
	'image',
	'lottie',
	'text',
	'subtitle',
	'shape',
	'adjustment',
	'controller',
	'composition'
] as const;

export type TimelineItemKind = (typeof TIMELINE_ITEM_KINDS)[number];

export type ShapeType =
	| 'rectangle'
	| 'circle'
	| 'triangle'
	| 'ellipse'
	| 'star'
	| 'polygon'
	| 'heart'
	| 'path';

/** One normalized Bezier vertex. Handles are offsets from the vertex. */
export interface ShapePathVertex {
	position: [number, number];
	inHandle: [number, number];
	outHandle: [number, number];
	tangentMode?: 'corner' | 'smooth' | 'continuous' | 'broken';
}

export interface ItemTransform {
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	anchorX?: number;
	anchorY?: number;
	rotation?: number;
	flipHorizontal?: boolean;
	flipVertical?: boolean;
	opacity?: number;
	cornerRadius?: number;
	aspectRatioLocked?: boolean;
}

/** Concrete pose snapshot used to keep transform parenting visually stable. */
export interface TransformReference {
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
}

/** Bind-space relationship between one visual layer and its transform parent. */
export interface TransformParentBinding {
	parentItemId?: string;
	parentReference?: TransformReference;
	childLocalReference: TransformReference;
	childWorldReference: TransformReference;
}

export type MotionModifierType = 'float-drift' | 'breath-pulse' | 'micro-shake' | 'sway' | 'spin';
export type MotionModifierChannel = 'x' | 'y' | 'width' | 'height' | 'rotation' | 'opacity';
export type MotionModifierChannelGains = Partial<Record<MotionModifierChannel, number>>;

export interface MotionModifier {
	version?: 2;
	id: string;
	type: MotionModifierType;
	enabled: boolean;
	amplitude: number;
	frequency: number;
	phaseFrames: number;
	seed: number;
	channelGains?: MotionModifierChannelGains;
}

export type MotionLayerBlendMode = 'add' | 'multiply';

export interface MotionLayerKeyframe {
	id: string;
	frame: number;
	value: number;
	easing: EasingType;
	easingConfig?: EasingConfig;
}

export interface MotionLayerTrack {
	property: TransformAnimatableProperty;
	blend: MotionLayerBlendMode;
	keyframes: MotionLayerKeyframe[];
}

export interface MotionAnimationLayer {
	id: string;
	name: string;
	enabled: boolean;
	source: 'built-in-preset' | 'saved-preset';
	sourcePresetId: string;
	tracks: MotionLayerTrack[];
}

export const TEXT_MOTION_IN_PRESET_IDS = [
	'typewriter',
	'fade-up',
	'rise',
	'cascade',
	'pop',
	'blur-in',
	'slide-mask',
	'wave-in'
] as const;
export const TEXT_MOTION_OUT_PRESET_IDS = [
	'fade-down',
	'sink',
	'pop-out',
	'blur-out',
	'typewriter-erase'
] as const;
export const TEXT_MOTION_LOOP_PRESET_IDS = ['pulse', 'wave', 'shimmer', 'swing'] as const;

export type TextMotionInPresetId = (typeof TEXT_MOTION_IN_PRESET_IDS)[number];
export type TextMotionOutPresetId = (typeof TEXT_MOTION_OUT_PRESET_IDS)[number];
export type TextMotionLoopPresetId = (typeof TEXT_MOTION_LOOP_PRESET_IDS)[number];
export type TextMotionPresetId =
	| TextMotionInPresetId
	| TextMotionOutPresetId
	| TextMotionLoopPresetId;
export type TextMotionUnit = 'character' | 'word' | 'line' | 'whole-clip';
export type TextMotionOrder = 'forward' | 'backward' | 'center' | 'random';
export type TextMotionEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'overshoot';
export type TextMotionSlot = 'in' | 'out' | 'loop';

export interface TextMotionEffectBase {
	durationFrames: number;
	offsetFrames?: number;
	staggerFrames: number;
	intensity: number;
	order: TextMotionOrder;
	easing: TextMotionEasing;
	seed: number;
	unit?: TextMotionUnit;
}

export interface TextMotionInEffect extends TextMotionEffectBase {
	presetId: TextMotionInPresetId;
}

export interface TextMotionOutEffect extends TextMotionEffectBase {
	presetId: TextMotionOutPresetId;
}

export interface TextMotionLoopEffect extends TextMotionEffectBase {
	presetId: TextMotionLoopPresetId;
}

export type TextMotionEffect = TextMotionInEffect | TextMotionOutEffect | TextMotionLoopEffect;

export interface TextMotionSpec {
	in?: TextMotionInEffect;
	out?: TextMotionOutEffect;
	loop?: TextMotionLoopEffect;
}

export interface CropSettings {
	top: number;
	right: number;
	bottom: number;
	left: number;
	softness?: number;
}

/** Four local-pixel offsets stored against the item size where they were authored. */
export interface TimelineItemCornerPin {
	topLeft: [number, number];
	topRight: [number, number];
	bottomRight: [number, number];
	bottomLeft: [number, number];
	referenceWidth?: number;
	referenceHeight?: number;
}

/**
 * Ported from FreeCut (MIT) - types/keyframe.ts.
 */
export type EasingType =
	| 'linear'
	| 'ease-in'
	| 'ease-out'
	| 'ease-in-out'
	| 'hold'
	| 'cubic-bezier'
	| 'spring';

export interface BezierControlPoints {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export interface SpringParameters {
	tension: number;
	friction: number;
	mass: number;
}

export interface EasingConfig {
	type: EasingType;
	bezier?: BezierControlPoints;
	spring?: SpringParameters;
}

export const DEFAULT_SPRING_PARAMS: SpringParameters = {
	tension: 170,
	friction: 26,
	mass: 1
};

export const DEFAULT_BEZIER_POINTS: BezierControlPoints = {
	x1: 0.42,
	y1: 0,
	x2: 0.58,
	y2: 1
};

/** Stable effect-parameter lane, matching FreeCut's persisted property format. */
export type EffectKeyframeProperty = `effect:${string}:${string}:${string}`;

export type PathVertexKeyframeComponent =
	| 'positionX'
	| 'positionY'
	| 'inX'
	| 'inY'
	| 'outX'
	| 'outY';

/** Stable scalar lane for one coordinate of one path vertex. */
export type PathVertexKeyframeProperty = `pathVertex:${number}:${PathVertexKeyframeComponent}`;

/** Built-in property that can be animated with per-item keyframes. */
export type BuiltInKeyframeProperty =
	| 'x'
	| 'y'
	| 'width'
	| 'height'
	| 'anchorX'
	| 'anchorY'
	| 'rotation'
	| 'opacity'
	| 'cornerRadius'
	| 'cropLeft'
	| 'cropRight'
	| 'cropTop'
	| 'cropBottom'
	| 'cropSoftness'
	| 'volume'
	| 'fontSize'
	| 'fontWeight'
	| 'lineHeight'
	| 'letterSpacing'
	| 'paddingX'
	| 'paddingY'
	| 'borderRadius'
	| 'textShadowOffsetX'
	| 'textShadowOffsetY'
	| 'textShadowBlur'
	| 'strokeWidth'
	| 'trimPathStart'
	| 'trimPathEnd'
	| 'trimPathOffset'
	| 'taperStartWidth'
	| 'taperEndWidth'
	| 'taperStartLength'
	| 'taperEndLength';

/** Property that can be animated with per-item keyframes. */
export type KeyframeProperty =
	| BuiltInKeyframeProperty
	| PathVertexKeyframeProperty
	| EffectKeyframeProperty;

/**
 * Parallel frame/value arrays for one animated property. Frames ascend and
 * are relative to the item's start (`from`), so tracks survive item moves.
 */
export interface KeyframeTrack {
	frames: number[];
	values: number[];
	/** Stable IDs and outgoing segment easing. Missing arrays mean legacy linear tracks. */
	ids?: string[];
	easings?: EasingType[];
	easingConfigs?: Array<EasingConfig | null>;
}

/** Per-property keyframe tracks stored on a timeline item. */
export type ItemKeyframes = Partial<Record<KeyframeProperty, KeyframeTrack>>;

export type ScalarLinkableProperty =
	| 'x'
	| 'y'
	| 'width'
	| 'height'
	| 'anchorX'
	| 'anchorY'
	| 'rotation'
	| 'opacity'
	| 'cornerRadius';
export type VectorKeyframeProperty = 'position' | 'scale' | 'anchor';
export type DirectLinkableProperty = ScalarLinkableProperty | VectorKeyframeProperty;

export interface DirectPropertyLink {
	type: 'link';
	targetProperty: DirectLinkableProperty;
	sourceItemId: string;
	sourceProperty: DirectLinkableProperty;
	enabled: boolean;
	timeOffsetFrames: number;
}

export interface PropertyExpression {
	type: 'expression';
	targetProperty: DirectLinkableProperty;
	source: string;
	enabled: boolean;
}

export const COMPOSITION_CONTROLS_VERSION = 1 as const;
export type CompositionControlProperty =
	| 'text.text'
	| 'text.color'
	| 'shape.fillColor'
	| 'shape.strokeColor';
export type CompositionControlKind = 'text' | 'color';
export interface CompositionControlDefinition {
	id: string;
	name: string;
	targetItemId: string;
	property: CompositionControlProperty;
	kind: CompositionControlKind;
	defaultValue: string;
}
export interface CompositionControlSchema {
	version: typeof COMPOSITION_CONTROLS_VERSION;
	controls: CompositionControlDefinition[];
}
export type CompositionControlOverrides = Record<string, string>;

/** Two-dimensional value used by coupled transform animation. */
export interface Vector2 {
	x: number;
	y: number;
}

/** Spatial Bezier handles stored as offsets from their keyframe value. */
export interface SpatialBezierTangents {
	inTangent: Vector2;
	outTangent: Vector2;
	/** Keep the handles opposite and collinear while either handle moves. */
	continuous?: boolean;
}

/** A coupled vector keyframe with temporal and spatial interpolation. */
export interface VectorKeyframe {
	id: string;
	frame: number;
	value: Vector2;
	easing: EasingType;
	easingConfig?: EasingConfig;
	spatial?: SpatialBezierTangents;
}

export type ItemVectorKeyframes = Partial<Record<VectorKeyframeProperty, VectorKeyframe[]>>;

/** One scalar key stored inside a portable saved animation recipe. */
export interface AnimationPresetKeyframe {
	id: string;
	frame: number;
	value: number;
	easing: EasingType;
	easingConfig?: EasingConfig;
}

export interface AnimationPresetProperty {
	property: KeyframeProperty;
	keyframes: AnimationPresetKeyframe[];
}

export interface AnimationPresetVectorProperty {
	property: VectorKeyframeProperty;
	keyframes: VectorKeyframe[];
}

/** Project-scoped animation recipe captured from one compatible clip type. */
export interface AnimationPreset {
	id: string;
	name: string;
	sourceItemType: TimelineItemKind;
	properties: AnimationPresetProperty[];
	vectorProperties?: AnimationPresetVectorProperty[];
	effects: import('../effects/types').ItemEffect[];
	motionModifiers?: MotionModifier[];
	motionLayers?: MotionAnimationLayer[];
	textMotion?: TextMotionSpec;
	sourceDurationInFrames: number;
	createdAt: number;
}

/** Styling for text items and caption rendering. */
export interface TextStyleFields {
	fontFamily?: string;
	fontSize?: number;
	fontWeight?: number;
	fontStyle?: 'normal' | 'italic';
	underline?: boolean;
	color?: string;
	backgroundColor?: string;
	backgroundFit?: 'box' | 'content';
	textAlign?: 'left' | 'center' | 'right';
	verticalAlign?: 'top' | 'middle' | 'bottom';
	lineHeight?: number;
	letterSpacing?: number;
	textShadow?: {
		blur: number;
		color: string;
		offsetX: number;
		offsetY: number;
	};
	strokeWidth?: number;
	strokeColor?: string;
	paddingX?: number;
	paddingY?: number;
	borderRadius?: number;
}

/** One independently styled line group inside a text item. */
export interface TextSpan {
	text: string;
	fontSize?: number;
	fontFamily?: string;
	fontWeight?: number;
	fontStyle?: 'normal' | 'italic';
	underline?: boolean;
	color?: string;
	letterSpacing?: number;
}

export type TextSingleLayoutDraft = TextSpan;

/** Preserves the creator's copy and inline styling while switching layouts. */
export interface TextLayoutDrafts {
	single?: TextSingleLayoutDraft;
	twoSpans?: TextSpan[];
	threeSpans?: TextSpan[];
}

export type TextSpanLayout = 'stack' | 'inline';

export type TextStylePresetId =
	| 'clean-title'
	| 'poster'
	| 'outline-pill'
	| 'lower-third'
	| 'speaker-card'
	| 'cinematic'
	| 'quote'
	| 'neon'
	| 'headline-stack'
	| 'breaking-update'
	| 'event-card'
	| 'launch-stack'
	| 'badge';

/** Where a subtitle item's cues came from. */
interface CaptionSourceBase {
	clipId: string;
	mediaId: string;
	importedAt?: number;
}

export interface TranscriptCaptionSource extends CaptionSourceBase {
	type: 'transcript';
	/** Source window used for transcription, before timeline speed scaling. */
	sourceStartSeconds?: number;
	/** Exclusive end of the transcribed source window. */
	sourceEndSeconds?: number;
	/** Playback speed used when source-second word timings became cue frames. */
	playbackSpeed?: number;
	/** Whether cue frames advance from the source window end toward its start. */
	isReversed?: boolean;
}

export interface SubtitleImportCaptionSource extends CaptionSourceBase {
	type: 'subtitle-import';
	fileName?: string;
	format?: 'srt' | 'vtt' | 'ass';
}

export interface EmbeddedSubtitleCaptionSource extends CaptionSourceBase {
	type: 'embedded-subtitles';
	trackNumber: number;
	language: string;
	trackName?: string;
	codecId: string;
}

export interface AiCaptionsCaptionSource extends CaptionSourceBase {
	type: 'ai-captions';
	sourceStartSeconds?: number;
	sourceEndSeconds?: number;
	playbackSpeed?: number;
	isReversed?: boolean;
}

export type CaptionSource =
	| TranscriptCaptionSource
	| SubtitleImportCaptionSource
	| EmbeddedSubtitleCaptionSource
	| AiCaptionsCaptionSource;

export interface SubtitleCue {
	id: string;
	startFrame: number;
	endFrame: number;
	text: string;
	words?: SubtitleWord[];
}

export interface SubtitleWord {
	id: string;
	startFrame: number;
	endFrame: number;
	text: string;
}

export interface TimelineItem extends TextStyleFields, AudioEqFieldSource, AudioPitchFieldSource {
	id: string;
	trackId: string;
	from: number;
	durationInFrames: number;
	label: string;
	type: TimelineItemKind;
	mediaId?: string;
	originId?: string;
	linkedGroupId?: string;
	/** Reusable nested timeline referenced by composition and companion audio items. */
	compositionId?: string;
	compositionWidth?: number;
	compositionHeight?: number;
	/** Per-instance values for controls published by a reusable composition. */
	compositionControlOverrides?: CompositionControlOverrides;

	// Source boundaries for media items (frames at the source's frame rate)
	sourceStart?: number;
	sourceEnd?: number;
	sourceDuration?: number;
	sourceFps?: number;
	speed?: number;
	/** Play the selected source window from its exclusive end back to its start. */
	isReversed?: boolean;

	// Lottie playback
	lottieTotalFrames?: number;
	lottieFrameRate?: number;
	lottieLoop?: boolean;
	lottieReversed?: boolean;
	lottieLoopMode?: 'loop' | 'pingpong';
	lottieSegmentStart?: number;
	lottieSegmentEnd?: number;
	/** Project-frame phase carried by a split clip so its animation does not restart. */
	lottiePhaseOffset?: number;
	lottieMarkers?: Array<{ name: string; start: number; duration: number }>;
	lottieAnimationId?: string;
	lottieThemeId?: string;
	lottieTextOverrides?: Record<string, string>;
	lottieColorOverrides?: Record<string, string>;
	lottieSlotOverrides?: Record<string, number | [number, number]>;

	// Text items
	text?: string;
	textSpans?: TextSpan[];
	spanLayout?: TextSpanLayout;
	textLayoutDrafts?: TextLayoutDrafts;
	textStylePresetId?: TextStylePresetId;
	textStyleScale?: number;

	// Shape items
	shapeType?: ShapeType;
	fillColor?: string;
	fillEnabled?: boolean;
	fillType?: 'solid' | 'linear';
	gradientStartColor?: string;
	gradientEndColor?: string;
	gradientAngle?: number;
	strokeEnabled?: boolean;
	strokeColor?: string;
	strokeWidth?: number;
	strokeLineCap?: 'butt' | 'round' | 'square';
	strokeLineJoin?: 'miter' | 'round' | 'bevel';
	strokeMiterLimit?: number;
	/** Visible stroke range as percentages of the shape outline. */
	trimPathStart?: number;
	trimPathEnd?: number;
	/** Cyclic phase for the visible stroke range, in degrees. */
	trimPathOffset?: number;
	/** Stroke-width percentages at the start and end of the visible range. */
	taperStartWidth?: number;
	taperEndWidth?: number;
	/** Percentages of the visible range used to ease each taper to full width. */
	taperStartLength?: number;
	taperEndLength?: number;
	shapeCornerRadius?: number;
	shapeDirection?: 'up' | 'down' | 'left' | 'right';
	shapePoints?: number;
	shapeInnerRadius?: number;
	pathVertices?: ShapePathVertex[];
	pathClosed?: boolean;
	isMask?: boolean;
	maskType?: 'clip' | 'alpha';
	maskFeather?: number;
	maskOpacity?: number;
	maskInvert?: boolean;

	// Subtitle items own the full cue list and render the active cue per frame
	captionSource?: CaptionSource;
	cues?: SubtitleCue[];
	subtitleStyleScale?: number;

	// Source dimensions (video/image)
	sourceWidth?: number;
	sourceHeight?: number;

	transform?: ItemTransform;
	/** Optional Motion hierarchy. Controllers participate but never render. */
	transformParent?: TransformParentBinding;
	crop?: CropSettings;
	cornerPin?: TimelineItemCornerPin;

	// Audio properties
	volume?: number;
	audioFadeIn?: number;
	audioFadeOut?: number;
	audioFadeInCurve?: number;
	audioFadeOutCurve?: number;
	audioFadeInCurveX?: number;
	audioFadeOutCurveX?: number;
	audioDucking?: AudioDuckingSettings;

	// Video properties
	fadeIn?: number;
	fadeOut?: number;

	// Animated properties (keyframes override the static values above)
	keyframes?: ItemKeyframes;
	/**
	 * Coupled transform animation. Kept beside the scalar map so legacy
	 * projects remain valid and scalar-property code cannot mistake metadata
	 * for a numeric track.
	 */
	vectorKeyframes?: ItemVectorKeyframes;
	animationVersion?: 2;
	separatedVectorProperties?: VectorKeyframeProperty[];
	/** Small deterministic live-motion records evaluated during preview and export. */
	motionModifiers?: MotionModifier[];
	/** Named additive animation layers evaluated after base keyframes and before modifiers. */
	motionLayers?: MotionAnimationLayer[];
	/** Same-sequence property followers evaluated after keyframes. */
	propertyLinks?: DirectPropertyLink[];
	/** Sandboxed property expressions evaluated after direct links. */
	expressions?: PropertyExpression[];
	/** Independent per-unit text animation slots evaluated in preview and export. */
	textMotion?: TextMotionSpec;

	// Clip effects (CSS-filter-semantics color/blur stack; see effects/types.ts)
	effects?: import('$lib/video-editor/effects/types').ItemEffect[];

	// Per-clip compositing blend mode for the GPU pipeline (25 modes; see
	// effects/gpu/blend-modes.ts). Absent/'normal' keeps opacity-only blending.
	blendMode?: import('$lib/video-editor/effects/gpu/blend-modes').BlendMode;
}

export interface TimelineTrack {
	id: string;
	name: string;
	/** Organizational rows never accept timeline items. Groups are one level deep. */
	isGroup?: boolean;
	/** A media track may belong to one group. Group rows cannot have a parent. */
	parentTrackId?: string;
	/** Presentation state only. It does not hide children from preview or export. */
	isCollapsed?: boolean;
	kind?: 'video' | 'audio';
	height: number;
	locked: boolean;
	syncLock?: boolean;
	visible: boolean;
	muted: boolean;
	solo: boolean;
	volume?: number;
	/** Per-track parametric EQ inserted after clip EQ and before bus EQ. */
	audioEq?: AudioEqSettings;
	color?: string;
	order: number;
}

export interface TimelineMarker {
	id: string;
	frame: number;
	label?: string;
	color: string;
}

export type TransitionPropertyValue = number | [number, number, number];

export interface TimelineTransition {
	id: string;
	/** Legacy display type. New projects use `presentation` for the renderer. */
	type: 'crossfade' | 'fade-black';
	presentation?: TransitionPresentation;
	timing?: TransitionTiming;
	direction?: TransitionDirection;
	bezierPoints?: TransitionBezierPoints;
	properties?: Record<string, TransitionPropertyValue>;
	durationInFrames: number;
	/** 0 starts at the cut, 0.5 centers on it, and 1 ends at the cut. */
	alignment?: number;
	fromItemId: string;
	toItemId: string;
}

export interface ProjectTimeline {
	tracks: TimelineTrack[];
	items: TimelineItem[];

	// Playback and view state
	currentFrame?: number;
	zoomLevel?: number;
	scrollPosition?: number;

	// In/Out points
	inPoint?: number;
	outPoint?: number;

	markers?: TimelineMarker[];
	transitions?: TimelineTransition[];
	/** Ordered reusable timelines promoted to tabs. Main stays implicit. */
	topLevelSequenceIds?: string[];
	/** Reusable nested timelines. The same entry can be a tab and a nested clip. */
	compositions?: SubComposition[];
	/** Persisted master-bus level in dB. */
	masterVolumeDb?: number;
	/** Persisted master-bus mute. */
	masterMuted?: boolean;
	/** Master-bus parametric EQ applied after all track and clip stages. */
	busAudioEq?: AudioEqSettings;
}

export interface SubComposition {
	id: string;
	name: string;
	editorKind?: 'sequence' | 'composite-2d';
	compositionControls?: CompositionControlSchema;
	items: TimelineItem[];
	tracks: TimelineTrack[];
	transitions: TimelineTransition[];
	fps: number;
	width: number;
	height: number;
	durationInFrames: number;
	backgroundColor?: string;
	markers?: TimelineMarker[];
	inPoint?: number | null;
	outPoint?: number | null;
	masterVolumeDb?: number;
	masterMuted?: boolean;
	/** Sequence-bus parametric EQ applied after nested track and clip stages. */
	busAudioEq?: AudioEqSettings;
}

export interface ProjectResolution {
	width: number;
	height: number;
	fps: number;
	backgroundColor?: string;
}

export interface Project {
	id: string;
	name: string;
	description: string;
	createdAt: number;
	updatedAt: number;
	duration: number;
	/**
	 * Schema version for migrations. Projects without this field are version 1.
	 */
	schemaVersion?: number;
	thumbnailId?: string;
	metadata: ProjectResolution;
	timeline?: ProjectTimeline;
	/** Saved animation recipes that travel with this project document. */
	animationPresets?: AnimationPreset[];
	/**
	 * Root folder handle for the project's media files. Non-serializable —
	 * stripped on save and re-attached from the handles registry on load.
	 */
	rootFolderHandle?: FileSystemDirectoryHandle;
	rootFolderName?: string;
}
