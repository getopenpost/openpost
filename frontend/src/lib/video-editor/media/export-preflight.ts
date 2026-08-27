/** Pure export readiness checks shared by the dialog and render queue. */

import type { VideoCodec } from 'mediabunny';
import type { Project, TimelineItem, TimelineTrack, TimelineTransition } from '../project/types';
import { effectiveMediaTracks } from '../timeline/utils/track-groups';
import type { MediaPreparationStatus } from './pool.svelte';
import { assessSmartCopy, type SmartCopyFormat } from './smart-copy-plan';
import type { MediaMetadata } from './types';

export type ExportPreflightSeverity = 'ok' | 'info' | 'warning' | 'error';
export type ExportPreflightCheckId =
	| 'empty-range'
	| 'export-range-ready'
	| 'no-renderable-content'
	| 'no-audible-content'
	| 'missing-media'
	| 'media-ready'
	| 'video-codec-checking'
	| 'video-codec-supported'
	| 'video-codec-unavailable'
	| 'image-encode-unavailable'
	| 'image-encode-checking'
	| 'subtitle-burn-fallback'
	| 'smart-copy'
	| 'worker-render'
	| 'main-thread-render'
	| 'long-render'
	| 'output-too-large';

export interface ExportPreflightCheck {
	id: ExportPreflightCheckId;
	severity: ExportPreflightSeverity;
	count?: number;
	frames?: number;
	seconds?: number;
	minutes?: number;
	sizeBytes?: number;
}

export interface ExportPreflightSettings {
	format: 'webm' | 'mp4' | 'mov' | 'mkv' | 'mp3' | 'aac' | 'wav' | 'png-sequence' | 'jpeg-sequence' | 'webp-sequence';
	codec?: VideoCodec;
	quality: 'draft' | 'standard' | 'high';
	width: number;
	height: number;
	subtitleMode: 'none' | 'burn' | 'sidecar' | 'embedded';
	range?: { startFrame: number; endFrame: number };
	jpegQuality?: number;
}

export interface ExportPreflightInput {
	settings: ExportPreflightSettings;
	fps: number;
	projectWidth?: number;
	projectHeight?: number;
	items: readonly TimelineItem[];
	tracks: readonly TimelineTrack[];
	transitions?: readonly TimelineTransition[];
	codecSupported: boolean | undefined;
	webpSupported?: boolean | undefined;
	mediaStatuses: Readonly<Record<string, MediaPreparationStatus | undefined>>;
	media?: readonly MediaMetadata[];
	workerAvailable?: boolean;
}

export interface ExportPreflightRange {
	startFrame: number;
	endFrame: number;
	frameCount: number;
}

export interface ExportPreflightResult {
	canExport: boolean;
	pending: boolean;
	checks: ExportPreflightCheck[];
	range: ExportPreflightRange;
	predictedRenderPath: 'smart-copy' | 'worker' | 'main-thread';
	estimatedDurationSeconds: number;
	estimatedFileSizeBytes: number;
}

const VIDEO_BITRATES = {
	draft: 4_000_000,
	standard: 8_000_000,
	high: 16_000_000
} as const;
const AUDIO_BITRATE = 192_000;
const WAV_BITRATE = 48_000 * 2 * 16;
const IN_MEMORY_OUTPUT_LIMIT = 2 * 1024 ** 3;
const LONG_RENDER_SECONDS = 30 * 60;

function isAudioFormat(format: ExportPreflightSettings['format']): boolean {
	return format === 'mp3' || format === 'aac' || format === 'wav';
}

function isImageSequenceFormat(format: ExportPreflightSettings['format']): boolean {
	return format === 'png-sequence' || format === 'jpeg-sequence' || format === 'webp-sequence';
}

function isVideoFormat(format: ExportPreflightSettings['format']): format is SmartCopyFormat {
	return format === 'webm' || format === 'mp4' || format === 'mov' || format === 'mkv';
}

function projectEnd(items: readonly TimelineItem[]): number {
	return items.reduce((maximum, item) => Math.max(maximum, item.from + item.durationInFrames), 0);
}

function resolveRange(
	items: readonly TimelineItem[],
	range: ExportPreflightSettings['range']
): ExportPreflightRange {
	const startFrame = Math.max(0, Math.floor(range?.startFrame ?? 0));
	const endFrame = Math.max(0, Math.floor(range?.endFrame ?? projectEnd(items)));
	return {
		startFrame,
		endFrame,
		frameCount: Math.max(0, endFrame - startFrame)
	};
}

function overlapsRange(item: TimelineItem, range: ExportPreflightRange): boolean {
	return item.from < range.endFrame && range.startFrame < item.from + item.durationInFrames;
}

function activeTrackIds(tracks: readonly TimelineTrack[]): Set<string> {
	const solo = tracks.filter((track) => track.solo);
	return new Set((solo.length > 0 ? solo : tracks).map((track) => track.id));
}

function visibleItems(
	items: readonly TimelineItem[],
	tracks: readonly TimelineTrack[],
	range: ExportPreflightRange
): TimelineItem[] {
	const resolvedTracks = effectiveMediaTracks(tracks);
	const byId = new Map(resolvedTracks.map((track) => [track.id, track]));
	const activeIds = activeTrackIds(resolvedTracks);
	return items.filter((item) => {
		const track = byId.get(item.trackId);
		return Boolean(track && activeIds.has(track.id) && track.visible && overlapsRange(item, range));
	});
}

function hasRenderableContent(items: readonly TimelineItem[]): boolean {
	return items.some((item) => item.type !== 'adjustment');
}

function hasAudibleContent(
	items: readonly TimelineItem[],
	tracks: readonly TimelineTrack[]
): boolean {
	const byId = new Map(effectiveMediaTracks(tracks).map((track) => [track.id, track]));
	return items.some((item) => {
		if (item.type !== 'audio' && item.type !== 'video') return false;
		const track = byId.get(item.trackId);
		return Boolean(track && !track.muted && (track.volume ?? 1) > 0 && (item.volume ?? 1) > 0);
	});
}

function needsSourceMedia(item: TimelineItem): boolean {
	return (
		item.type === 'video' ||
		item.type === 'audio' ||
		item.type === 'image' ||
		item.type === 'lottie'
	);
}

function referencedMediaIds(items: readonly TimelineItem[]): Set<string> {
	return new Set(
		items
			.filter((item) => needsSourceMedia(item) && Boolean(item.mediaId))
			.flatMap((item) => (item.mediaId ? [item.mediaId] : []))
	);
}

function estimateFileSize(
	settings: ExportPreflightSettings,
	durationSeconds: number,
	audible: boolean,
	frameCount?: number
): number {
	if (isImageSequenceFormat(settings.format)) {
		const count = frameCount ?? Math.max(0, Math.round(durationSeconds * 30));
		const perPixel =
			settings.format === 'png-sequence' ? 0.55 : settings.format === 'webp-sequence' ? 0.28 : 0.18;
		return Math.ceil(settings.width * settings.height * perPixel * count);
	}
	let bitsPerSecond: number;
	if (settings.format === 'wav') bitsPerSecond = WAV_BITRATE;
	else if (isAudioFormat(settings.format)) bitsPerSecond = AUDIO_BITRATE;
	else bitsPerSecond = VIDEO_BITRATES[settings.quality] + (audible ? AUDIO_BITRATE : 0);
	return Math.ceil((bitsPerSecond * durationSeconds) / 8);
}

export function assessExportPreflight(input: ExportPreflightInput): ExportPreflightResult {
	const checks: ExportPreflightCheck[] = [];
	const range = resolveRange(input.items, input.settings.range);
	const estimatedDurationSeconds = range.frameCount / Math.max(1, input.fps);
	const activeItems = visibleItems(input.items, input.tracks, range);
	const audioFormat = isAudioFormat(input.settings.format);
	const audible = hasAudibleContent(activeItems, input.tracks);
	const smartCopyAssessment = isVideoFormat(input.settings.format)
		? assessSmartCopy(
				{
					id: 'export-preflight',
					name: 'Export',
					description: '',
					createdAt: 0,
					updatedAt: 0,
					duration: projectEnd(input.items),
					metadata: {
						fps: input.fps,
						width: input.projectWidth ?? input.settings.width,
						height: input.projectHeight ?? input.settings.height
					},
					timeline: {
						items: [...input.items],
						tracks: [...input.tracks],
						transitions: [...(input.transitions ?? [])]
					}
				} satisfies Project,
				{ ...input.settings, format: input.settings.format },
				input.media ?? []
			)
		: null;
	const smartCopyEligible = smartCopyAssessment?.eligible === true;

	if (range.frameCount === 0) {
		checks.push({ id: 'empty-range', severity: 'error' });
	} else {
		checks.push({
			id: 'export-range-ready',
			severity: 'ok',
			frames: range.frameCount,
			seconds: estimatedDurationSeconds
		});
	}

	if (!audioFormat && range.frameCount > 0 && !hasRenderableContent(activeItems)) {
		checks.push({ id: 'no-renderable-content', severity: 'error' });
	}
	if (audioFormat && range.frameCount > 0 && !audible) {
		checks.push({ id: 'no-audible-content', severity: 'error' });
	}

	const mediaIds = referencedMediaIds(input.items);
	const missingCount = [...mediaIds].filter((id) => input.mediaStatuses[id] !== 'ready').length;
	if (missingCount > 0) {
		checks.push({
			id: 'missing-media',
			severity: 'error',
			count: missingCount
		});
	} else if (mediaIds.size > 0) {
		checks.push({ id: 'media-ready', severity: 'ok', count: mediaIds.size });
	}

	let pending = false;
	const imageSequence = isImageSequenceFormat(input.settings.format);
	if (imageSequence && input.settings.format === 'webp-sequence') {
		if (input.webpSupported === undefined) {
			pending = true;
			checks.push({ id: 'image-encode-checking', severity: 'info' });
		} else if (input.webpSupported === false) {
			checks.push({ id: 'image-encode-unavailable', severity: 'error' });
		}
	}
	if (!audioFormat && !imageSequence && !smartCopyEligible) {
		if (input.codecSupported === undefined) {
			pending = true;
			checks.push({ id: 'video-codec-checking', severity: 'info' });
		} else if (!input.codecSupported) {
			checks.push({ id: 'video-codec-unavailable', severity: 'error' });
		} else {
			checks.push({ id: 'video-codec-supported', severity: 'ok' });
		}
		if (
			input.settings.subtitleMode === 'embedded' &&
			input.settings.format !== 'webm' &&
			input.settings.format !== 'mkv'
		) {
			checks.push({ id: 'subtitle-burn-fallback', severity: 'warning' });
		}
	}

	const predictedRenderPath = smartCopyEligible
		? 'smart-copy'
		: input.workerAvailable === false
			? 'main-thread'
			: 'worker';
	checks.push({
		id:
			predictedRenderPath === 'smart-copy'
				? 'smart-copy'
				: predictedRenderPath === 'worker'
					? 'worker-render'
					: 'main-thread-render',
		severity: predictedRenderPath === 'smart-copy' ? 'info' : 'ok'
	});
	const estimatedFileSizeBytes = smartCopyEligible
		? Math.ceil(
				((smartCopyAssessment.plan.media.bitrate || VIDEO_BITRATES.standard) *
					estimatedDurationSeconds) /
					8
			)
		: estimateFileSize(input.settings, estimatedDurationSeconds, audible, range.frameCount);
	if (estimatedDurationSeconds >= LONG_RENDER_SECONDS) {
		checks.push({
			id: 'long-render',
			severity: 'warning',
			minutes: Math.round(estimatedDurationSeconds / 60)
		});
	}
	if (estimatedFileSizeBytes >= IN_MEMORY_OUTPUT_LIMIT) {
		checks.push({
			id: 'output-too-large',
			severity: 'error',
			sizeBytes: estimatedFileSizeBytes
		});
	}

	return {
		canExport: !pending && !checks.some((check) => check.severity === 'error'),
		pending,
		checks,
		range,
		predictedRenderPath,
		estimatedDurationSeconds,
		estimatedFileSizeBytes
	};
}

export function summarizePreflightSeverity(
	checks: readonly ExportPreflightCheck[]
): ExportPreflightSeverity {
	if (checks.some((check) => check.severity === 'error')) return 'error';
	if (checks.some((check) => check.severity === 'warning')) return 'warning';
	if (checks.some((check) => check.severity === 'info')) return 'info';
	return 'ok';
}
