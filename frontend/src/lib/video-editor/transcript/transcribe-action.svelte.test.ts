import { beforeEach, describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { editorSettings } from '../settings/editor-settings.svelte';
import { addGeneratedSubtitleItem, transcriptionSourceWindow } from './transcribe-action';

const track: TimelineTrack = {
	id: 'video',
	name: 'Video',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const source: TimelineItem = {
	id: 'source',
	trackId: track.id,
	from: 90,
	durationInFrames: 150,
	label: 'Interview',
	type: 'video',
	mediaId: 'media',
	sourceStart: 300,
	sourceEnd: 600,
	sourceFps: 30,
	speed: 2
};

beforeEach(() => {
	commandHistory.clearHistory();
	editorSettings.reset();
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [track], items: [source], fps: 30 });
});

describe('transcription timeline mapping', () => {
	it('decodes only the selected source window', () => {
		expect(transcriptionSourceWindow(source)).toEqual({
			sourceStartSeconds: 10,
			sourceEndSeconds: 20
		});
	});

	it('derives a bounded source window when an older item has no source end', () => {
		expect(
			transcriptionSourceWindow(
				{
					...source,
					durationInFrames: 60,
					sourceStart: 300,
					sourceEnd: undefined,
					sourceFps: 60,
					speed: 2
				},
				30
			)
		).toEqual({ sourceStartSeconds: 5, sourceEndSeconds: 9 });
	});

	it('places captions at the clip start and scales timings by playback speed', () => {
		const subtitleId = addGeneratedSubtitleItem(source.id, [
			{ text: 'Hello', startSeconds: 1, endSeconds: 2 }
		]);
		const subtitle = timelineStore.itemById.get(subtitleId);
		expect(subtitle).toMatchObject({ from: source.from, type: 'subtitle' });
		expect(subtitle?.trackId).not.toBe(source.trackId);
		expect(timelineStore.tracks).toHaveLength(2);
		expect(subtitle?.cues?.[0]).toMatchObject({
			text: 'Hello',
			startFrame: 15,
			endFrame: 30
		});
		expect(commandHistory.undoStack).toHaveLength(1);
	});

	it('applies the configured caption recipe to a new generated subtitle', () => {
		editorSettings.set('defaultCaptionStylePresetId', 'bold-yellow');
		const subtitleId = addGeneratedSubtitleItem(
			source.id,
			[{ text: 'Styled', startSeconds: 1, endSeconds: 2 }],
			undefined,
			{ width: 1000, height: 1000 }
		);
		expect(timelineStore.itemById.get(subtitleId)).toMatchObject({
			fontFamily: 'Roboto Slab',
			fontSize: 50,
			fontWeight: 700,
			color: '#FFD400',
			strokeWidth: 1.5,
			transform: { y: 380, width: 850, height: 180 }
		});
		timelineStore._updateItems([{ id: subtitleId, patch: { color: '#00ff00', paddingX: 27 } }]);
		editorSettings.set('defaultCaptionStylePresetId', 'youtube');
		addGeneratedSubtitleItem(
			source.id,
			[{ text: 'Restyled', startSeconds: 1, endSeconds: 2 }],
			undefined,
			{ width: 1000, height: 1000 }
		);
		expect(timelineStore.itemById.get(subtitleId)).toMatchObject({
			fontFamily: 'Roboto Slab',
			color: '#00ff00',
			paddingX: 27
		});
	});

	it('orders reversed captions by their exact timeline source direction', () => {
		timelineStore._updateItems([{ id: source.id, patch: { isReversed: true } }]);
		const subtitleId = addGeneratedSubtitleItem(source.id, [
			{ text: 'Early', startSeconds: 1, endSeconds: 2 },
			{ text: 'Late', startSeconds: 8, endSeconds: 9 }
		]);
		const subtitle = timelineStore.itemById.get(subtitleId)!;
		const words = subtitle.cues?.flatMap((cue) => cue.words ?? []) ?? [];

		expect(words.map((word) => word.text)).toEqual(['Late', 'Early']);
		expect(words.map((word) => [word.startFrame, word.endFrame])).toEqual([
			[15, 30],
			[120, 135]
		]);
		expect(subtitle).toMatchObject({
			durationInFrames: source.durationInFrames,
			captionSource: {
				sourceStartSeconds: 10,
				sourceEndSeconds: 20,
				playbackSpeed: 2,
				isReversed: true
			}
		});
	});

	it('replaces every prior generated caption for the same clip in one undo step', () => {
		const firstSubtitleId = addGeneratedSubtitleItem(source.id, [
			{ text: 'Old words', startSeconds: 1, endSeconds: 2 }
		]);
		const firstSubtitle = timelineStore.itemById.get(firstSubtitleId)!;
		timelineStore._setItems([
			...timelineStore.items,
			{
				...firstSubtitle,
				id: 'old-duplicate',
				cues: firstSubtitle.cues?.map((cue) => ({
					...cue,
					words: cue.words?.map((word) => ({ ...word }))
				}))
			}
		]);
		commandHistory.clearHistory();

		const replacementId = addGeneratedSubtitleItem(source.id, [
			{ text: 'Correct words', startSeconds: 0.5, endSeconds: 1.5 }
		]);
		const generated = timelineStore.items.filter(
			(item) => item.captionSource?.type === 'transcript' && item.captionSource.clipId === source.id
		);

		expect(replacementId).toBe(firstSubtitleId);
		expect(generated).toHaveLength(1);
		expect(generated[0]?.cues?.[0]?.text).toBe('Correct words');
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(
			timelineStore.items.filter(
				(item) =>
					item.captionSource?.type === 'transcript' && item.captionSource.clipId === source.id
			)
		).toHaveLength(2);
	});

	it('rejects a late result after the source timing changed', () => {
		const snapshot = transcriptionSourceWindow(source);
		timelineStore._updateItems([{ id: source.id, patch: { sourceStart: 330 } }]);
		expect(() =>
			addGeneratedSubtitleItem(
				source.id,
				[{ text: 'Late', startSeconds: 0, endSeconds: 1 }],
				snapshot
			)
		).toThrow('changed while transcription was running');
		expect(commandHistory.undoStack).toHaveLength(0);
	});
});
