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
		post_published: { in_app: true, email_frequency: 'off' },
		publish_failed: { in_app: true, email_frequency: 'immediate' },
		account_needs_attention: { in_app: true, email_frequency: 'off' },
		new_engagement: { in_app: true, email_frequency: 'off' },
		new_message: { in_app: true, email_frequency: 'off' },
		reply_failed: { in_app: true, email_frequency: 'immediate' },
		workspace_invite: { in_app: true, email_frequency: 'immediate' },
		security_action: { in_app: true, email_frequency: 'immediate' },
		access_changed: { in_app: true, email_frequency: 'immediate' },
		critical_billing: { in_app: true, email_frequency: 'immediate' }
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
				email_address: 'founder@example.com',
				digest_time: '09:00',
				digest_timezone: 'Europe/Lisbon',
				digest_configured: true
			}
		});
		mocks.put.mockImplementation(async (_path, request) => ({
			data: {
				preferences: request.body.preferences,
				email_available: true,
				email_address: 'founder@example.com',
				digest_time: request.body.digest_time,
				digest_timezone: request.body.digest_timezone,
				digest_configured: true
			}
		}));

		const screen = await render(NotificationPreferences);
		await expect
			.element(screen.getByText('Email notifications go to founder@example.com.'))
			.toBeVisible();
		const emailMessage = screen.getByLabelText('New message · Email frequency').nth(1);
		await expect.element(emailMessage).toHaveTextContent('Off');
		await emailMessage.click();
		await screen.getByRole('option', { name: 'Daily' }).click();
		await screen.getByRole('button', { name: 'Save preferences' }).click();

		expect(mocks.put).toHaveBeenCalledWith('/notifications/preferences', {
			body: {
				preferences: {
					...initial,
					new_message: { in_app: true, email_frequency: 'daily' }
				},
				digest_time: '09:00',
				digest_timezone: 'Europe/Lisbon'
			}
		});
		expect(mocks.showToast).toHaveBeenCalledWith('Preferences saved.', 'success');
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
	});

	it('explains when email is unavailable and keeps email choices disabled', async () => {
		mocks.get.mockResolvedValue({
			data: {
				preferences: preferences(),
				email_available: false,
				email_address: 'founder@example.com',
				digest_time: '09:00',
				digest_timezone: 'UTC',
				digest_configured: false
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
			.element(screen.getByLabelText('Publish failed · Email frequency').nth(1))
			.toBeDisabled();
	});

	it('defaults only a new choice to 09:00 in the browser timezone', async () => {
		mocks.get.mockResolvedValue({
			data: {
				preferences: preferences(),
				email_available: true,
				email_address: 'founder@example.com',
				digest_time: '09:00',
				digest_timezone: 'UTC',
				digest_configured: false
			}
		});

		const screen = await render(NotificationPreferences);
		await expect.element(screen.getByLabelText('Daily digest time')).toHaveValue('09:00');
		await expect
			.element(screen.getByLabelText('Timezone'))
			.toHaveValue(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
	});

	it('shows the saved digest window and frequency controls on desktop', async () => {
		await page.viewport(1280, 900);
		mocks.get.mockResolvedValue({
			data: {
				preferences: preferences(),
				email_available: true,
				email_address: 'founder@example.com',
				digest_time: '16:45',
				digest_timezone: 'America/New_York',
				digest_configured: true
			}
		});

		const screen = await render(NotificationPreferences);
		await expect.element(screen.getByLabelText('Daily digest time')).toHaveValue('16:45');
		await expect.element(screen.getByLabelText('Timezone')).toHaveValue('America/New_York');
		await expect
			.element(screen.getByLabelText('New message · Email frequency').first())
			.toBeVisible();
		await expect
			.element(screen.getByLabelText('Security action · Email frequency').first())
			.toBeDisabled();
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1280);
	});

	it('maps preference validation failures to localized copy', async () => {
		mocks.get.mockResolvedValue({
			data: {
				preferences: preferences(),
				email_available: true,
				email_address: 'founder@example.com',
				digest_time: '09:00',
				digest_timezone: 'UTC',
				digest_configured: true
			}
		});
		mocks.put.mockResolvedValue({
			error: { status: 400, detail: 'digest timezone is invalid' }
		});

		const screen = await render(NotificationPreferences);
		await screen.getByLabelText('Timezone').fill('Not/AZone');
		await screen.getByRole('button', { name: 'Save preferences' }).click();
		expect(mocks.showToast).toHaveBeenCalledWith(
			'Check the email frequencies, digest time, and IANA timezone, then try again.',
			'error'
		);
	});
});
