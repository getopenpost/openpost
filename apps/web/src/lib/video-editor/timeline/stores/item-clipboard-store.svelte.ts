import type { TimelineItem } from '../../project/types';
import { copyTimelineItems } from '../item-clipboard';
import { snapshotTimelineState } from '../utils/state-snapshot.svelte';

export type TimelineClipboardOperation = 'copy' | 'cut';

class ItemClipboardStore {
	items = $state<TimelineItem[]>([]);
	operation = $state<TimelineClipboardOperation>('copy');

	copy(items: readonly TimelineItem[], operation: TimelineClipboardOperation): void {
		this.items = copyTimelineItems(items.map((item) => snapshotTimelineState(item)));
		this.operation = operation;
	}

	clear(): void {
		this.items = [];
		this.operation = 'copy';
	}

	get hasItems(): boolean {
		return this.items.length > 0;
	}

	__resetForTesting(): void {
		this.clear();
	}
}

export const itemClipboardStore = new ItemClipboardStore();
