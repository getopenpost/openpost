import { z } from 'zod';
import { mixerDbToGain } from '../audio/mixer-utils';
import type { ItemEffect } from '../effects/types';
import {
	TIMELINE_ITEM_KINDS,
	type CaptionSource,
	type ItemKeyframes,
	type ItemVectorKeyframes,
	type KeyframeTrack,
	type Project,
	type ProjectTimeline,
	type SubComposition,
	type SubtitleCue,
	type TimelineItem,
	type TimelineTrack,
	type TimelineTransition
} from './types';

export const FREECUT_SCHEMA_VERSION = 15;

const easingTypeSchema = z.enum([
	'linear',
	'ease-in',
	'ease-out',
	'ease-in-out',
	'hold',
	'cubic-bezier',
	'spring'
]);
const vectorPropertySchema = z.enum(['position', 'scale', 'anchor']);
const directPropertySchema = z.enum([
	'x',
	'y',
	'width',
	'height',
	'anchorX',
	'anchorY',
	'rotation',
	'opacity',
	'cornerRadius',
	'position',
	'scale',
	'anchor'
]);
const vectorSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
const easingConfigSchema = z.object({
	type: easingTypeSchema,
	bezier: z
		.object({
			x1: z.number().finite(),
			y1: z.number().finite(),
			x2: z.number().finite(),
			y2: z.number().finite()
		})
		.optional(),
	spring: z
		.object({
			tension: z.number().finite(),
			friction: z.number().finite(),
			mass: z.number().finite()
		})
		.optional()
});
const animationKeyframeSourceSchema = z.object({
	applicationId: z.string(),
	kind: z.enum(['built-in-preset', 'saved-preset']),
	presetId: z.string(),
	presetName: z.string()
});
const scalarKeyframeSchema = z.looseObject({
	id: z.string().optional(),
	frame: z.number().finite().optional(),
	value: z.number().finite().optional(),
	easing: easingTypeSchema.optional(),
	easingConfig: easingConfigSchema.optional(),
	source: animationKeyframeSourceSchema.optional()
});
const scalarPropertySchema = z.looseObject({
	property: z.string(),
	keyframes: z.array(scalarKeyframeSchema)
});
const vectorKeyframeSchema = z.looseObject({
	id: z.string().optional(),
	frame: z.number().finite().optional(),
	value: vectorSchema.optional(),
	easing: easingTypeSchema.optional(),
	easingConfig: easingConfigSchema.optional(),
	source: animationKeyframeSourceSchema.optional()
});
const vectorPropertyGroupSchema = z.looseObject({
	property: vectorPropertySchema,
	keyframes: z.array(vectorKeyframeSchema)
});
const propertyLinkSchema = z.object({
	type: z.literal('link'),
	targetProperty: directPropertySchema,
	sourceItemId: z.string(),
	sourceProperty: directPropertySchema,
	enabled: z.boolean(),
	timeOffsetFrames: z.number().finite()
});
const expressionSchema = z.object({
	type: z.literal('expression'),
	targetProperty: directPropertySchema,
	source: z.string(),
	enabled: z.boolean()
});
const itemAnimationSchema = z.looseObject({
	itemId: z.string(),
	animationVersion: z.literal(2).optional(),
	properties: z.array(scalarPropertySchema).optional().default([]),
	vectorProperties: z.array(vectorPropertyGroupSchema).optional().default([]),
	separatedVectorProperties: z.array(vectorPropertySchema).optional(),
	propertyLinks: z.array(propertyLinkSchema).optional(),
	expressions: z.array(expressionSchema).optional()
});
const gpuParamsSchema = z.record(
	z.string(),
	z.union([z.number().finite(), z.string(), z.boolean()])
);
const freeCutEffectSchema = z.looseObject({
	id: z.string(),
	enabled: z.boolean().optional(),
	type: z.string().optional(),
	effectId: z.string().optional(),
	params: gpuParamsSchema.optional(),
	effect: z
		.looseObject({
			type: z.string(),
			gpuEffectType: z.string().optional(),
			params: gpuParamsSchema.optional()
		})
		.optional()
});
const captionSourceSchema = z.looseObject({
	type: z.enum(['transcript', 'subtitle-import', 'embedded-subtitles', 'ai-captions']),
	clipId: z.string().optional(),
	mediaId: z.string().optional(),
	importedAt: z.number().finite().optional(),
	sourceStartSeconds: z.number().finite().optional(),
	sourceEndSeconds: z.number().finite().optional(),
	playbackSpeed: z.number().finite().optional(),
	isReversed: z.boolean().optional(),
	fileName: z.string().optional(),
	format: z.enum(['srt', 'vtt', 'ass']).optional(),
	trackNumber: z.number().int().nonnegative().optional(),
	language: z.string().optional(),
	trackName: z.string().optional(),
	codecId: z.string().optional()
});
const subtitleCueSchema = z.looseObject({
	id: z.string(),
	text: z.string(),
	startFrame: z.number().finite().optional(),
	endFrame: z.number().finite().optional(),
	startSeconds: z.number().finite().optional(),
	endSeconds: z.number().finite().optional()
});
const freeCutTrackSchema = z.looseObject({
	id: z.string(),
	name: z.string(),
	kind: z.enum(['video', 'audio']).optional(),
	height: z.number().finite(),
	locked: z.boolean(),
	visible: z.boolean(),
	muted: z.boolean(),
	solo: z.boolean(),
	volume: z.number().finite().optional(),
	order: z.number().finite()
});
const freeCutItemSchema = z.looseObject({
	id: z.string(),
	trackId: z.string(),
	from: z.number().finite(),
	durationInFrames: z.number().finite(),
	label: z.string(),
	type: z.enum(TIMELINE_ITEM_KINDS),
	mediaId: z.string().optional(),
	volume: z.number().finite().optional(),
	effects: z.array(freeCutEffectSchema).optional(),
	captionSource: captionSourceSchema.optional(),
	source: captionSourceSchema.optional(),
	cues: z.array(subtitleCueSchema).optional(),
	shapeCornerRadius: z.number().finite().optional(),
	cornerRadius: z.number().finite().optional(),
	shapeDirection: z.enum(['up', 'down', 'left', 'right']).optional(),
	direction: z.enum(['up', 'down', 'left', 'right']).optional(),
	shapePoints: z.number().finite().optional(),
	points: z.number().finite().optional(),
	shapeInnerRadius: z.number().finite().optional(),
	innerRadius: z.number().finite().optional(),
	lottieFrameRate: z.number().finite().optional(),
	frameRate: z.number().finite().optional(),
	lottieTotalFrames: z.number().finite().optional(),
	totalFrames: z.number().finite().optional(),
	lottieLoop: z.boolean().optional(),
	loop: z.boolean().optional(),
	lottieReversed: z.boolean().optional(),
	reversed: z.boolean().optional(),
	lottieLoopMode: z.enum(['loop', 'pingpong']).optional(),
	loopMode: z.enum(['loop', 'pingpong']).optional(),
	lottieSegmentStart: z.number().finite().optional(),
	segmentStart: z.number().finite().optional(),
	lottieSegmentEnd: z.number().finite().optional(),
	segmentEnd: z.number().finite().optional(),
	lottieAnimationId: z.string().optional(),
	animationId: z.string().optional(),
	lottieThemeId: z.string().optional(),
	themeId: z.string().optional(),
	lottieTextOverrides: z.record(z.string(), z.string()).optional(),
	textOverrides: z.record(z.string(), z.string()).optional(),
	lottieColorOverrides: z.record(z.string(), z.string()).optional(),
	colorOverrides: z.record(z.string(), z.string()).optional(),
	lottieSlotOverrides: z
		.record(z.string(), z.union([z.number().finite(), z.tuple([z.number(), z.number()])]))
		.optional(),
	slotOverrides: z
		.record(z.string(), z.union([z.number().finite(), z.tuple([z.number(), z.number()])]))
		.optional()
});
const freeCutTransitionSchema = z.looseObject({
	id: z.string(),
	type: z.enum(['crossfade', 'fade-black']),
	durationInFrames: z.number().finite(),
	fromItemId: z.string().optional(),
	toItemId: z.string().optional(),
	leftClipId: z.string().optional(),
	rightClipId: z.string().optional()
});
const freeCutCompositionSchema = z.looseObject({
	id: z.string(),
	name: z.string(),
	editorKind: z.enum(['sequence', 'composite-2d']).optional(),
	items: z.array(freeCutItemSchema),
	tracks: z.array(freeCutTrackSchema),
	transitions: z.array(freeCutTransitionSchema),
	keyframes: z.array(itemAnimationSchema).optional(),
	fps: z.number().finite().positive(),
	width: z.number().finite().positive(),
	height: z.number().finite().positive(),
	durationInFrames: z.number().finite().nonnegative()
});
const freeCutTimelineSchema = z.looseObject({
	tracks: z.array(freeCutTrackSchema),
	items: z.array(freeCutItemSchema),
	transitions: z.array(freeCutTransitionSchema).optional().default([]),
	keyframes: z.array(itemAnimationSchema).optional(),
	compositions: z.array(freeCutCompositionSchema).optional().default([]),
	masterBusDb: z.number().finite().optional(),
	masterVolumeDb: z.number().finite().optional()
});

type FreeCutTrack = z.infer<typeof freeCutTrackSchema>;
type FreeCutItem = z.infer<typeof freeCutItemSchema>;
type FreeCutEffect = z.infer<typeof freeCutEffectSchema>;
type FreeCutCaptionSource = z.infer<typeof captionSourceSchema>;
type FreeCutSubtitleCue = z.infer<typeof subtitleCueSchema>;
type FreeCutTransition = z.infer<typeof freeCutTransitionSchema>;
type ItemAnimation = z.infer<typeof itemAnimationSchema>;
type FreeCutComposition = z.infer<typeof freeCutCompositionSchema>;
type FreeCutTimeline = z.infer<typeof freeCutTimelineSchema>;

function hasFreeCutTimelineShape(timeline: FreeCutTimeline): boolean {
	if (timeline.masterBusDb !== undefined || timeline.keyframes !== undefined) return true;
	if (
		timeline.transitions.some(
			(transition) => transition.leftClipId !== undefined || transition.rightClipId !== undefined
		)
	)
		return true;
	return timeline.items.some(
		(item) =>
			item.direction !== undefined ||
			item.points !== undefined ||
			item.innerRadius !== undefined ||
			item.effects?.some((effect) => effect.effect?.type === 'gpu-effect') === true
	);
}

export function isFreeCutProjectDocument(project: Project): boolean {
	if (project.schemaFamily === 'openpost') return false;
	const version = project.schemaVersion ?? 1;
	if (version >= 5 && version <= FREECUT_SCHEMA_VERSION) return true;
	const timeline = freeCutTimelineSchema.safeParse(project.timeline);
	return timeline.success && hasFreeCutTimelineShape(timeline.data);
}

function freeCutDbToGain(value: number | undefined): number | undefined {
	return value === undefined ? undefined : mixerDbToGain(value);
}

function convertTrack(value: FreeCutTrack): TimelineTrack {
	const volume = freeCutDbToGain(value.volume);
	return { ...value, ...(volume !== undefined && { volume }) };
}

function convertEffect(value: FreeCutEffect): ItemEffect | null {
	if (value.type === 'gpu' && value.effectId) {
		return {
			id: value.id,
			enabled: value.enabled !== false,
			type: 'gpu',
			effectId: value.effectId,
			params: value.params ?? {}
		};
	}
	if (value.effect?.type !== 'gpu-effect' || !value.effect.gpuEffectType) return null;
	return {
		id: value.id,
		enabled: value.enabled !== false,
		type: 'gpu',
		effectId: value.effect.gpuEffectType,
		params: value.effect.params ?? {}
	};
}

function convertSubtitleCue(value: FreeCutSubtitleCue, fps: number): SubtitleCue | null {
	const startFrame =
		value.startFrame ??
		(value.startSeconds === undefined ? undefined : Math.round(value.startSeconds * fps));
	const endFrame =
		value.endFrame ??
		(value.endSeconds === undefined ? undefined : Math.round(value.endSeconds * fps));
	if (startFrame === undefined || endFrame === undefined) return null;
	return {
		id: value.id,
		startFrame: Math.max(0, startFrame),
		endFrame: Math.max(1, endFrame),
		text: value.text
	};
}

function convertCaptionSource(
	value: FreeCutCaptionSource | undefined,
	fallbackClipId: string,
	fallbackMediaId?: string
): CaptionSource | undefined {
	if (!value) return undefined;
	const identity = {
		clipId: value.clipId ?? fallbackClipId,
		mediaId: value.mediaId ?? fallbackMediaId ?? '',
		...(value.importedAt !== undefined && { importedAt: value.importedAt })
	};
	if (value.type === 'embedded-subtitles') {
		return {
			type: value.type,
			...identity,
			trackNumber: value.trackNumber ?? 0,
			language: value.language ?? 'und',
			...(value.trackName !== undefined && { trackName: value.trackName }),
			codecId: value.codecId ?? ''
		};
	}
	if (value.type === 'subtitle-import') {
		return {
			type: value.type,
			...identity,
			...(value.fileName !== undefined && { fileName: value.fileName }),
			...(value.format !== undefined && { format: value.format })
		};
	}
	return {
		type: value.type,
		...identity,
		...(value.sourceStartSeconds !== undefined && {
			sourceStartSeconds: value.sourceStartSeconds
		}),
		...(value.sourceEndSeconds !== undefined && { sourceEndSeconds: value.sourceEndSeconds }),
		...(value.playbackSpeed !== undefined && { playbackSpeed: value.playbackSpeed }),
		...(value.isReversed !== undefined && { isReversed: value.isReversed })
	};
}

function mapScalarProperty(property: string): string[] {
	if (property === 'textPadding') return ['paddingX', 'paddingY'];
	if (property === 'backgroundRadius') return ['borderRadius'];
	return [property];
}

function convertKeyframeTrack(
	property: string,
	value: z.infer<typeof scalarPropertySchema>
): KeyframeTrack {
	const convertValue = property === 'volume' ? freeCutDbToGain : (key: number | undefined) => key;
	return {
		frames: value.keyframes.map((keyframe) => keyframe.frame ?? 0),
		values: value.keyframes.map((keyframe) => convertValue(keyframe.value) ?? 0),
		ids: value.keyframes.map((keyframe, index) => keyframe.id ?? `${property}-${index}`),
		easings: value.keyframes.map((keyframe) => keyframe.easing ?? 'linear'),
		easingConfigs: value.keyframes.map((keyframe) => keyframe.easingConfig ?? null),
		sources: value.keyframes.map((keyframe) => keyframe.source ?? null)
	};
}

function convertItemAnimation(item: TimelineItem, value: ItemAnimation | undefined): TimelineItem {
	if (!value) return item;
	const importedScalar = Object.fromEntries(
		value.properties.flatMap((propertyGroup) =>
			mapScalarProperty(propertyGroup.property).map((property) => [
				property,
				convertKeyframeTrack(propertyGroup.property, propertyGroup)
			])
		)
	);
	const scalar: ItemKeyframes = { ...(item.keyframes ?? {}), ...importedScalar };
	const importedVectors = Object.fromEntries(
		value.vectorProperties.map((propertyGroup) => [
			propertyGroup.property,
			propertyGroup.keyframes.map((keyframe, index) => ({
				...keyframe,
				id: keyframe.id ?? `${propertyGroup.property}-${index}`,
				frame: keyframe.frame ?? 0,
				value: keyframe.value ?? { x: 0, y: 0 },
				easing: keyframe.easing ?? 'linear'
			}))
		])
	);
	const vectors: ItemVectorKeyframes = { ...(item.vectorKeyframes ?? {}), ...importedVectors };
	return {
		...item,
		...(Object.keys(scalar).length > 0 && { keyframes: scalar }),
		...(Object.keys(vectors).length > 0 && { vectorKeyframes: vectors }),
		...(value.animationVersion === 2 && { animationVersion: 2 }),
		...(value.separatedVectorProperties !== undefined && {
			separatedVectorProperties: value.separatedVectorProperties
		}),
		...(value.propertyLinks !== undefined && { propertyLinks: value.propertyLinks }),
		...(value.expressions !== undefined && { expressions: value.expressions })
	};
}

function convertItem(value: FreeCutItem, fps: number): TimelineItem {
	const volume = freeCutDbToGain(value.volume);
	const effects = value.effects?.map(convertEffect).filter((effect) => effect !== null);
	const source = convertCaptionSource(value.captionSource ?? value.source, value.id, value.mediaId);
	const cues = value.cues?.map((cue) => convertSubtitleCue(cue, fps)).filter((cue) => cue !== null);
	return {
		...value,
		...(volume !== undefined && { volume }),
		...(value.type === 'shape' && {
			shapeCornerRadius: value.shapeCornerRadius ?? value.cornerRadius,
			shapeDirection: value.shapeDirection ?? value.direction,
			shapePoints: value.shapePoints ?? value.points,
			shapeInnerRadius: value.shapeInnerRadius ?? value.innerRadius
		}),
		...(value.type === 'lottie' && {
			lottieFrameRate: value.lottieFrameRate ?? value.frameRate,
			lottieTotalFrames: value.lottieTotalFrames ?? value.totalFrames,
			lottieLoop: value.lottieLoop ?? value.loop,
			lottieReversed: value.lottieReversed ?? value.reversed,
			lottieLoopMode: value.lottieLoopMode ?? value.loopMode,
			lottieSegmentStart: value.lottieSegmentStart ?? value.segmentStart,
			lottieSegmentEnd: value.lottieSegmentEnd ?? value.segmentEnd,
			lottieAnimationId: value.lottieAnimationId ?? value.animationId,
			lottieThemeId: value.lottieThemeId ?? value.themeId,
			lottieTextOverrides: value.lottieTextOverrides ?? value.textOverrides,
			lottieColorOverrides: value.lottieColorOverrides ?? value.colorOverrides,
			lottieSlotOverrides: value.lottieSlotOverrides ?? value.slotOverrides
		}),
		...(source !== undefined && { captionSource: source }),
		...(cues !== undefined && { cues }),
		...(effects !== undefined && { effects })
	};
}

function convertTransition(value: FreeCutTransition): TimelineTransition | null {
	const fromItemId = value.fromItemId ?? value.leftClipId;
	const toItemId = value.toItemId ?? value.rightClipId;
	if (!fromItemId || !toItemId) return null;
	return { ...value, fromItemId, toItemId };
}

function animationByItemId(value: ItemAnimation[] | undefined): Map<string, ItemAnimation> {
	return new Map((value ?? []).map((entry) => [entry.itemId, entry]));
}

function convertComposition(value: FreeCutComposition, projectFps: number): SubComposition {
	const fps = value.fps ?? projectFps;
	const keyframes = animationByItemId(value.keyframes);
	return {
		...value,
		items: value.items.map((item) => {
			const converted = convertItem(item, fps);
			return convertItemAnimation(converted, keyframes.get(converted.id));
		}),
		tracks: value.tracks.map(convertTrack),
		transitions: value.transitions
			.map(convertTransition)
			.filter((transition) => transition !== null),
		fps
	};
}

function convertTimeline(value: FreeCutTimeline, fps: number): ProjectTimeline {
	const keyframes = animationByItemId(value.keyframes);
	const masterVolumeDb = value.masterVolumeDb ?? value.masterBusDb;
	return {
		...value,
		tracks: value.tracks.map(convertTrack),
		items: value.items.map((item) => {
			const converted = convertItem(item, fps);
			return convertItemAnimation(converted, keyframes.get(converted.id));
		}),
		transitions: value.transitions
			.map(convertTransition)
			.filter((transition) => transition !== null),
		compositions: value.compositions.map((composition) => convertComposition(composition, fps)),
		...(masterVolumeDb !== undefined && { masterVolumeDb })
	};
}

export function convertFreeCutProjectDocument(project: Project, schemaVersion: number): Project {
	const timeline = freeCutTimelineSchema.safeParse(project.timeline);
	if (!timeline.success) return { ...project, schemaVersion, schemaFamily: 'openpost' };
	return {
		...project,
		schemaVersion,
		schemaFamily: 'openpost',
		timeline: convertTimeline(timeline.data, project.metadata.fps)
	};
}
