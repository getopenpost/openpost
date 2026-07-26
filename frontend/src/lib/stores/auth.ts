import { browser } from '$app/environment';
import { writable } from 'svelte/store';
import { client, setToken, recreateClient, type User } from '$lib/api/client';
import { getPasskeyAssertion } from '$lib/auth/webauthn';
import { IS_CAPACITOR } from '$lib/env';

interface AuthState {
	user: User | null;
	isLoading: boolean;
	isAuthenticated: boolean;
}

interface AuthActionResult {
	success: boolean;
	error?: string;
	requiresMfa?: boolean;
	mfaToken?: string;
	mfaMethods?: string[];
}

interface RegisterInput {
	email: string;
	password: string;
	acceptedLegal: boolean;
}

function createAuthStore() {
	const { subscribe, set, update } = writable<AuthState>({
		user: null,
		isLoading: true,
		isAuthenticated: false
	});

	return {
		subscribe,
		async initialize() {
			if (!browser) return;

			// Recreate client in case instance URL was just set
			recreateClient();

			try {
				const { data, error } = await client.GET('/auth/me');
				if (error || !data) throw new Error('Failed to fetch user');
				set({ user: data, isLoading: false, isAuthenticated: true });
			} catch {
				setToken(null);
				set({ user: null, isLoading: false, isAuthenticated: false });
			}
		},
		async login(email: string, password: string): Promise<AuthActionResult> {
			try {
				const { data, error } = await client.POST('/auth/login', {
					body: { email, password }
				});
				if (error || !data) throw new Error(error?.detail ?? 'Login failed');
				if (data.requires_mfa) {
					set({ user: null, isLoading: false, isAuthenticated: false });
					return {
						success: false,
						requiresMfa: true,
						mfaToken: data.mfa_token,
						mfaMethods: data.mfa_methods ?? []
					};
				}
				setToken(IS_CAPACITOR ? data.token : null);
				set({ user: data.user ?? null, isLoading: false, isAuthenticated: true });
				return { success: true };
			} catch (e) {
				return { success: false, error: (e as Error).message };
			}
		},
		async register({ email, password, acceptedLegal }: RegisterInput) {
			try {
				const { data, error } = await client.POST('/auth/register', {
					body: { email, password, accepted_legal: acceptedLegal }
				});
				if (error || !data) throw new Error(error?.detail || 'Registration failed');
				setToken(IS_CAPACITOR ? data.token : null);
				set({ user: data.user ?? null, isLoading: false, isAuthenticated: true });
				return { success: true };
			} catch (e) {
				return { success: false, error: (e as Error).message };
			}
		},
		async verifyTOTP(mfaToken: string, code: string): Promise<AuthActionResult> {
			try {
				const { data, error } = await client.POST('/auth/login/totp', {
					body: { mfa_token: mfaToken, code }
				});
				if (error || !data) throw new Error(error?.detail ?? 'Authenticator verification failed');
				setToken(IS_CAPACITOR ? data.token : null);
				set({ user: data.user ?? null, isLoading: false, isAuthenticated: true });
				return { success: true };
			} catch (e) {
				return { success: false, error: (e as Error).message };
			}
		},
		async verifyPasskey(mfaToken: string): Promise<AuthActionResult> {
			try {
				const { data: beginData, error: beginError } = await client.POST(
					'/auth/login/passkey/options',
					{
						body: { mfa_token: mfaToken }
					}
				);
				if (beginError || !beginData) {
					throw new Error(beginError?.detail || 'Unable to start passkey verification');
				}

				const credential = await getPasskeyAssertion(beginData.options);
				const { data, error } = await client.POST('/auth/login/passkey/verify', {
					body: {
						challenge_id: beginData.challenge_id,
						credential
					}
				});
				if (error || !data) throw new Error(error?.detail ?? 'Passkey verification failed');

				setToken(IS_CAPACITOR ? data.token : null);
				set({ user: data.user ?? null, isLoading: false, isAuthenticated: true });
				return { success: true };
			} catch (e) {
				return { success: false, error: (e as Error).message };
			}
		},
		async logout() {
			try {
				await client.POST('/auth/logout');
			} catch {
				// Local state must still be cleared if the server is unavailable.
			}
			this.clearLocal();
		},
		clearLocal() {
			setToken(null);
			set({ user: null, isLoading: false, isAuthenticated: false });
		},
		setUser(user: User | null) {
			update((state) => ({
				...state,
				user,
				isAuthenticated: Boolean(user)
			}));
		}
	};
}

export const auth = createAuthStore();
