/**
 * AI captions: turn local scene analysis text into an editable subtitle layer.
 *
 * Reuses the local LFM caption model via the existing scene-analysis
 * pipeline (scene-caption-provider, analyzeSceneContent, scene-browser).
 * Produces a subtitle item with captionSource.type === 'ai-captions' that
 * coexists beside transcript / subtitle-import / embedded-subtitles layers,
 * supports atomic undo, repeat-run replacement, and shared preview/export.
 */

import type { MediaScene } from '../media/scene-search/types';
import type { SubtitleCue, TimelineItem, TimelineTrack } from '../project/types';
import { m } from '$lib/paraglide/messages';
import { execute } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { effectiveMediaTracks } from '../timeline/utils/track-groups';
import { sourceSecondsToTimelineFrame } from '../timeline/utils/media-item-frames';
import {
	captureTranscriptionSource,
	transcriptionSourceWindow,
	type TranscriptionSourceSnapshot,
	type TranscriptionSourceWindow
} from './transcribe-action';
import { editorSettings } from '../settings/editor-settings.svelte';
import {
	captionStylePresetById,
	resolveCaptionStylePatch
} from '../typography/caption-style-presets';

export interface AiCaptionSourceWindow extends TranscriptionSourceWindow {
	playbackSpeed: number;
	isReversed: boolean;
}

export function aiCaptionSourceWindow(
	item: TimelineItem,
	timelineFps = timelineStore.fps
): AiCaptionSourceWindow {
	const window = transcriptionSourceWindow(item, timelineFps);
	const speed = item.speed && item.speed > 0 ? item.speed : 1;
	return {
		...window,
		playbackSpeed: speed,
		isReversed: item.isReversed === true
	};
}

export function buildAiCaptionCues(
	scenes: readonly MediaScene[],
	clip: TimelineItem,
	fps: number
): SubtitleCue[] {
	const cues: SubtitleCue[] = [];
	for (const scene of scenes) {
		const text = scene.text?.trim();
		if (!text) continue;
		const startSec = Number.isFinite(scene.startSec) ? scene.startSec : scene.timeSec;
		const endSec =
			Number.isFinite(scene.endSec) && scene.endSec > startSec ? scene.endSec : startSec + 3;
		const a = sourceSecondsToTimelineFrame(clip, startSec, fps);
		const b = sourceSecondsToTimelineFrame(clip, endSec, fps);
		const startFrame = Math.min(a, b);
		const endFrame = Math.max(a, b);
		const clippedStart = Math.max(startFrame, clip.from);
		const clippedEnd = Math.min(endFrame, clip.from + clip.durationInFrames);
		if (clippedEnd <= clippedStart) continue;
		const safeEnd = Math.max(clippedStart + 1, clippedEnd);
		cues.push({
			id: crypto.randomUUID(),
			startFrame: clippedStart,
			endFrame: safeEnd,
			text
		});
	}
	return cues.toSorted(
		(left, right) => left.startFrame - right.startFrame || left.text.localeCompare(right.text)
	);
}

function sourceStillMatches(
	item: TimelineItem,
	expected: TranscriptionSourceWindow | TranscriptionSourceSnapshot
): boolean {
	const current = transcriptionSourceWindow(item);
	if (
		current.sourceStartSeconds !== expected.sourceStartSeconds ||
		current.sourceEndSeconds !== expected.sourceEndSeconds
	)
		return false;
	if (!('itemId' in expected)) return true;
	const snapshot = captureTranscriptionSource(item);
	return (
		snapshot.itemId === expected.itemId &&
		snapshot.mediaId === expected.mediaId &&
		snapshot.from === expected.from &&
		snapshot.durationInFrames === expected.durationInFrames &&
		snapshot.sourceStart === expected.sourceStart &&
		snapshot.sourceEnd === expected.sourceEnd &&
		snapshot.sourceFps === expected.sourceFps &&
		snapshot.speed === expected.speed &&
		snapshot.isReversed === expected.isReversed
	);
}

function rangesOverlap(
	left: { from: number; durationInFrames: number },
	right: { from: number; durationInFrames: number }
): boolean {
	return (
		left.from < right.from + right.durationInFrames &&
		right.from < left.from + left.durationInFrames
	);
}

function chooseCaptionTrack(
	segments: readonly { from: number; durationInFrames: number }[],
	existingTrackId?: string
) {
	const tracks = timelineStore.tracks;
	if (existingTrackId) {
		const existing = tracks.find((track) => track.id === existingTrackId);
		if (existing && !existing.locked) return { trackId: existing.id, created: false as const };
	}
	for (const track of effectiveMediaTracks(tracks).toSorted(
		(left, right) => left.order - right.order
	)) {
		if (track.kind === 'audio' || track.locked) continue;
		const items = timelineStore.items.filter((item) => item.trackId === track.id);
		const overlaps = segments.some((segment) => items.some((item) => rangesOverlap(item, segment)));
		if (!overlaps) return { trackId: track.id, created: false as const };
	}
	const minimumOrder = tracks.length > 0 ? Math.min(...tracks.map((track) => track.order)) : 0;
	const newTrack = {
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
	} satisfies TimelineTrack;
	return { trackId: newTrack.id, created: true as const, track: newTrack };
}

export interface AiCaptionCanvas {
	width: number;
	height: number;
}

function resolveAiCaptionCanvas(canvas?: AiCaptionCanvas): AiCaptionCanvas {
	if (canvas && canvas.width > 0 && canvas.height > 0) return canvas;
	// Fallback to 16:9 project default; callers that know the real canvas should pass it explicitly.
	return { width: 1920, height: 1080 };
}

/** Create or replace the generated AI-caption subtitle item for one exact clip source window. */
export function addAiCaptionSubtitleItem(
	sourceItemId: string,
	scenes: readonly MediaScene[],
	expectedSource?: TranscriptionSourceWindow | TranscriptionSourceSnapshot,
	canvas?: AiCaptionCanvas
): string {
	// SAFETY: execute returns the inner callback's string unchanged, so `as string` is sound.
	return execute('ADD_AI_CAPTIONS', () => {
		const source = timelineStore.itemById.get(sourceItemId);
		if (!source) throw new Error('Source clip is gone');
		if (expectedSource && !sourceStillMatches(source, expectedSource)) {
			throw new Error(m.video_editor_transcribe_source_changed());
		}
		if (source.type !== 'video' && source.type !== 'audio') {
			throw new Error(m.video_editor_transcribe_media_only());
		}
		const fps = timelineStore.fps;
		const { sourceStartSeconds, sourceEndSeconds } = transcriptionSourceWindow(source, fps);
		const speed = source.speed && source.speed > 0 ? source.speed : 1;
		const cues = buildAiCaptionCues(scenes, source, fps);
		if (cues.length === 0) throw new Error(m.video_editor_ai_captions_empty());
		const matches = timelineStore.items.filter(
			(item) =>
				item.captionSource?.type === 'ai-captions' && item.captionSource.clipId === source.id
		);
		const lockedTrackIds = new Set(
			effectiveMediaTracks(timelineStore.tracks)
				.filter((track) => track.locked)
				.map((track) => track.id)
		);
		if (matches.some((item) => lockedTrackIds.has(item.trackId))) {
			throw new Error(m.video_editor_transcribe_unlock_existing());
		}
		const existing = matches[0];
		const segment = { from: source.from, durationInFrames: source.durationInFrames };
		const choice = chooseCaptionTrack([segment], existing?.trackId);
		let targetTrackId = existing?.trackId ?? choice.trackId;
		if (choice.created && 'track' in choice && choice.track) {
			timelineStore._setTracks(
				[...timelineStore.tracks, choice.track].toSorted((left, right) => left.order - right.order)
			);
			targetTrackId = choice.track.id;
		}
		if (!targetTrackId) throw new Error(m.video_editor_transcribe_unlock_track());
		const id = existing?.id ?? crypto.randomUUID();
		const resolvedCanvas = resolveAiCaptionCanvas(canvas);
		const style = existing
			? {}
			: resolveCaptionStylePatch(
					captionStylePresetById(editorSettings.defaultCaptionStylePresetId),
					resolvedCanvas.width,
					resolvedCanvas.height
				);
		const nextItem = {
			...(existing ?? {}),
			id,
			trackId: targetTrackId,
			from: source.from,
			durationInFrames: source.durationInFrames,
			label: m.video_editor_ai_captions_label(),
			type: 'subtitle',
			captionSource: {
				type: 'ai-captions',
				clipId: source.id,
				mediaId: source.mediaId ?? '',
				sourceStartSeconds,
				sourceEndSeconds,
				playbackSpeed: speed,
				isReversed: source.isReversed === true
			},
			cues,
			...style
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

export function removeAiCaptionsForClip(clipId: string): boolean {
	const matches = timelineStore.items.filter(
		(item) => item.captionSource?.type === 'ai-captions' && item.captionSource.clipId === clipId
	);
	if (matches.length === 0) return false;
	const ids = new Set(matches.map((item) => item.id));
	execute('REMOVE_AI_CAPTIONS', () => {
		timelineStore._setItems(timelineStore.items.filter((item) => !ids.has(item.id)));
	});
	return true;
}
