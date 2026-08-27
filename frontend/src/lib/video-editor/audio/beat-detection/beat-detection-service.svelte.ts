import { mediaPool } from '$lib/video-editor/media/pool.svelte';
import { resolveMediaBlob as defaultResolveMediaBlob } from '$lib/video-editor/media/resolve-media-blob';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { m } from '$lib/paraglide/messages';
import { BeatAnalyzer } from './analyzer';
import { beatsToMarkers } from './marker-mapping';
import { addBeatMarkersAtomic } from './beat-actions';
import type { TimelineItem } from '$lib/video-editor/project/types';
import type { MediaMetadata } from '$lib/video-editor/media/types';

export type BeatDetectionStatus = 'idle' | 'analyzing' | 'success' | 'error' | 'cancelled';

export interface BeatDetectionProgress {
	status: BeatDetectionStatus;
	message?: string;
	createdCount?: number;
	bpm?: number;
	confidence?: number;
}

class BeatDetectionService {
	status = $state<BeatDetectionStatus>('idle');
	error = $state<string | null>(null);
	progress = $state<string | null>(null);
	lastResult = $state<BeatDetectionProgress | null>(null);
	private controller: AbortController | null = null;
	private readonly analyzer = new BeatAnalyzer();
	private resolveMediaBlobFn: (media: MediaMetadata) => Promise<Blob> = defaultResolveMediaBlob;
	private analyzeBlobOverride:
		| ((blob: Blob, signal?: AbortSignal) => Promise<import('./types').BeatAnalysisResult>)
		| null = null;

	/** Test seam: replace blob resolution with a faithful in-memory implementation. */
	setResolveMediaBlobForTesting(fn: ((media: MediaMetadata) => Promise<Blob>) | null): void {
		this.resolveMediaBlobFn = fn ?? defaultResolveMediaBlob;
	}

	/** Restore the production resolver. */
	clearResolveMediaBlobForTesting(): void {
		this.resolveMediaBlobFn = defaultResolveMediaBlob;
	}

	/** Test seam: override analyzer blob decoding for deterministic browser UI tests. */
	setAnalyzeBlobForTesting(
		fn: ((blob: Blob, signal?: AbortSignal) => Promise<import('./types').BeatAnalysisResult>) | null
	): void {
		this.analyzeBlobOverride = fn;
	}

	get isAnalyzing(): boolean {
		return this.status === 'analyzing';
	}

	cancel(): void {
		if (this.controller && this.status === 'analyzing') {
			this.controller.abort();
		}
	}

	reset(): void {
		this.controller?.abort();
		this.controller = null;
		this.status = 'idle';
		this.error = null;
		this.progress = null;
		this.lastResult = null;
	}

	async analyzeSelectedClip(clipId?: string | null): Promise<BeatDetectionProgress> {
		const selectedId =
			(clipId ?? timelineStore.itemById.get(timelineStore.itemById.keys().next().value ?? ''))
				? (timelineStore.itemById.keys().next().value ?? null)
				: null;
		// Prefer explicit selection if available
		const item = clipId ? timelineStore.itemById.get(clipId) : this.resolveSelectedMediaItem();

		if (!item) {
			const msg =
				m.video_editor_beat_no_selection?.() ?? 'Select an audio or video clip to detect beats.';
			this.status = 'error';
			this.error = msg;
			this.lastResult = { status: 'error', message: msg };
			throw new Error(msg);
		}
		if (item.type !== 'audio' && item.type !== 'video') {
			const msg =
				m.video_editor_beat_unsupported_clip?.() ??
				'Beat detection works on audio and video clips.';
			this.status = 'error';
			this.error = msg;
			this.lastResult = { status: 'error', message: msg };
			throw new Error(msg);
		}
		if (!item.mediaId) {
			const msg = m.video_editor_beat_missing_media?.() ?? 'This clip has no source media.';
			this.status = 'error';
			this.error = msg;
			this.lastResult = { status: 'error', message: msg };
			throw new Error(msg);
		}
		const media = mediaPool.get(item.mediaId);
		if (!media) {
			const msg = m.video_editor_beat_missing_media?.() ?? 'Source media not found.';
			this.status = 'error';
			this.error = msg;
			this.lastResult = { status: 'error', message: msg };
			throw new Error(msg);
		}
		if (media.audioCodecSupported === false) {
			const msg = m.video_editor_beat_unsupported_audio?.() ?? 'This media has no decodable audio.';
			this.status = 'error';
			this.error = msg;
			this.lastResult = { status: 'error', message: msg };
			throw new Error(msg);
		}

		// Cancel previous
		this.controller?.abort();
		const controller = new AbortController();
		this.controller = controller;
		this.status = 'analyzing';
		this.error = null;
		this.progress = m.video_editor_beat_analyzing?.() ?? 'Analyzing audio…';
		this.lastResult = { status: 'analyzing', message: this.progress };

		try {
			const blob = await this.resolveMediaBlobFn(media);
			if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
			this.progress = m.video_editor_beat_decoding?.() ?? 'Decoding audio…';
			const result = this.analyzeBlobOverride
				? await this.analyzeBlobOverride(blob, controller.signal)
				: await this.analyzer.analyzeBlob(blob, controller.signal);
			if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
			this.progress = m.video_editor_beat_mapping?.() ?? 'Placing markers…';
			const fps = timelineStore.fps;
			const markers = beatsToMarkers(result.beats, result.downbeats, {
				fps,
				item
			});
			const inserted = addBeatMarkersAtomic(markers);
			if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
			this.status = 'success';
			this.progress = null;
			this.lastResult = {
				status: 'success',
				createdCount: inserted,
				bpm: result.bpm,
				confidence: result.confidence,
				message:
					inserted > 0
						? (m.video_editor_beat_success?.({ count: inserted }) ??
							`Added ${inserted} beat markers.`)
						: (m.video_editor_beat_no_new_markers?.() ?? 'No new markers - beats already marked.')
			};
			return this.lastResult;
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				this.status = 'cancelled';
				this.error = null;
				this.progress = null;
				this.lastResult = {
					status: 'cancelled',
					message: m.video_editor_beat_cancelled?.() ?? 'Beat detection cancelled.'
				};
				return this.lastResult;
			}
			const message =
				error instanceof Error
					? error.message
					: (m.video_editor_beat_failed?.() ?? 'Beat detection failed.');
			this.status = 'error';
			this.error = message;
			this.lastResult = { status: 'error', message };
			throw error instanceof Error ? error : new Error(message);
		} finally {
			if (this.controller === controller) this.controller = null;
		}
	}

	private resolveSelectedMediaItem(): TimelineItem | undefined {
		// If a marker is selected, no clip; otherwise try top selected clip or playhead clip
		// We expose selection via timelineStore.itemById; the panel passes clipId explicitly.
		// Fallback: clip under playhead with audio
		const frame = timelineStore.currentFrame;
		const candidates = timelineStore.items
			.filter((i) => i.type === 'audio' || i.type === 'video')
			.filter((i) => frame >= i.from && frame < i.from + i.durationInFrames)
			.sort((a, b) => b.from - a.from);
		if (candidates[0]) return candidates[0];
		// otherwise any audio/video clip
		return timelineStore.items.find((i) => i.type === 'audio' || i.type === 'video');
	}
}

export const beatDetectionService = new BeatDetectionService();
export function createBeatDetectionServiceForTesting(): BeatDetectionService {
	return new BeatDetectionService();
}
