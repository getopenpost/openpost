import { addItems } from './items';
import { planTimelineClipboardPaste } from '../item-clipboard';
import { itemClipboardStore } from '../stores/item-clipboard-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { snapshotTimelineState } from '../utils/state-snapshot.svelte';

export function pasteTimelineItemClipboard(activeTrackId: string | null): string[] {
	if (!itemClipboardStore.hasItems) return [];
	const items = planTimelineClipboardPaste({
		clipboard: itemClipboardStore.items.map((item) => snapshotTimelineState(item)),
		currentFrame: timelineStore.currentFrame,
		existingItems: timelineStore.items,
		tracks: timelineStore.tracks,
		activeTrackId
	});
	if (items.length === 0) return [];
	addItems(items);
	if (itemClipboardStore.operation === 'cut') itemClipboardStore.clear();
	return items.map((item) => item.id);
}
