import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import {
	loadSpeechCleanupSettings,
	saveSpeechCleanupSettings
} from '../transcript/speech-cleanup-settings';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { createDefaultTracks } from '../project/defaults';
import type { TimelineItem } from '../project/types';
import SpeechCleanupDialog from './speech-cleanup-dialog.svelte';

it('names the cleanup mode tablist so assistive technology announces it', async () => {
	const screen = await render(SpeechCleanupDialog, {
		open: true,
		itemIds: [],
		onapplied: vi.fn()
	});

	const tablist = screen.getByRole('tablist', { name: m.video_editor_cleanup_title() });
	await expect.element(tablist).toBeVisible();
	await expect
		.element(tablist.getByRole('tab', { name: m.video_editor_filler_review() }))
		.toBeVisible();
});

it('reports reviewed source sections once when cleanup cuts linked tracks', async () => {
	const settings = loadSpeechCleanupSettings();
	saveSpeechCleanupSettings({
		...settings,
		silenceMode: 'transcript',
		minSilenceMs: 500,
		paddingStartMs: 0,
		paddingEndMs: 0
	});
	const source = {
		from: 0,
		durationInFrames: 240,
		mediaId: 'recording',
		sourceStart: 0,
		sourceEnd: 240,
		sourceFps: 30,
		label: 'Speech',
		linkedGroupId: 'pair'
	};
	const original: TimelineItem[] = [
		{ ...source, id: 'speech', type: 'audio', trackId: 'track-audio-main' },
		{ ...source, id: 'video', type: 'video', trackId: 'track-video-main' },
		{
			id: 'caption',
			type: 'subtitle',
			trackId: 'captions',
			from: 0,
			durationInFrames: 240,
			label: 'Transcript',
			captionSource: {
				type: 'transcript',
				clipId: 'speech',
				mediaId: 'recording',
				sourceStartSeconds: 0,
				sourceEndSeconds: 8
			},
			cues: [
				{
					id: 'cue',
					startFrame: 0,
					endFrame: 240,
					text: 'One two three four five',
					words: [
						[0, 15],
						[45, 60],
						[90, 105],
						[135, 150],
						[180, 240]
					].map(([startFrame, endFrame], index) => ({
						id: `word-${index}`,
						text: String(index),
						startFrame,
						endFrame
					}))
				}
			]
		}
	];
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	timelineStore._setTracks([
		...createDefaultTracks(),
		{ ...createDefaultTracks()[0], id: 'captions', order: 2 }
	]);
	timelineStore._setItems(original);
	const onapplied = vi.fn();
	const screen = await render(SpeechCleanupDialog, {
		open: true,
		itemIds: ['speech', 'video'],
		initialMode: 'silence',
		onapplied
	});
	try {
		const include = screen.getByRole('button', {
			name: m.video_editor_cleanup_include({ label: m.video_editor_cleanup_silence_range() })
		});
		await expect.element(include.first()).toBeVisible();
		expect(include.all()).toHaveLength(4);
		await screen.getByRole('button', { name: m.video_editor_apply_silences() }).click();
		expect(onapplied).toHaveBeenCalledExactlyOnceWith(4);
		expect(timelineStore.maxItemEndFrame).toBe(120);
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.items).toEqual(original);
		commandHistory.redo();
		expect(timelineStore.maxItemEndFrame).toBe(120);
	} finally {
		await screen.unmount();
		saveSpeechCleanupSettings(settings);
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
	}
});
