import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { client } from '$lib/api/client';
import { setLocale } from '$lib/paraglide/runtime';
import OrganizationDeleteDialog from './organization-delete-dialog.svelte';

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

function previewResponse(overrides = {}) {
	return {
		data: {
			organization_id: 'org-1',
			organization_name: 'Acme Org',
			workspaces: [],
			billing_state: 'none',
			pending_work: {
				pending_provider_writes: 0,
				pending_jobs: 0,
				pending_cleanup_jobs: 0
			},
			access_effects: [],
			retained: [],
			irreversible_loss: [],
			recovery_possible: false,
			blockers: [],
			...overrides
		}
	};
}

describe('OrganizationDeleteDialog shared flow', () => {
	afterEach(() => {
		getMock.mockReset();
		setLocale('en', { reload: false });
	});

	it('enables delete only after the exact organization name and password', async () => {
		// SAFETY: the cast bridges the mock's declared response type to the canned preview payload.
		getMock.mockResolvedValue(previewResponse() as never);
		const onConfirm = vi.fn().mockResolvedValue(undefined);
		const screen = await render(OrganizationDeleteDialog, {
			open: true,
			organizationID: 'org-1',
			organizationName: 'Acme Org',
			hasPassword: true,
			onConfirm
		});

		const deleteButton = screen.getByRole('button', { name: 'Delete Organization' });
		await screen.getByRole('textbox', { name: 'Enter Acme Org exactly' }).fill('Acme Org');
		await expect.element(deleteButton).toBeDisabled();

		await screen.getByLabelText('Current password').fill('secret-123');
		await expect.element(deleteButton).not.toBeDisabled();

		await deleteButton.click();
		await vi.waitFor(() =>
			expect(onConfirm).toHaveBeenCalledWith('org-1', {
				confirmName: 'Acme Org',
				currentPassword: 'secret-123',
				reauthGrant: undefined
			})
		);
	});

	it('reports preview blockers and keeps delete disabled', async () => {
		// SAFETY: the cast bridges the mock's declared response type to the canned preview payload.
		getMock.mockResolvedValue(
			previewResponse({
				blockers: [{ code: 'active_billing', message: 'Resolve billing first' }]
			}) as never
		);
		const onConfirm = vi.fn();
		const screen = await render(OrganizationDeleteDialog, {
			open: true,
			organizationID: 'org-1',
			organizationName: 'Acme Org',
			hasPassword: true,
			onConfirm
		});

		await expect
			.element(screen.getByText(/Resolve the subscription and wait for Paddle/))
			.toBeVisible();
		await expect
			.element(screen.getByRole('textbox', { name: 'Enter Acme Org exactly' }))
			.toBeDisabled();
		await expect
			.element(screen.getByRole('button', { name: 'Delete Organization' }))
			.toBeDisabled();
		expect(onConfirm).not.toHaveBeenCalled();
	});
});
