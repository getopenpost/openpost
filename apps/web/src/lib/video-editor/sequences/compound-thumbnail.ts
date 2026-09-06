import { createBlankProject } from '../project/defaults';
import type { ProjectTimeline, SubComposition } from '../project/types';
import { TimelineFrameRenderer } from '../media/render-export';
import { createLogger } from '../workspace-fs/logger';
import { sequenceStore } from './sequence-store.svelte';

const MAX_THUMBNAIL_EDGE = 320;
const logger = createLogger('CompoundThumbnail');

interface CachedThumbnail {
	signature: string;
	url: string;
}

interface PendingThumbnail {
	signature: string;
	promise: Promise<string | null>;
}

function referencedCompositionIds(composition: SubComposition): string[] {
	return composition.items.flatMap((item) => (item.compositionId ? [item.compositionId] : []));
}

/** Stable recursive signature for a composition and every nested composition it renders. */
export function compoundThumbnailSignature(
	compositionId: string,
	compositions: ReadonlyMap<string, SubComposition>
): string {
	const visited = new Set<string>();
	const snapshots: SubComposition[] = [];
	const visit = (id: string): void => {
		if (visited.has(id)) return;
		visited.add(id);
		const composition = compositions.get(id);
		if (!composition) return;
		snapshots.push(composition);
		for (const nestedId of referencedCompositionIds(composition).toSorted()) visit(nestedId);
	};
	visit(compositionId);
	return JSON.stringify(snapshots);
}

export function compoundThumbnailFrame(durationInFrames: number): number {
	if (durationInFrames <= 1) return 0;
	return Math.min(durationInFrames - 1, Math.round((durationInFrames - 1) * 0.2));
}

export interface CompoundThumbnailSize {
	width: number;
	height: number;
}

export function compoundThumbnailSize(width: number, height: number): CompoundThumbnailSize {
	const safeWidth = Math.max(1, width);
	const safeHeight = Math.max(1, height);
	const scale = Math.min(1, MAX_THUMBNAIL_EDGE / Math.max(safeWidth, safeHeight));
	return {
		width: Math.max(1, Math.round(safeWidth * scale)),
		height: Math.max(1, Math.round(safeHeight * scale))
	};
}

function thumbnailProject(
	composition: SubComposition,
	timeline: ProjectTimeline
): ReturnType<typeof createBlankProject> {
	const project = createBlankProject(composition.name);
	project.duration = composition.durationInFrames / Math.max(1, composition.fps);
	project.metadata = {
		width: composition.width,
		height: composition.height,
		fps: composition.fps,
		backgroundColor: composition.backgroundColor ?? '#000000'
	};
	project.timeline = {
		tracks: composition.tracks,
		items: composition.items,
		transitions: composition.transitions,
		markers: composition.markers,
		compositions: timeline.compositions,
		currentFrame: 0,
		zoomLevel: 1,
		scrollPosition: 0
	};
	return project;
}

class CompoundThumbnailService {
	private readonly cache = new Map<string, CachedThumbnail>();
	private readonly pending = new Map<string, PendingThumbnail>();
	private readonly generations = new Map<string, number>();

	async getThumbnailUrl(compositionId: string, knownSignature?: string): Promise<string | null> {
		if (typeof OffscreenCanvas === 'undefined') return null;
		const timeline = sequenceStore.projectTimeline();
		const compositions = new Map(
			(timeline.compositions ?? []).map((composition) => [composition.id, composition])
		);
		const composition = compositions.get(compositionId);
		if (!composition) return null;
		const signature = knownSignature ?? compoundThumbnailSignature(compositionId, compositions);
		const cached = this.cache.get(compositionId);
		if (cached?.signature === signature) return cached.url;
		const pending = this.pending.get(compositionId);
		if (pending?.signature === signature) return pending.promise;

		const generation = (this.generations.get(compositionId) ?? 0) + 1;
		this.generations.set(compositionId, generation);
		const promise = this.render(composition, timeline)
			.then((url) => {
				if (!url) return cached?.url ?? null;
				if (this.generations.get(compositionId) !== generation) {
					URL.revokeObjectURL(url);
					return this.cache.get(compositionId)?.url ?? null;
				}
				const previous = this.cache.get(compositionId);
				this.cache.set(compositionId, { signature, url });
				if (previous?.url && previous.url !== url) URL.revokeObjectURL(previous.url);
				return url;
			})
			.catch((error) => {
				logger.warn(`Could not render compound thumbnail ${compositionId}`, error);
				return cached?.url ?? null;
			})
			.finally(() => {
				if (this.pending.get(compositionId)?.promise === promise) {
					this.pending.delete(compositionId);
				}
			});
		this.pending.set(compositionId, { signature, promise });
		return promise;
	}

	clear(compositionId: string): void {
		this.generations.set(compositionId, (this.generations.get(compositionId) ?? 0) + 1);
		const cached = this.cache.get(compositionId);
		if (cached) URL.revokeObjectURL(cached.url);
		this.cache.delete(compositionId);
		this.pending.delete(compositionId);
	}

	clearAll(): void {
		for (const id of new Set([...this.cache.keys(), ...this.pending.keys()])) this.clear(id);
	}

	private async render(composition: SubComposition, timeline: ProjectTimeline): Promise<string> {
		const size = compoundThumbnailSize(composition.width, composition.height);
		const renderer = new TimelineFrameRenderer(thumbnailProject(composition, timeline), size);
		try {
			await renderer.render(compoundThumbnailFrame(composition.durationInFrames));
			const blob = await renderer.canvas.convertToBlob({
				type: 'image/jpeg',
				quality: 0.82
			});
			return URL.createObjectURL(blob);
		} finally {
			renderer.dispose();
		}
	}
}

export const compoundThumbnailService = new CompoundThumbnailService();
