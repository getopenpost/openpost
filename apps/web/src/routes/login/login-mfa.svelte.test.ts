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
	// NOTE: postMock.mock.calls is typed as never[] because the spied
	// openapi-fetch POST overloads resolve call parameters to never, so
	// index instead of destructuring (never has no iterator).
	return postMock.mock.calls.filter((call) => call[0] === '/auth/login/totp');
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
				// SAFETY: The spied POST overload resolves its generic response to never for a
				// concrete body. This is the real error branch the page consumes: verifyTOTP
				// throws on `error` and the page renders its detail.
				return { data: undefined, error: { detail: 'Authenticator code expired.' } } as never;
			}
			return { data: undefined };
		});
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
		const verifyButton = screen.getByRole('button', { name: 'Verify Code', exact: true });
		await expect.element(verifyButton).toBeDisabled();
		await codeInput.fill('123');
		await expect.element(verifyButton).toBeDisabled();
		// Keyboard submission bypasses the disabled submit button, so drive the
		// form's submit path directly the way an Enter keypress would.
		const form = codeInput.element().closest<HTMLFormElement>('form');
		expect(form).toBeInstanceOf(HTMLFormElement);
		const submitted = vi.fn();
		form!.addEventListener('submit', submitted);
		form!.requestSubmit();
		await vi.waitFor(() => expect(submitted).toHaveBeenCalledOnce());
		expect(totpCalls()).toHaveLength(0);

		// Positive control: the same submit path reaches verify once the code is complete.
		await codeInput.fill('123456');
		await expect.element(verifyButton).toBeEnabled();
		form!.requestSubmit();
		await vi.waitFor(() => expect(totpCalls()).toHaveLength(1));
		expect(postMock).toHaveBeenCalledWith('/auth/login/totp', {
			body: { mfa_token: 'mfa-token', code: '123456' }
		});
		await expect.element(screen.getByText('Authenticator code expired.')).toBeVisible();
	});
});
