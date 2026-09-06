import type {
	DirectLinkableProperty,
	TimelineItem,
	VectorKeyframeProperty
} from '../../project/types';
import { getActiveMotionModifierChannels } from '../motion-modifier-eval';
import { execute } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { effectiveMediaTracks } from '../utils/track-groups';
import {
	bentoSourceSize,
	buildBentoTransitionChains,
	computeBentoLayout,
	type BentoLayoutConfig
} from '../bento-layout';
import { transitionsStore } from './transitions-store.svelte';

const CONTROLLED_SCALARS = ['x', 'y', 'width', 'height', 'anchorX', 'anchorY', 'rotation'] as const;
const CONTROLLED_VECTORS = ['position', 'scale', 'anchor'] as const;
const CONTROLLED_LINK_TARGETS = new Set<DirectLinkableProperty>([
	...CONTROLLED_SCALARS,
	...CONTROLLED_VECTORS
]);
const CONTROLLED_MOTION_CHANNELS = new Set(['x', 'y', 'width', 'height', 'rotation']);

function isBentoVisual(item: TimelineItem): boolean {
	return item.type !== 'audio' && item.type !== 'adjustment';
}

export function eligibleBentoItemIds(itemIds: readonly string[]): string[] {
	const unlockedTrackIds = new Set(
		effectiveMediaTracks(timelineStore.tracks)
			.filter((track) => !track.locked)
			.map((track) => track.id)
	);
	const seen = new Set<string>();
	return itemIds.filter((id) => {
		if (seen.has(id)) return false;
		seen.add(id);
		const item = timelineStore.itemById.get(id);
		return Boolean(item && isBentoVisual(item) && unlockedTrackIds.has(item.trackId));
	});
}

function orderedBentoChains(
	itemIds: readonly string[],
	orderedChains: readonly (readonly string[])[] | undefined
): string[][] {
	const eligible = new Set(itemIds);
	const seen = new Set<string>();
	const ordered: string[][] = [];
	for (const chain of orderedChains ?? []) {
		const next: string[] = [];
		for (const id of chain) {
			if (!eligible.has(id) || seen.has(id)) continue;
			seen.add(id);
			next.push(id);
		}
		if (next.length > 0) ordered.push(next);
	}
	const missing = itemIds.filter((id) => !seen.has(id));
	return [...ordered, ...buildBentoTransitionChains(missing, transitionsStore.list)];
}

function clearControlledTransformDrivers(item: TimelineItem): Partial<TimelineItem> {
	const keyframes = { ...(item.keyframes ?? {}) };
	for (const property of CONTROLLED_SCALARS) delete keyframes[property];
	const vectorKeyframes: NonNullable<TimelineItem['vectorKeyframes']> = {
		...(item.vectorKeyframes ?? {})
	};
	for (const property of CONTROLLED_VECTORS) delete vectorKeyframes[property];
	const separatedVectorProperties = item.separatedVectorProperties?.filter(
		(property) => !CONTROLLED_VECTORS.includes(property)
	);
	const propertyLinks = item.propertyLinks?.filter(
		(link) => !CONTROLLED_LINK_TARGETS.has(link.targetProperty)
	);
	const expressions = item.expressions?.filter(
		(expression) => !CONTROLLED_LINK_TARGETS.has(expression.targetProperty)
	);
	const motionModifiers = item.motionModifiers?.filter((modifier) =>
		getActiveMotionModifierChannels(modifier).every(
			(channel) => !CONTROLLED_MOTION_CHANNELS.has(channel)
		)
	);
	return {
		keyframes: Object.keys(keyframes).length > 0 ? keyframes : undefined,
		vectorKeyframes: Object.keys(vectorKeyframes).length > 0 ? vectorKeyframes : undefined,
		separatedVectorProperties:
			separatedVectorProperties && separatedVectorProperties.length > 0
				? separatedVectorProperties
				: undefined,
		propertyLinks: propertyLinks && propertyLinks.length > 0 ? propertyLinks : undefined,
		expressions: expressions && expressions.length > 0 ? expressions : undefined,
		motionModifiers: motionModifiers && motionModifiers.length > 0 ? motionModifiers : undefined
	};
}

export interface ApplyBentoLayoutOptions {
	itemIds: readonly string[];
	canvasWidth: number;
	canvasHeight: number;
	config: BentoLayoutConfig;
	orderedChains?: readonly (readonly string[])[];
}

/** Apply one layout to selected visual clips as one undo entry. */
export function applyBentoLayout(options: ApplyBentoLayoutOptions): string[] {
	const itemIds = eligibleBentoItemIds(options.itemIds);
	if (itemIds.length < 2) return [];
	const chains = orderedBentoChains(itemIds, options.orderedChains);
	const layoutItems = chains.flatMap((chain) => {
		const representative = timelineStore.itemById.get(chain[0] ?? '');
		if (!representative) return [];
		return [
			{
				id: representative.id,
				...bentoSourceSize(representative, options.canvasWidth, options.canvasHeight)
			}
		];
	});
	const chainTransforms = computeBentoLayout(
		layoutItems,
		options.canvasWidth,
		options.canvasHeight,
		options.config
	);
	const transforms = new Map<string, NonNullable<TimelineItem['transform']>>();
	for (const chain of chains) {
		const transform = chainTransforms.get(chain[0] ?? '');
		if (!transform?.width || !transform.height) continue;
		for (const id of chain) {
			transforms.set(id, {
				...transform,
				anchorX: transform.width / 2,
				anchorY: transform.height / 2
			});
		}
	}
	if (transforms.size < 2) return [];

	return execute('APPLY_BENTO_LAYOUT', () => {
		const updates = [...transforms].flatMap(([id, transform]) => {
			const item = timelineStore.itemById.get(id);
			if (!item) return [];
			return [
				{
					id,
					patch: {
						...clearControlledTransformDrivers(item),
						transform: { ...item.transform, ...transform }
					}
				}
			];
		});
		timelineStore._updateItems(updates);
		return updates.map((update) => update.id);
	});
}
