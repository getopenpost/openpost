import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { mediaTasks } from '../media/media-tasks.svelte';
import MediaTaskProgress from './media-task-progress.svelte';
import '../../../routes/layout.css';
afterEach(() => mediaTasks.reset());
it('keeps mixed progress indeterminate and exposes cancellation while reporting the phase', async () => {
	const cancel = vi.fn();
	mediaTasks.start({
		id: 'upload',
		kind: 'import',
		label: 'Launch video',
		stage: 'copying',
		progress: 0.5,
		onCancel: cancel
	});
	mediaTasks.start({
		id: 'probe',
		kind: 'import',
		label: 'Second video',
		stage: 'probing',
		progress: null
	});
	const screen = await render(MediaTaskProgress);
	await expect.element(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
	await expect.element(screen.getByRole('status')).toHaveTextContent('Second video');
	mediaTasks.update('probe', { progress: 0.3 });
	await expect.element(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
	await screen.getByRole('button', { expanded: false }).click();
	await screen.getByRole('button', { name: /Cancel/ }).click();
	expect(cancel).toHaveBeenCalledOnce();
	await expect.element(screen.getByRole('status')).toHaveTextContent(/Cancelling/i);
});
