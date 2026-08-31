/** Pure geometry for crop, anchor, and position-path editing in the preview. */
import type {
	CropSettings,
	ItemKeyframes,
	ItemTransform,
	KeyframeProperty,
	SpatialBezierTangents,
	TimelineItem
} from '$lib/video-editor/project/types';
import { applyEasing, applyEasingConfig } from '$lib/video-editor/timeline/easing';
import {
	resolveAnimatedItemAt,
	type AnimatedItemMotionContext
} from '$lib/video-editor/timeline/animated-properties';
import {
	activePositionKeyframes,
	interpolatePosition,
	upsertPositionKeyframe,
	vectorKeyframesPatch
} from '$lib/video-editor/timeline/vector-keyframes';

export type CropEdge = 'left' | 'right' | 'top' | 'bottom';
export type TransformHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Exact set of numeric properties the direct canvas tools can commit. */
export interface CanvasAnimatedValues {
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	anchorX?: number;
	anchorY?: number;
	rotation?: number;
	opacity?: number;
	cornerRadius?: number;
	cropLeft?: number;
	cropRight?: number;
	cropTop?: number;
	cropBottom?: number;
	cropSoftness?: number;
}

export const CROP_EDGE_PROPERTY = {
	left: 'cropLeft',
	right: 'cropRight',
	top: 'cropTop',
	bottom: 'cropBottom'
} satisfies Record<CropEdge, KeyframeProperty>;

export interface Point {
	x: number;
	y: number;
}

export interface MotionPathPoint extends Point {
	frame: number;
	isKeyframe: boolean;
	vectorId?: string;
	spatial?: SpatialBezierTangents;
	inHandle?: Point;
	outHandle?: Point;
}

const MIN_VISIBLE_RATIO = 0.001;
export const MIN_TRANSFORM_SIZE = 20;

export function resolveCrop(crop: CropSettings | undefined): CropSettings {
	return {
		top: crop?.top ?? 0,
		right: crop?.right ?? 0,
		bottom: crop?.bottom ?? 0,
		left: crop?.left ?? 0,
		...(crop?.softness !== undefined && { softness: crop.softness })
	};
}

/**
 * Resolve a crop drag in item-local coordinates. Crop is stored as a source
 * ratio, while pointer positions arrive in canvas pixels.
 */
export function calculateCropFromDrag({
	edge,
	startCrop,
	startPoint,
	currentPoint,
	rotation,
	mediaWidth,
	mediaHeight,
	sourceDimension
}: {
	edge: CropEdge;
	startCrop: CropSettings | undefined;
	startPoint: Point;
	currentPoint: Point;
	rotation: number;
	mediaWidth: number;
	mediaHeight: number;
	sourceDimension: number;
}): CropSettings {
	const crop = resolveCrop(startCrop);
	const radians = (rotation * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const worldDeltaX = currentPoint.x - startPoint.x;
	const worldDeltaY = currentPoint.y - startPoint.y;
	const localDeltaX = worldDeltaX * cos + worldDeltaY * sin;
	const localDeltaY = -worldDeltaX * sin + worldDeltaY * cos;
	const horizontal = edge === 'left' || edge === 'right';
	const dimension = horizontal ? mediaWidth : mediaHeight;
	if (dimension <= 0 || sourceDimension <= 0 || !Number.isFinite(dimension)) return crop;

	const opposite =
		edge === 'left'
			? crop.right
			: edge === 'right'
				? crop.left
				: edge === 'top'
					? crop.bottom
					: crop.top;
	const signedDelta =
		edge === 'left'
			? localDeltaX
			: edge === 'right'
				? -localDeltaX
				: edge === 'top'
					? localDeltaY
					: -localDeltaY;
	const startInset = crop[edge] * dimension;
	const maxInset = Math.max(0, (1 - opposite - MIN_VISIBLE_RATIO) * dimension);
	const nextInset = Math.min(maxInset, Math.max(0, startInset + signedDelta));
	const requestedSourcePixels = Math.round((nextInset / dimension) * sourceDimension);
	const maxSourcePixels = Math.max(0, Math.floor((1 - opposite) * sourceDimension) - 1);
	const nextSourcePixels = Math.min(maxSourcePixels, Math.max(0, requestedSourcePixels));
	return { ...crop, [edge]: nextSourcePixels / sourceDimension };
}

function rotateVector(point: Point, angleDegrees: number): Point {
	const radians = (angleDegrees * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	return {
		x: point.x * cos - point.y * sin,
		y: point.x * sin + point.y * cos
	};
}

export function transformHandlePoint({
	transform,
	handle,
	canvasWidth,
	canvasHeight
}: {
	transform: Required<Pick<ItemTransform, 'x' | 'y' | 'width' | 'height' | 'rotation'>> &
		ItemTransform;
	handle: TransformHandle;
	canvasWidth: number;
	canvasHeight: number;
}): Point {
	const anchorX = transform.anchorX ?? transform.width / 2;
	const anchorY = transform.anchorY ?? transform.height / 2;
	const local = {
		x: handle.includes('w')
			? -anchorX
			: handle.includes('e')
				? transform.width - anchorX
				: transform.width / 2 - anchorX,
		y: handle.includes('n')
			? -anchorY
			: handle.includes('s')
				? transform.height - anchorY
				: transform.height / 2 - anchorY
	};
	const rotated = rotateVector(local, transform.rotation);
	return {
		x: canvasWidth / 2 + transform.x + rotated.x,
		y: canvasHeight / 2 + transform.y + rotated.y
	};
}

/**
 * Resize in item-local space. FreeCut scales from the transform origin by
 * default and keeps the opposite edge or corner fixed while Control is held.
 */
export function calculateTransformResize({
	startTransform,
	handle,
	startPoint,
	currentPoint,
	maintainAspectRatio,
	oppositeAnchored,
	canvasWidth,
	canvasHeight
}: {
	startTransform: Required<Pick<ItemTransform, 'x' | 'y' | 'width' | 'height' | 'rotation'>> &
		ItemTransform;
	handle: TransformHandle;
	startPoint: Point;
	currentPoint: Point;
	maintainAspectRatio: boolean;
	oppositeAnchored: boolean;
	canvasWidth: number;
	canvasHeight: number;
}): ItemTransform {
	const origin = {
		x: canvasWidth / 2 + startTransform.x,
		y: canvasHeight / 2 + startTransform.y
	};
	const localStart = rotateVector(
		{ x: startPoint.x - origin.x, y: startPoint.y - origin.y },
		-startTransform.rotation
	);
	const localCurrent = rotateVector(
		{ x: currentPoint.x - origin.x, y: currentPoint.y - origin.y },
		-startTransform.rotation
	);
	const affectsLeft = handle.includes('w');
	const affectsRight = handle.includes('e');
	const affectsTop = handle.includes('n');
	const affectsBottom = handle.includes('s');
	const corner = (affectsLeft || affectsRight) && (affectsTop || affectsBottom);
	const aspect = startTransform.width / Math.max(MIN_TRANSFORM_SIZE, startTransform.height);
	let newWidth = startTransform.width;
	let newHeight = startTransform.height;

	if (maintainAspectRatio && corner) {
		const reference = oppositeAnchored
			? oppositeLocalPoint(startTransform, handle)
			: { x: 0, y: 0 };
		const startDistance = Math.hypot(localStart.x - reference.x, localStart.y - reference.y);
		const currentDistance = Math.hypot(localCurrent.x - reference.x, localCurrent.y - reference.y);
		const requestedScale = startDistance > 0 ? currentDistance / startDistance : 1;
		const minimumScale = Math.max(
			MIN_TRANSFORM_SIZE / startTransform.width,
			MIN_TRANSFORM_SIZE / startTransform.height
		);
		const scale = Math.max(minimumScale, requestedScale);
		newWidth = startTransform.width * scale;
		newHeight = startTransform.height * scale;
	} else {
		const multiplier = oppositeAnchored ? 1 : 2;
		const dx = localCurrent.x - localStart.x;
		const dy = localCurrent.y - localStart.y;
		if (affectsRight) newWidth += dx * multiplier;
		else if (affectsLeft) newWidth -= dx * multiplier;
		if (affectsBottom) newHeight += dy * multiplier;
		else if (affectsTop) newHeight -= dy * multiplier;

		if (maintainAspectRatio) {
			const horizontalEdge = (affectsLeft || affectsRight) && !affectsTop && !affectsBottom;
			if (horizontalEdge) newHeight = newWidth / aspect;
			else newWidth = newHeight * aspect;
			const minimumScale = Math.max(
				MIN_TRANSFORM_SIZE / startTransform.width,
				MIN_TRANSFORM_SIZE / startTransform.height
			);
			const scale = Math.max(
				minimumScale,
				Math.min(newWidth / startTransform.width, newHeight / startTransform.height)
			);
			newWidth = startTransform.width * scale;
			newHeight = startTransform.height * scale;
		} else {
			newWidth = Math.max(MIN_TRANSFORM_SIZE, newWidth);
			newHeight = Math.max(MIN_TRANSFORM_SIZE, newHeight);
		}
	}

	let x = startTransform.x;
	let y = startTransform.y;
	if (oppositeAnchored) {
		const startOpposite = oppositeLocalPoint(startTransform, handle);
		const nextTransform = { ...startTransform, width: newWidth, height: newHeight };
		const nextOpposite = oppositeLocalPoint(nextTransform, handle);
		const compensation = rotateVector(
			{
				x: startOpposite.x - nextOpposite.x,
				y: startOpposite.y - nextOpposite.y
			},
			startTransform.rotation
		);
		x += compensation.x;
		y += compensation.y;
	}

	return { ...startTransform, x, y, width: newWidth, height: newHeight };
}

export function calculateTransformRotation({
	startTransform,
	startPoint,
	currentPoint,
	canvasWidth,
	canvasHeight,
	snap = true
}: {
	startTransform: Required<Pick<ItemTransform, 'x' | 'y' | 'width' | 'height' | 'rotation'>> &
		ItemTransform;
	startPoint: Point;
	currentPoint: Point;
	canvasWidth: number;
	canvasHeight: number;
	snap?: boolean;
}): ItemTransform {
	const origin = {
		x: canvasWidth / 2 + startTransform.x,
		y: canvasHeight / 2 + startTransform.y
	};
	const startAngle = Math.atan2(startPoint.y - origin.y, startPoint.x - origin.x);
	const currentAngle = Math.atan2(currentPoint.y - origin.y, currentPoint.x - origin.x);
	let rotation = normalizeAngle(
		startTransform.rotation + ((currentAngle - startAngle) * 180) / Math.PI
	);
	if (snap) rotation = normalizeAngle(Math.round(rotation / 15) * 15);
	return { ...startTransform, rotation };
}

export function transformHandleCursor(handle: TransformHandle, rotation: number): string {
	const baseAngle = {
		e: 0,
		se: 45,
		s: 90,
		sw: 135,
		w: 180,
		nw: 225,
		n: 270,
		ne: 315
	}[handle];
	const index = Math.round(((((baseAngle + rotation) % 360) + 360) % 360) / 45) % 4;
	return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][index] ?? 'default';
}

function oppositeLocalPoint(
	transform: Required<Pick<ItemTransform, 'width' | 'height'>> & ItemTransform,
	handle: TransformHandle
): Point {
	const anchorX = transform.anchorX ?? transform.width / 2;
	const anchorY = transform.anchorY ?? transform.height / 2;
	return {
		x: handle.includes('e')
			? -anchorX
			: handle.includes('w')
				? transform.width - anchorX
				: transform.width / 2 - anchorX,
		y: handle.includes('s')
			? -anchorY
			: handle.includes('n')
				? transform.height - anchorY
				: transform.height / 2 - anchorY
	};
}

function normalizeAngle(angle: number): number {
	let normalized = angle;
	while (normalized > 180) normalized -= 360;
	while (normalized <= -180) normalized += 360;
	return normalized;
}

/** Move an anchor in local space while preserving the layer's visible pose. */
export function calculateAnchorDrag(
	startTransform: Required<Pick<ItemTransform, 'x' | 'y' | 'width' | 'height' | 'rotation'>> &
		ItemTransform,
	startPoint: Point,
	currentPoint: Point
): ItemTransform {
	const worldDelta = {
		x: currentPoint.x - startPoint.x,
		y: currentPoint.y - startPoint.y
	};
	const localDelta = rotateVector(worldDelta, -startTransform.rotation);
	return {
		...startTransform,
		x: startTransform.x + worldDelta.x - localDelta.x,
		y: startTransform.y + worldDelta.y - localDelta.y,
		anchorX: (startTransform.anchorX ?? startTransform.width / 2) + localDelta.x,
		anchorY: (startTransform.anchorY ?? startTransform.height / 2) + localDelta.y
	};
}

export function positionKeyframeFrames(item: TimelineItem): number[] {
	const vector = activePositionKeyframes(item);
	if (vector) {
		return vector
			.filter((keyframe) => keyframe.frame >= 0 && keyframe.frame < item.durationInFrames)
			.map((keyframe) => item.from + keyframe.frame);
	}
	const frames = new Set<number>();
	for (const property of ['x', 'y'] as const) {
		for (const frame of item.keyframes?.[property]?.frames ?? []) {
			if (frame >= 0 && frame < item.durationInFrames) frames.add(item.from + frame);
		}
	}
	return [...frames].sort((left, right) => left - right);
}

function evenFrames(start: number, end: number, maxSamples: number): number[] {
	const span = end - start;
	if (span <= 0) return [start];
	const count = Math.max(2, Math.min(maxSamples, span + 1));
	return Array.from({ length: count }, (_, index) =>
		Math.round(start + (span * index) / (count - 1))
	);
}

function trackValueAt(item: TimelineItem, property: 'x' | 'y', absoluteFrame: number): number {
	const vector = activePositionKeyframes(item);
	if (vector) {
		return (
			interpolatePosition(vector, absoluteFrame - item.from)?.[property] ??
			item.transform?.[property] ??
			0
		);
	}
	const track = item.keyframes?.[property];
	if (!track || track.frames.length === 0) return item.transform?.[property] ?? 0;
	const frame = absoluteFrame - item.from;
	if (frame <= (track.frames[0] ?? 0)) return track.values[0] ?? 0;
	const last = track.frames.length - 1;
	if (frame >= (track.frames[last] ?? 0)) return track.values[last] ?? 0;
	for (let index = 1; index <= last; index += 1) {
		const nextFrame = track.frames[index] ?? 0;
		if (frame > nextFrame) continue;
		const previousFrame = track.frames[index - 1] ?? 0;
		const progress = (frame - previousFrame) / Math.max(1, nextFrame - previousFrame);
		const config = track.easingConfigs?.[index - 1] ?? undefined;
		const eased = config
			? applyEasingConfig(progress, config)
			: applyEasing(progress, track.easings?.[index - 1] ?? 'linear');
		const start = track.values[index - 1] ?? 0;
		const end = track.values[index] ?? start;
		return start + eased * (end - start);
	}
	return track.values[last] ?? 0;
}

function upsertPreviewPosition(
	item: TimelineItem,
	preview: { frame: number; x: number; y: number } | undefined
): TimelineItem {
	if (!preview) return item;
	const relativeFrame = preview.frame - item.from;
	const vector = activePositionKeyframes(item);
	if (vector) {
		const position = upsertPositionKeyframe(vector, relativeFrame, {
			x: preview.x,
			y: preview.y
		});
		return { ...item, ...vectorKeyframesPatch(item, position) };
	}
	const keyframes: ItemKeyframes = { ...item.keyframes };
	const positionFrames = [
		...new Set([...(item.keyframes?.x?.frames ?? []), ...(item.keyframes?.y?.frames ?? [])])
	].sort((left, right) => left - right);
	const template = item.keyframes?.x ?? item.keyframes?.y;
	for (const property of ['x', 'y'] as const) {
		const source = item.keyframes?.[property] ?? {
			frames: positionFrames,
			values: positionFrames.map(() => item.transform?.[property] ?? 0),
			...(template?.easings && {
				easings: positionFrames.map((frame) => {
					const index = template.frames.indexOf(frame);
					return index >= 0 ? (template.easings?.[index] ?? 'linear') : 'linear';
				})
			}),
			...(template?.easingConfigs && {
				easingConfigs: positionFrames.map((frame) => {
					const index = template.frames.indexOf(frame);
					return index >= 0 ? (template.easingConfigs?.[index] ?? null) : null;
				})
			}),
			...(template?.sources && {
				sources: positionFrames.map((frame) => {
					const index = template.frames.indexOf(frame);
					return index >= 0 ? (template.sources?.[index] ?? null) : null;
				})
			})
		};
		const value = preview[property];
		const index = source.frames.indexOf(relativeFrame);
		if (index >= 0) {
			const values = [...source.values];
			values[index] = value;
			keyframes[property] = { ...source, values };
		} else {
			const entries = [
				...source.frames.map((frame, entryIndex) => ({
					frame,
					value: source.values[entryIndex] ?? 0,
					id: source.ids?.[entryIndex],
					easing: source.easings?.[entryIndex],
					config: source.easingConfigs?.[entryIndex],
					source: source.sources?.[entryIndex]
				})),
				{
					frame: relativeFrame,
					value,
					id: undefined,
					easing: undefined,
					config: undefined,
					source: null
				}
			].sort((left, right) => left.frame - right.frame);
			keyframes[property] = {
				frames: entries.map((entry) => entry.frame),
				values: entries.map((entry) => entry.value),
				...(source.ids && { ids: entries.map((entry) => entry.id ?? crypto.randomUUID()) }),
				...(source.easings && { easings: entries.map((entry) => entry.easing ?? 'linear') }),
				...(source.easingConfigs && {
					easingConfigs: entries.map((entry) => entry.config ?? null)
				}),
				...(source.sources && { sources: entries.map((entry) => entry.source ?? null) })
			};
		}
	}
	return { ...item, keyframes };
}

function applySpatialPreview(
	item: TimelineItem,
	preview: { frame: number; spatial: SpatialBezierTangents } | undefined
): TimelineItem {
	if (!preview) return item;
	const position = activePositionKeyframes(item)?.map((keyframe) => ({
		...keyframe,
		value: { ...keyframe.value },
		...(keyframe.spatial && {
			spatial: {
				...keyframe.spatial,
				inTangent: { ...keyframe.spatial.inTangent },
				outTangent: { ...keyframe.spatial.outTangent }
			}
		})
	}));
	if (!position) return item;
	const index = position.findIndex((keyframe) => item.from + keyframe.frame === preview.frame);
	const keyframe = position[index];
	if (!keyframe) return item;
	position[index] = {
		...keyframe,
		spatial: {
			...preview.spatial,
			inTangent: { ...preview.spatial.inTangent },
			outTangent: { ...preview.spatial.outTangent }
		}
	};
	return { ...item, ...vectorKeyframesPatch(item, position) };
}

function shiftPositionKeyframe(
	item: TimelineItem,
	absoluteFrame: number,
	delta: Point
): TimelineItem {
	const position = activePositionKeyframes(item);
	if (!position) return item;
	const index = position.findIndex((keyframe) => item.from + keyframe.frame === absoluteFrame);
	if (index < 0) return item;
	return {
		...item,
		...vectorKeyframesPatch(
			item,
			position.map((keyframe, keyframeIndex) =>
				keyframeIndex === index
					? {
							...keyframe,
							value: {
								x: keyframe.value.x + delta.x,
								y: keyframe.value.y + delta.y
							}
						}
					: keyframe
			)
		)
	};
}

/** Build a bounded sampled position path plus every editable X/Y keyframe. */
export function buildMotionPathPoints({
	item,
	canvasWidth,
	canvasHeight,
	maxSamples = 96,
	preview,
	spatialPreview,
	motionContext
}: {
	item: TimelineItem;
	canvasWidth: number;
	canvasHeight: number;
	maxSamples?: number;
	preview?: { frame: number; x: number; y: number };
	spatialPreview?: { frame: number; spatial: SpatialBezierTangents };
	motionContext?: AnimatedItemMotionContext;
}): MotionPathPoint[] {
	const keyframes = positionKeyframeFrames(item);
	if (keyframes.length === 0) return [];
	const end = item.from + Math.max(0, item.durationInFrames - 1);
	if (end <= item.from) return [];
	const previewed = applySpatialPreview(upsertPreviewPosition(item, preview), spatialPreview);
	const frames = new Set([...evenFrames(item.from, end, maxSamples), ...keyframes]);
	if (preview) frames.add(preview.frame);
	const keyframeSet = new Set(keyframes);
	const points = [...frames]
		.sort((left, right) => left - right)
		.map((frame): MotionPathPoint => {
			const vector = activePositionKeyframes(previewed)?.find(
				(keyframe) => previewed.from + keyframe.frame === frame
			);
			const resolved = motionContext
				? resolveAnimatedItemAt(previewed, frame, motionContext)
				: undefined;
			const x = canvasWidth / 2 + (resolved?.transform?.x ?? trackValueAt(previewed, 'x', frame));
			const y = canvasHeight / 2 + (resolved?.transform?.y ?? trackValueAt(previewed, 'y', frame));
			const worldTangent = (tangent: Point): Point => {
				if (!motionContext) return tangent;
				const shifted = resolveAnimatedItemAt(
					shiftPositionKeyframe(previewed, frame, tangent),
					frame,
					motionContext
				);
				return {
					x: (shifted.transform?.x ?? 0) - (resolved?.transform?.x ?? 0),
					y: (shifted.transform?.y ?? 0) - (resolved?.transform?.y ?? 0)
				};
			};
			const spatial = vector?.spatial
				? {
						...vector.spatial,
						inTangent: worldTangent(vector.spatial.inTangent),
						outTangent: worldTangent(vector.spatial.outTangent)
					}
				: undefined;
			return {
				frame,
				x,
				y,
				isKeyframe: keyframeSet.has(frame) || preview?.frame === frame,
				...(vector && {
					vectorId: vector.id,
					...(spatial && {
						spatial,
						inHandle: {
							x: x + spatial.inTangent.x,
							y: y + spatial.inTangent.y
						},
						outHandle: {
							x: x + spatial.outTangent.x,
							y: y + spatial.outTangent.y
						}
					})
				})
			};
		});
	const first = points[0];
	if (!first) return [];
	return points.some(
		(point) => Math.abs(point.x - first.x) > 0.5 || Math.abs(point.y - first.y) > 0.5
	)
		? points
		: [];
}
