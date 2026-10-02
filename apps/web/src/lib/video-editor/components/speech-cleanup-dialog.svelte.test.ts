import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import {
	loadSpeechCleanupSettings,
	saveSpeechCleanupSettings
} from '../transcript/speech-cleanup-settings';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { createBlankProject, createDefaultTracks } from '../project/defaults';
import type { TimelineItem } from '../project/types';
import PreviewPlayer from './preview-player.svelte';
import { editorSession } from '../editor.svelte';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { mediaPool } from '../media/pool.svelte';
import fixtureUrl from '../../../../../../tests/app/fixtures/product-screenshots/study-sos-demo.mp4?url';
import SpeechCleanupDialog from './speech-cleanup-dialog.svelte';
import '../../../routes/layout.css';

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
	await page.viewport(1000, 800);
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
	const project = createBlankProject('Cleanup preview');
	project.timeline!.tracks = timelineStore.tracks;
	project.timeline!.items = original;
	editorSession.project = project;
	sequenceStore.load(project.timeline!, project.metadata);
	mediaPool.loadAll([
		{
			id: 'recording',
			storageType: 'cloud',
			remoteUrl: fixtureUrl,
			fileName: 'recording.mp4',
			fileSize: 185000,
			mimeType: 'video/mp4',
			duration: 8,
			width: 640,
			height: 360,
			fps: 30,
			codec: 'avc',
			bitrate: 100000,
			hasAudio: true,
			tags: []
		}
	]);
	editorSession.clock.seek(195);
	const preview = await render(PreviewPlayer, { onedit: () => {} });
	preview.container.style.cssText = 'display:flex;width:900px;height:500px';
	const picture = () => {
		const layer = preview.container;
		const video = layer?.querySelector('video');
		const fallback = layer?.querySelector<HTMLCanvasElement>('[data-seek-fallback]');
		const canvas = document.createElement('canvas');
		canvas.width = 64;
		canvas.height = 36;
		const context = canvas.getContext('2d')!;
		if (video && video.readyState >= 2 && video.checkVisibility({ checkOpacity: true }))
			context.drawImage(video, 0, 0, 64, 36);
		if (
			fallback &&
			!fallback.hidden &&
			fallback.width &&
			fallback.checkVisibility({ checkOpacity: true })
		)
			context.drawImage(fallback, 0, 0, 64, 36);
		return context
			.getImageData(0, 0, 64, 36)
			.data.some((value, index) => index % 4 !== 3 && value > 32);
	};
	await expect.poll(picture).toBe(true);
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
		await expect.poll(picture).toBe(true);
		expect(timelineStore.currentFrame).toBe(119);
		expect(editorSession.clock.currentFrame).toBe(119);
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.items).toEqual(original);
		editorSession.clock.seek(195);
		commandHistory.redo();
		expect(timelineStore.maxItemEndFrame).toBe(120);
		expect(timelineStore.currentFrame).toBe(119);
		await expect.poll(picture).toBe(true);
	} finally {
		await screen.unmount();
		await preview.unmount();
		mediaPool.clear();
		sequenceStore.reset();
		editorSession.project = null;
		saveSpeechCleanupSettings(settings);
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
	}
});
