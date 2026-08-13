import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import NotificationPreferences from './notification-preferences.svelte';

const mocks = vi.hoisted(() => ({
	get: vi.fn(),
	put: vi.fn(),
	showToast: vi.fn()
}));

vi.mock('$lib/api/client', () => ({
	client: {
		GET: mocks.get,
		PUT: mocks.put
	}
}));

vi.mock('$lib/toast', () => ({ showToast: mocks.showToast }));

function preferences() {
	return {
		post_published: { in_app: true, email: false },
		publish_failed: { in_app: true, email: true },
		account_needs_attention: { in_app: true, email: false },
		new_engagement: { in_app: true, email: false },
		new_message: { in_app: true, email: false },
		reply_failed: { in_app: true, email: true },
		workspace_invite: { in_app: true, email: true }
	};
}

describe('NotificationPreferences', () => {
	beforeEach(() => {
		mocks.get.mockReset();
		mocks.put.mockReset();
		mocks.showToast.mockReset();
	});

	it('lets a person choose email delivery on a phone-sized screen', async () => {
		await page.viewport(390, 844);
		const initial = preferences();
		mocks.get.mockResolvedValue({
			data: {
				preferences: initial,
				email_available: true,
				email_address: 'founder@example.com'
			}
		});
		mocks.put.mockImplementation(async (_path, request) => ({
			data: {
				preferences: request.body,
				email_available: true,
				email_address: 'founder@example.com'
			}
		}));

		const screen = await render(NotificationPreferences);
		await expect
			.element(screen.getByText('Email notifications go to founder@example.com.'))
			.toBeVisible();
		const emailMessage = screen.getByRole('checkbox', { name: 'New message · Email' }).nth(1);
		await expect.element(emailMessage).not.toBeChecked();
		await emailMessage.click();
		await screen.getByRole('button', { name: 'Save preferences' }).click();

		expect(mocks.put).toHaveBeenCalledWith('/notifications/preferences', {
			body: { ...initial, new_message: { in_app: true, email: true } }
		});
		expect(mocks.showToast).toHaveBeenCalledWith('Preferences saved.', 'success');
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
	});

	it('explains when email is unavailable and keeps email choices disabled', async () => {
		mocks.get.mockResolvedValue({
			data: {
				preferences: preferences(),
				email_available: false,
				email_address: 'founder@example.com'
			}
		});

		const screen = await render(NotificationPreferences);
		await expect
			.element(
				screen.getByText(
					'Email delivery is not configured on this OpenPost instance. Your email choices will take effect when an administrator configures it.'
				)
			)
			.toBeVisible();
		await expect
			.element(screen.getByRole('checkbox', { name: 'Publish failed · Email' }).nth(1))
			.toBeDisabled();
	});
});
