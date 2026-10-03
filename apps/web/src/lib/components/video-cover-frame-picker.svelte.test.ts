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

// Use a real decodable source while keeping media discovery out of this lifecycle test.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$lib/media-url', async () => {
	const { default: source } =
		await import('../../../../../tests/app/fixtures/product-screenshots/study-sos-demo.mp4?url');
	return { getAuthenticatedMediaByID: () => source };
});

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
		await screen.getByRole('button', { name: action, exact: true }).click();
		await screen.unmount();
		capture.resolve(new Blob(['frame'], { type: 'image/jpeg' }));
		await capture.promise;
		await tick();
		expect(onEditFrame).not.toHaveBeenCalled();
		expect(onFileChange).not.toHaveBeenCalled();
	}
);
