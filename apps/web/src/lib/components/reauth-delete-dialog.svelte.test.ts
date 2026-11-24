import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { setLocale } from '$lib/paraglide/runtime';
import { acquireReauthGrant } from '$lib/auth/reauth';
import ReauthDeleteDialog from './reauth-delete-dialog.svelte';

// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$lib/auth/reauth', () => ({ acquireReauthGrant: vi.fn() }));

const grantMock = vi.mocked(acquireReauthGrant);

function baseProps(overrides = {}) {
	return {
		open: true,
		entityID: 'ws-1',
		title: 'Delete workspace?',
		description: 'This cannot be undone.',
		confirmInputID: 'confirm-name',
		confirmLabelFor: (name: string) => `Type ${name} to confirm`,
		passwordInputID: 'confirm-password',
		hasPassword: true,
		reauthAction: 'workspace.delete',
		manageReauthCapabilities: false,
		fallbackExpectedConfirm: 'Acme',
		blockerTitle: 'Cannot delete yet',
		confirmButtonLabel: 'Delete workspace',
		fallbackPreviewError: 'Preview unavailable',
		fallbackDeleteError: 'Delete failed',
		onDelete: vi.fn().mockResolvedValue(undefined),
		...overrides
	};
}

describe('ReauthDeleteDialog shared delete flow', () => {
	afterEach(() => {
		vi.clearAllMocks();
		setLocale('en', { reload: false });
	});

	it('blocks delete until the typed confirmation matches and a password is present', async () => {
		const onDelete = vi.fn().mockResolvedValue(undefined);
		const screen = await render(ReauthDeleteDialog, baseProps({ onDelete }));
		const confirmBox = screen.getByRole('textbox', {
			name: 'Type Acme to confirm'
		});
		const passwordBox = screen.getByLabelText('Current password');
		const deleteButton = screen.getByRole('button', {
			name: 'Delete workspace'
		});

		await expect.element(deleteButton).toBeDisabled();

		await confirmBox.fill('Wrong name');
		await passwordBox.fill('secret-123');
		await expect.element(deleteButton).toBeDisabled();

		await confirmBox.fill('Acme');
		await passwordBox.fill('');
		await expect.element(deleteButton).toBeDisabled();

		await passwordBox.fill('secret-123');
		await expect.element(deleteButton).not.toBeDisabled();

		await deleteButton.click();
		await vi.waitFor(() =>
			expect(onDelete).toHaveBeenCalledWith({
				confirmText: 'Acme',
				currentPassword: 'secret-123',
				reauthGrant: undefined
			})
		);
		expect(grantMock).not.toHaveBeenCalled();
	});

	it('acquires the re-auth grant for passwordless accounts and passes it to onDelete', async () => {
		grantMock.mockResolvedValue('grant-1');
		const onDelete = vi.fn().mockResolvedValue(undefined);
		const screen = await render(
			ReauthDeleteDialog,
			baseProps({ onDelete, hasPassword: false, hasPasskey: true })
		);

		await screen.getByRole('textbox', { name: 'Type Acme to confirm' }).fill('Acme');
		await screen.getByRole('button', { name: 'Delete workspace' }).click();

		await vi.waitFor(() =>
			expect(grantMock).toHaveBeenCalledWith('workspace.delete', expect.anything())
		);
		await vi.waitFor(() =>
			expect(onDelete).toHaveBeenCalledWith({
				confirmText: 'Acme',
				currentPassword: '',
				reauthGrant: 'grant-1'
			})
		);
	});

	it('keeps the dialog open with the failure visible so the user can retry', async () => {
		const onDelete = vi
			.fn()
			.mockRejectedValueOnce(new Error('The server rejected deletion.'))
			.mockResolvedValue(undefined);
		const screen = await render(ReauthDeleteDialog, baseProps({ onDelete }));
		const deleteButton = screen.getByRole('button', {
			name: 'Delete workspace'
		});

		await screen.getByRole('textbox', { name: 'Type Acme to confirm' }).fill('Acme');
		await screen.getByLabelText('Current password').fill('secret-123');
		await deleteButton.click();

		await expect.element(screen.getByText('The server rejected deletion.')).toBeVisible();
		await expect.element(screen.getByRole('dialog')).toBeVisible();
		await expect.element(deleteButton).not.toBeDisabled();

		await deleteButton.click();
		await vi.waitFor(() => expect(onDelete).toHaveBeenCalledTimes(2));
	});
});
