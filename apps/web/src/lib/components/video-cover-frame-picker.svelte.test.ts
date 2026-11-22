import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import { captureVideoFrame } from '$lib/video/cover-frame';
import VideoCoverFramePicker from './video-cover-frame-picker.svelte';

// Hold browser encoding open to exercise dismissal before its callback settles.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$lib/video/cover-frame', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/video/cover-frame')>()),
	captureVideoFrame: vi.fn()
}));

// Keep media URLs inert so headless Chromium does not block on external MP4 decoding.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$lib/media-url', () => ({
	getAuthenticatedMediaByID: () => undefined
}));

it.each(['Edit this frame', 'Use this frame'])(
	'does not finish %s after the picker closes during capture',
	async (action) => {
		const capture = Promise.withResolvers<Blob>();
		vi.mocked(captureVideoFrame).mockReturnValue(capture.promise);
		const onEditFrame = vi.fn(async () => {});
		const onFileChange = vi.fn(async () => {});
		const screen = await render(VideoCoverFramePicker, {
			mediaId: 'source-video',
			mode: 'image',
			label: 'Thumbnail',
			onEditFrame,
			onFileChange
		});
		const previewVideo = screen.container.querySelector('video:not([hidden])');
		expect(previewVideo).toBeInstanceOf(HTMLVideoElement);
		if (!(previewVideo instanceof HTMLVideoElement)) {
			throw new Error('Expected visible preview video');
		}
		Object.defineProperty(previewVideo, 'duration', { value: 10, configurable: true });
		previewVideo.dispatchEvent(new Event('loadedmetadata'));
		await tick();

		await screen.getByRole('button', { name: action, exact: true }).click();
		await screen.unmount();
		capture.resolve(new Blob(['frame'], { type: 'image/jpeg' }));
		await capture.promise;
		await tick();
		expect(onEditFrame).not.toHaveBeenCalled();
		expect(onFileChange).not.toHaveBeenCalled();
	}
);
