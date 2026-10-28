import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AccountPickerRow from './row.svelte';

describe('account-picker row', () => {
	it('names the checkbox for the account, independent of issues or custom state', async () => {
		const onToggle = vi.fn();
		const screen = await render(AccountPickerRow, {
			name: 'Demo Account',
			platform: 'x',
			avatarUrl: 'https://example.com/avatar-demo.png',
			detail: 'Needs attention',
			selected: false,
			issues: ['Reconnect required'],
			custom: true,
			customLabel: 'Customized for this post',
			onToggle
		});

		// The row passes the avatar, name, platform, and detail through to the shared identity.
		const avatar = screen.container.querySelector('img[src="https://example.com/avatar-demo.png"]');
		expect(avatar?.getAttribute('src')).toBe('https://example.com/avatar-demo.png');
		await expect.element(screen.getByText('Demo Account')).toBeVisible();
		const platform = screen.container.querySelector('[data-slot="social-account-platform"]');
		expect(platform?.textContent).toContain('X');
		expect(platform?.textContent).toContain('Needs attention');

		const checkbox = screen.getByRole('checkbox', { name: 'Demo Account, X' });
		await expect.element(checkbox).not.toBeChecked();
		// Issues stay readable but linked, not folded into the accessible name.
		await expect.element(checkbox).toHaveAttribute('aria-describedby');
		const describedBy = screen.container
			.querySelector('[role="checkbox"][aria-describedby]')
			?.getAttribute('aria-describedby');
		expect(describedBy).toBeTruthy();
		const issues = screen.container.querySelector(`#${CSS.escape(describedBy ?? '')}`);
		expect(issues?.textContent).toContain('Reconnect required');

		await checkbox.click();
		expect(onToggle).toHaveBeenCalledTimes(1);
	});

	it('reflects the selected state on the checkbox', async () => {
		const screen = await render(AccountPickerRow, {
			name: 'Demo Account',
			platform: 'x',
			selected: true,
			onToggle: vi.fn()
		});

		await expect.element(screen.getByRole('checkbox', { name: 'Demo Account, X' })).toBeChecked();
	});
});
