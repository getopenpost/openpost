import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { client } from '$lib/api/client';
import { setLocale } from '$lib/paraglide/runtime';
import { auth } from '$lib/stores/auth';
import { userProfileDefaults } from '$lib/test-fixtures/user-profile';
import DeleteAccountDialog from './delete-account-dialog.svelte';

// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const deleteMock = vi.spyOn(client, 'DELETE');

function impactResponse(overrides = {}) {
	return {
		organizations: 1,
		workspaces: 2,
		social_accounts: 3,
		publications: 4,
		posts: 5,
		media: 6,
		blockers: [],
		ownership_transfers: [],
		...overrides
	};
}

function user() {
	return {
		...userProfileDefaults,
		id: 'user-1',
		email: 'user-1@example.com',
		username: 'user-1',
		public_profile_enabled: false,
		is_admin: false,
		is_managed: false,
		has_password: true,
		legal_acceptance_required: false,
		email_verified: true,
		created_at: '2026-09-01T10:00:00Z'
	};
}

describe('DeleteAccountDialog shared flow', () => {
	beforeEach(() => {
		deleteMock.mockReset();
		setLocale('en', { reload: false });
		auth.setUser(user());
	});

	it('enables delete only after the matching email and password, then sends the identical body', async () => {
		// SAFETY: the cast bridges the mock's declared response type to the canned delete payload.
		deleteMock.mockResolvedValue({ data: { deleted: true } } as never);
		const onDeleted = vi.fn().mockResolvedValue(undefined);
		const screen = await render(DeleteAccountDialog, {
			open: true,
			email: 'user-1@example.com',
			impact: impactResponse(),
			hasPassword: true,
			onDeleted
		});

		const deleteButton = screen.getByRole('button', { name: 'Delete account permanently' });
		await screen
			.getByRole('textbox', { name: 'Type your account email to confirm' })
			.fill('USER-1@EXAMPLE.COM');
		await expect.element(deleteButton).toBeDisabled();

		await screen.getByLabelText('Current password').fill('secret-123');
		await expect.element(deleteButton).not.toBeDisabled();

		await deleteButton.click();
		await vi.waitFor(() =>
			expect(deleteMock).toHaveBeenCalledWith('/auth/account', {
				body: {
					confirm_email: 'USER-1@EXAMPLE.COM',
					current_password: 'secret-123',
					reauth_grant: undefined
				}
			})
		);
		await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
	});

	it('reports blockers and keeps delete disabled', async () => {
		const screen = await render(DeleteAccountDialog, {
			open: true,
			email: 'user-1@example.com',
			impact: impactResponse({
				blockers: [{ code: 'sole_owner', message: 'Transfer ownership first' }]
			}),
			hasPassword: true,
			onDeleted: vi.fn()
		});

		await expect.element(screen.getByText('Transfer ownership first')).toBeVisible();
		await expect
			.element(screen.getByRole('textbox', { name: 'Type your account email to confirm' }))
			.toBeDisabled();
		await expect
			.element(screen.getByRole('button', { name: 'Delete account permanently' }))
			.toBeDisabled();
		expect(deleteMock).not.toHaveBeenCalled();
	});

	it('keeps a failed delete open with the message visible', async () => {
		// SAFETY: the cast bridges the mock's declared response type to the canned error payload.
		deleteMock.mockResolvedValue({ error: { detail: 'Delete refused' } } as never);
		const screen = await render(DeleteAccountDialog, {
			open: true,
			email: 'user-1@example.com',
			impact: impactResponse(),
			hasPassword: true,
			onDeleted: vi.fn()
		});

		await screen
			.getByRole('textbox', { name: 'Type your account email to confirm' })
			.fill('user-1@example.com');
		await screen.getByLabelText('Current password').fill('secret-123');
		await screen.getByRole('button', { name: 'Delete account permanently' }).click();

		await expect.element(screen.getByText('Delete refused')).toBeVisible();
		await expect.element(screen.getByRole('dialog')).toBeVisible();
	});
});
