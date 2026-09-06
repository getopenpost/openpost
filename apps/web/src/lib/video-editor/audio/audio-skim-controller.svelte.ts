import { editorSession } from '../editor.svelte';
import { getMediaObjectUrl } from '../media/media-source';
import { mediaPool } from '../media/pool.svelte';
import { previewPlaybackSettings } from '../preview/playback-settings.svelte';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { transitionsStore } from '../timeline/actions/transitions-store.svelte';
import {
	createLatestOnlyFrameRunner,
	createResilientAudioSkimEngine,
	selectAudioSkimSource,
	type AudioSkimEngine
} from './audio-skim';

export interface TimelineAudioSkimController {
	schedule(frame: number): void;
	stop(): void;
	dispose(): void;
}

export function createTimelineAudioSkimController(
	engine: AudioSkimEngine = createResilientAudioSkimEngine()
): TimelineAudioSkimController {
	let requestId = 0;
	let animationFrame: number | null = null;
	let pendingFrame: number | null = null;
	const runner = createLatestOnlyFrameRunner(async (frame) => {
		if (
			!previewPlaybackSettings.audioSkimmingEnabled ||
			previewPlaybackSettings.muted ||
			editorSession.clock.isPlaying
		) {
			engine.stop();
			return;
		}
		const source = selectAudioSkimSource(
			frame,
			timelineStore.items,
			timelineStore.tracks,
			transitionsStore.list,
			timelineStore.fps,
			(item, fps) => {
				const media = item.mediaId ? mediaPool.get(item.mediaId) : undefined;
				if (media?.duration && media.duration > 0) return media.duration;
				if (item.sourceDuration !== undefined) {
					return item.sourceDuration / (item.sourceFps || fps);
				}
				return item.durationInFrames / fps;
			},
			(compositionId) => {
				const composition = sequenceStore.compositionById.get(compositionId);
				return composition
					? {
							items: composition.items,
							tracks: composition.tracks,
							transitions: composition.transitions,
							fps: composition.fps
						}
					: undefined;
			}
		);
		if (!source?.item.mediaId) return engine.stop();
		const media = mediaPool.get(source.item.mediaId);
		if (!media) return engine.stop();
		const id = ++requestId;
		try {
			const url = await getMediaObjectUrl(media);
			if (id !== requestId) return;
			await engine.scrub({
				url,
				kind: source.item.type,
				timeSeconds: source.timeSeconds,
				gain: source.gain * previewPlaybackSettings.volume
			});
		} catch {
			// Audio skimming must never interrupt timeline editing.
		}
	});

	const stop = (): void => {
		requestId++;
		pendingFrame = null;
		runner.cancelPending();
		if (animationFrame !== null) cancelAnimationFrame(animationFrame);
		animationFrame = null;
		engine.stop();
	};
	return {
		schedule(frame): void {
			pendingFrame = frame;
			if (animationFrame !== null) return;
			animationFrame = requestAnimationFrame(() => {
				animationFrame = null;
				const next = pendingFrame;
				pendingFrame = null;
				if (next !== null) runner.schedule(next);
			});
		},
		stop,
		dispose(): void {
			stop();
			engine.dispose();
		}
	};
}
