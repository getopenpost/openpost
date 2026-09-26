import { afterEach, expect, it } from 'vitest';
import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny';
import { createFloat32WavBlob } from '../local-ai/audio';
import type { Project } from '../project/types';
import { mediaPool } from './pool.svelte';
import { renderTimelineAudioArtifact } from './render-export';

afterEach(() => mediaPool.clear());

it.each([
	{
		name: 'trimmed EOF',
		from: 0,
		range: { startFrame: 1, endFrame: 3 },
		skip: 1600,
		leading: 0,
		expectedCount: 3200
	},
	{
		name: 'delayed clip',
		from: 69,
		range: undefined,
		skip: 0,
		leading: 110400,
		expectedCount: 115200
	}
])(
	'keeps sample boundaries aligned for $name',
	async ({ from, range, skip, leading, expectedCount }) => {
		const samples = Float32Array.from({ length: 4800 }, (_, index) => index / 10000);
		const blob = createFloat32WavBlob([samples], 48000);
		const url = URL.createObjectURL(blob);
		mediaPool.upsert(
			{
				id: 'audio',
				storageType: 'cloud',
				remoteUrl: url,
				fileName: 'ramp.wav',
				fileSize: blob.size,
				mimeType: blob.type,
				duration: 0.1,
				width: 0,
				height: 0,
				fps: 0,
				codec: 'pcm-f32',
				bitrate: 1_536_000,
				audioCodec: 'pcm-f32',
				tags: []
			},
			'ready'
		);
		const project: Project = {
			id: 'audio-range',
			name: 'Audio range',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 0.1,
			metadata: { width: 64, height: 64, fps: 30 },
			timeline: {
				tracks: [
					{
						id: 'a',
						name: 'Audio',
						kind: 'audio',
						height: 60,
						order: 0,
						visible: true,
						locked: false,
						muted: false,
						solo: false
					}
				],
				items: [
					{
						id: 'clip',
						label: 'Ramp',
						type: 'audio',
						trackId: 'a',
						mediaId: 'audio',
						from,
						durationInFrames: 3
					}
				]
			}
		};
		let input: Input | undefined;
		try {
			const artifact = await renderTimelineAudioArtifact(project, {
				format: 'wav',
				range
			});
			input = new Input({ source: new BlobSource(artifact.blob), formats: ALL_FORMATS });
			const track = (await input.getPrimaryAudioTrack())!;
			let count = 0;
			let maxError = 0;
			for await (const { buffer } of new AudioBufferSink(track).buffers()) {
				expect(buffer.numberOfChannels).toBe(2);
				for (let channel = 0; channel < 2; channel++) {
					const decoded = buffer.getChannelData(channel);
					for (let index = 0; index < decoded.length; index++) {
						const sourceIndex = count + index - leading + skip;
						const expected = sourceIndex < 0 ? 0 : sourceIndex / 10000;
						maxError = Math.max(maxError, Math.abs(decoded[index]! - expected));
					}
				}
				count += buffer.length;
			}
			expect(count).toBe(expectedCount);
			expect(maxError).toBeLessThan(0.00004);
		} finally {
			input?.dispose();
			URL.revokeObjectURL(url);
		}
	}
);
