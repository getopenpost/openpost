import { afterEach, expect, it } from 'vitest';
import { createDefaultTracks } from '../../project/defaults';
import { mediaPool } from '../../media/pool.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { commandHistory } from '../commands/command-store.svelte';
import { planMixdown } from '../../media/render-plan';
import { previewItemVolume } from '../../preview/playback-settings';
import { detachAudio } from './detach-audio';
import { unlinkItems, updateItemProperties } from './items';
import { transitionsStore } from './transitions-store.svelte';
import { collectMixEntryDuckWindows, mixEntryDuckGainAtTime } from '../../audio/audio-ducking';

afterEach(() => {
	mediaPool.clear();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	transitionsStore.clear();
});

it('preserves edited audio and other linked recording sources when separating the camera', () => {
	mediaPool.loadAll([
		{
			id: 'camera-source',
			storageType: 'cloud',
			remoteUrl: '/camera.mp4',
			fileName: 'camera.mp4',
			fileSize: 100,
			mimeType: 'video/mp4',
			duration: 8,
			width: 640,
			height: 360,
			fps: 30,
			codec: 'avc',
			audioCodec: 'aac',
			hasAudio: true,
			bitrate: 1000,
			tags: []
		}
	]);
	timelineStore.setAll({
		fps: 30,
		tracks: createDefaultTracks(),
		items: [
			{
				id: 'screen',
				type: 'video',
				label: 'Screen',
				trackId: 'track-video-main',
				mediaId: 'screen-source',
				from: 30,
				durationInFrames: 60,
				linkedGroupId: 'recording'
			},
			{
				id: 'camera',
				type: 'video',
				label: 'Camera',
				trackId: 'track-video-overlay',
				mediaId: 'camera-source',
				from: 30,
				durationInFrames: 60,
				linkedGroupId: 'recording',
				sourceStart: 48,
				sourceEnd: 144,
				sourceFps: 24,
				sourceDuration: 192,
				speed: 2,
				isReversed: true,
				volume: 0.5,
				audioFadeIn: 0.2,
				audioEqEnabled: true,
				audioEqLowGainDb: 3,
				keyframes: {
					volume: { frames: [0, 59], values: [0.5, 0.8] },
					opacity: { frames: [0, 59], values: [0, 1] }
				},
				transform: { x: 12, y: 20 },
				effects: [{ id: 'blur', type: 'blur', enabled: true, amount: 3 }]
			}
		]
	});
	const id = detachAudio('camera')!;
	const audio = timelineStore.itemById.get(id)!;
	expect(audio).toMatchObject({
		type: 'audio',
		mediaId: 'camera-source',
		from: 30,
		durationInFrames: 60,
		sourceStart: 48,
		sourceEnd: 144,
		sourceFps: 24,
		sourceDuration: 192,
		speed: 2,
		isReversed: true,
		volume: 0.5,
		audioFadeIn: 0.2,
		audioEqEnabled: true,
		audioEqLowGainDb: 3,
		keyframes: { volume: { frames: [0, 59], values: [0.5, 0.8] } }
	});
	expect(audio.transform).toBeUndefined();
	expect(audio.effects).toBeUndefined();
	expect(audio.keyframes?.opacity).toBeUndefined();
	expect(
		planMixdown(timelineStore.items, timelineStore.tracks, 30).map((entry) => entry.itemId)
	).toEqual(['screen', id]);
	unlinkItems([id]);
	updateItemProperties(id, { from: 45 });
	expect(
		planMixdown(timelineStore.items, timelineStore.tracks, 30).map((entry) => entry.itemId)
	).toEqual(['screen', id]);
	expect(
		previewItemVolume(timelineStore.itemById.get('camera')!, timelineStore.tracks, 1, false)
	).toBe(0);
	expect(detachAudio('camera')).toBeNull();
});

it('keeps targeted ducking and transition sound when detached audio is unlinked', () => {
	mediaPool.loadAll([
		{
			id: 'media',
			storageType: 'cloud',
			remoteUrl: '/video.mp4',
			fileName: 'video.mp4',
			fileSize: 100,
			mimeType: 'video/mp4',
			duration: 5,
			width: 640,
			height: 360,
			fps: 30,
			codec: 'avc',
			hasAudio: true,
			bitrate: 1000,
			tags: []
		}
	]);
	timelineStore.setAll({
		fps: 30,
		tracks: createDefaultTracks(),
		items: [
			{
				id: 'video',
				type: 'video',
				label: 'Video',
				mediaId: 'media',
				trackId: 'track-video-main',
				from: 0,
				durationInFrames: 60,
				sourceStart: 0,
				sourceEnd: 60,
				sourceDuration: 150,
				sourceFps: 30
			},
			{
				id: 'next',
				type: 'video',
				label: 'Next',
				mediaId: 'next-media',
				trackId: 'track-video-main',
				from: 60,
				durationInFrames: 60,
				sourceStart: 30,
				sourceEnd: 90,
				sourceDuration: 150,
				sourceFps: 30
			},
			{
				id: 'voice',
				type: 'audio',
				label: 'Voice',
				mediaId: 'voice-media',
				trackId: 'track-audio',
				from: 0,
				durationInFrames: 60,
				audioDucking: { duckOthersDb: -12, targetTrackIds: ['track-video-main'] }
			}
		]
	});
	transitionsStore.setAll([
		{
			id: 'dissolve',
			type: 'crossfade',
			fromItemId: 'video',
			toItemId: 'next',
			durationInFrames: 20
		}
	]);
	const id = detachAudio('video')!;
	unlinkItems([id]);
	const mix = planMixdown(timelineStore.items, timelineStore.tracks, 30, transitionsStore.list);
	const audio = mix.find((entry) => entry.itemId === id)!;
	expect
		.soft(mixEntryDuckGainAtTime(1, audio, collectMixEntryDuckWindows(mix)))
		.toBeCloseTo(10 ** (-12 / 20));
	expect
		.soft(audio.transitionGainSpans)
		.toEqual([
			{ startSeconds: 50 / 30, durationSeconds: 20 / 30, isIncoming: false, dipToSilence: false }
		]);
	expect(audio.durationSeconds).toBeCloseTo(70 / 30);
});
