import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ProgressMeter from './progress-meter.svelte';

describe('measured progress', () => {
	it('exposes a measured zero and removes the percentage for an unknown phase', async () => {
		const screen = await render(ProgressMeter, {
			fraction: 0,
			label: 'Uploading video',
			phase: 'upload'
		});
		await expect
			.element(screen.getByRole('progressbar', { name: 'Uploading video' }))
			.toHaveAttribute('aria-valuenow', '0');
		await screen.rerender({ fraction: 0.5 });
		await expect.element(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
		await screen.rerender({ fraction: null, label: 'Checking video', phase: 'checking' });
		await expect
			.element(screen.getByRole('progressbar', { name: 'Checking video' }))
			.not.toHaveAttribute('aria-valuenow');
		await screen.rerender({ fraction: 0 });
		await expect.element(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
	});
});
