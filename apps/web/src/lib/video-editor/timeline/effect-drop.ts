/**
 * Effect drag data and target selection.
 *
 * Ported from FreeCut (MIT), effect-drop.ts and drag-data-cache.ts.
 * Browsers hide DataTransfer payloads during dragover, so the drag source
 * also keeps the current payload in this small module cache.
 */

import type { CssFilterType } from '$lib/video-editor/effects/types';
import type { GpuParamValues } from '$lib/video-editor/effects/gpu/types';
import type { TimelineItem } from '$lib/video-editor/project/types';

export type EffectTemplate =
	| { kind: 'css'; effectType: CssFilterType; amount?: number; enabled?: boolean }
	| { kind: 'gpu'; effectId: string; params?: GpuParamValues; enabled?: boolean };

export interface EffectDragData {
	type: 'timeline-effect';
	label: string;
	effects: EffectTemplate[];
}

let cachedEffectDragData: EffectDragData | null = null;

export function areItemIdListsEqual(previous: readonly string[], next: readonly string[]): boolean {
	if (previous === next) return true;
	if (previous.length !== next.length) return false;
	for (let index = 0; index < previous.length; index += 1) {
		if (previous[index] !== next[index]) return false;
	}
	return true;
}

export function setEffectDragData(data: EffectDragData): void {
	cachedEffectDragData = data;
}

export function getEffectDragData(): EffectDragData | null {
	return cachedEffectDragData;
}

export function clearEffectDragData(): void {
	cachedEffectDragData = null;
}

export function canApplyDroppedEffectsToItem(item: Pick<TimelineItem, 'type'>): boolean {
	return item.type !== 'audio';
}

export function resolveEffectDropTargetIds(params: {
	hoveredItemId: string;
	items: readonly TimelineItem[];
	selectedItemIds: readonly string[];
}): string[] {
	const { hoveredItemId, items, selectedItemIds } = params;
	const itemById = new Map(items.map((item) => [item.id, item]));
	const hoveredItem = itemById.get(hoveredItemId);
	if (!hoveredItem || !canApplyDroppedEffectsToItem(hoveredItem)) return [];

	if (!selectedItemIds.includes(hoveredItemId) || selectedItemIds.length <= 1) {
		return [hoveredItemId];
	}

	const compatibleSelectedIds = selectedItemIds.filter((id) => {
		const item = itemById.get(id);
		return !!item && canApplyDroppedEffectsToItem(item);
	});
	return compatibleSelectedIds.length > 0 ? compatibleSelectedIds : [hoveredItemId];
}

export function isDragPointInsideElement(
	event: { clientX: number; clientY: number },
	element: Pick<HTMLElement, 'getBoundingClientRect'>
): boolean {
	const rect = element.getBoundingClientRect();
	return (
		event.clientX >= rect.left &&
		event.clientX <= rect.right &&
		event.clientY >= rect.top &&
		event.clientY <= rect.bottom
	);
}
