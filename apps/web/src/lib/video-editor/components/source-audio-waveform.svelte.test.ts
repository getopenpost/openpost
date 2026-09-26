import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import type { MediaMetadata } from '$lib/video-editor/media/types';
import type { ComponentProps } from 'svelte';
import SourceAudioWaveform from './source-audio-waveform.svelte';

function mediaFixture(): MediaMetadata {
	// SAFETY: the fixture carries the stream metadata the slider derives its bounds from;
	// the waveform loader failure path renders without reaching the decoder.
	return {
		id: 'test-media',
		fileName: 'clip.mp4',
		fileSize: 1024,
		mimeType: 'video/mp4',
		duration: 120,
		width: 1920,
		height: 1080,
		fps: 30,
		codec: 'h264',
		bitrate: 1000,
		storageType: 'handle'
	} as MediaMetadata;
}

async function renderWaveform(props: Partial<ComponentProps<typeof SourceAudioWaveform>> = {}) {
	const onseek = vi.fn();
	const screen = await render(SourceAudioWaveform, {
		media: mediaFixture(),
		durationSeconds: 120,
		currentTimeSeconds: 50,
		onseek,
		...props
	});
	const slider = screen.getByRole('slider', { name: 'Source audio waveform' });
	// SAFETY: waveform slider locators resolve to HTMLElement hosts, which support focus().
	(slider.element() as HTMLElement).focus();
	await expect.element(slider).toHaveFocus();
	return { slider, onseek };
}

describe('Source audio waveform slider keyboard', () => {
	it('seeks in large steps with PageUp and PageDown', async () => {
		const { onseek } = await renderWaveform();
		await userEvent.keyboard('{PageUp}');
		expect(onseek).toHaveBeenCalledTimes(1);
		expect(onseek.mock.calls[0][0]).toBe(60);
		onseek.mockClear();
		await userEvent.keyboard('{PageDown}');
		expect(onseek).toHaveBeenCalledTimes(1);
		expect(onseek.mock.calls[0][0]).toBe(40);
	});

	it('keeps arrow small steps and Home/End jumps', async () => {
		const { onseek } = await renderWaveform();
		await userEvent.keyboard('{ArrowRight}');
		expect(onseek.mock.calls[0][0]).toBe(51);
		onseek.mockClear();
		await userEvent.keyboard('{Home}');
		expect(onseek.mock.calls[0][0]).toBe(0);
		onseek.mockClear();
		await userEvent.keyboard('{End}');
		expect(onseek.mock.calls[0][0]).toBe(120);
	});
});
