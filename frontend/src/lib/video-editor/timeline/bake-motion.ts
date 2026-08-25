/** Convert procedural live motion into ordinary editable keyframes. */
import type {
	KeyframeProperty,
	MotionModifier,
	MotionModifierChannel,
	TimelineItem
} from '$lib/video-editor/project/types';
import { resolveAnimatedItemAt, type AnimatedItemMotionContext } from './animated-properties';
import { getActiveMotionModifierChannels } from './motion-modifier-eval';
import { getActiveMotionLayerChannels } from './motion-layer-eval';

export interface BakedMotionKeyframe {
	property: MotionModifierChannel;
	frame: number;
	value: number;
}

export interface BakeMotionPlanEntry {
	itemId: string;
	keyframes: BakedMotionKeyframe[];
	clearProperties: KeyframeProperty[];
}

export interface BakedMotionSampleSet {
	keyframes: BakedMotionKeyframe[];
	properties: MotionModifierChannel[];
}

function sampleStep(modifiers: readonly MotionModifier[], fps: number): number {
	let step = Number.POSITIVE_INFINITY;
	for (const modifier of modifiers) {
		if (!modifier.enabled || modifier.amplitude <= 0) continue;
		const samplesPerCycle = modifier.type === 'micro-shake' ? 1 : 6;
		const candidate = Math.max(
			1,
			Math.round(fps / Math.max(0.01, modifier.frequency * samplesPerCycle))
		);
		step = Math.min(step, candidate);
	}
	return Number.isFinite(step) ? step : 0;
}

function activeProperties(
	modifiers: readonly MotionModifier[],
	layers: readonly import('$lib/video-editor/project/types').MotionAnimationLayer[] | undefined
): MotionModifierChannel[] {
	const properties = new Set<MotionModifierChannel>();
	for (const modifier of modifiers) {
		if (!modifier.enabled || modifier.amplitude <= 0) continue;
		for (const property of getActiveMotionModifierChannels(modifier)) properties.add(property);
	}
	for (const property of getActiveMotionLayerChannels(layers)) properties.add(property);
	// Position is one coupled vector lane in OpenPost. Baking either axis must
	// sample both so an existing authored path stays visually unchanged.
	if (properties.has('x') || properties.has('y')) {
		properties.add('x');
		properties.add('y');
	}
	return [...properties];
}

function resolvedValue(
	item: TimelineItem,
	property: MotionModifierChannel,
	context: AnimatedItemMotionContext
): number {
	const transform = item.transform ?? {};
	switch (property) {
		case 'x':
			return transform.x ?? 0;
		case 'y':
			return transform.y ?? 0;
		case 'width':
			return Math.max(1, transform.width ?? item.sourceWidth ?? context.frameWidth);
		case 'height':
			return Math.max(1, transform.height ?? item.sourceHeight ?? context.frameHeight);
		case 'rotation':
			return transform.rotation ?? 0;
		case 'opacity':
			return transform.opacity ?? 1;
	}
}

/**
 * Sample one clip's visible live motion. Smooth waves use six samples per
 * cycle; seeded shake uses its noise rate. The first and final visible frames
 * are always present so removing the procedural source cannot change the ends.
 */
export function bakeMotionModifiersToKeyframes(
	item: TimelineItem,
	context: AnimatedItemMotionContext
): BakedMotionSampleSet {
	const modifiers = item.motionModifiers?.filter((modifier) => modifier.enabled) ?? [];
	const properties = activeProperties(modifiers, item.motionLayers);
	if (properties.length === 0) return { keyframes: [], properties: [] };

	const lastFrame = Math.max(0, item.durationInFrames - 1);
	const frames = new Set<number>([0, lastFrame]);
	const step = sampleStep(modifiers, context.fps);
	if (step > 0) {
		for (let frame = 0; frame <= lastFrame; frame += step) frames.add(frame);
	}

	const keyframes: BakedMotionKeyframe[] = [];
	for (const frame of [...frames].toSorted((left, right) => left - right)) {
		const resolved = resolveAnimatedItemAt(item, item.from + frame, context);
		for (const property of properties) {
			keyframes.push({ property, frame, value: resolvedValue(resolved, property, context) });
		}
	}
	return { keyframes, properties };
}

/** Build a store-free bake plan that an action can preflight and commit. */
export function buildBakeMotionPlan(
	items: readonly TimelineItem[],
	context: AnimatedItemMotionContext
): BakeMotionPlanEntry[] {
	return items.flatMap((item) => {
		const hasModifier = item.motionModifiers?.some((modifier) => modifier.enabled) ?? false;
		const hasLayer = item.motionLayers?.some((layer) => layer.enabled) ?? false;
		if (!hasModifier && !hasLayer) return [];
		const baked = bakeMotionModifiersToKeyframes(item, context);
		return [
			{
				itemId: item.id,
				keyframes: baked.keyframes,
				clearProperties: baked.properties
			}
		];
	});
}
