import { browser } from '$app/environment';
import { identifyTelemetryUser, resetTelemetryIdentity } from '@openpost/telemetry';
import { writable } from 'svelte/store';
import { client, type User } from '$lib/api/client';
import {
	appBootstrapQueryOptions,
	authQueryKeys,
	openPostQueryKeys,
	seedAppBootstrap,
	type AppBootstrap,
	type AppBootstrapQueryAPI,
	type SecurityStatus
} from '@openpost/query-catalog';
import type { QueryClient } from '@tanstack/svelte-query';
import { appBootstrapQueryAPI } from '$lib/query/bootstrap';
import {
	registerQueryAuthorizationBoundary,
	type QueryAuthorizationIdentity
} from '$lib/query/authorization-boundary';
import { queryClient } from '$lib/query/client';
import { getPasskeyAssertion } from '$lib/auth/webauthn';
import { notificationInbox } from '$lib/stores/notifications.svelte';
import { workspaceCtx } from '$lib/stores/workspace.svelte';

interface AuthState {
	user: User | null;
	isLoading: boolean;
	isAuthenticated: boolean;
	initializationError: string;
}

interface AuthActionResult {
	success: boolean;
	error?: string;
	requiresMfa?: boolean;
	mfaToken?: string;
	mfaMethods?: string[];
	requiresEmailVerification?: boolean;
	emailVerificationID?: string;
	emailVerificationEmail?: string;
	emailDeliveryStatus?: 'sent' | 'failed';
}

interface RegisterInput {
	email: string;
	username?: string;
	password: string;
	acceptedLegal: boolean;
	purchaseChoiceToken?: string;
}

interface UserProjectionToken {
	userID: string;
	revision: number;
	baselineUser: User;
}

export type AuthIdentityToken = QueryAuthorizationIdentity;

export interface AuthStoreDependencies {
	isBrowser: boolean;
	client: Pick<typeof client, 'GET' | 'POST'>;
	getPasskeyAssertion: typeof getPasskeyAssertion;
	notificationInbox: Pick<typeof notificationInbox, 'clear'>;
	identifyTelemetryUser: typeof identifyTelemetryUser;
	resetTelemetryIdentity: typeof resetTelemetryIdentity;
	queryClient: Pick<QueryClient, 'clear' | 'fetchQuery' | 'setQueryData' | 'setQueriesData'>;
	appBootstrapQueryAPI: AppBootstrapQueryAPI;
	resetWorkspaceState: () => void;
}

const defaultAuthStoreDependencies: AuthStoreDependencies = {
	isBrowser: browser,
	client,
	getPasskeyAssertion,
	notificationInbox,
	identifyTelemetryUser,
	resetTelemetryIdentity,
	queryClient,
	appBootstrapQueryAPI,
	resetWorkspaceState: () => workspaceCtx.reset()
};

export function createAuthStore(dependencyOverrides: Partial<AuthStoreDependencies> = {}) {
	const dependencies: AuthStoreDependencies = {
		...defaultAuthStoreDependencies,
		...dependencyOverrides
	};
	const {
		isBrowser,
		client,
		getPasskeyAssertion,
		notificationInbox,
		identifyTelemetryUser,
		resetTelemetryIdentity,
		queryClient,
		appBootstrapQueryAPI,
		resetWorkspaceState
	} = dependencies;
	const { subscribe, set, update } = writable<AuthState>({
		user: null,
		isLoading: true,
		isAuthenticated: false,
		initializationError: ''
	});
	let activeUserID: string | null = null;
	let activeUser: User | null = null;
	let identitySettled = false;
	let identityEpoch = 0;
	let initializeGeneration = 0;
	let authActionGeneration = 0;
	let authActionTail = Promise.resolve();
	let userProjectionRevision = 0;
	const bootstrapRoot = [...openPostQueryKeys.all, 'app', 'bootstrap'] as const;
	const settleIdentity = (userID: string | null, supersedeAuthActions = false) => {
		initializeGeneration += 1;
		const identityChanged = identitySettled && activeUserID !== userID;
		if (!identitySettled || activeUserID !== userID) {
			identityEpoch += 1;
			authActionGeneration += 1;
		} else if (supersedeAuthActions) {
			authActionGeneration += 1;
		}
		if (identityChanged) {
			queryClient.clear();
			resetWorkspaceState();
		}
		identitySettled = true;
		activeUserID = userID;
	};
	const beginAuthAction = () => {
		initializeGeneration += 1;
		authActionGeneration += 1;
		return authActionGeneration;
	};
	const authActionIsCurrent = (generation: number) => generation === authActionGeneration;
	const discardSupersededSession = async (
		generation: number,
		sessionUser: User | null | undefined
	): Promise<boolean> => {
		if (authActionIsCurrent(generation)) return false;
		if (sessionUser) {
			try {
				const { error } = await client.POST('/auth/logout');
				if (error) throw new Error(error.detail ?? 'Unable to clear superseded session');
			} catch {
				// Keep the client aligned with the session the server may still hold. This identity
				// change also blocks queued auth actions until the user starts a fresh one.
				setAuthenticatedUser(sessionUser);
			}
		}
		return true;
	};
	const acquireAuthActionTurn = async (generation: number) => {
		const previousAction = authActionTail;
		let releaseAction!: () => void;
		authActionTail = new Promise<void>((resolve) => {
			releaseAction = resolve;
		});
		await previousAction;
		if (!authActionIsCurrent(generation)) {
			releaseAction();
			return;
		}
		return releaseAction;
	};
	const syncBootstrapUser = (user: User | null) => {
		queryClient.setQueriesData<AppBootstrap>({ queryKey: bootstrapRoot }, (bootstrap) => {
			if (!bootstrap) return bootstrap;
			if (user) return { ...bootstrap, authenticated: true, user };
			return {
				...bootstrap,
				authenticated: false,
				user: null,
				workspaces: [],
				selected_workspace_id: null,
				selected_workspace_settings: null
			};
		});
	};
	const repairSupersededBootstrap = () => {
		queryClient.setQueriesData<AppBootstrap>({ queryKey: bootstrapRoot }, (bootstrap) => {
			if (!bootstrap) return bootstrap;
			if (!activeUser) {
				return {
					...bootstrap,
					authenticated: false,
					user: null,
					workspaces: [],
					selected_workspace_id: null,
					selected_workspace_settings: null
				};
			}
			return {
				...bootstrap,
				authenticated: true,
				user: activeUser,
				workspaces: [],
				selected_workspace_id: null,
				selected_workspace_settings: null
			};
		});
	};
	const syncSecurityUser = (user: User) => {
		queryClient.setQueryData<SecurityStatus>(authQueryKeys.security(), (security) =>
			security ? { ...security, user } : security
		);
	};
	const clearAccountState = () => {
		resetTelemetryIdentity();
		settleIdentity(null, true);
		activeUser = null;
		userProjectionRevision += 1;
		notificationInbox.clear();
		syncBootstrapUser(null);
		set({
			user: null,
			isLoading: false,
			isAuthenticated: false,
			initializationError: ''
		});
	};
	const setAuthenticatedUser = (user: User | null) => {
		if (!user) {
			clearAccountState();
			return;
		}
		if (activeUserID !== user.id) notificationInbox.clear();
		settleIdentity(user.id);
		activeUser = user;
		userProjectionRevision += 1;
		syncBootstrapUser(user);
		syncSecurityUser(user);
		set({
			user,
			isLoading: false,
			isAuthenticated: true,
			initializationError: ''
		});
		identifyTelemetryUser(user.id);
	};

	return {
		subscribe,
		async initialize(
			options: {
				optional?: boolean;
				preferredWorkspaceID?: string | null;
			} = {}
		) {
			if (!isBrowser) return;
			const requestGeneration = ++initializeGeneration;
			update((state) => ({
				...state,
				isLoading: true,
				initializationError: ''
			}));

			try {
				const bootstrapOptions = appBootstrapQueryOptions(
					appBootstrapQueryAPI,
					options.preferredWorkspaceID
				);
				const bootstrap = await queryClient.fetchQuery(bootstrapOptions);
				if (requestGeneration !== initializeGeneration) {
					repairSupersededBootstrap();
					return;
				}
				if (!bootstrap.authenticated || !bootstrap.user) {
					clearAccountState();
					queryClient.setQueryData(bootstrapOptions.queryKey, bootstrap);
					seedAppBootstrap(queryClient, bootstrap);
					return;
				}
				setAuthenticatedUser(bootstrap.user);
				queryClient.setQueryData(bootstrapOptions.queryKey, bootstrap);
				seedAppBootstrap(queryClient, bootstrap);
			} catch (error) {
				if (requestGeneration !== initializeGeneration) {
					syncBootstrapUser(activeUser);
					return;
				}
				if (options.optional && !identitySettled) settleIdentity(null);
				update((state) => ({
					...state,
					isLoading: false,
					initializationError: options.optional || state.isAuthenticated ? '' : errorMessage(error)
				}));
			}
		},
		async login(email: string, password: string): Promise<AuthActionResult> {
			const actionGeneration = beginAuthAction();
			const releaseAction = await acquireAuthActionTurn(actionGeneration);
			if (!releaseAction) return { success: false };
			try {
				const { data, error } = await client.POST('/auth/login', {
					body: { email, password }
				});
				if (await discardSupersededSession(actionGeneration, data?.user)) {
					return { success: false };
				}
				if (error || !data) throw new Error(error?.detail ?? 'Login failed');
				if (data.requires_mfa) {
					clearAccountState();
					return {
						success: false,
						requiresMfa: true,
						mfaToken: data.mfa_token,
						mfaMethods: data.mfa_methods ?? []
					};
				}
				if (data.requires_email_verification) {
					clearAccountState();
					return emailVerificationResult(data);
				}
				setAuthenticatedUser(data.user ?? null);
				return { success: true };
			} catch (e) {
				if (!authActionIsCurrent(actionGeneration)) return { success: false };
				return { success: false, error: errorMessage(e) };
			} finally {
				releaseAction();
			}
		},
		async register({
			email,
			username,
			password,
			acceptedLegal,
			purchaseChoiceToken
		}: RegisterInput) {
			const actionGeneration = beginAuthAction();
			const releaseAction = await acquireAuthActionTurn(actionGeneration);
			if (!releaseAction) return { success: false };
			try {
				const { data, error } = await client.POST('/auth/register', {
					body: {
						email,
						username: username || undefined,
						password,
						accepted_legal: acceptedLegal,
						purchase_choice_token: purchaseChoiceToken
					}
				});
				if (await discardSupersededSession(actionGeneration, data?.user)) {
					return { success: false };
				}
				if (error || !data) throw new Error(error?.detail || 'Registration failed');
				if (data.requires_email_verification) {
					clearAccountState();
					return emailVerificationResult(data);
				}
				setAuthenticatedUser(data.user ?? null);
				return { success: true };
			} catch (e) {
				if (!authActionIsCurrent(actionGeneration)) return { success: false };
				return { success: false, error: errorMessage(e) };
			} finally {
				releaseAction();
			}
		},
		async verifyEmail(challengeID: string, code: string): Promise<AuthActionResult> {
			const actionGeneration = beginAuthAction();
			const releaseAction = await acquireAuthActionTurn(actionGeneration);
			if (!releaseAction) return { success: false };
			try {
				const { data, error } = await client.POST('/auth/email-verification/confirm', {
					body: { challenge_id: challengeID, code }
				});
				if (await discardSupersededSession(actionGeneration, data?.user)) {
					return { success: false };
				}
				if (error || !data?.user) throw new Error(error?.detail ?? 'Email verification failed');
				setAuthenticatedUser(data.user);
				return { success: true };
			} catch (e) {
				if (!authActionIsCurrent(actionGeneration)) return { success: false };
				return { success: false, error: errorMessage(e) };
			} finally {
				releaseAction();
			}
		},
		async resendEmailVerification(challengeID: string): Promise<AuthActionResult> {
			try {
				const { data, error } = await client.POST('/auth/email-verification/resend', {
					body: { challenge_id: challengeID }
				});
				if (error || !data?.requires_email_verification) {
					throw new Error(error?.detail ?? 'Unable to send another verification code');
				}
				return emailVerificationResult(data);
			} catch (e) {
				return { success: false, error: errorMessage(e) };
			}
		},
		async verifyTOTP(mfaToken: string, code: string): Promise<AuthActionResult> {
			const actionGeneration = beginAuthAction();
			const releaseAction = await acquireAuthActionTurn(actionGeneration);
			if (!releaseAction) return { success: false };
			try {
				const { data, error } = await client.POST('/auth/login/totp', {
					body: { mfa_token: mfaToken, code }
				});
				if (await discardSupersededSession(actionGeneration, data?.user)) {
					return { success: false };
				}
				if (error || !data) throw new Error(error?.detail ?? 'Authenticator verification failed');
				setAuthenticatedUser(data.user ?? null);
				return { success: true };
			} catch (e) {
				if (!authActionIsCurrent(actionGeneration)) return { success: false };
				return { success: false, error: errorMessage(e) };
			} finally {
				releaseAction();
			}
		},
		async verifyRecoveryCode(mfaToken: string, code: string): Promise<AuthActionResult> {
			const actionGeneration = beginAuthAction();
			const releaseAction = await acquireAuthActionTurn(actionGeneration);
			if (!releaseAction) return { success: false };
			try {
				const { data, error } = await client.POST('/auth/login/recovery-code', {
					body: { mfa_token: mfaToken, code }
				});
				if (await discardSupersededSession(actionGeneration, data?.user)) {
					return { success: false };
				}
				if (error || !data) throw new Error(error?.detail ?? 'Recovery code verification failed');
				setAuthenticatedUser(data.user ?? null);
				return { success: true };
			} catch (e) {
				if (!authActionIsCurrent(actionGeneration)) return { success: false };
				return { success: false, error: errorMessage(e) };
			} finally {
				releaseAction();
			}
		},
		async verifyPasskey(mfaToken: string): Promise<AuthActionResult> {
			const actionGeneration = beginAuthAction();
			const releaseAction = await acquireAuthActionTurn(actionGeneration);
			if (!releaseAction) return { success: false };
			try {
				const { data: beginData, error: beginError } = await client.POST(
					'/auth/login/passkey/options',
					{
						body: { mfa_token: mfaToken }
					}
				);
				if (!authActionIsCurrent(actionGeneration)) return { success: false };
				if (beginError || !beginData) {
					throw new Error(beginError?.detail || 'Unable to start passkey verification');
				}

				const credential = await getPasskeyAssertion(beginData.options);
				if (!authActionIsCurrent(actionGeneration)) return { success: false };
				const { data, error } = await client.POST('/auth/login/passkey/verify', {
					body: {
						challenge_id: beginData.challenge_id,
						credential
					}
				});
				if (await discardSupersededSession(actionGeneration, data?.user)) {
					return { success: false };
				}
				if (error || !data) throw new Error(error?.detail ?? 'Passkey verification failed');

				setAuthenticatedUser(data.user ?? null);
				return { success: true };
			} catch (e) {
				if (!authActionIsCurrent(actionGeneration)) return { success: false };
				return { success: false, error: errorMessage(e) };
			} finally {
				releaseAction();
			}
		},
		async logout(): Promise<boolean> {
			const actionGeneration = beginAuthAction();
			const releaseAction = await acquireAuthActionTurn(actionGeneration);
			if (!releaseAction) return false;
			const logoutUserID = activeUserID;
			const logoutIdentityEpoch = identityEpoch;
			try {
				try {
					await client.POST('/auth/logout');
				} catch {
					// Local state must still be cleared if the server is unavailable.
				}
				if (
					!authActionIsCurrent(actionGeneration) ||
					activeUserID !== logoutUserID ||
					identityEpoch !== logoutIdentityEpoch
				) {
					return false;
				}
				this.clearLocal();
				return true;
			} finally {
				releaseAction();
			}
		},
		clearLocal() {
			clearAccountState();
		},
		setUser(user: User | null) {
			if (!user) {
				clearAccountState();
				return;
			}
			if (user.id === activeUserID) {
				initializeGeneration += 1;
				activeUser = user;
				userProjectionRevision += 1;
				syncBootstrapUser(user);
				syncSecurityUser(user);
				update((state) => ({
					...state,
					user,
					isLoading: false,
					isAuthenticated: true,
					initializationError: ''
				}));
				return;
			}
			setAuthenticatedUser(user);
		},
		captureIdentity(): AuthIdentityToken | undefined {
			if (!activeUserID) return;
			return { userID: activeUserID, epoch: identityEpoch };
		},
		isIdentityCurrent(token: AuthIdentityToken | undefined) {
			return Boolean(token && token.userID === activeUserID && token.epoch === identityEpoch);
		},
		captureUserProjection(expectedUserID: string): UserProjectionToken | undefined {
			if (!expectedUserID || activeUserID !== expectedUserID || !activeUser) return;
			return {
				userID: expectedUserID,
				revision: userProjectionRevision,
				baselineUser: snapshotUser(activeUser)
			};
		},
		projectBootstrap(bootstrap: AppBootstrap | undefined, token: UserProjectionToken | undefined) {
			if (!bootstrap || !token || activeUserID !== token.userID) return false;
			if (!bootstrap.authenticated || !bootstrap.user) {
				clearAccountState();
				return false;
			}
			if (bootstrap.user.id !== token.userID) {
				setAuthenticatedUser(bootstrap.user);
				return false;
			}
			if (token.revision !== userProjectionRevision) {
				if (!activeUser) return false;
				setAuthenticatedUser(mergeUserProjection(bootstrap.user, token.baselineUser, activeUser));
				return true;
			}
			setAuthenticatedUser(bootstrap.user);
			return true;
		}
	};
}

export const auth = createAuthStore();

export function registerAuthQueryAuthorizationBoundary(
	store: Pick<
		ReturnType<typeof createAuthStore>,
		'captureIdentity' | 'isIdentityCurrent' | 'clearLocal'
	>
) {
	return registerQueryAuthorizationBoundary({
		captureIdentity: () => store.captureIdentity(),
		isIdentityCurrent: (identity) => store.isIdentityCurrent(identity),
		settleUnauthorized: (identity) => {
			if (store.isIdentityCurrent(identity)) store.clearLocal();
		}
	});
}

registerAuthQueryAuthorizationBoundary(auth);

function snapshotUser(user: User): User {
	const snapshot = { ...user };
	if (Array.isArray(user.public_profile_visible_fields)) {
		snapshot.public_profile_visible_fields = [...user.public_profile_visible_fields];
	}
	return snapshot;
}

function mergeUserProjection(serverUser: User, baselineUser: User, projectedUser: User): User {
	const merged = { ...serverUser };
	for (const field of projectedUserFields) {
		applyProjectedUserField(merged, baselineUser, projectedUser, field);
	}
	for (const field of optionalProjectedUserFields) {
		applyOptionalProjectedUserField(merged, baselineUser, projectedUser, field);
	}
	return merged;
}

const projectedUserFields = [
	'avatar_url',
	'composer_experience',
	'created_at',
	'display_name',
	'email',
	'email_verified',
	'has_password',
	'id',
	'is_admin',
	'is_managed',
	'legal_acceptance_required',
	'password_usable',
	'public_profile_enabled',
	'public_profile_visible_fields',
	'username'
] as const satisfies readonly (keyof User)[];

const optionalProjectedUserFields = [
	'legal_accepted_at',
	'managed_organization_name',
	'privacy_version',
	'terms_version'
] as const satisfies readonly (keyof User)[];

type ProjectedUserField = (typeof projectedUserFields)[number];
type OptionalProjectedUserField = (typeof optionalProjectedUserFields)[number];

function applyProjectedUserField<K extends ProjectedUserField>(
	merged: User,
	baseline: User,
	projected: User,
	field: K
) {
	if (!userFieldEquals(baseline[field], projected[field])) merged[field] = projected[field];
}

function applyOptionalProjectedUserField<K extends OptionalProjectedUserField>(
	merged: User,
	baseline: User,
	projected: User,
	field: K
) {
	const baselineHasField = Object.hasOwn(baseline, field);
	const projectedHasField = Object.hasOwn(projected, field);
	if (
		baselineHasField === projectedHasField &&
		userFieldEquals(baseline[field], projected[field])
	) {
		return;
	}
	if (!projectedHasField) {
		delete merged[field];
		return;
	}
	merged[field] = projected[field];
}

function userFieldEquals<T>(left: T, right: T) {
	if (!Array.isArray(left) || !Array.isArray(right)) return Object.is(left, right);
	return (
		left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
	);
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function emailVerificationResult(data: {
	email_verification_id?: string;
	email_verification_email?: string;
	email_delivery_status?: 'sent' | 'failed';
}): AuthActionResult {
	return {
		success: false,
		requiresEmailVerification: true,
		emailVerificationID: data.email_verification_id,
		emailVerificationEmail: data.email_verification_email,
		emailDeliveryStatus: data.email_delivery_status
	};
}
