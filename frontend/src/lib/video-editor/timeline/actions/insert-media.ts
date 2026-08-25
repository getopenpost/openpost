import { editorSession } from '../../editor.svelte';
import type { MediaMetadata } from '../../media/types';
import type { TimelineItem, TimelineTrack } from '../../project/types';
import { sequenceStore } from '../../sequences/sequence-store.svelte';
import { execute } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { effectiveMediaTracks } from '../utils/track-groups';

export interface InsertMediaOptions {
	preferredTrackId?: string;
	label?: string;
}

function itemKind(media: MediaMetadata): TimelineItem['type'] {
	if (media.tags.includes('audio')) return 'audio';
	if (media.tags.includes('lottie')) return 'lottie';
	if (media.tags.includes('image')) return 'image';
	return 'video';
}

function itemDuration(media: MediaMetadata, type: TimelineItem['type'], fps: number): number {
	if (type === 'image') {
		// Animated GIF/WebP clips span their real loop length instead of a fixed
		// 3-second still so the timeline shows true animation timing.
		if ((media.animationFrameCount ?? 0) > 1 && media.duration > 0) {
			return Math.max(1, Math.round(media.duration * fps));
		}
		return Math.max(1, Math.round(3 * fps));
	}
	return Math.max(1, Math.round(Math.max(media.duration, 1 / fps) * fps));
}

function collides(trackId: string, from: number, end: number): boolean {
	return (timelineStore.itemsByTrackId.get(trackId) ?? []).some(
		(item) => item.from < end && item.from + item.durationInFrames > from
	);
}

function newTrack(kind: 'video' | 'audio', label: string): TimelineTrack {
	const orders = timelineStore.tracks.map((track) => track.order);
	return {
		id: crypto.randomUUID(),
		name: label,
		kind,
		height: kind === 'video' ? 96 : 72,
		locked: false,
		syncLock: true,
		visible: true,
		muted: false,
		solo: false,
		volume: 1,
		order:
			kind === 'video'
				? (orders.length > 0 ? Math.min(...orders) : 0) - 1
				: (orders.length > 0 ? Math.max(...orders) : -1) + 1
	};
}

function targetTrack(
	kind: 'video' | 'audio',
	from: number,
	end: number,
	preferredTrackId?: string
): TimelineTrack {
	const tracks = effectiveMediaTracks(timelineStore.tracks);
	const preferred = preferredTrackId
		? tracks.find((track) => track.id === preferredTrackId)
		: undefined;
	if (preferred?.kind === kind && !preferred.locked && !collides(preferred.id, from, end)) {
		return preferred;
	}
	const open = tracks
		.filter((track) => track.kind === kind && !track.locked)
		.toSorted((left, right) =>
			kind === 'video' ? left.order - right.order : right.order - left.order
		)
		.find((track) => !collides(track.id, from, end));
	return open ?? newTrack(kind, kind === 'video' ? 'Overlay' : 'Audio');
}

/** Insert media at an exact timeline frame as one undoable item and optional track creation. */
export function insertMediaAtFrame(
	media: MediaMetadata,
	frame: number,
	options: InsertMediaOptions = {}
): string {
	return execute('INSERT_MEDIA_AT_FRAME', () => {
		const fps = timelineStore.fps;
		const type = itemKind(media);
		const trackKind = type === 'audio' ? 'audio' : 'video';
		const from = Math.max(0, Math.round(frame));
		const durationInFrames = itemDuration(media, type, fps);
		const track = targetTrack(trackKind, from, from + durationInFrames, options.preferredTrackId);
		if (!timelineStore.tracks.some((candidate) => candidate.id === track.id)) {
			timelineStore._setTracks([...timelineStore.tracks, track]);
		}
		const canvasWidth =
			sequenceStore.activeSequence?.width ?? editorSession.project?.metadata.width ?? 1920;
		const canvasHeight =
			sequenceStore.activeSequence?.height ?? editorSession.project?.metadata.height ?? 1080;
		const sourceWidth = media.width || canvasWidth;
		const sourceHeight = media.height || canvasHeight;
		const canvasShare = media.tags.includes('sticker') ? 0.32 : 1;
		const fitScale = Math.min(
			(canvasWidth * canvasShare) / sourceWidth,
			(canvasHeight * canvasShare) / sourceHeight
		);
		const sourceFps = media.fps > 0 ? media.fps : fps;
		const sourceDuration = Math.max(
			1,
			Math.round(Math.max(media.duration, 1 / sourceFps) * sourceFps)
		);
		const id = crypto.randomUUID();
		timelineStore._addItem({
			id,
			trackId: track.id,
			from,
			durationInFrames,
			label: options.label ?? media.fileName,
			type,
			mediaId: media.id,
			sourceStart: 0,
			sourceEnd: type === 'image' ? undefined : sourceDuration,
			sourceDuration: type === 'image' ? durationInFrames : sourceDuration,
			sourceFps: type === 'image' ? undefined : sourceFps,
			sourceWidth: type === 'audio' ? undefined : sourceWidth,
			sourceHeight: type === 'audio' ? undefined : sourceHeight,
			transform:
				type === 'audio'
					? undefined
					: {
							x: 0,
							y: 0,
							width: Math.round(sourceWidth * fitScale),
							height: Math.round(sourceHeight * fitScale),
							rotation: 0
						},
			lottieTotalFrames: type === 'lottie' ? (media.lottieTotalFrames ?? 1) : undefined,
			lottieFrameRate: type === 'lottie' ? media.fps || 30 : undefined,
			lottieLoop: type === 'lottie' ? true : undefined,
			lottieMarkers: type === 'lottie' ? media.lottieMarkers : undefined
		});
		return id;
	});
}

export function insertMediaAtPlayhead(
	media: MediaMetadata,
	options: InsertMediaOptions = {}
): string {
	return insertMediaAtFrame(media, timelineStore.currentFrame, options);
}
