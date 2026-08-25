import type { MediaMetadata } from '../media/types';
import type { TimelineItem, TimelineItemKind, TimelineTrack } from '../project/types';
import { editorSession } from '../editor.svelte';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { execute } from '../timeline/commands/command-store.svelte';
import { pruneInvalidTransitions } from '../timeline/actions/transitions.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { effectiveMediaTracks } from '../timeline/utils/track-groups';

export type SourcePatchTarget = 'auto' | 'create' | string;

export interface SourceEditRequest {
	media: MediaMetadata;
	inFrame: number;
	outFrame: number;
	insertFrame: number;
	videoEnabled: boolean;
	audioEnabled: boolean;
	videoTarget: SourcePatchTarget;
	audioTarget: SourcePatchTarget;
	createdVideoTrackName?: string;
	createdAudioTrackName?: string;
	mode: 'insert' | 'overwrite';
}

export interface SourceEditResult {
	itemIds: string[];
	endFrame: number;
}

export type SourceEditErrorCode = 'no-patch' | 'target-locked' | 'target-invalid' | 'empty-range';

export class SourceEditError extends Error {
	constructor(readonly code: SourceEditErrorCode) {
		super(code);
		this.name = 'SourceEditError';
	}
}

function mediaKind(media: MediaMetadata): 'video' | 'audio' | 'image' | 'lottie' {
	if (media.tags.includes('lottie')) return 'lottie';
	if (media.tags.includes('audio')) return 'audio';
	if (media.tags.includes('image')) return 'image';
	return 'video';
}

function availableTracks(kind: 'video' | 'audio'): TimelineTrack[] {
	return effectiveMediaTracks(timelineStore.tracks)
		.filter((track) => (kind === 'audio' ? track.kind === 'audio' : track.kind !== 'audio'))
		.toSorted((left, right) => left.order - right.order);
}

function createTrack(kind: 'video' | 'audio', name?: string): TimelineTrack {
	const sameKind = availableTracks(kind);
	const orders = timelineStore.tracks.map((track) => track.order);
	const track: TimelineTrack = {
		id: crypto.randomUUID(),
		name:
			name ?? (kind === 'audio' ? `Audio ${sameKind.length + 1}` : `Video ${sameKind.length + 1}`),
		kind,
		height: kind === 'audio' ? 72 : 96,
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
	timelineStore._setTracks([...timelineStore.tracks, track]);
	return track;
}

function resolveTrack(
	kind: 'video' | 'audio',
	target: SourcePatchTarget,
	name?: string
): TimelineTrack {
	if (target !== 'auto' && target !== 'create') {
		const track = timelineStore.tracks.find((candidate) => candidate.id === target);
		if (!track || (kind === 'audio' ? track.kind !== 'audio' : track.kind === 'audio')) {
			throw new SourceEditError('target-invalid');
		}
		if (track.locked) throw new SourceEditError('target-locked');
		return track;
	}
	if (target !== 'create') {
		const tracks = availableTracks(kind).filter((track) => !track.locked);
		const automatic = kind === 'audio' ? tracks[0] : tracks.at(-1);
		if (automatic) return automatic;
	}
	return createTrack(kind, name);
}

function sourceDurationFrames(media: MediaMetadata, kind: ReturnType<typeof mediaKind>): number {
	if (kind === 'image') return Math.max(1, Math.round(editorSession.fps * 3));
	if (kind === 'lottie')
		return media.lottieTotalFrames ?? Math.max(1, Math.round(media.duration * media.fps));
	return Math.max(1, Math.round(media.duration * (media.fps || editorSession.fps)));
}

type BuildItemsResult = {
	items: TimelineItem[];
	durationInFrames: number;
};

function buildItems(
	request: SourceEditRequest,
	videoTrack: TimelineTrack | null,
	audioTrack: TimelineTrack | null
): BuildItemsResult {
	const kind = mediaKind(request.media);
	const nativeFps = request.media.fps || editorSession.fps;
	const sourceDuration = sourceDurationFrames(request.media, kind);
	const inFrame = Math.max(0, Math.min(Math.round(request.inFrame), sourceDuration - 1));
	const outFrame = Math.max(inFrame + 1, Math.min(Math.round(request.outFrame), sourceDuration));
	const durationInFrames =
		kind === 'image'
			? Math.max(1, outFrame - inFrame)
			: Math.max(1, Math.round(((outFrame - inFrame) / nativeFps) * editorSession.fps));
	const canvasWidth =
		sequenceStore.activeSequence?.width ?? editorSession.project?.metadata.width ?? 1920;
	const canvasHeight =
		sequenceStore.activeSequence?.height ?? editorSession.project?.metadata.height ?? 1080;
	const sourceWidth = request.media.width || canvasWidth;
	const sourceHeight = request.media.height || canvasHeight;
	const fitScale = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
	const linkedGroupId = videoTrack && audioTrack ? crypto.randomUUID() : undefined;
	const items: TimelineItem[] = [];

	if (videoTrack && kind !== 'audio') {
		const type: TimelineItemKind = kind;
		items.push({
			id: crypto.randomUUID(),
			trackId: videoTrack.id,
			from: request.insertFrame,
			durationInFrames,
			label: request.media.fileName,
			type,
			mediaId: request.media.id,
			linkedGroupId,
			sourceStart: kind === 'image' ? undefined : inFrame,
			sourceEnd: kind === 'image' ? undefined : outFrame,
			sourceDuration,
			sourceFps: kind === 'image' ? undefined : nativeFps,
			sourceWidth,
			sourceHeight,
			volume: kind === 'video' && !audioTrack ? 0 : undefined,
			transform: {
				x: 0,
				y: 0,
				width: Math.max(1, Math.round(sourceWidth * fitScale)),
				height: Math.max(1, Math.round(sourceHeight * fitScale)),
				rotation: 0
			},
			lottieTotalFrames: kind === 'lottie' ? (request.media.lottieTotalFrames ?? 1) : undefined,
			lottieFrameRate: kind === 'lottie' ? nativeFps : undefined,
			lottieLoop: kind === 'lottie' ? true : undefined,
			lottieSegmentStart: kind === 'lottie' ? inFrame : undefined,
			lottieSegmentEnd: kind === 'lottie' ? outFrame - 1 : undefined,
			lottieMarkers: kind === 'lottie' ? request.media.lottieMarkers : undefined
		});
	}

	if (audioTrack && (kind === 'audio' || (kind === 'video' && request.media.audioCodec))) {
		items.push({
			id: crypto.randomUUID(),
			trackId: audioTrack.id,
			from: request.insertFrame,
			durationInFrames,
			label: request.media.fileName,
			type: 'audio',
			mediaId: request.media.id,
			linkedGroupId,
			sourceStart: inFrame,
			sourceEnd: outFrame,
			sourceDuration,
			sourceFps: nativeFps,
			volume: 1
		});
	}
	return { items, durationInFrames };
}

function splitCrossingItems(trackId: string, frame: number): void {
	for (const item of [...timelineStore.items]) {
		if (
			item.trackId !== trackId ||
			item.from >= frame ||
			item.from + item.durationInFrames <= frame
		) {
			continue;
		}
		timelineStore._splitItem(item.id, frame);
	}
}

function insertItems(items: TimelineItem[], duration: number): void {
	const trackIds = [...new Set(items.map((item) => item.trackId))];
	for (const trackId of trackIds) {
		splitCrossingItems(trackId, items[0]!.from);
		timelineStore._moveItems(
			timelineStore.items
				.filter((candidate) => candidate.trackId === trackId && candidate.from >= items[0]!.from)
				.map((item) => ({ id: item.id, from: item.from + duration }))
		);
	}
	timelineStore._setItems([...timelineStore.items, ...items]);
}

function overwriteItems(items: TimelineItem[], duration: number): void {
	const start = items[0]!.from;
	const end = start + duration;
	for (const trackId of new Set(items.map((item) => item.trackId))) {
		const overlapping = timelineStore.items.filter(
			(item) =>
				item.trackId === trackId && item.from < end && item.from + item.durationInFrames > start
		);
		for (const item of overlapping) {
			const itemEnd = item.from + item.durationInFrames;
			const startsBefore = item.from < start;
			const endsAfter = itemEnd > end;
			if (!startsBefore && !endsAfter) timelineStore._removeItems([item.id]);
			else if (startsBefore && endsAfter) {
				const first = timelineStore._splitItem(item.id, start);
				const second = first ? timelineStore._splitItem(first.rightItem.id, end) : null;
				if (second) timelineStore._removeItems([second.leftItem.id]);
			} else if (startsBefore) {
				const split = timelineStore._splitItem(item.id, start);
				if (split) timelineStore._removeItems([split.rightItem.id]);
			} else {
				const split = timelineStore._splitItem(item.id, end);
				if (split) timelineStore._removeItems([split.leftItem.id]);
			}
		}
	}
	timelineStore._setItems([...timelineStore.items, ...items]);
}

export function applySourceEdit(request: SourceEditRequest): SourceEditResult {
	const kind = mediaKind(request.media);
	const canUseVideo = request.videoEnabled && kind !== 'audio';
	const canUseAudio =
		request.audioEnabled && (kind === 'audio' || (kind === 'video' && !!request.media.audioCodec));
	if (!canUseVideo && !canUseAudio) throw new SourceEditError('no-patch');

	return execute(request.mode === 'insert' ? 'SOURCE_INSERT_EDIT' : 'SOURCE_OVERWRITE_EDIT', () => {
		const videoTrack = canUseVideo
			? resolveTrack('video', request.videoTarget, request.createdVideoTrackName)
			: null;
		const audioTrack = canUseAudio
			? resolveTrack('audio', request.audioTarget, request.createdAudioTrackName)
			: null;
		const built = buildItems(request, videoTrack, audioTrack);
		if (built.items.length === 0) throw new SourceEditError('empty-range');
		if (request.mode === 'insert') insertItems(built.items, built.durationInFrames);
		else overwriteItems(built.items, built.durationInFrames);
		pruneInvalidTransitions();
		const endFrame = request.insertFrame + built.durationInFrames;
		editorSession.clock.seek(endFrame);
		return { itemIds: built.items.map((item) => item.id), endFrame };
	});
}
