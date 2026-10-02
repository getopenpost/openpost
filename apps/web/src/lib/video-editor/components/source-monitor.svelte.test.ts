import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import demoVideoURL from '../../../../../../tests/app/fixtures/product-screenshots/study-sos-demo.mp4?url';
import { mediaPool } from '../media/pool.svelte';
import SourceMonitor from './source-monitor.svelte';

afterEach(() => mediaPool.clear());

async function renderSource(remoteUrl = 'data:audio/wav;base64,UklGRgQAAABXQVZF') {
	mediaPool.upsert(
		{
			id: 'source',
			fileName: 'source.mp4',
			fileSize: 1,
			mimeType: 'video/mp4',
			duration: 8,
			width: 1920,
			height: 1080,
			fps: 30,
			codec: 'avc',
			bitrate: 1,
			storageType: 'cloud',
			remoteUrl,
			tags: ['video']
		},
		'ready'
	);
	return render(SourceMonitor, {
		mediaId: 'source',
		onclose: vi.fn(),
		onedit: vi.fn()
	});
}

it('places crossed marks at the playhead and keeps a nonempty source range', async () => {
	const screen = await renderSource();
	await screen.getByRole('button', { name: 'Go to end', exact: true }).click();
	await screen.getByRole('button', { name: 'Mark in', exact: true }).click();
	await screen.getByRole('button', { name: 'Go to start', exact: true }).click();
	await screen.getByRole('button', { name: 'Mark out', exact: true }).click();
	await expect
		.element(screen.getByRole('slider', { name: 'Source out point' }))
		.toHaveAttribute('aria-valuenow', '1');
	await expect
		.element(screen.getByRole('slider', { name: 'Source in point' }))
		.toHaveAttribute('aria-valuenow', '0');
	await screen.getByRole('button', { name: 'Go to end', exact: true }).click();
	await screen.getByRole('button', { name: 'Mark in', exact: true }).click();
	await expect
		.element(screen.getByRole('slider', { name: 'Source in point' }))
		.toHaveAttribute('aria-valuenow', '239');
	await expect
		.element(screen.getByRole('slider', { name: 'Source out point' }))
		.toHaveAttribute('aria-valuenow', '240');
});

it('lets source sliders own native keyboard range and position adjustments', async () => {
	const screen = await renderSource();
	const position = screen.getByRole('slider', { name: 'Source position' });
	const start = screen.getByRole('slider', { name: 'Source in point' });
	const end = screen.getByRole('slider', { name: 'Source out point' });
	await screen.getByRole('button', { name: 'Go to end', exact: true }).click();
	position.element().focus();
	await userEvent.keyboard('{Home}');
	await expect.element(position).toHaveAttribute('aria-valuenow', '0');
	await userEvent.keyboard('{ArrowRight}');
	await expect.element(position).toHaveAttribute('aria-valuenow', '1');
	await userEvent.keyboard('{End}');
	await expect.element(position).toHaveAttribute('aria-valuenow', '239');
	start.element().focus();
	await userEvent.keyboard('{ArrowRight}');
	await expect.element(start).toHaveAttribute('aria-valuenow', '1');
	await userEvent.keyboard('{End}');
	await expect.element(start).toHaveAttribute('aria-valuenow', '239');
	await userEvent.keyboard('{Home}');
	await expect.element(start).toHaveAttribute('aria-valuenow', '0');
	end.element().focus();
	await userEvent.keyboard('{Home}');
	await expect.element(end).toHaveAttribute('aria-valuenow', '1');
	await userEvent.keyboard('{ArrowRight}');
	await expect.element(end).toHaveAttribute('aria-valuenow', '2');
	await userEvent.keyboard('{End}');
	await expect.element(end).toHaveAttribute('aria-valuenow', '240');
});

it('keeps paused native video seeks outside the marked range', async () => {
	const screen = await renderSource(demoVideoURL);
	const source = screen.getByRole('region', { name: 'Source', exact: true }).element();
	await vi.waitFor(
		() => {
			expect(source.querySelector('video')?.readyState ?? 0).toBeGreaterThanOrEqual(2);
		},
		{ timeout: 5000 }
	);
	const video = source.querySelector('video')!;
	await screen.getByRole('button', { name: 'Mark out', exact: true }).click();
	await expect
		.element(screen.getByRole('slider', { name: 'Source out point' }))
		.toHaveAttribute('aria-valuenow', '1');
	const updated = new Promise<void>((resolve) =>
		video.addEventListener('timeupdate', () => resolve(), { once: true })
	);
	await screen.getByRole('button', { name: 'Go to end', exact: true }).click();
	await updated;
	await expect
		.element(screen.getByRole('slider', { name: 'Source position' }))
		.toHaveAttribute('aria-valuenow', '239');
	expect(video.paused).toBe(true);
	expect(video.currentTime).toBeCloseTo(239 / 30, 2);
	const outPoint = screen.getByRole('slider', { name: 'Source out point' });
	outPoint.element().focus();
	await userEvent.keyboard('{ArrowRight>29/}');
	await expect.element(outPoint).toHaveAttribute('aria-valuenow', '30');
	await screen.getByRole('button', { name: 'Play', exact: true }).click();
	await vi.waitFor(() => expect(video.played.length).toBeGreaterThan(0));
	await vi.waitFor(() => expect(video.paused).toBe(true), { timeout: 3000 });
	await expect
		.element(screen.getByRole('slider', { name: 'Source position' }))
		.toHaveAttribute('aria-valuenow', '29');
	expect(video.currentTime).toBeCloseTo(29 / 30, 2);
});
