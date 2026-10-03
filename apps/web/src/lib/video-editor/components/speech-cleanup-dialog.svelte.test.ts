import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { WebThemeRuntime } from '$lib/themes/runtime';
import { resolveBuiltInTheme } from '$lib/themes/builtins';
import { updateItemProperties } from '../timeline/actions/items';
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
	const recordingTab = tablist.getByRole('tab', { name: m.recording_cleanup_tab(), exact: true });
	await recordingTab.click();
	await userEvent.keyboard('{ArrowRight}');
	await expect
		.element(tablist.getByRole('tab', { name: m.video_editor_filler_review() }))
		.toHaveFocus();
	await expect
		.element(tablist.getByRole('tab', { name: m.video_editor_filler_review() }))
		.toHaveAttribute('aria-selected', 'true');
	await screen.unmount();
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
		// A pending seek can retain visible pixels while readyState drops to HAVE_METADATA.
		if (
			video &&
			video.videoWidth > 0 &&
			video.checkVisibility({ visibilityProperty: true, opacityProperty: true })
		)
			try {
				context.drawImage(video, 0, 0, 64, 36);
			} catch (error) {
				if (!(error instanceof DOMException) || error.name !== 'InvalidStateError') throw error;
			}
		if (
			fallback &&
			!fallback.hidden &&
			fallback.width &&
			fallback.checkVisibility({ visibilityProperty: true, opacityProperty: true })
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
		const include = screen.getByRole('checkbox', {
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

it('keeps repeated starts optional and applies reviewed cuts and voice treatment in one Undo', async () => {
	const clip: TimelineItem = {
		id: 'explanation',
		type: 'audio',
		trackId: 'track-audio',
		label: 'Product update',
		mediaId: 'product-update',
		linkedGroupId: 'recorded-together',
		from: 0,
		durationInFrames: 360,
		sourceStart: 0,
		sourceEnd: 360,
		sourceFps: 30
	};
	const words = (text: string, start: number) =>
		text.split(' ').map((text, index) => ({
			id: `${start}-${index}`,
			text,
			startFrame: start + index * 12,
			endFrame: start + index * 12 + 9
		}));
	const captions: TimelineItem = {
		id: 'captions',
		type: 'subtitle',
		trackId: 'track-video-main',
		from: 0,
		durationInFrames: 360,
		label: 'Captions',
		captionSource: {
			type: 'transcript',
			clipId: clip.id,
			mediaId: clip.mediaId!,
			sourceStartSeconds: 0,
			sourceEndSeconds: 12
		},
		cues: [
			{
				id: 'cue',
				startFrame: 0,
				endFrame: 360,
				text: 'Product update',
				words: [
					...words('um', 0),
					...words('Today we shipped a faster editor with wrong sorry', 30),
					...words('Today we shipped a faster editor with instant previews.', 165)
				]
			}
		]
	};
	const otherInstance = { ...clip, id: 'other-instance', from: 600, linkedGroupId: undefined };
	const screenCapture: TimelineItem = {
		...clip,
		id: 'screen',
		type: 'video',
		trackId: 'track-video-main',
		mediaId: 'silent-screen'
	};
	const original = structuredClone([clip, captions, otherInstance, screenCapture]);
	mediaPool.loadAll([
		{
			id: 'silent-screen',
			storageType: 'cloud',
			remoteUrl: fixtureUrl,
			fileName: 'screen.mp4',
			fileSize: 185000,
			mimeType: 'video/mp4',
			duration: 12,
			width: 640,
			height: 360,
			fps: 30,
			codec: 'avc',
			bitrate: 100000,
			hasAudio: false,
			tags: []
		}
	]);
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	timelineStore._setTracks(createDefaultTracks());
	timelineStore._setItems(structuredClone(original));
	const theme = new WebThemeRuntime();
	const onapplied = vi.fn();
	const screen = await render(SpeechCleanupDialog, {
		open: true,
		itemIds: [screenCapture.id],
		onapplied
	});
	try {
		await expect.element(screen.getByText(m.recording_cleanup_possible_restart())).toBeVisible();
		const retake = screen.getByRole('checkbox', {
			name: m.video_editor_cleanup_include({ label: 'Today we shipped a faster editor with' })
		});
		await expect.element(retake).toHaveAttribute('aria-checked', 'false');
		for (const width of [1280, 390, 320]) {
			await page.viewport(width, 850);
			for (const scheme of ['light', 'dark'] as const) {
				await theme.apply(resolveBuiltInTheme('dither', scheme), document.documentElement);
				expect(document.documentElement.dataset.themeScheme).toBe(scheme);
				const dialog = screen.getByRole('dialog').element();
				await Promise.all(
					document
						.getAnimations()
						.filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
						.map((animation) => animation.finished.catch(() => {}))
				);
				expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
				await expect
					.element(screen.getByRole('button', { name: m.recording_cleanup_apply(), exact: true }))
					.toBeVisible();
				await page.screenshot({ path: `__screenshots__/recording-cleanup-${width}-${scheme}.png` });
			}
		}
		// A normal property edit mutates the existing item object. The previous review must expire.
		expect(updateItemProperties(clip.id, { volume: 0.8 })).toBe(true);
		await expect
			.element(screen.getByRole('button', { name: m.recording_cleanup_apply(), exact: true }))
			.toBeDisabled();
		await expect.element(screen.getByText(m.recording_cleanup_changed())).toBeVisible();
		commandHistory.undo();
		await screen
			.getByRole('button', { name: m.video_editor_cleanup_update(), exact: true })
			.click();
		await expect.element(retake).toHaveAttribute('aria-checked', 'false');

		await screen.getByRole('checkbox', { name: m.recording_cleanup_voice(), exact: true }).click();
		await screen.getByRole('button', { name: m.recording_cleanup_apply(), exact: true }).click();
		expect(onapplied).toHaveBeenCalledOnce();
		expect(commandHistory.undoStack).toHaveLength(1);
		const survivingAudio = timelineStore.items.filter(
			(item) => item.mediaId === clip.mediaId && item.id !== otherInstance.id
		);
		expect(survivingAudio.length).toBeGreaterThan(0);
		expect(
			survivingAudio.every(
				(item) =>
					item.audioNoiseReductionEnabled &&
					item.audioEffects?.some((effect) => effect.type === 'compressor')
			)
		).toBe(true);
		const spokenText = timelineStore.items
			.flatMap(
				(item) => item.cues?.flatMap((cue) => cue.words?.map((word) => word.text) ?? []) ?? []
			)
			.join(' ');
		expect(spokenText).not.toMatch(/\bum\b/);
		expect(spokenText).toContain('wrong sorry');
		expect(spokenText).toContain('instant previews.');
		const untouched = timelineStore.itemById.get(otherInstance.id)!;
		expect(untouched.audioNoiseReductionEnabled).toBeUndefined();
		expect(untouched.durationInFrames).toBe(otherInstance.durationInFrames);
		expect(untouched.sourceStart).toBe(otherInstance.sourceStart);
		commandHistory.undo();
		expect(timelineStore.items).toEqual(original);
	} finally {
		theme.clear(document.documentElement);
		mediaPool.clear();
		await screen.unmount();
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
	}
}, 30000);
