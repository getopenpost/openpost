import { afterEach, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { mediaPool } from '../../media/pool.svelte';
import { timelineStore } from '../../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../../timeline/commands/command-store.svelte';
import { createDefaultTracks } from '../../project/defaults';
import { createFloat32WavBlob } from '../../local-ai/audio';
import { createBeatDetectionService } from './beat-detection-service.svelte';
import BeatDetectionPanel from './beat-detection-panel.svelte';
import '../../../../routes/layout.css';

afterEach(() => {
	mediaPool.clear();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
});

it('distinguishes no detected beats from a repeated, already marked beat grid', async () => {
	const sampleRate = 44_100;
	const seconds = 8;
	let samples = new Float32Array(sampleRate * seconds);
	mediaPool.upsert(
		{
			id: 'beat-feedback-media',
			storageType: 'workspace',
			fileName: 'fixture.wav',
			fileSize: samples.byteLength + 44,
			mimeType: 'audio/wav',
			duration: seconds,
			width: 0,
			height: 0,
			fps: 0,
			codec: 'pcm',
			bitrate: 0,
			audioCodec: 'pcm',
			audioCodecSupported: true,
			tags: ['audio']
		},
		'ready'
	);
	timelineStore.setAll({
		tracks: createDefaultTracks(),
		fps: 30,
		markers: [],
		items: [
			{
				id: 'beat-feedback-clip',
				label: 'Beat feedback',
				type: 'audio',
				trackId: 'track-audio-main',
				from: 0,
				durationInFrames: seconds * 30,
				mediaId: 'beat-feedback-media',
				sourceStart: 0,
				sourceEnd: seconds * 30,
				sourceFps: 30
			}
		]
	});
	const service = createBeatDetectionService({
		resolveMediaBlob: async () => createFloat32WavBlob([samples], sampleRate)
	});
	const screen = await render(BeatDetectionPanel, {
		selectedItemId: 'beat-feedback-clip',
		service
	});
	const detect = screen.getByRole('button', { name: 'Detect beats', exact: true });
	await detect.click();
	await expect
		.element(screen.getByText('No beats were found in this clip.', { exact: true }))
		.toBeVisible();
	expect(timelineStore.markers).toHaveLength(0);

	samples = new Float32Array(sampleRate * seconds);
	for (let time = 0; time < seconds; time += 0.5) {
		const start = Math.round(time * sampleRate);
		for (let index = 0; index < sampleRate * 0.04; index++) {
			samples[start + index] =
				(1 - index / (sampleRate * 0.04)) *
				(0.7 + 0.3 * Math.sin((2 * Math.PI * 800 * index) / sampleRate));
		}
	}
	await detect.click();
	await expect.poll(() => timelineStore.markers.length).toBeGreaterThan(0);
	await expect.element(detect).toBeEnabled();
	const marked = timelineStore.markers.map((marker) => ({ ...marker }));
	await detect.click();
	await expect.element(screen.getByText(/No new markers.*beats already marked/)).toBeVisible();
	expect(timelineStore.markers).toEqual(marked);
});
