import { beforeEach, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { commands } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { getWaveform, type WaveformData } from '../media/waveform-client';
import type { MediaMetadata } from '@openpost/editor-shared/media';
import SourceAudioWaveform from './source-audio-waveform.svelte';
import '../../../routes/layout.css';

declare module 'vitest/browser' {
	interface BrowserCommands {
		setDeviceScaleFactor(scale: number | null): Promise<void>;
	}
}

// Hold decoding at its asynchronous boundary while the real component switches sources.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('../media/waveform-client', async (original) => ({
	...(await original<typeof import('../media/waveform-client')>()),
	getWaveform: vi.fn()
}));

beforeEach(() => {
	vi.mocked(getWaveform).mockReset();
});

const media: MediaMetadata = {
	id: 'previous-source',
	storageType: 'handle',
	fileName: 'recording.wav',
	fileSize: 100,
	mimeType: 'audio/wav',
	duration: 1,
	width: 0,
	height: 0,
	fps: 0,
	codec: 'pcm-s16',
	bitrate: 100,
	tags: []
};
function samples(peak: number): WaveformData {
	return {
		peaks: new Float32Array([peak]),
		durationSeconds: 1,
		samplesPerSecond: 1,
		loadedSamples: 1,
		isComplete: true
	};
}

it.each(['loading', 'ready'] as const)(
	'ignores old waveform completion when the selected source is %s',
	async (state) => {
		const previous = Promise.withResolvers<WaveformData>();
		const selected = Promise.withResolvers<WaveformData>();
		vi.mocked(getWaveform).mockImplementation((source) =>
			source.id === media.id ? previous.promise : selected.promise
		);
		const props = { media, durationSeconds: 1, currentTimeSeconds: 0, onseek: vi.fn() };
		const screen = await render(SourceAudioWaveform, props);
		try {
			screen.container.style.width = '480px';
			screen.container.style.height = '180px';
			await expect.poll(() => vi.mocked(getWaveform).mock.calls.length).toBe(1);
			await screen.rerender({ ...props, media: { ...media, id: 'selected-source' } });
			await expect.poll(() => vi.mocked(getWaveform).mock.calls.length).toBe(2);
			let selectedPixels: string | undefined;
			if (state === 'ready') {
				selected.resolve(samples(0));
				await expect
					.poll(() => screen.container.querySelector('canvas')?.height)
					.toBe(180 * devicePixelRatio);
				selectedPixels = screen.container.querySelector('canvas')!.toDataURL();
			}
			previous.resolve(samples(1));
			await previous.promise;
			await tick();
			if (state === 'loading') expect(screen.container.querySelector('canvas')).toBeNull();
			else
				expect(screen.container.querySelector('canvas')!.toDataURL() === selectedPixels).toBe(true);
		} finally {
			previous.resolve(samples(0));
			selected.resolve(samples(0));
			await screen.unmount();
		}
	}
);

function displayedPixel(container: HTMLElement, x: number, y: number): number[] {
	const layers = [...container.querySelectorAll('canvas')];
	if (layers.length === 0) return [];
	const composite = document.createElement('canvas');
	composite.width = layers[0].width;
	composite.height = layers[0].height;
	const context = composite.getContext('2d')!;
	for (const layer of layers) context.drawImage(layer, 0, 0);
	return [...context.getImageData(x * devicePixelRatio, y * devicePixelRatio, 1, 1).data];
}

it('moves both playheads over the waveform and clears their old position after seeking', async () => {
	vi.mocked(getWaveform).mockResolvedValue({ ...samples(0), durationSeconds: 120 });
	const screen = await render(SourceAudioWaveform, {
		media: { ...media, duration: 120 },
		durationSeconds: 120,
		currentTimeSeconds: 0,
		onseek: vi.fn()
	});
	screen.container.style.width = '480px';
	screen.container.style.height = '180px';
	await expect
		.poll(() => screen.container.querySelector('canvas')?.height)
		.toBe(180 * devicePixelRatio);
	const redAt = (x: number, y: number) => {
		const [red, green, blue] = displayedPixel(screen.container, x, y);
		return red > 200 && green < 100 && blue < 100;
	};
	await expect.poll(() => redAt(8, 60)).toBe(true);
	await screen.rerender({ currentTimeSeconds: 5 });
	await expect.poll(() => redAt(27, 8) && redAt(124, 60)).toBe(true);
	expect(redAt(8, 60)).toBe(false);
	await screen.rerender({ currentTimeSeconds: 50 });
	await expect.poll(() => redAt(201, 8) && redAt(240, 60)).toBe(true);
	expect(redAt(124, 60)).toBe(false);
	screen.container.style.width = '320px';
	await expect.poll(() => redAt(135, 8) && redAt(160, 60)).toBe(true);
	expect(redAt(240, 60)).toBe(false);
});

it('keeps the paused waveform sharp when display scale changes without a layout change', async () => {
	let screen: Awaited<ReturnType<typeof render>> | undefined;
	try {
		await commands.setDeviceScaleFactor(1);
		vi.mocked(getWaveform).mockResolvedValue(samples(0));
		screen = await render(SourceAudioWaveform, {
			media,
			durationSeconds: 1,
			currentTimeSeconds: 0,
			onseek: vi.fn()
		});
		screen.container.style.width = '480px';
		screen.container.style.height = '180px';
		await expect.poll(() => screen!.container.querySelector('canvas')?.height).toBe(180);
		await commands.setDeviceScaleFactor(2);
		await expect.poll(() => devicePixelRatio).toBe(2);
		await expect
			.poll(() =>
				[...screen!.container.querySelectorAll('canvas')].map((canvas) => [
					canvas.width,
					canvas.height
				])
			)
			.toEqual([
				[960, 360],
				[960, 360]
			]);
		expect(screen.container.clientWidth).toBe(480);
		const [red, green, blue] = displayedPixel(screen.container, 8, 60);
		expect(red > 200 && green < 100 && blue < 100).toBe(true);
	} finally {
		await screen?.unmount();
		await commands.setDeviceScaleFactor(null);
	}
});
