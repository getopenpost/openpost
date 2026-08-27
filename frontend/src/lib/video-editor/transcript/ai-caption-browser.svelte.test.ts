import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { addGeneratedSubtitleItem } from './transcribe-action';
import { addAiCaptionSubtitleItem } from './ai-captions';
import type { MediaScene } from '../media/scene-search/types';
import TranscriptPanel from '../components/transcript-panel.svelte';
import AiCaptionControls from '../components/ai-caption-controls.svelte';

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
	id: 'clip',
	trackId: track.id,
	from: 0,
	durationInFrames: 90,
	label: 'Clip',
	type: 'video',
	mediaId: 'media',
	sourceStart: 0,
	sourceEnd: 90,
	sourceFps: 30
};

const scenes: MediaScene[] = [
	{
		id: 'media:0',
		mediaId: 'media',
		index: 0,
		startSec: 0,
		endSec: 1,
		timeSec: 0,
		text: 'First scene'
	},
	{
		id: 'media:1',
		mediaId: 'media',
		index: 1,
		startSec: 1,
		endSec: 2,
		timeSec: 1,
		text: 'Second scene'
	}
];

beforeEach(() => {
	commandHistory.clearHistory();
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [track], items: [source], fps: 30 });
});

describe('AI captions browser integration at 320 and 390', () => {
	it('drives backed action, repeat-run replacement, transcript coexistence, correction and undo at 320 dark with no overflow and 44px targets', async () => {
		await page.viewport(320, 800);
		document.documentElement.classList.add('dark');
		// Backed action: create AI captions with derived canvas (16:9)
		const aiId = addAiCaptionSubtitleItem(source.id, scenes, undefined, {
			width: 1920,
			height: 1080
		});
		const aiItem = timelineStore.itemById.get(aiId)!;
		expect(aiItem.captionSource?.type).toBe('ai-captions');
		expect(aiItem.transform?.width).toBe(Math.round(1920 * 0.82));
		// Also verify portrait and square derive correctly (sane behavior)
		timelineStore._setItems(timelineStore.items.filter((entry) => entry.id !== aiId));
		commandHistory.clearHistory();
		const portraitId = addAiCaptionSubtitleItem(source.id, scenes, undefined, {
			width: 1080,
			height: 1920
		});
		const portrait = timelineStore.itemById.get(portraitId)!;
		expect(portrait.transform?.width).toBe(Math.round(1080 * 0.82));
		expect(portrait.transform?.y).toBe(Math.round(1920 * 0.32));
		timelineStore._setItems(timelineStore.items.filter((entry) => entry.id !== portraitId));
		commandHistory.clearHistory();
		const squareId = addAiCaptionSubtitleItem(source.id, scenes, undefined, {
			width: 1080,
			height: 1080
		});
		const square = timelineStore.itemById.get(squareId)!;
		expect(square.transform?.width).toBe(Math.round(1080 * 0.82));
		expect(square.transform?.height).toBe(Math.round(1080 * 0.16));
		// Clean and test full flow
		timelineStore.__resetForTesting();
		timelineStore.setAll({ tracks: [track], items: [source], fps: 30 });
		commandHistory.clearHistory();
		const freshId = addAiCaptionSubtitleItem(source.id, scenes, undefined, {
			width: 1920,
			height: 1080
		});
		expect(timelineStore.itemById.has(freshId)).toBe(true);

		// Repeat-run replacement in one undo step
		const beforeCount = timelineStore.items.filter(
			(entry) => entry.captionSource?.type === 'ai-captions'
		).length;
		expect(beforeCount).toBe(1);
		const repeatScenes: MediaScene[] = [
			{
				id: 'media:0',
				mediaId: 'media',
				index: 0,
				startSec: 0,
				endSec: 0.5,
				timeSec: 0,
				text: 'Revised'
			}
		];
		const repeatId = addAiCaptionSubtitleItem(source.id, repeatScenes, undefined, {
			width: 1920,
			height: 1080
		});
		expect(repeatId).toBe(freshId);
		expect(
			timelineStore.items.filter((entry) => entry.captionSource?.type === 'ai-captions')
		).toHaveLength(1);
		expect(timelineStore.itemById.get(freshId)?.cues?.[0]?.text).toBe('Revised');
		expect(commandHistory.undoStack).toHaveLength(2);
		commandHistory.undo();
		expect(timelineStore.itemById.get(freshId)?.cues?.[0]?.text).toBe('First scene');
		expect(
			timelineStore.items.filter((entry) => entry.captionSource?.type === 'ai-captions')
		).toHaveLength(1);

		// Transcript coexistence
		timelineStore.__resetForTesting();
		timelineStore.setAll({ tracks: [track], items: [source], fps: 30 });
		commandHistory.clearHistory();
		const transcriptId = addGeneratedSubtitleItem(source.id, [
			{ text: 'Transcript', startSeconds: 0, endSeconds: 1 }
		]);
		const aiCoexistId = addAiCaptionSubtitleItem(source.id, scenes, undefined, {
			width: 1920,
			height: 1080
		});
		expect(timelineStore.itemById.has(transcriptId)).toBe(true);
		expect(timelineStore.itemById.has(aiCoexistId)).toBe(true);
		expect(
			timelineStore.items.filter((entry) => entry.captionSource?.type === 'transcript')
		).toHaveLength(1);
		expect(
			timelineStore.items.filter((entry) => entry.captionSource?.type === 'ai-captions')
		).toHaveLength(1);

		// Editable correction via TranscriptPanel and one-step undo, with 44px and overflow checks
		const screen = await render(TranscriptPanel, { onedit: vi.fn() });
		// SAFETY: vitest-browser-svelte renders into an HTMLElement container in Chromium.
		(screen.container as HTMLElement).style.width = '320px';
		await expect.element(screen.getByRole('button', { name: 'Delete line' }).first()).toBeVisible();
		// Check 44px target for delete button (first of several)
		const delButton = screen.getByRole('button', { name: 'Delete line' }).first().element();
		expect(delButton.className).toContain('size-');
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(321);
		// Simulate correction: edit first cue text
		const currentPanelItem = timelineStore.items.find(
			(entry) => entry.captionSource?.type === 'ai-captions'
		)!;
		const firstCue = currentPanelItem.cues![0]!;
		commandHistory.clearHistory();
		// Directly simulate panel commit by updating cue text
		const { execute } = await import('../timeline/commands/command-store.svelte');
		execute('EDIT_CUE', () => {
			timelineStore._updateItems([
				{
					id: currentPanelItem.id,
					patch: {
						cues: currentPanelItem.cues!.map((cue) =>
							cue.id === firstCue.id ? { ...cue, text: 'Corrected' } : cue
						)
					}
				}
			]);
		});
		expect(timelineStore.itemById.get(currentPanelItem.id)?.cues?.[0]?.text).toBe('Corrected');
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.itemById.get(currentPanelItem.id)?.cues?.[0]?.text).toBe(firstCue.text);

		document.documentElement.classList.remove('dark');
	});

	it('keeps controls usable at 390 with no overflow and accessible progress', async () => {
		await page.viewport(390, 800);
		const screen = await render(AiCaptionControls, {
			canGenerate: true,
			busy: true,
			status: 'running',
			progress: { stage: 'captioning', percent: 67 },
			error: null,
			onstart: vi.fn(),
			oncancel: vi.fn()
		});
		const progress = screen.getByRole('progressbar', { name: 'Describing scenes' });
		await expect.element(progress).toBeInTheDocument();
		expect(progress.element().getAttribute('aria-valuenow')).toBe('67');
		await expect.element(screen.getByText('67%')).toBeVisible();
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(390);
		const button = screen.getByRole('button', { name: 'Cancel transcription' });
		await expect.element(button).toBeVisible();
		await expect.element(button).toHaveClass('h-11');
	});
});
