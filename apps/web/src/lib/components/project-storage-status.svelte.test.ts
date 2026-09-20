import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ProjectStorageStatus from './project-storage-status.svelte';

test('cloud sync completion does not claim the project is available offline', async () => {
	const screen = await render(ProjectStorageStatus, { storage: 'cloud', syncStatus: 'synced' });
	await expect
		.element(screen.getByRole('img', { name: 'Saved to OpenPost · Online' }))
		.toBeVisible();
	await screen.rerender({ storage: 'cloud', syncStatus: 'synced', offline: true });
	await expect
		.element(screen.getByRole('img', { name: /Saved to OpenPost · Available offline/ }))
		.toBeVisible();
});

test('failed saves stay visible for local as well as cloud projects', async () => {
	const screen = await render(ProjectStorageStatus, {
		storage: 'local',
		syncStatus: 'needs_attention',
		reason: 'Folder access lost'
	});
	await expect
		.element(screen.getByRole('img', { name: /Needs attention.*Folder access lost/ }))
		.toBeVisible();
	await screen.rerender({ storage: 'cloud', syncStatus: 'uploading' });
	await expect.element(screen.getByRole('img', { name: /OpenPost · Saving/ })).toBeVisible();
});
