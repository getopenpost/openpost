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

test('draws the selected second audio track waveform and seeks from its timeline', async () => {
	const source = await probeSourceFile(await twoTrackAudioFixture());
	source.selectedAudioTrackIndices = [1];
	const onSeek = vi.fn();

	// Decoding the selected track directly keeps the second-track choice honest:
	// the silent first track would peak at zero.
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
		viewport: { start: 0, zoom: 1 },
		onViewportChange: vi.fn(),
		onSeek,
		onSelect: vi.fn()
	});
	await vi.waitFor(() => expect(screen.container.querySelector('canvas')).not.toBeNull());
	const canvas = screen.container.querySelector('canvas')!;
	await vi.waitFor(() => expect(canvas.width).toBeGreaterThan(1));

	// The canvas width only proves the draw ran once. Require painted pixels with the
	// vertical extent above a quarter of the canvas before seeking; this claims a
	// painted waveform at the current viewport, not progressive loading.
	await vi.waitFor(() => {
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Waveform canvas has no 2D context.');
		const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
		let paintedPixels = 0;
		let top = canvas.height;
		let bottom = -1;
		for (let y = 0; y < canvas.height; y += 1) {
			for (let x = 0; x < canvas.width; x += 1) {
				if (data[(y * canvas.width + x) * 4 + 3] === 0) continue;
				paintedPixels += 1;
				if (y < top) top = y;
				if (y > bottom) bottom = y;
			}
		}
		expect(paintedPixels).toBeGreaterThan(0);
		expect((bottom - top + 1) / canvas.height).toBeGreaterThan(0.25);
	});

	await screen.getByRole('button', { name: 'Seek in timeline' }).click();
	expect(onSeek).toHaveBeenCalledOnce();
	expect(onSeek.mock.calls[0]?.[0]).toBeGreaterThan(0);
	expect(onSeek.mock.calls[0]?.[0]).toBeLessThan(source.duration);
});
