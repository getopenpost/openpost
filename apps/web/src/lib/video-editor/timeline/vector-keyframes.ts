/** Coupled vector-keyframe promotion and interpolation. */
import type {
	EasingConfig,
	EasingType,
	ItemKeyframes,
	ItemVectorKeyframes,
	KeyframeTrack,
	SpatialBezierTangents,
	TimelineItem,
	Vector2,
	VectorKeyframe,
	VectorKeyframeProperty
} from '$lib/video-editor/project/types';
import { applyEasing, applyEasingConfig } from './easing';

export interface PositionPromotion {
	position: VectorKeyframe[];
	keyframes: ItemKeyframes | undefined;
	identityRemap: ReadonlyMap<string, string>;
}

export interface VectorPromotion {
	property: VectorKeyframeProperty;
	keyframes: VectorKeyframe[];
	scalarKeyframes: ItemKeyframes | undefined;
	identityRemap: ReadonlyMap<string, string>;
}

export const VECTOR_COMPONENTS = {
	position: ['x', 'y'],
	scale: ['width', 'height'],
	anchor: ['anchorX', 'anchorY']
} as const satisfies Record<
	VectorKeyframeProperty,
	readonly [keyof ItemKeyframes, keyof ItemKeyframes]
>;

export function vectorPropertyForComponent(
	property: keyof ItemKeyframes
): { property: VectorKeyframeProperty; axis: 'x' | 'y' } | null {
	for (const vectorProperty of ['position', 'scale', 'anchor'] as const) {
		const [xProperty, yProperty] = VECTOR_COMPONENTS[vectorProperty];
		if (property === xProperty) return { property: vectorProperty, axis: 'x' };
		if (property === yProperty) return { property: vectorProperty, axis: 'y' };
	}
	return null;
}

export function activeVectorKeyframes(
	item: TimelineItem,
	property: VectorKeyframeProperty
): readonly VectorKeyframe[] | undefined {
	if (item.separatedVectorProperties?.includes(property)) return undefined;
	const keyframes = item.vectorKeyframes?.[property];
	return keyframes && keyframes.length > 0 ? keyframes : undefined;
}

export function activePositionKeyframes(item: TimelineItem): readonly VectorKeyframe[] | undefined {
	return activeVectorKeyframes(item, 'position');
}

export function vectorKeyframeByFrame(
	item: TimelineItem,
	property: VectorKeyframeProperty,
	relativeFrame: number
): VectorKeyframe | undefined {
	return activeVectorKeyframes(item, property)?.find(
		(keyframe) => keyframe.frame === relativeFrame
	);
}

export function positionKeyframeByFrame(
	item: TimelineItem,
	relativeFrame: number
): VectorKeyframe | undefined {
	return vectorKeyframeByFrame(item, 'position', relativeFrame);
}

export function promoteVectorKeyframes(
	item: TimelineItem,
	property: VectorKeyframeProperty,
	includeFrame?: number
): VectorPromotion | null {
	const active = activeVectorKeyframes(item, property);
	if (active) {
		return {
			property,
			keyframes: active.map(cloneVectorKeyframe),
			scalarKeyframes: withoutVectorScalarTracks(item.keyframes, property),
			identityRemap: new Map()
		};
	}
	const [xProperty, yProperty] = VECTOR_COMPONENTS[property];
	const xTrack = item.keyframes?.[xProperty];
	const yTrack = item.keyframes?.[yProperty];
	const frames = new Set<number>([...(xTrack?.frames ?? []), ...(yTrack?.frames ?? [])]);
	if (includeFrame !== undefined) frames.add(Math.max(0, Math.round(includeFrame)));
	if (frames.size === 0) return null;
	const identityRemap = new Map<string, string>();
	const keyframes = [...frames]
		.filter((frame) => Number.isInteger(frame) && frame >= 0 && frame < item.durationInFrames)
		.toSorted((left, right) => left - right)
		.map((frame) => {
			const style = segmentStyleAt(xTrack, frame) ?? segmentStyleAt(yTrack, frame);
			const xSource = sourceAtFrame(xTrack, frame);
			const ySource = sourceAtFrame(yTrack, frame);
			const source =
				xSource?.applicationId === ySource?.applicationId ? (xSource ?? ySource) : undefined;
			const id = crypto.randomUUID();
			const xIndex = xTrack?.frames.indexOf(frame) ?? -1;
			const yIndex = yTrack?.frames.indexOf(frame) ?? -1;
			if (xIndex >= 0) {
				identityRemap.set(xTrack?.ids?.[xIndex] ?? `legacy:${xProperty}:${frame}:${xIndex}`, id);
			}
			if (yIndex >= 0) {
				identityRemap.set(
					yTrack?.ids?.[yIndex] ?? `legacy:${yProperty}:${frame}:${yIndex}`,
					`${id}:y`
				);
			}
			return {
				id,
				frame,
				value: {
					x: scalarToVectorComponent(
						item,
						property,
						'x',
						interpolateScalarTrack(xTrack, frame, scalarBaseValue(item, xProperty))
					),
					y: scalarToVectorComponent(
						item,
						property,
						'y',
						interpolateScalarTrack(yTrack, frame, scalarBaseValue(item, yProperty))
					)
				},
				easing: style?.easing ?? 'linear',
				...(source && { source }),
				...(style?.easingConfig && { easingConfig: cloneEasingConfig(style.easingConfig) })
			};
		});
	return keyframes.length > 0
		? {
				property,
				keyframes,
				scalarKeyframes: withoutVectorScalarTracks(item.keyframes, property),
				identityRemap
			}
		: null;
}

/**
 * Promote legacy scalar X/Y tracks to one position lane. The union of both
 * frame sets preserves every keyed value. X owns temporal easing when both
 * axes have different outgoing easing, matching FreeCut's promotion rule.
 */
export function promotePositionKeyframes(
	item: TimelineItem,
	includeFrame?: number
): PositionPromotion | null {
	const promoted = promoteVectorKeyframes(item, 'position', includeFrame);
	return promoted
		? {
				position: promoted.keyframes,
				keyframes: promoted.scalarKeyframes,
				identityRemap: promoted.identityRemap
			}
		: null;
}

export function interpolateVector(
	keyframes: readonly VectorKeyframe[],
	frame: number
): Vector2 | null {
	if (keyframes.length === 0) return null;
	if (keyframes.length === 1 || frame <= (keyframes[0]?.frame ?? 0)) {
		return cloneVector(keyframes[0]?.value ?? { x: 0, y: 0 });
	}
	const last = keyframes.length - 1;
	if (frame >= (keyframes[last]?.frame ?? 0)) {
		return cloneVector(keyframes[last]?.value ?? { x: 0, y: 0 });
	}
	for (let index = 1; index <= last; index += 1) {
		const end = keyframes[index];
		const start = keyframes[index - 1];
		if (!start || !end || frame > end.frame) continue;
		const progress = (frame - start.frame) / Math.max(1, end.frame - start.frame);
		const eased = start.easingConfig
			? applyEasingConfig(progress, start.easingConfig)
			: applyEasing(progress, start.easing);
		return interpolatePositionSegment(start, end, eased);
	}
	return cloneVector(keyframes[last]?.value ?? { x: 0, y: 0 });
}

export function interpolatePosition(
	keyframes: readonly VectorKeyframe[],
	frame: number
): Vector2 | null {
	return interpolateVector(keyframes, frame);
}

export function interpolatePositionSegment(
	start: Pick<VectorKeyframe, 'value' | 'spatial'>,
	end: Pick<VectorKeyframe, 'value' | 'spatial'>,
	progress: number
): Vector2 {
	const t = Number.isFinite(progress) ? progress : 0;
	const out = start.spatial?.outTangent;
	const incoming = end.spatial?.inTangent;
	if (!out && !incoming) {
		return {
			x: start.value.x + t * (end.value.x - start.value.x),
			y: start.value.y + t * (end.value.y - start.value.y)
		};
	}
	const control1 = add(start.value, out ?? { x: 0, y: 0 });
	const control2 = add(end.value, incoming ?? { x: 0, y: 0 });
	return cubicBezier(start.value, control1, control2, end.value, t);
}

/** Build FreeCut-style smooth default handles for one position keyframe. */
export function defaultSpatialTangents(
	keyframes: readonly VectorKeyframe[],
	index: number
): SpatialBezierTangents | null {
	const current = keyframes[index];
	if (!current || keyframes.length < 2) return null;
	const previous = keyframes[index - 1];
	const next = keyframes[index + 1];
	let outTangent: Vector2;
	if (!previous && next) {
		outTangent = scale(subtract(next.value, current.value), 1 / 3);
	} else if (previous && !next) {
		outTangent = scale(subtract(current.value, previous.value), 1 / 3);
	} else if (previous && next) {
		outTangent = scale(subtract(next.value, previous.value), 1 / 6);
	} else {
		return null;
	}
	return {
		inTangent: scale(outTangent, -1),
		outTangent,
		continuous: true
	};
}

export function withSpatialTangent(
	spatial: SpatialBezierTangents,
	handle: 'in' | 'out',
	tangent: Vector2
): SpatialBezierTangents {
	if (!spatial.continuous) {
		return {
			...spatial,
			[handle === 'in' ? 'inTangent' : 'outTangent']: cloneVector(tangent)
		};
	}
	return handle === 'in'
		? { ...spatial, inTangent: cloneVector(tangent), outTangent: scale(tangent, -1) }
		: { ...spatial, outTangent: cloneVector(tangent), inTangent: scale(tangent, -1) };
}

export function upsertPositionKeyframe(
	keyframes: readonly VectorKeyframe[],
	frame: number,
	value: Vector2
): VectorKeyframe[] {
	const next = keyframes.map(cloneVectorKeyframe);
	const index = next.findIndex((keyframe) => keyframe.frame === frame);
	if (index >= 0) {
		const current = next[index];
		if (current) next[index] = { ...current, value: cloneVector(value) };
		return next;
	}
	next.push({ id: crypto.randomUUID(), frame, value: cloneVector(value), easing: 'linear' });
	return next.toSorted((left, right) => left.frame - right.frame);
}

export function upsertVectorKeyframe(
	keyframes: readonly VectorKeyframe[],
	frame: number,
	value: Vector2
): VectorKeyframe[] {
	return upsertPositionKeyframe(keyframes, frame, value);
}

export function vectorPropertyKeyframesPatch(
	item: TimelineItem,
	property: VectorKeyframeProperty,
	keyframes: readonly VectorKeyframe[]
): Pick<
	TimelineItem,
	'keyframes' | 'vectorKeyframes' | 'animationVersion' | 'separatedVectorProperties'
> {
	const vectorKeyframes: ItemVectorKeyframes = { ...item.vectorKeyframes };
	if (keyframes.length > 0) vectorKeyframes[property] = keyframes.map(cloneVectorKeyframe);
	else delete vectorKeyframes[property];
	return {
		keyframes: withoutVectorScalarTracks(item.keyframes, property),
		vectorKeyframes: Object.keys(vectorKeyframes).length > 0 ? vectorKeyframes : undefined,
		animationVersion: 2,
		separatedVectorProperties: item.separatedVectorProperties?.filter(
			(candidate) => candidate !== property
		)
	};
}

export function vectorKeyframesPatch(
	item: TimelineItem,
	position: readonly VectorKeyframe[]
): Pick<
	TimelineItem,
	'keyframes' | 'vectorKeyframes' | 'animationVersion' | 'separatedVectorProperties'
> {
	return vectorPropertyKeyframesPatch(item, 'position', position);
}

export function scaleItemVectorKeyframes(
	vectorKeyframes: ItemVectorKeyframes | undefined,
	oldDuration: number,
	newDuration: number
): ItemVectorKeyframes | undefined {
	if (!vectorKeyframes || oldDuration <= 0 || newDuration <= 0 || oldDuration === newDuration)
		return vectorKeyframes;
	const scaleFactor = newDuration / oldDuration;
	const maxFrame = newDuration - 1;
	const scaled: ItemVectorKeyframes = {};
	for (const property of ['position', 'scale', 'anchor'] as const) {
		const source = vectorKeyframes[property];
		if (!source) continue;
		const byFrame = new Map<number, VectorKeyframe>();
		for (const keyframe of source) {
			const frame = Math.max(0, Math.min(maxFrame, Math.round(keyframe.frame * scaleFactor)));
			byFrame.set(frame, { ...cloneVectorKeyframe(keyframe), frame });
		}
		scaled[property] = [...byFrame.values()].toSorted((left, right) => left.frame - right.frame);
	}
	return scaled;
}

export function cloneVectorKeyframe(keyframe: VectorKeyframe): VectorKeyframe {
	return {
		...keyframe,
		value: cloneVector(keyframe.value),
		...(keyframe.easingConfig && { easingConfig: cloneEasingConfig(keyframe.easingConfig) }),
		...(keyframe.spatial && {
			spatial: {
				...keyframe.spatial,
				inTangent: cloneVector(keyframe.spatial.inTangent),
				outTangent: cloneVector(keyframe.spatial.outTangent)
			}
		})
	};
}

function withoutVectorScalarTracks(
	keyframes: ItemKeyframes | undefined,
	property: VectorKeyframeProperty
): ItemKeyframes | undefined {
	const [xProperty, yProperty] = VECTOR_COMPONENTS[property];
	if (!keyframes?.[xProperty] && !keyframes?.[yProperty]) return keyframes;
	const next = { ...keyframes };
	delete next[xProperty];
	delete next[yProperty];
	return Object.keys(next).length > 0 ? next : undefined;
}

export function scalarToVectorComponent(
	item: TimelineItem,
	property: VectorKeyframeProperty,
	axis: 'x' | 'y',
	value: number
): number {
	if (property !== 'scale') return value;
	const base = axis === 'x' ? baseWidth(item) : baseHeight(item);
	return Math.abs(base) <= Number.EPSILON ? 100 : (value / base) * 100;
}

export function vectorToScalarComponent(
	item: TimelineItem,
	property: VectorKeyframeProperty,
	axis: 'x' | 'y',
	value: number
): number {
	if (property !== 'scale') return value;
	const base = axis === 'x' ? baseWidth(item) : baseHeight(item);
	return (base * value) / 100;
}

export function baseVectorValue(item: TimelineItem, property: VectorKeyframeProperty): Vector2 {
	if (property === 'position') return { x: item.transform?.x ?? 0, y: item.transform?.y ?? 0 };
	if (property === 'scale') return { x: 100, y: 100 };
	return {
		x: item.transform?.anchorX ?? baseWidth(item) / 2,
		y: item.transform?.anchorY ?? baseHeight(item) / 2
	};
}

function scalarBaseValue(item: TimelineItem, property: keyof ItemKeyframes): number {
	if (property === 'width') return baseWidth(item);
	if (property === 'height') return baseHeight(item);
	if (property === 'anchorX') return item.transform?.anchorX ?? baseWidth(item) / 2;
	if (property === 'anchorY') return item.transform?.anchorY ?? baseHeight(item) / 2;
	if (property === 'x') return item.transform?.x ?? 0;
	if (property === 'y') return item.transform?.y ?? 0;
	return 0;
}

function baseWidth(item: TimelineItem): number {
	return item.transform?.width ?? item.sourceWidth ?? 1;
}

function baseHeight(item: TimelineItem): number {
	return item.transform?.height ?? item.sourceHeight ?? 1;
}

function interpolateScalarTrack(
	track: KeyframeTrack | undefined,
	frame: number,
	fallback: number
): number {
	if (!track || track.frames.length === 0) return fallback;
	if (track.frames.length === 1 || frame <= (track.frames[0] ?? 0)) {
		return track.values[0] ?? fallback;
	}
	const last = track.frames.length - 1;
	if (frame >= (track.frames[last] ?? 0)) return track.values[last] ?? fallback;
	for (let index = 1; index <= last; index += 1) {
		const endFrame = track.frames[index] ?? 0;
		if (frame > endFrame) continue;
		const startFrame = track.frames[index - 1] ?? 0;
		const progress = (frame - startFrame) / Math.max(1, endFrame - startFrame);
		const config = track.easingConfigs?.[index - 1] ?? undefined;
		const eased = config
			? applyEasingConfig(progress, config)
			: applyEasing(progress, track.easings?.[index - 1] ?? 'linear');
		const start = track.values[index - 1] ?? fallback;
		const end = track.values[index] ?? start;
		return start + eased * (end - start);
	}
	return track.values[last] ?? fallback;
}

function segmentStyleAt(
	track: KeyframeTrack | undefined,
	frame: number
): { easing: EasingType; easingConfig?: EasingConfig } | null {
	if (!track || track.frames.length === 0) return null;
	let index = 0;
	for (let candidate = 0; candidate < track.frames.length; candidate += 1) {
		if ((track.frames[candidate] ?? 0) > frame) break;
		index = candidate;
	}
	const easing = track.easings?.[index] ?? 'linear';
	const easingConfig = track.easingConfigs?.[index] ?? undefined;
	return { easing, ...(easingConfig && { easingConfig }) };
}

function sourceAtFrame(track: KeyframeTrack | undefined, frame: number) {
	const index = track?.frames.indexOf(frame) ?? -1;
	return index >= 0 ? (track?.sources?.[index] ?? undefined) : undefined;
}

function cubicBezier(p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2, t: number): Vector2 {
	const inverse = 1 - t;
	const a = inverse * inverse * inverse;
	const b = 3 * inverse * inverse * t;
	const c = 3 * inverse * t * t;
	const d = t * t * t;
	return {
		x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
		y: a * p0.y + b * p1.y + c * p2.y + d * p3.y
	};
}

function add(left: Vector2, right: Vector2): Vector2 {
	return { x: left.x + right.x, y: left.y + right.y };
}

function subtract(left: Vector2, right: Vector2): Vector2 {
	return { x: left.x - right.x, y: left.y - right.y };
}

function scale(value: Vector2, factor: number): Vector2 {
	const x = value.x * factor;
	const y = value.y * factor;
	return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}

function cloneVector(value: Vector2): Vector2 {
	return { x: value.x, y: value.y };
}

function cloneEasingConfig(config: EasingConfig): EasingConfig {
	return {
		...config,
		...(config.bezier && { bezier: { ...config.bezier } }),
		...(config.spring && { spring: { ...config.spring } })
	};
}
