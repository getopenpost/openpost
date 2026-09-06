import type { MotionAnimationLayer } from '$lib/video-editor/project/types';
import { execute } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { resolveAnimatedItemAt } from '../animated-properties';
import {
	getMotionPresetAnchorFrame,
	motionPresetById,
	type MotionPresetId
} from '../motion-presets';
import { applyMotionGeneratorSettings } from '../motion-generator';
import { createMotionAnimationLayer } from '../motion-layer-eval';

export interface MotionLayerAssignment {
	itemId: string;
	layer: MotionAnimationLayer;
}

export function applyMotionLayersToItems(assignments: MotionLayerAssignment[]): number {
	if (assignments.length === 0) return 0;
	return execute('APPLY_MOTION_LAYERS', () => {
		let count = 0;
		for (const { itemId, layer } of assignments) {
			const item = timelineStore.itemById.get(itemId);
			if (!item) continue;
			timelineStore._updateItems([
				{ id: itemId, patch: { motionLayers: [...(item.motionLayers ?? []), layer] } }
			]);
			count += 1;
		}
		return count;
	});
}

export function removeMotionLayerFromItems(itemIds: string[], layerId: string): number {
	if (itemIds.length === 0) return 0;
	return execute('REMOVE_MOTION_LAYER', () => {
		let count = 0;
		for (const itemId of new Set(itemIds)) {
			const item = timelineStore.itemById.get(itemId);
			if (!item?.motionLayers?.some((layer) => layer.id === layerId)) continue;
			timelineStore._updateItems([
				{
					id: itemId,
					patch: { motionLayers: item.motionLayers.filter((layer) => layer.id !== layerId) }
				}
			]);
			count += 1;
		}
		return count;
	});
}

export function setMotionLayerEnabled(
	itemIds: string[],
	layerId: string,
	enabled: boolean
): number {
	if (itemIds.length === 0) return 0;
	return execute('TOGGLE_MOTION_LAYER', () => {
		let count = 0;
		for (const itemId of new Set(itemIds)) {
			const item = timelineStore.itemById.get(itemId);
			const layer = item?.motionLayers?.find((entry) => entry.id === layerId);
			if (!layer || layer.enabled === enabled) continue;
			timelineStore._updateItems([
				{
					id: itemId,
					patch: {
						motionLayers: item.motionLayers!.map((entry) =>
							entry.id === layerId ? { ...entry, enabled } : entry
						)
					}
				}
			]);
			count += 1;
		}
		return count;
	});
}

export function renameMotionLayer(itemIds: string[], layerId: string, name: string): number {
	const trimmed = name.trim();
	if (trimmed.length === 0 || itemIds.length === 0) return 0;
	return execute('RENAME_MOTION_LAYER', () => {
		let count = 0;
		for (const itemId of new Set(itemIds)) {
			const item = timelineStore.itemById.get(itemId);
			const layer = item?.motionLayers?.find((entry) => entry.id === layerId);
			if (!layer || layer.name === trimmed) continue;
			timelineStore._updateItems([
				{
					id: itemId,
					patch: {
						motionLayers: item.motionLayers!.map((entry) =>
							entry.id === layerId ? { ...entry, name: trimmed } : entry
						)
					}
				}
			]);
			count += 1;
		}
		return count;
	});
}

export interface ApplyPresetAsLayerOptions {
	itemIds: string[];
	presetId: MotionPresetId;
	frameWidth: number;
	frameHeight: number;
	fps?: number;
	durationScale?: number;
	intensityScale?: number;
	staggerFrames?: number;
}

export function applyMotionPresetAsLayers(options: ApplyPresetAsLayerOptions): number {
	const preset = motionPresetById(options.presetId);
	const items = options.itemIds
		.map((id) => timelineStore.itemById.get(id))
		.filter((item): item is NonNullable<typeof item> => Boolean(item))
		.filter((item) =>
			[
				'video',
				'image',
				'lottie',
				'text',
				'subtitle',
				'shape',
				'composition',
				'controller'
			].includes(item.type)
		);
	if (items.length === 0) return 0;
	const fps = options.fps ?? timelineStore.fps;
	const sharedLayerId = crypto.randomUUID();
	const assignments: MotionLayerAssignment[] = [];
	for (let index = 0; index < items.length; index += 1) {
		const item = items[index]!;
		const anchorFrame = getMotionPresetAnchorFrame(preset.category, item.durationInFrames, fps);
		// Additive layers anchor at the current animated pose (FreeCut additive mode), not the base.
		const anchorResolved = resolveAnimatedItemAt(item, item.from + anchorFrame, {
			fps,
			frameWidth: options.frameWidth,
			frameHeight: options.frameHeight,
			items: timelineStore.items
		});
		const anchor = {
			x: anchorResolved.transform?.x ?? 0,
			y: anchorResolved.transform?.y ?? 0,
			width: Math.max(
				1,
				anchorResolved.transform?.width ?? anchorResolved.sourceWidth ?? options.frameWidth
			),
			height: Math.max(
				1,
				anchorResolved.transform?.height ?? anchorResolved.sourceHeight ?? options.frameHeight
			),
			scaleX: anchorResolved.transform?.scaleX ?? 1,
			scaleY: anchorResolved.transform?.scaleY ?? 1,
			rotation: anchorResolved.transform?.rotation ?? 0,
			opacity: anchorResolved.transform?.opacity ?? 1
		};
		const context = {
			anchor,
			durationInFrames: item.durationInFrames,
			fps,
			frameWidth: options.frameWidth,
			frameHeight: options.frameHeight
		};
		const payloads = applyMotionGeneratorSettings(
			preset,
			preset.build(context),
			context,
			{
				durationScale: options.durationScale ?? 1,
				intensityScale: options.intensityScale ?? 1,
				staggerFrames: (options.staggerFrames ?? 0) * index
			},
			index
		);
		if (payloads.length === 0) continue;
		const layer = createMotionAnimationLayer({
			id: sharedLayerId,
			name: preset.id,
			source: 'built-in-preset',
			sourcePresetId: preset.id,
			anchor,
			payloads: payloads.map((payload) => ({
				// SAFETY: payload.property comes from preset.build which emits only transform properties.
				property:
					payload.property as import('$lib/video-editor/project/types').TransformAnimatableProperty,
				frame: payload.frame,
				value: payload.value,
				easing: payload.easing,
				easingConfig: payload.easingConfig
			}))
		});
		assignments.push({ itemId: item.id, layer });
	}
	return applyMotionLayersToItems(assignments);
}
