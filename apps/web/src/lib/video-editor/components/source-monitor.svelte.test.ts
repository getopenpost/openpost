import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import { mediaPool } from '../media/pool.svelte';
import SourceMonitor from './source-monitor.svelte';

afterEach(() => mediaPool.clear());

async function renderSource() {
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
