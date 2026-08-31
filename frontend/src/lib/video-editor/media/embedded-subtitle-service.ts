/** Embedded subtitle scanning, caching, source-time mapping, and insertion. */

import type { TimelineItem, TimelineTrack } from '../project/types';
import { m } from '$lib/paraglide/messages';
import { execute } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { effectiveMediaTracks, isTrackEffectivelyLocked } from '../timeline/utils/track-groups';
import {
	getItemSourceSpanSeconds,
	sourceSecondsToTimelinePosition
} from '../timeline/utils/media-item-frames';
import {
	extractMatroskaTextSubtitleTracksFromBlob,
	type EmbeddedSubtitleScanOptions,
	type EmbeddedSubtitleTrack
} from './embedded-subtitles';
import type { MediaMetadata } from './types';
import {
	getEmbeddedSubtitleCache,
	saveEmbeddedSubtitleCache
} from '../workspace-fs/embedded-subtitles';

export interface EmbeddedSubtitleScanResult {
	tracks: readonly EmbeddedSubtitleTrack[];
	scannedAt: number;
	fromCache: boolean;
}

export interface EmbeddedSubtitleInsertOptions {
	canvasWidth: number;
	canvasHeight: number;
}

export interface EmbeddedSubtitleInsertResult {
	itemIds: string[];
	cueCount: number;
	trackLabel: string;
}

export function canExtractEmbeddedSubtitles(media: MediaMetadata): boolean {
	const extension = media.fileName.split('.').at(-1)?.toLowerCase();
	return (
		extension === 'mkv' ||
		extension === 'mka' ||
		extension === 'webm' ||
		media.mimeType.includes('matroska') ||
		media.mimeType.includes('webm')
	);
}

export function formatEmbeddedSubtitleTrackLabel(track: EmbeddedSubtitleTrack): string {
	const identity = track.name?.trim() || track.language || `Track ${track.trackNumber}`;
	return `${identity} - ${track.codecId} - ${track.cues.length} cue${track.cues.length === 1 ? '' : 's'}`;
}

export function chooseEmbeddedSubtitleTrack(
	tracks: readonly EmbeddedSubtitleTrack[]
): EmbeddedSubtitleTrack | null {
	return (
		tracks.find((track) => track.forced) ??
		tracks.find((track) => track.default) ??
		tracks.find((track) => /^en(?:g|[-_]|$)/i.test(track.language)) ??
		tracks[0] ??
		null
	);
}

export async function scanEmbeddedSubtitleTracks(
	media: MediaMetadata,
	blob: Blob,
	options: EmbeddedSubtitleScanOptions = {}
): Promise<EmbeddedSubtitleScanResult> {
	const cached = await getEmbeddedSubtitleCache(media);
	if (cached) {
		options.onProgress?.({
			bytesRead: blob.size,
			totalBytes: blob.size,
			clusters: 0
		});
		return {
			tracks: cached.tracks,
			scannedAt: cached.scannedAt,
			fromCache: true
		};
	}
	const tracks = await extractMatroskaTextSubtitleTracksFromBlob(blob, options);
	let scannedAt = Date.now();
	scannedAt = await saveEmbeddedSubtitleCache(media, tracks).catch(() => scannedAt);
	return { tracks, scannedAt, fromCache: false };
}

function targetClips(items: readonly TimelineItem[], mediaId: string): TimelineItem[] {
	const matching = items
		.filter(
			(item) =>
				(item.type === 'video' || item.type === 'audio') &&
				item.mediaId === mediaId &&
				item.isReversed !== true
		)
		.toSorted((left, right) => {
			if (left.linkedGroupId === right.linkedGroupId && left.type !== right.type) {
				return left.type === 'video' ? -1 : 1;
			}
			return left.from - right.from;
		});
	const linkedGroups = new Set<string>();
	return matching.filter((item) => {
		if (!item.linkedGroupId) return true;
		if (linkedGroups.has(item.linkedGroupId)) return false;
		linkedGroups.add(item.linkedGroupId);
		return true;
	});
}

function subtitleForClip(item: TimelineItem, clipIds: ReadonlySet<string>): boolean {
	return (
		(item.type === 'subtitle' || item.type === 'text') &&
		item.captionSource?.type === 'embedded-subtitles' &&
		clipIds.has(item.captionSource.clipId)
	);
}

function buildSubtitleForClip(
	media: MediaMetadata,
	track: EmbeddedSubtitleTrack,
	clip: TimelineItem,
	options: EmbeddedSubtitleInsertOptions
): TimelineItem | null {
	const timelineFps = timelineStore.fps;
	const sourceFps =
		clip.sourceFps && clip.sourceFps > 0 ? clip.sourceFps : media.fps || timelineFps;
	const sourceStart = Math.max(0, clip.sourceStart ?? 0);
	const fallbackSourceFrames =
		clip.sourceDuration ??
		Math.max(1, Math.round((clip.durationInFrames / timelineFps) * (clip.speed ?? 1) * sourceFps));
	const sourceEnd = Math.max(sourceStart + 1, clip.sourceEnd ?? sourceStart + fallbackSourceFrames);
	const sourceSpan = getItemSourceSpanSeconds(clip, timelineFps);
	const sourceStartSeconds = sourceSpan?.start ?? sourceStart / sourceFps;
	const sourceEndSeconds = sourceSpan?.end ?? sourceEnd / sourceFps;
	const cues = track.cues.flatMap((cue) => {
		const overlapStart = Math.max(cue.startSeconds, sourceStartSeconds);
		const overlapEnd = Math.min(cue.endSeconds, sourceEndSeconds);
		if (overlapEnd <= overlapStart) return [];
		const mappedStart = sourceSecondsToTimelinePosition(clip, overlapStart, timelineFps);
		const mappedEnd = sourceSecondsToTimelinePosition(clip, overlapEnd, timelineFps);
		const startFrame = Math.max(clip.from, Math.floor(Math.min(mappedStart, mappedEnd)));
		const endFrame = Math.min(
			clip.from + clip.durationInFrames,
			Math.max(startFrame + 1, Math.ceil(Math.max(mappedStart, mappedEnd)))
		);
		if (endFrame <= startFrame) return [];
		return [{ id: cue.id, startFrame, endFrame, text: cue.text }];
	});
	if (cues.length === 0) return null;
	const from = cues.reduce(
		(minimum, cue) => Math.min(minimum, cue.startFrame),
		cues[0]!.startFrame
	);
	const end = cues.reduce((maximum, cue) => Math.max(maximum, cue.endFrame), from + 1);
	return {
		id: crypto.randomUUID(),
		trackId: clip.trackId,
		from,
		durationInFrames: Math.max(1, end - from),
		label: `${media.fileName} - ${track.name?.trim() || track.language || 'Subtitles'}`,
		type: 'subtitle',
		mediaId: media.id,
		linkedGroupId: clip.linkedGroupId,
		captionSource: {
			type: 'embedded-subtitles',
			mediaId: media.id,
			clipId: clip.id,
			trackNumber: track.trackNumber,
			language: track.language,
			trackName: track.name,
			codecId: track.codecId,
			importedAt: Date.now()
		},
		cues,
		fontSize: Math.max(36, Math.round(options.canvasHeight * 0.045)),
		fontFamily: 'Inter',
		fontWeight: 600,
		fontStyle: 'normal',
		underline: false,
		color: '#ffffff',
		backgroundColor: 'rgba(0, 0, 0, 0.55)',
		backgroundFit: 'content',
		textAlign: 'center',
		verticalAlign: 'middle',
		lineHeight: 1.15,
		letterSpacing: 0,
		paddingX: 16,
		paddingY: 8,
		borderRadius: 8,
		textShadow: {
			offsetX: 0,
			offsetY: 3,
			blur: 10,
			color: 'rgba(0, 0, 0, 0.75)'
		},
		transform: {
			x: 0,
			y: Math.round(options.canvasHeight * 0.32),
			width: Math.round(options.canvasWidth * 0.82),
			height: Math.round(options.canvasHeight * 0.16),
			rotation: 0,
			opacity: 1
		}
	};
}

function rangesOverlap(left: TimelineItem, right: TimelineItem): boolean {
	return (
		left.from < right.from + right.durationInFrames &&
		right.from < left.from + left.durationInFrames
	);
}

interface CaptionTrackChoice {
	track: TimelineTrack;
	created: boolean;
}

function chooseCaptionTrack(
	tracks: readonly TimelineTrack[],
	remainingItems: readonly TimelineItem[],
	segments: readonly TimelineItem[]
): CaptionTrackChoice {
	for (const track of effectiveMediaTracks(tracks).toSorted(
		(left, right) => left.order - right.order
	)) {
		if (track.kind === 'audio' || track.locked) continue;
		const items = remainingItems.filter((item) => item.trackId === track.id);
		if (segments.every((segment) => items.every((item) => !rangesOverlap(segment, item)))) {
			return { track, created: false };
		}
	}
	const minimumOrder = tracks.length > 0 ? Math.min(...tracks.map((track) => track.order)) : 0;
	return {
		created: true,
		track: {
			id: crypto.randomUUID(),
			name: m.video_editor_captions_lane(),
			kind: 'video',
			height: 64,
			locked: false,
			syncLock: false,
			visible: true,
			muted: false,
			solo: false,
			order: minimumOrder - 1
		}
	};
}

export function insertEmbeddedSubtitleTrack(
	media: MediaMetadata,
	track: EmbeddedSubtitleTrack,
	options: EmbeddedSubtitleInsertOptions
): EmbeddedSubtitleInsertResult {
	const clips = targetClips(timelineStore.items, media.id);
	const clipIds = new Set(
		timelineStore.items
			.filter(
				(item) =>
					(item.type === 'video' || item.type === 'audio') &&
					item.mediaId === media.id &&
					item.isReversed !== true
			)
			.map((clip) => clip.id)
	);
	const obsoleteIds = new Set(
		timelineStore.items.filter((item) => subtitleForClip(item, clipIds)).map((item) => item.id)
	);
	const obsoleteItems = timelineStore.items.filter((item) => obsoleteIds.has(item.id));
	if (obsoleteItems.some((item) => isTrackEffectivelyLocked(item.trackId, timelineStore.tracks))) {
		throw new Error(m.video_editor_transcribe_unlock_existing());
	}
	const segments = clips
		.map((clip) => buildSubtitleForClip(media, track, clip, options))
		.filter((item): item is TimelineItem => item !== null);
	if (segments.length === 0 && obsoleteIds.size === 0) {
		return {
			itemIds: [],
			cueCount: 0,
			trackLabel: formatEmbeddedSubtitleTrackLabel(track)
		};
	}

	return execute('INSERT_EMBEDDED_SUBTITLES', () => {
		const remainingItems = timelineStore.items.filter((item) => !obsoleteIds.has(item.id));
		let placed = segments;
		if (segments.length > 0) {
			const target = chooseCaptionTrack(timelineStore.tracks, remainingItems, segments);
			if (target.created) {
				timelineStore._setTracks(
					[...timelineStore.tracks, target.track].toSorted(
						(left, right) => left.order - right.order
					)
				);
			}
			placed = segments.map((item) => ({ ...item, trackId: target.track.id }));
		}
		timelineStore._setItems([...remainingItems, ...placed]);
		return {
			itemIds: placed.map((item) => item.id),
			cueCount: placed.reduce((count, item) => count + (item.cues?.length ?? 0), 0),
			trackLabel: formatEmbeddedSubtitleTrackLabel(track)
		};
	});
}
