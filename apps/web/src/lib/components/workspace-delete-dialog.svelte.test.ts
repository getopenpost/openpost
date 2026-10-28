import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { client } from '$lib/api/client';
import { setLocale } from '$lib/paraglide/runtime';
import WorkspaceDeleteDialog from './workspace-delete-dialog.svelte';

// The shared loading status is mid-migration to ActivityIndicator in a concurrent
// change (packages/ui does not export it yet), so tests stand in this stub with the
// same role and accessible name. Drop this mock once the export lands.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$lib/components/dialog-loading-status.svelte', async () => {
	const stub = await import('./dialog-loading-status.fixture.svelte');
	return { default: stub.default };
});

// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const getMock = vi.spyOn(client, 'GET');

describe('WorkspaceDeleteDialog shared flow', () => {
	afterEach(() => {
		getMock.mockReset();
		setLocale('en', { reload: false });
	});

	function previewResponse(overrides = {}) {
		return {
			data: {
				workspace_id: 'ws-1',
				workspace_name: 'Acme',
				removed: [],
				retained: [],
				recovery_possible: false,
				blockers: [],
				...overrides
			}
		};
	}

	it('enables delete only after the exact workspace name and password', async () => {
		// SAFETY: the cast bridges the mock's declared response type to the canned preview payload.
		getMock.mockResolvedValue(previewResponse() as never);
		const onConfirm = vi.fn().mockResolvedValue(undefined);
		const screen = await render(WorkspaceDeleteDialog, {
			open: true,
			workspaceID: 'ws-1',
			workspaceName: 'Acme',
			hasPassword: true,
			onConfirm
		});

		const deleteButton = screen.getByRole('button', { name: 'Delete workspace' });
		await screen.getByRole('textbox', { name: 'Enter Acme exactly' }).fill('acme');
		await screen.getByLabelText('Current password').fill('secret-123');
		await expect.element(deleteButton).toBeDisabled();

		await screen.getByRole('textbox', { name: 'Enter Acme exactly' }).fill('Acme');
		await expect.element(deleteButton).not.toBeDisabled();

		await deleteButton.click();
		await vi.waitFor(() =>
			expect(onConfirm).toHaveBeenCalledWith('ws-1', {
				confirmName: 'Acme',
				currentPassword: 'secret-123',
				reauthGrant: undefined
			})
		);
	});

	it('reports preview blockers and keeps delete disabled', async () => {
		// SAFETY: the cast bridges the mock's declared response type to the canned preview payload.
		getMock.mockResolvedValue(
			previewResponse({
				blockers: [{ code: 'active_billing', message: 'Settle billing first' }]
			}) as never
		);
		const onConfirm = vi.fn();
		const screen = await render(WorkspaceDeleteDialog, {
			open: true,
			workspaceID: 'ws-1',
			workspaceName: 'Acme',
			hasPassword: true,
			onConfirm
		});

		await expect
			.element(screen.getByText(/Move or cancel the active billing subscription/))
			.toBeVisible();
		await expect
			.element(screen.getByRole('textbox', { name: 'Enter Acme exactly' }))
			.toBeDisabled();
		await expect.element(screen.getByRole('button', { name: 'Delete workspace' })).toBeDisabled();
		expect(onConfirm).not.toHaveBeenCalled();
	});
});
