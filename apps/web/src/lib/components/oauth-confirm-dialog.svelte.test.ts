import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { ProviderInfo } from '$lib/api/client';
import OAuthConfirmDialog from './oauth-confirm-dialog.svelte';
import '../../routes/layout.css';

const provider: ProviderInfo = {
	platform: 'instagram',
	display_name: 'Instagram',
	auth_mode: 'oauth',
	configured: true,
	configured_connection_modes: ['oauth'],
	readiness: {
		state: 'healthy',
		connectable: true,
		advertisable: false,
		analytics_ready: false,
		discoverable: true,
		executable: true,
		observable: true,
		publishable: true,
		facts: {
			approval: '',
			authorization: '',
			configuration: '',
			control: '',
			live_certification: '',
			local_test: '',
			policy: ''
		}
	}
};

describe('Instagram connection choices', () => {
	for (const width of [1280, 390, 320]) {
		for (const dark of [false, true]) {
			it(`contains every action label at ${width}px in ${dark ? 'dark' : 'light'} appearance`, async () => {
				await page.viewport(width, 900);
				document.documentElement.classList.toggle('dark', dark);
				const onConfirm = vi.fn();
				const screen = await render(OAuthConfirmDialog, {
					open: true,
					provider,
					title: 'Instagram',
					onConfirm
				});
				const dialog = page.getByRole('dialog').element();
				const direct = screen.getByRole('button', { name: /Continue with Instagram/ }).element();
				const facebook = screen.getByRole('button', { name: /Continue with Facebook/ }).element();
				await Promise.all(
					document
						.getAnimations()
						.filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
						.map((animation) => animation.finished.catch(() => {}))
				);
				await page.screenshot({
					path: `__screenshots__/oauth-choice-${width}-${dark ? 'dark' : 'light'}.png`
				});
				for (const button of [direct, facebook]) {
					const bounds = button.getBoundingClientRect();
					for (const label of button.querySelectorAll('span.block')) {
						const text = label.getBoundingClientRect();
						expect(text.top).toBeGreaterThanOrEqual(bounds.top);
						expect(text.bottom).toBeLessThanOrEqual(bounds.bottom);
					}
					expect(bounds.width).toBeLessThanOrEqual(width - 32);
					expect(bounds.height).toBeGreaterThanOrEqual(44);
				}
				expect(direct.getBoundingClientRect().bottom).toBeLessThan(
					facebook.getBoundingClientRect().top
				);
				expect(dialog.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
				expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(width);
				expect(direct instanceof HTMLButtonElement && direct.disabled).toBe(true);
				facebook.focus();
				await userEvent.keyboard('{Enter}');
				expect(onConfirm).toHaveBeenCalledExactlyOnceWith('oauth');
				await screen.unmount();
				document.documentElement.classList.remove('dark');
			});
		}
	}
});
