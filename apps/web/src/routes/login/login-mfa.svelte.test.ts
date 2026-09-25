import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { QueryClientProvider } from '@tanstack/svelte-query';
import { client } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import { auth } from '$lib/stores/auth';
import LoginPage from './+page.svelte';
import '../layout.css';

// Component tests do not populate the SvelteKit page store, so provide its public readable contract.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$app/stores', async () => {
	const { readable } = await import('svelte/store');
	return { page: readable({ url: new URL('http://localhost/login') }) };
});

// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const getMock = vi.spyOn(client, 'GET');
const postMock = vi.spyOn(client, 'POST');

function totpCalls() {
	return postMock.mock.calls.filter(([path]) => path === '/auth/login/totp');
}

describe('login TOTP submit gate', () => {
	beforeEach(() => {
		queryClient.clear();
		auth.setUser(null);
		getMock.mockReset();
		postMock.mockReset();
		getMock.mockImplementation(async (path) => {
			if (path === '/auth/config') {
				return {
					data: {
						registration_enabled: true,
						password_reset_enabled: true,
						email_verification_required: false,
						public_profiles_enabled: false,
						legal_acceptance_required: false,
						purchase_choice_required: false
					}
				};
			}
			if (path === '/auth/oidc/providers') return { data: [] };
			return { data: undefined };
		});
		postMock.mockImplementation(async (path) => {
			if (path === '/auth/login') {
				return {
					data: { requires_mfa: true, mfa_token: 'mfa-token', mfa_methods: ['totp'] }
				};
			}
			if (path === '/auth/login/totp') {
				// SAFETY: The incomplete-code guard returns before this response is consumed; the shape only satisfies the mock's return type.
				return { data: { user: null }, response: new Response() } as never;
			}
			return { data: undefined };
		});
	});

	it('keeps Verify Code disabled until a full six-digit code is entered', async () => {
		const screen = await render(LoginPage, undefined, {
			wrapper: QueryClientProvider,
			wrapperProps: { client: queryClient }
		});

		await screen.getByLabelText('Email', { exact: true }).fill('founder@example.com');
		await screen
			.getByRole('textbox', { name: 'Password', exact: true })
			.fill('correct horse battery staple');
		await screen.getByRole('button', { name: 'Sign In', exact: true }).click();

		const codeInput = screen.getByLabelText('Authenticator code');
		await expect.element(codeInput).toBeVisible();
		const verifyButton = screen.getByRole('button', { name: 'Verify Code', exact: true });

		await expect.element(verifyButton).toBeDisabled();

		await codeInput.fill('123');
		await expect.element(verifyButton).toBeDisabled();

		await codeInput.fill('123456');
		await expect.element(verifyButton).toBeEnabled();
	});

	it('does not call the TOTP verify endpoint for an incomplete code submitted with Enter', async () => {
		const screen = await render(LoginPage, undefined, {
			wrapper: QueryClientProvider,
			wrapperProps: { client: queryClient }
		});

		await screen.getByLabelText('Email', { exact: true }).fill('founder@example.com');
		await screen
			.getByRole('textbox', { name: 'Password', exact: true })
			.fill('correct horse battery staple');
		await screen.getByRole('button', { name: 'Sign In', exact: true }).click();

		const codeInput = screen.getByLabelText('Authenticator code');
		await expect.element(codeInput).toBeVisible();
		await codeInput.fill('123');
		// Keyboard submission bypasses the disabled submit button, so drive the
		// form's submit path directly the way an Enter keypress would.
		document.querySelector<HTMLInputElement>('#totpCode')?.closest('form')?.requestSubmit();

		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(totpCalls()).toHaveLength(0);
	});
});
