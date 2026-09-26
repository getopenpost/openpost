import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { client } from '$lib/api/client';
import { setLocale } from '$lib/paraglide/runtime';
import WorkspaceDeleteDialog from './workspace-delete-dialog.svelte';

// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const getMock = vi.spyOn(client, 'GET');

describe('WorkspaceDeleteDialog loading status', () => {
	afterEach(() => {
		getMock.mockReset();
		setLocale('en', { reload: false });
	});

	it('exposes the preview loading indicator as a live status', async () => {
		// SAFETY: a never-settling promise holds the dialog in its loading state; the cast bridges
		// the mock's declared response type, whose payload the loading branch never reads.
		getMock.mockImplementation(() => new Promise(() => {}) as never);
		const screen = await render(WorkspaceDeleteDialog, {
			open: true,
			workspaceID: 'ws-1',
			workspaceName: 'Acme',
			hasPassword: true,
			onConfirm: vi.fn()
		});

		await expect.element(screen.getByRole('status', { name: 'Loading...' })).toBeVisible();
	});
});
