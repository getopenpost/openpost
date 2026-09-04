import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ExportPanel from './ExportPanel.svelte';
import '../../../routes/layout.css';

describe('Quick Cut ExportPanel', () => {
	it('shows readable live progress and cancels the export', async () => {
		const cancel = vi.fn();
		const screen = await render(ExportPanel, {
			isExporting: true,
			cancel,
			progress: {
				phase: 'transcoding',
				segmentIndex: 2,
				totalSegments: 4,
				bytesWritten: 12_582_912,
				elapsedMs: 4_000,
				etaMs: 6_000,
				fraction: 0.42
			}
		});

		await expect
			.element(screen.getByRole('progressbar', { name: 'Export progress' }))
			.toHaveAttribute('aria-valuenow', '42');
		await expect.element(screen.getByText('12.0 MB', { exact: true })).toBeVisible();
		await expect.element(screen.getByText('Encoding output', { exact: true })).toBeVisible();

		await screen.getByRole('button', { name: 'Cancel' }).click();
		expect(cancel).toHaveBeenCalledOnce();
	});
});
