import type { TimelineItem } from '../project/types';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { mediaPool } from './pool.svelte';
import {
	orphanedTimelineClips,
	type MediaSourceIssue,
	type OrphanedTimelineClip
} from './media-recovery';
import { scanMediaSourceIssues } from './media-source-recovery';
import type { MediaMetadata } from './types';

class MediaRecoveryStore {
	sourceIssues = $state<MediaSourceIssue[]>([]);
	orphanedClips = $state<OrphanedTimelineClip[]>([]);
	open = $state(false);
	scanning = $state(false);
	error = $state('');
	private dismissed = false;
	private scanVersion = 0;

	get issueCount(): number {
		return this.sourceIssues.length + this.orphanedClips.length;
	}

	reset(): void {
		this.scanVersion += 1;
		this.sourceIssues = [];
		this.orphanedClips = [];
		this.open = false;
		this.scanning = false;
		this.error = '';
		this.dismissed = false;
	}

	async scan(media: readonly MediaMetadata[], items: readonly TimelineItem[]): Promise<void> {
		const version = ++this.scanVersion;
		this.scanning = true;
		this.error = '';
		const orphans = orphanedTimelineClips(items, media);
		try {
			const sources = await scanMediaSourceIssues(media);
			if (version !== this.scanVersion) return;
			this.sourceIssues = sources;
			this.orphanedClips = orphans;
			if (sources.length + orphans.length === 0) {
				this.open = false;
				this.dismissed = false;
			} else if (!this.dismissed) {
				this.open = true;
			}
		} catch (reason) {
			if (version !== this.scanVersion) return;
			this.orphanedClips = orphans;
			this.error = reason instanceof Error ? reason.message : String(reason);
			if (orphans.length > 0 && !this.dismissed) this.open = true;
		} finally {
			if (version === this.scanVersion) this.scanning = false;
		}
	}

	refresh(): Promise<void> {
		return this.scan(mediaPool.mediaList, timelineStore.items);
	}

	show(): void {
		this.dismissed = false;
		this.open = true;
		void this.refresh();
	}

	workOffline(): void {
		this.dismissed = true;
		this.open = false;
	}
}

export const mediaRecovery = new MediaRecoveryStore();
