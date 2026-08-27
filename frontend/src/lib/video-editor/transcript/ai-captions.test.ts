import { beforeEach, describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { addGeneratedSubtitleItem } from './transcribe-action';
import { addAiCaptionSubtitleItem, buildAiCaptionCues } from './ai-captions';
import type { MediaScene } from '../media/scene-search/types';
import { collectSubtitleCues, subtitleSidecarSrt } from './subtitle-export';
import { execute } from '../timeline/commands/command-store.svelte';

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

const scenes: MediaScene[] = [
	{
		id: 'media:0',
		mediaId: 'media',
		index: 0,
		startSec: 10,
		endSec: 12,
		timeSec: 10,
		text: 'A person walks into a room'
	},
	{
		id: 'media:1',
		mediaId: 'media',
		index: 1,
		startSec: 14,
		endSec: 18,
		timeSec: 14,
		text: 'Close up of hands typing'
	}
];

beforeEach(() => {
	commandHistory.clearHistory();
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [track], items: [source], fps: 30 });
});

describe('ai-caption cue building', () => {
	it('maps scene windows to timeline frames scaled by playback speed and trimmed to the clip', () => {
		const cues = buildAiCaptionCues(scenes, source, 30);
		// source window is 10s..20s at 30fps source, speed 2x -> 150 timeline frames
		// scene 0: 10..12 source seconds -> timeline 0..30 frames from source.from
		expect(cues).toHaveLength(2);
		expect(cues[0]).toMatchObject({
			text: 'A person walks into a room',
			startFrame: 90,
			endFrame: 120
		});
		expect(cues[1]).toMatchObject({
			text: 'Close up of hands typing',
			startFrame: 150,
			endFrame: 210
		});
	});

	it('drops scenes entirely outside the clip source window', () => {
		const outside: MediaScene[] = [
			{
				id: 'media:2',
				mediaId: 'media',
				index: 2,
				startSec: 0,
				endSec: 1,
				timeSec: 0,
				text: 'Before clip'
			}
		];
		expect(buildAiCaptionCues(outside, source, 30)).toHaveLength(0);
	});

	it('handles reversed clips by mirroring source seconds', () => {
		timelineStore._updateItems([{ id: source.id, patch: { isReversed: true } }]);
		const reversedSource = timelineStore.itemById.get(source.id)!;
		const cues = buildAiCaptionCues(scenes, reversedSource, 30);
		// For reversed, the later source scene appears earlier on the timeline, but cues are sorted by startFrame.
		expect(cues).toHaveLength(2);
		expect(cues[0]!.text).toBe('Close up of hands typing');
		expect(cues[1]!.text).toBe('A person walks into a room');
		expect(cues[0]!.startFrame).toBeLessThan(cues[1]!.startFrame);
	});
});

describe('addAiCaptionSubtitleItem', () => {
	it('creates an undoable ai-caption subtitle item without touching transcript captions', () => {
		const transcriptId = addGeneratedSubtitleItem(source.id, [
			{ text: 'Transcript words', startSeconds: 1, endSeconds: 2 }
		]);
		commandHistory.clearHistory();

		const aiId = addAiCaptionSubtitleItem(source.id, scenes);
		const aiItem = timelineStore.itemById.get(aiId)!;
		const transcriptItem = timelineStore.itemById.get(transcriptId)!;

		expect(aiItem.type).toBe('subtitle');
		expect(aiItem.captionSource?.type).toBe('ai-captions');
		expect(aiItem.cues?.length).toBe(2);
		expect(transcriptItem.cues?.length).toBe(1);
		expect(aiItem.from).toBe(source.from);
		expect(aiItem.durationInFrames).toBe(source.durationInFrames);
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.itemById.has(aiId)).toBe(false);
		expect(timelineStore.itemById.has(transcriptId)).toBe(true);
	});

	it('replaces every prior ai-caption for the same clip in one undo step and keeps transcript', () => {
		const firstId = addAiCaptionSubtitleItem(source.id, scenes);
		const first = timelineStore.itemById.get(firstId)!;
		// Inject a duplicate to simulate legacy double-write.
		timelineStore._setItems([
			...timelineStore.items,
			{ ...first, id: 'old-ai-duplicate', cues: first.cues?.map((cue) => ({ ...cue })) }
		]);
		commandHistory.clearHistory();

		const replacementScenes: MediaScene[] = [
			{
				id: 'media:0',
				mediaId: 'media',
				index: 0,
				startSec: 11,
				endSec: 13,
				timeSec: 11,
				text: 'Revised caption'
			}
		];
		const replacementId = addAiCaptionSubtitleItem(source.id, replacementScenes);
		const aiItems = timelineStore.items.filter(
			(item) => item.captionSource?.type === 'ai-captions' && item.captionSource.clipId === source.id
		);
		expect(replacementId).toBe(firstId);
		expect(aiItems).toHaveLength(1);
		expect(aiItems[0]?.cues?.[0]?.text).toBe('Revised caption');
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(
			timelineStore.items.filter(
				(item) => item.captionSource?.type === 'ai-captions' && item.captionSource.clipId === source.id
			)
		).toHaveLength(2);
	});

	it('coexists with transcript: second ai run does not replace transcript and transcript run does not replace ai', () => {
		const transcriptId = addGeneratedSubtitleItem(source.id, [
			{ text: 'Transcript', startSeconds: 0, endSeconds: 1 }
		]);
		const aiId = addAiCaptionSubtitleItem(source.id, scenes);
		expect(timelineStore.itemById.has(transcriptId)).toBe(true);
		expect(timelineStore.itemById.has(aiId)).toBe(true);

		// Replace transcript — ai must survive
		addGeneratedSubtitleItem(source.id, [{ text: 'Transcript v2', startSeconds: 0, endSeconds: 1 }]);
		expect(timelineStore.items.filter((item) => item.captionSource?.type === 'ai-captions')).toHaveLength(1);
		expect(timelineStore.items.filter((item) => item.captionSource?.type === 'transcript')).toHaveLength(1);

		// Replace ai — transcript must survive
		addAiCaptionSubtitleItem(source.id, [
			{
				id: 'media:0',
				mediaId: 'media',
				index: 0,
				startSec: 10,
				endSec: 11,
				timeSec: 10,
				text: 'AI v2'
			}
		]);
		expect(timelineStore.items.filter((item) => item.captionSource?.type === 'transcript')).toHaveLength(1);
		expect(timelineStore.items.filter((item) => item.captionSource?.type === 'ai-captions')[0]?.cues?.[0]?.text).toBe(
			'AI v2'
		);
	});

	it('allows editing the generated cue text and persists as a normal subtitle edit', () => {
		const aiId = addAiCaptionSubtitleItem(source.id, scenes);
		const aiItem = timelineStore.itemById.get(aiId)!;
		const firstCue = aiItem.cues![0]!;
		commandHistory.clearHistory();
		execute('EDIT_CUE', () => {
			timelineStore._updateItems([
				{
					id: aiId,
					patch: {
						cues: aiItem.cues!.map((cue) => (cue.id === firstCue.id ? { ...cue, text: 'Corrected caption' } : cue))
					}
				}
			]);
		});
		expect(timelineStore.itemById.get(aiId)?.cues?.[0]?.text).toBe('Corrected caption');
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.itemById.get(aiId)?.cues?.[0]?.text).toBe(firstCue.text);
	});

	it('exports ai captions via the shared subtitle sidecar and keeps them burnable', () => {
		const aiId = addAiCaptionSubtitleItem(source.id, scenes);
		const aiItem = timelineStore.itemById.get(aiId)!;
		const srt = collectSubtitleCues([aiItem], 30, aiItem.from, aiItem.from + aiItem.durationInFrames);
		expect(srt.length).toBe(2);
		expect(new Set(srt.map((cue) => cue.text))).toEqual(new Set(scenes.map((scene) => scene.text)));
		const sidecar = subtitleSidecarSrt([aiItem], 30);
		expect(sidecar).toContain(scenes[0]!.text);
		expect(sidecar).toContain(scenes[1]!.text);
	});

	it('throws when AI captioning produced no overlapping scenes', () => {
		expect(() =>
			addAiCaptionSubtitleItem(source.id, [
				{
					id: 'media:99',
					mediaId: 'media',
					index: 99,
					startSec: 100,
					endSec: 101,
					timeSec: 100,
					text: 'Far future'
				}
			])
		).toThrow();
	});
});


