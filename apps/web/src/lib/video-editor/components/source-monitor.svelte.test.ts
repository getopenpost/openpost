import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { mediaPool } from '../media/pool.svelte';
import SourceMonitor from './source-monitor.svelte';

afterEach(() => mediaPool.clear());

it('places crossed marks at the playhead and keeps a nonempty source range', async () => {
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
			remoteUrl: 'data:audio/wav;base64,UklGRgQAAABXQVZF',
			tags: ['video']
		},
		'ready'
	);
	const screen = await render(SourceMonitor, {
		mediaId: 'source',
		onclose: vi.fn(),
		onedit: vi.fn()
	});
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
