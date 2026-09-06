import type { TimelineItem } from '../project/types';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';

const MAX_REFS = 40;

export interface ClipRefEntry {
	ref: string;
	itemId: string;
	type: TimelineItem['type'];
	label: string;
	startSeconds: number;
	endSeconds: number;
	selected: boolean;
}

let refToItemId = new Map<string, string>();
let itemIdToRef = new Map<string, string>();

function deterministicOrder(a: TimelineItem, b: TimelineItem): number {
	if (a.from !== b.from) return a.from - b.from;
	return a.trackId.localeCompare(b.trackId);
}

export function buildClipRefs(
	items: readonly TimelineItem[] = timelineStore.items,
	selectedIds: readonly string[] = timelineStore.items.filter(() => true).length
		? getSelectedIds()
		: []
): ClipRefEntry[] {
	const fps = timelineStore.fps;
	const safeFps = Math.max(1, fps);
	const selected = new Set(selectedIds);
	const ordered = [...items].sort(deterministicOrder).slice(0, MAX_REFS);
	const entries: ClipRefEntry[] = ordered.map((item, index) => ({
		ref: `c${index + 1}`,
		itemId: item.id,
		type: item.type,
		label: item.label?.trim() || item.type,
		startSeconds: item.from / safeFps,
		endSeconds: (item.from + item.durationInFrames) / safeFps,
		selected: selected.has(item.id)
	}));
	refToItemId = new Map(entries.map((entry) => [entry.ref, entry.itemId]));
	itemIdToRef = new Map(entries.map((entry) => [entry.itemId, entry.ref]));
	return entries;
}

function getSelectedIds(): string[] {
	// Selection is page-owned in OpenPost; we expose a setter for the store to
	// inject current selection without importing page state directly.
	return currentSelectionProvider ? currentSelectionProvider() : [];
}

let currentSelectionProvider: (() => string[]) | null = null;

export function setClipRefSelectionProvider(provider: (() => string[]) | null): void {
	currentSelectionProvider = provider;
}

export function resolveClipRef(ref: string): string | undefined {
	return refToItemId.get(ref.trim());
}

export function resolveItemRef(itemId: string): string | undefined {
	return itemIdToRef.get(itemId);
}

export function resolveClipRefs(refs: readonly string[]): string[] {
	return refs.map((ref) => resolveClipRef(ref)).filter((id): id is string => Boolean(id));
}

export function resolveTargetItems(refs: readonly string[] | undefined): TimelineItem[] {
	const ids =
		refs && refs.length > 0 ? resolveClipRefs(refs) : (currentSelectionProvider?.() ?? []);
	const byId = new Map(timelineStore.items.map((item) => [item.id, item]));
	return ids.map((id) => byId.get(id)).filter((item): item is TimelineItem => Boolean(item));
}

export function __resetClipRefsForTesting(): void {
	refToItemId = new Map();
	itemIdToRef = new Map();
	currentSelectionProvider = null;
}
