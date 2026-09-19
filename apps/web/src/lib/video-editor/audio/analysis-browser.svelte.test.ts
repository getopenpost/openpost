import { describe, expect, it } from 'vitest';
import { createFloat32WavBlob } from '../local-ai/audio';
import { decodeAudioBlobRangeForAnalysis } from './analysis-decoder';
import { analyzeAudioBlob } from './analysis-client';
import { detectSilentRanges } from './audio-silence';

describe('source audio cleanup', () => {
	it('retains audible opposite-phase stereo through decode and silence detection', async () => {
		const sampleRate = 16000;
		const left = Float32Array.from({ length: sampleRate * 3 }, (_, index) =>
			index < sampleRate || index >= sampleRate * 2
				? 0
				: 0.5 * Math.sin((2 * Math.PI * 440 * index) / sampleRate)
		);
		const right = left.map((sample) => -sample);
		const audio = await decodeAudioBlobRangeForAnalysis(
			createFloat32WavBlob([left, right], sampleRate)
		);
		const ranges = detectSilentRanges(audio, { minSilenceMs: 300, paddingMs: 0 });
		expect(ranges).toEqual([
			{ start: 0, end: 1 },
			{ start: 2, end: 3 }
		]);
	});
	it('runs signal analysis in the production worker and cancels outstanding work', async () => {
		const audio = createFloat32WavBlob([new Float32Array(48000)], 16000);
		expect(await analyzeAudioBlob(audio, { mode: 'signal', paddingMs: 0 })).toEqual([
			{ start: 0, end: 3 }
		]);
		const controller = new AbortController();
		const job = analyzeAudioBlob(audio, { mode: 'speech', signal: controller.signal });
		controller.abort();
		await expect(job).rejects.toMatchObject({ name: 'AbortError' });
	});
	it('preserves audible ranges across decode chunks and all selected audio tracks', async () => {
		const sampleRate = 16000;
		const samples = Float32Array.from({ length: sampleRate * 19 }, (_, i) =>
			i >= sampleRate * 15.8 && i < sampleRate * 16.5
				? Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5
				: 0
		);
		const ranges = await analyzeAudioBlob(createFloat32WavBlob([samples], sampleRate), {
			mode: 'signal',
			paddingMs: 0
		});
		expect(ranges).toEqual([
			{ start: 0, end: 15.8 },
			{ start: 16.5, end: 19 }
		]);
		const blob = await audioTracks([
			new Float32Array(48000),
			Float32Array.from(
				{ length: 48000 },
				(_, i) => Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.5
			)
		]);
		expect(
			await analyzeAudioBlob(blob, { mode: 'signal', audioTrackIndices: [0], paddingMs: 0 })
		).toHaveLength(1);
		expect(
			await analyzeAudioBlob(blob, { mode: 'signal', audioTrackIndices: [0, 1], paddingMs: 0 })
		).toEqual([]);
	});

	it('keeps short gaps between speakers on different audio tracks', async () => {
		const rate = 48000;
		const tone = (i: number) => Math.sin((2 * Math.PI * 440 * i) / rate) * 0.5;
		const blob = await audioTracks([
			Float32Array.from({ length: rate * 2 }, (_, i) => (i < rate ? 0 : tone(i))),
			Float32Array.from({ length: rate * 2 }, (_, i) => (i < rate * 0.9 ? tone(i) : 0))
		]);
		expect(
			await analyzeAudioBlob(blob, {
				mode: 'signal',
				audioTrackIndices: [0, 1],
				minSilenceMs: 500,
				paddingMs: 0
			})
		).toEqual([]);
	});
});

async function audioTracks(channels: Float32Array[]): Promise<Blob> {
	const { Output, BufferTarget, WebMOutputFormat, AudioSampleSource, AudioSample } =
		await import('mediabunny');
	const target = new BufferTarget();
	const output = new Output({ target, format: new WebMOutputFormat() });
	const tracks = channels.map(() => new AudioSampleSource({ codec: 'opus', bitrate: 64000 }));
	for (const track of tracks) output.addAudioTrack(track);
	await output.start();
	for (let index = 0; index < tracks.length; index += 1) {
		const sample = new AudioSample({
			data: channels[index]!,
			format: 'f32',
			sampleRate: 48000,
			numberOfChannels: 1,
			timestamp: 0
		});
		await tracks[index]!.add(sample);
		sample.close();
		tracks[index]!.close();
	}
	await output.finalize();
	return new Blob([target.buffer!], { type: 'audio/webm' });
}
