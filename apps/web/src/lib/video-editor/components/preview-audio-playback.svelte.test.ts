import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import PreviewPlayer from './preview-player.svelte';
import type { TimelineItem } from '../project/types';
import { createBlankProject } from '../project/defaults';
import { editorSession } from '../editor.svelte';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { mediaPool } from '../media/pool.svelte';
import { readMixerMasterLevels } from '../audio/audio-mixer';
import { previewPlaybackSettings } from '../preview/playback-settings.svelte';
import { toggleTrackMute } from '../timeline/actions/tracks';
import { updateTransition } from '../timeline/actions/transitions.svelte';
import { updateItemProperties } from '../timeline/actions/items';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import videoFixtureUrl from '../../../../../../tests/app/fixtures/product-screenshots/study-sos-demo.mp4?url';
import fixtureUrl from '../../../../../../tests/app/fixtures/product-demos/tutorial-music.wav?url';

it.each(
	(['audio', 'video', 'nested'] as const).flatMap((kind) =>
		(['volume', 'pan', 'pan with EQ'] as const).map((edit) => ({ kind, edit }))
	)
)('keeps $kind playback correct through $edit edits', async ({ kind, edit }) => {
	let worklets = 0;
	const NativeWorklet = AudioWorkletNode;
	vi.stubGlobal(
		'AudioWorkletNode',
		class extends NativeWorklet {
			constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
				super(context, name, options);
				worklets++;
			}
		}
	);
	const project = createBlankProject('Audio playback');
	project.timeline!.items = [
		{
			id: 'music',
			type: kind === 'video' ? 'video' : 'audio',
			trackId: kind !== 'video' ? 'track-audio' : 'track-video-main',
			label: 'Music',
			mediaId: 'music',
			from: 0,
			durationInFrames: 300
		}
	];
	mediaPool.loadAll([
		{
			id: 'music',
			storageType: 'cloud',
			remoteUrl: kind !== 'video' ? fixtureUrl : videoFixtureUrl,
			fileName: 'music',
			fileSize: 1,
			mimeType: kind !== 'video' ? 'audio/wav' : 'video/mp4',
			duration: 10,
			width: 0,
			height: 0,
			fps: 0,
			codec: 'pcm',
			bitrate: 0,
			hasAudio: true,
			tags: []
		}
	]);
	if (kind === 'nested') {
		project.timeline!.compositions = [
			{
				id: 'nested',
				name: 'Nested audio',
				width: 16,
				height: 16,
				fps: 30,
				durationInFrames: 300,
				tracks: project.timeline!.tracks,
				items: project.timeline!.items,
				transitions: []
			}
		];
		project.timeline!.items = [
			{
				id: 'music',
				type: 'composition',
				compositionId: 'nested',
				trackId: 'track-video-main',
				label: 'Nested audio',
				from: 0,
				durationInFrames: 300
			}
		];
	}
	const previousVolume = previewPlaybackSettings.volume;
	const previousMuted = previewPlaybackSettings.muted;
	previewPlaybackSettings.setVolume(1);
	previewPlaybackSettings.setMuted(false);
	editorSession.project = project;
	sequenceStore.load(project.timeline!, project.metadata);
	editorSession.stopPlayback();
	editorSession.clock.setFps(project.metadata.fps);
	const screen = await render(PreviewPlayer, { onedit: () => {} });
	try {
		await expect
			.poll(() => screen.container.querySelector<HTMLMediaElement>('audio,video')?.readyState, {
				// Nested compositions create their media element asynchronously, and
				// the browser shard shares one Chromium process with every other file.
				timeout: 5_000
			})
			.toBeGreaterThanOrEqual(2);
		await userEvent.click(screen.container);
		editorSession.startPlayback({ start: 0, end: 300 });
		await expect
			.poll(() => readMixerMasterLevels().peakLeft, {
				// A cold Chromium shard still has to initialize the audio graph
				// after the media element is ready. Match the fixture startup budget.
				timeout: 5_000
			})
			.toBeGreaterThan(0.001);
		if (edit !== 'volume') {
			const settings: Partial<TimelineItem> = {
				audioEffects: [{ id: 'pan', type: 'pan', enabled: true, pan: 1 }]
			};
			if (edit === 'pan with EQ') {
				settings.audioEqEnabled = true;
				settings.audioEqBand1Enabled = true;
				settings.audioEqBand1Type = 'high-pass';
				settings.audioEqBand1FrequencyHz = 80;
			}
			updateItemProperties('music', settings);
			await expect
				.poll(
					() => {
						const levels = readMixerMasterLevels();
						return levels.peakLeft < 0.00001 && levels.peakRight > 0.001;
					},
					{ timeout: 3000 }
				)
				.toBe(true);
			const beforeGainEdit = timelineStore.currentFrame;
			updateItemProperties('music', { volume: 0.5 });
			await expect.poll(() => timelineStore.currentFrame).toBeGreaterThan(beforeGainEdit + 6);
			expect(worklets).toBe(1);
			updateItemProperties('music', { audioEffects: [] });
			await expect.poll(() => readMixerMasterLevels().peakLeft).toBeGreaterThan(0.001);
		} else {
			const media = screen.container.querySelector<HTMLMediaElement>('audio,video')!;
			const beforeEdit = media.currentTime;
			updateItemProperties('music', { volume: 0 });
			await expect.poll(() => media.currentTime).toBeGreaterThan(beforeEdit + 0.15);
			await expect.poll(() => readMixerMasterLevels().peakLeft).toBeLessThan(0.00001);
			updateItemProperties('music', { volume: 0.5 });
			await expect
				.poll(() => readMixerMasterLevels().peakLeft, { timeout: 2000 })
				.toBeGreaterThan(0.001);
		}
	} finally {
		editorSession.stopPlayback();
		await screen.unmount();
		mediaPool.clear();
		sequenceStore.reset();
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		editorSession.project = null;
		previewPlaybackSettings.setVolume(previousVolume);
		previewPlaybackSettings.setMuted(previousMuted);
		vi.unstubAllGlobals();
	}
});

it('refreshes audible clip windows after transition, timing, mute, and media readiness changes', async () => {
	const project = createBlankProject('Audio window edits');
	project.timeline!.items = ['left', 'right'].map((id, index) => ({
		id,
		type: 'audio',
		trackId: 'track-audio',
		label: id,
		linkedGroupId: id,
		mediaId: 'music',
		from: index * 60,
		durationInFrames: 60,
		sourceStart: 30,
		sourceEnd: 90,
		sourceDuration: 300,
		sourceFps: 30
	}));
	project.timeline!.items.push(
		...project.timeline!.items.map((item) => ({
			...item,
			id: `visual-${item.id}`,
			type: 'video' as const,
			mediaId: 'visual',
			trackId: 'track-video-main',
			audioDetached: true
		}))
	);
	project.timeline!.transitions = [
		{
			id: 'fade',
			fromItemId: 'visual-left',
			toItemId: 'visual-right',
			type: 'crossfade',
			durationInFrames: 20
		}
	];
	mediaPool.loadAll([
		{
			id: 'music',
			storageType: 'cloud',
			remoteUrl: fixtureUrl,
			fileName: 'music.wav',
			fileSize: 1,
			mimeType: 'audio/wav',
			duration: 10,
			width: 0,
			height: 0,
			fps: 0,
			codec: 'pcm',
			bitrate: 0,
			audioCodec: 'pcm',
			hasAudio: true,
			tags: []
		}
	]);
	editorSession.project = project;
	sequenceStore.load(project.timeline!, project.metadata);
	editorSession.stopPlayback();
	editorSession.clock.seek(55);
	const screen = await render(PreviewPlayer, { onedit: () => {} });
	const audioCount = () => screen.container.querySelectorAll('audio').length;
	try {
		// The incoming clip starts at frame 60, with a ten-frame transition handle.
		await expect.poll(audioCount).toBe(2);
		updateTransition('fade', { durationInFrames: 4 });
		await expect.poll(audioCount).toBe(1);
		editorSession.clock.seek(59);
		await expect.poll(audioCount).toBe(2);
		toggleTrackMute('track-audio');
		await expect.poll(audioCount).toBe(0);
		toggleTrackMute('track-audio');
		await expect.poll(audioCount).toBe(2);
		mediaPool.setStatus('music', 'importing');
		await expect.poll(audioCount).toBe(0);
		mediaPool.setStatus('music', 'ready');
		await expect.poll(audioCount).toBe(2);
		// Removing the incoming source handle takes it out of this pre-roll frame.
		updateItemProperties('right', { sourceStart: 0, sourceEnd: 60 });
		await expect.poll(audioCount).toBe(1);
		editorSession.clock.seek(60);
		await expect.poll(audioCount).toBe(2);
		editorSession.clock.seek(62);
		await expect.poll(audioCount).toBe(1);
		updateItemProperties('right', { from: 90 });
		await expect.poll(audioCount).toBe(0);
	} finally {
		editorSession.stopPlayback();
		await screen.unmount();
		mediaPool.clear();
		sequenceStore.reset();
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		editorSession.project = null;
	}
});
