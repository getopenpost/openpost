/**
 * End-to-end transcription action: stream a clip through the selected local
 * speech engine and convert word timings into cues on a subtitle
 * item as one undoable step.
 *
 * Ported from FreeCut (MIT) transcription flow, retargeted to OpenPost's
 * timeline store and cue model.
 */

import type { TimelineItem } from '../project/types';
import { m } from '$lib/paraglide/messages';
import { execute } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { editorSettings } from '../settings/editor-settings.svelte';
import {
	captionStylePresetById,
	resolveCaptionStylePatch
} from '../typography/caption-style-presets';
import { buildCuesFromWords, type TranscriptWord } from './cues';
import { BrowserTranscriber } from './engine/transcriber';
import type { TranscribeOptions } from './engine/types';
import { isTrackEffectivelyLocked } from '../timeline/utils/track-groups';
import { ensureOpenTrackForRange } from '../timeline/actions/track-placement';

export interface TranscriptionSourceWindow {
	sourceStartSeconds: number;
	sourceEndSeconds: number;
}

export interface TranscriptionSourceSnapshot extends TranscriptionSourceWindow {
	itemId: string;
	mediaId: string;
	from: number;
	durationInFrames: number;
	sourceStart?: number;
	sourceEnd?: number;
	sourceFps: number;
	speed: number;
	isReversed: boolean;
}

export function transcriptionSourceWindow(
	item: TimelineItem,
	timelineFps = timelineStore.fps
): TranscriptionSourceWindow {
	const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : 30;
	const speed = item.speed && item.speed > 0 ? item.speed : 1;
	const sourceStartSeconds = Math.max(0, (item.sourceStart ?? 0) / sourceFps);
	const derivedSourceEnd =
		(item.sourceStart ?? 0) +
		(item.durationInFrames * speed * sourceFps) / Math.max(1, timelineFps);
	const sourceEndSeconds = Math.max(
		sourceStartSeconds,
		(item.sourceEnd ?? derivedSourceEnd) / sourceFps
	);
	return { sourceStartSeconds, sourceEndSeconds };
}

export function captureTranscriptionSource(item: TimelineItem): TranscriptionSourceSnapshot {
	const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : 30;
	const speed = item.speed && item.speed > 0 ? item.speed : 1;
	return {
		itemId: item.id,
		mediaId: item.mediaId ?? '',
		from: item.from,
		durationInFrames: item.durationInFrames,
		sourceStart: item.sourceStart,
		sourceEnd: item.sourceEnd,
		sourceFps,
		speed,
		isReversed: item.isReversed === true,
		...transcriptionSourceWindow(item)
	};
}

function sourceStillMatches(
	item: TimelineItem,
	expected: TranscriptionSourceWindow | TranscriptionSourceSnapshot
): boolean {
	const currentWindow = transcriptionSourceWindow(item);
	if (
		currentWindow.sourceStartSeconds !== expected.sourceStartSeconds ||
		currentWindow.sourceEndSeconds !== expected.sourceEndSeconds
	) {
		return false;
	}
	if (!('itemId' in expected)) return true;
	const current = captureTranscriptionSource(item);
	return (
		current.itemId === expected.itemId &&
		current.mediaId === expected.mediaId &&
		current.from === expected.from &&
		current.durationInFrames === expected.durationInFrames &&
		current.sourceStart === expected.sourceStart &&
		current.sourceEnd === expected.sourceEnd &&
		current.sourceFps === expected.sourceFps &&
		current.speed === expected.speed &&
		current.isReversed === expected.isReversed
	);
}

export async function transcribeClip(
	item: TimelineItem,
	file: File,
	options: TranscribeOptions = {}
): Promise<TranscriptWord[]> {
	const sourceWindow = transcriptionSourceWindow(item);
	const sourceStartSeconds = options.sourceStartSeconds ?? sourceWindow.sourceStartSeconds;
	const sourceEndSeconds = options.sourceEndSeconds ?? sourceWindow.sourceEndSeconds;
	return transcribeSource(file, { ...options, sourceStartSeconds, sourceEndSeconds });
}

/** Transcribe an explicit source window without requiring a timeline item. */
export async function transcribeSource(
	file: File,
	options: TranscribeOptions = {}
): Promise<TranscriptWord[]> {
	const transcriber = new BrowserTranscriber();
	const segments = await transcriber.transcribe(file, options).collect();
	return segments.flatMap((segment) =>
		(segment.words ?? []).map((word) => ({
			text: word.text,
			startSeconds: word.start,
			endSeconds: word.end
		}))
	);
}

/** Create or replace the generated subtitle item for one exact clip source window. */
export interface GeneratedCaptionCanvas {
	width: number;
	height: number;
}

export function addGeneratedSubtitleItem(
	sourceItemId: string,
	words: TranscriptWord[],
	expectedSource?: TranscriptionSourceWindow | TranscriptionSourceSnapshot,
	canvas: GeneratedCaptionCanvas = { width: 1920, height: 1080 }
): string {
	// SAFETY: execute returns the action's own string id unchanged.
	return execute('ADD_GENERATED_SUBTITLES', () => {
		const source = timelineStore.itemById.get(sourceItemId);
		if (!source) throw new Error('Source clip is gone');
		if (expectedSource && !sourceStillMatches(source, expectedSource)) {
			throw new Error(m.video_editor_transcribe_source_changed());
		}
		const fps = timelineStore.fps;
		const speed = source.speed && source.speed > 0 ? source.speed : 1;
		const { sourceStartSeconds, sourceEndSeconds } = transcriptionSourceWindow(source);
		const cueWords = source.isReversed
			? words
					.map((word) => ({
						...word,
						startSeconds: Math.max(0, sourceEndSeconds - sourceStartSeconds - word.endSeconds),
						endSeconds: Math.max(0, sourceEndSeconds - sourceStartSeconds - word.startSeconds)
					}))
					.toSorted((left, right) => left.startSeconds - right.startSeconds)
			: words;
		const cues = buildCuesFromWords(cueWords, { fps: fps / speed });
		if (cues.length === 0) throw new Error('Transcription produced no words');
		const matches = timelineStore.items.filter(
			(item) => item.captionSource?.type === 'transcript' && item.captionSource.clipId === source.id
		);
		if (matches.some((item) => isTrackEffectivelyLocked(item.trackId, timelineStore.tracks))) {
			throw new Error(m.video_editor_transcribe_unlock_existing());
		}
		const existing = matches[0];
		if (
			!existing &&
			!timelineStore.tracks.some(
				(track) =>
					track.kind === 'video' && !isTrackEffectivelyLocked(track.id, timelineStore.tracks)
			)
		) {
			throw new Error(m.video_editor_transcribe_unlock_track());
		}
		const id = existing?.id ?? crypto.randomUUID();
		const label = m.video_editor_transcribe();
		const targetTrack = ensureOpenTrackForRange({
			kind: 'video',
			itemType: 'subtitle',
			from: source.from,
			durationInFrames: source.durationInFrames,
			label,
			preferredTrackId: existing?.trackId,
			ignoredItemIds: new Set(matches.map((item) => item.id))
		});
		const resolvedCanvas =
			canvas.width > 0 && canvas.height > 0 ? canvas : { width: 1920, height: 1080 };
		const style = existing
			? {}
			: resolveCaptionStylePatch(
					captionStylePresetById(editorSettings.defaultCaptionStylePresetId),
					resolvedCanvas.width,
					resolvedCanvas.height
				);
		const nextItem = {
			...(existing ?? {}),
			...style,
			id,
			trackId: targetTrack.id,
			from: source.from,
			durationInFrames: source.durationInFrames,
			label,
			type: 'subtitle',
			captionSource: {
				type: 'transcript',
				clipId: source.id,
				mediaId: source.mediaId ?? '',
				sourceStartSeconds,
				sourceEndSeconds,
				playbackSpeed: speed,
				isReversed: source.isReversed === true
			},
			cues
		} satisfies TimelineItem;
		const duplicateIds = new Set(matches.slice(1).map((item) => item.id));
		const nextItems = timelineStore.items
			.filter((item) => !duplicateIds.has(item.id))
			.map((item) => (item.id === id ? nextItem : item));
		if (!existing) nextItems.push(nextItem);
		timelineStore._setItems(nextItems);
		return id;
	}) as string;
}
