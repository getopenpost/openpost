/**
 * Media pool store — every media item known to this workspace project.
 *
 * Svelte 5 runes module. Import actions update it optimistically with
 * per-media preparation progress.
 */

import type { MediaMetadata } from './types';

export type MediaPreparationStatus = 'importing' | 'ready' | 'failed';

export interface MediaPoolEntry {
	media: MediaMetadata;
	status: MediaPreparationStatus;
	progress: number;
	error?: string;
}

interface MediaPoolState {
	order: string[];
	entries: Record<string, MediaPoolEntry>;
	thumbnailRevision: number;
}

const state = $state<MediaPoolState>({
	order: [],
	entries: {},
	thumbnailRevision: 0
});

export const mediaPool = {
	get order(): string[] {
		return state.order;
	},
	get mediaList(): MediaMetadata[] {
		return state.order
			.map((id) => state.entries[id]?.media)
			.filter((m): m is MediaMetadata => m !== undefined);
	},
	get thumbnailRevision(): number {
		return state.thumbnailRevision;
	},
	get(id: string): MediaMetadata | undefined {
		return state.entries[id]?.media;
	},
	entry(id: string): MediaPoolEntry | undefined {
		return state.entries[id];
	},

	upsert(media: MediaMetadata, status: MediaPreparationStatus, progress = 1): void {
		if (!state.entries[media.id]) state.order.push(media.id);
		state.entries[media.id] = { media, status, progress };
	},

	setStatus(id: string, status: MediaPreparationStatus, error?: string): void {
		const entry = state.entries[id];
		if (!entry) return;
		entry.status = status;
		if (error !== undefined) entry.error = error;
	},

	remove(id: string): void {
		delete state.entries[id];
		state.order = state.order.filter((existing) => existing !== id);
	},

	loadAll(media: MediaMetadata[]): void {
		state.order = [];
		state.entries = {};
		for (const item of media) {
			this.upsert(item, 'ready');
		}
	},

	clear(): void {
		state.order = [];
		state.entries = {};
	},

	notifyThumbnailsChanged(): void {
		state.thumbnailRevision += 1;
	}
};
