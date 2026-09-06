import { expect, test, vi } from 'vitest';
import { AudioSample, AudioSampleSource, BufferTarget, Output, WebMOutputFormat } from 'mediabunny';
import { render } from 'vitest-browser-svelte';
import { probeSourceFile } from './source';
import { getQuickCutWaveform } from './waveform';
import TimelineBar from './components/TimelineBar.svelte';
import '../../routes/layout.css';

async function twoTrackAudioFixture(): Promise<File> {
	const target = new BufferTarget();
	const output = new Output({ format: new WebMOutputFormat(), target });
	const quiet = new AudioSampleSource({ codec: 'opus', bitrate: 64_000 });
	const voice = new AudioSampleSource({ codec: 'opus', bitrate: 64_000 });
	output.addAudioTrack(quiet);
	output.addAudioTrack(voice);
	await output.start();

	const sampleRate = 48_000;
	const quietPcm = new Float32Array(sampleRate);
	const voicePcm = new Float32Array(sampleRate);
	for (let frame = 0; frame < sampleRate; frame += 1) {
		voicePcm[frame] = Math.sin((2 * Math.PI * 440 * frame) / sampleRate) * 0.8;
	}
	for (const [source, pcm] of [
		[quiet, quietPcm],
		[voice, voicePcm]
	] as const) {
		const sample = new AudioSample({
			data: pcm,
			format: 'f32',
			numberOfChannels: 1,
			sampleRate,
			timestamp: 0
		});
		await source.add(sample);
		sample.close();
		source.close();
	}
	await output.finalize();
	if (!target.buffer) throw new Error('Audio fixture produced no bytes.');
	return new File([target.buffer], 'two-track-audio.webm', { type: 'audio/webm' });
}

test('decodes and draws the selected audio stream progressively', async () => {
	const source = await probeSourceFile(await twoTrackAudioFixture());
	source.selectedAudioTrackIndices = [1];
	const onSeek = vi.fn();

	const waveform = await getQuickCutWaveform(source);
	expect(waveform.isComplete).toBe(true);
	expect(Math.max(...waveform.peaks)).toBeGreaterThan(0.5);

	const screen = await render(TimelineBar, {
		activeSource: source,
		segments: [],
		currentTime: 0,
		selectedId: null,
		inPoint: null,
		outPoint: null,
		onSeek,
		onSelect: vi.fn()
	});
	await vi.waitFor(() => expect(screen.container.querySelector('canvas')).not.toBeNull());
	const canvas = screen.container.querySelector('canvas')!;
	await vi.waitFor(() => expect(canvas.width).toBeGreaterThan(1));

	await screen.getByRole('button', { name: 'Zoom in timeline' }).click();
	await expect
		.element(screen.getByRole('button', { name: 'Reset timeline zoom' }))
		.toHaveTextContent('200%');

	await screen.getByRole('button', { name: 'Seek in timeline' }).click();
	expect(onSeek).toHaveBeenCalledOnce();
	expect(onSeek.mock.calls[0]?.[0]).toBeGreaterThan(0);
	expect(onSeek.mock.calls[0]?.[0]).toBeLessThan(source.duration);
});
