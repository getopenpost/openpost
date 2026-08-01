import { browser } from '$app/environment';
import { client } from '$lib/api/client';
import { getPasskeyAssertion } from '$lib/auth/webauthn';
import { IS_CAPACITOR } from '$lib/env';

const PENDING_ACTION_KEY = 'openpost_reauth_pending_action';
const GRANTS_KEY = 'openpost_reauth_grants';
const GRANT_MAX_AGE_MS = 5 * 60 * 1000;

interface StoredGrant {
	grant: string;
	expiresAt: number;
}

type StoredGrants = Record<string, StoredGrant>;

function readGrants(): StoredGrants {
	if (!browser) return {};
	try {
		return JSON.parse(sessionStorage.getItem(GRANTS_KEY) ?? '{}') as StoredGrants;
	} catch {
		return {};
	}
}

function writeGrants(grants: StoredGrants) {
	if (!browser) return;
	sessionStorage.setItem(GRANTS_KEY, JSON.stringify(grants));
}

export function storeReauthGrant(action: string, grant: string) {
	if (!browser || !action || !grant) return;
	const grants = readGrants();
	grants[action] = { grant, expiresAt: Date.now() + GRANT_MAX_AGE_MS };
	writeGrants(grants);
	sessionStorage.removeItem(PENDING_ACTION_KEY);
}

export function captureWebReauthGrant() {
	if (!browser || !window.location.hash) return;
	const fragment = new URLSearchParams(window.location.hash.slice(1));
	const grant = fragment.get('reauth_grant');
	const action = sessionStorage.getItem(PENDING_ACTION_KEY);
	if (!grant || !action) return;
	storeReauthGrant(action, grant);
	fragment.delete('reauth_grant');
	const nextHash = fragment.toString();
	history.replaceState(
		history.state,
		'',
		`${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ''}`
	);
}

export function takeReauthGrant(action: string): string {
	if (!browser) return '';
	captureWebReauthGrant();
	const grants = readGrants();
	const stored = grants[action];
	delete grants[action];
	writeGrants(grants);
	if (!stored || stored.expiresAt <= Date.now()) return '';
	return stored.grant;
}

async function passkeyGrant(action: string): Promise<string> {
	const { data: begin, error: beginError } = await client.POST('/auth/reauth/passkey/options', {
		body: { action }
	});
	if (beginError || !begin) {
		throw new Error(beginError?.detail ?? 'Unable to start passkey verification');
	}
	const credential = await getPasskeyAssertion(begin.options);
	const { data, error } = await client.POST('/auth/reauth/passkey/verify', {
		body: { challenge_id: begin.challenge_id, credential }
	});
	if (error || !data?.grant) {
		throw new Error(error?.detail ?? 'Passkey verification failed');
	}
	return data.grant;
}

async function passwordGrant(action: string, password: string): Promise<string> {
	const { data, error } = await client.POST('/auth/reauth/password', {
		body: { action, password }
	});
	if (error || !data?.grant) {
		throw new Error(error?.detail ?? 'Password verification failed');
	}
	return data.grant;
}

async function openAuthorizationURL(url: string) {
	if (IS_CAPACITOR) {
		const { Browser } = await import('@capacitor/browser');
		await Browser.open({ url });
		return;
	}
	window.location.assign(url);
}

async function startOIDCReauth(action: string, providerID: string): Promise<void> {
	const returnPath = `${window.location.pathname}${window.location.search}`;
	sessionStorage.setItem(PENDING_ACTION_KEY, action);
	const { data, error } = await client.POST('/auth/oidc/{provider_id}/reauth', {
		params: { path: { provider_id: providerID } },
		body: { action, return_path: returnPath, native: IS_CAPACITOR }
	});
	if (error || !data?.authorization_url) {
		sessionStorage.removeItem(PENDING_ACTION_KEY);
		throw new Error(error?.detail ?? 'Unable to start identity verification');
	}
	await openAuthorizationURL(data.authorization_url);
}

export async function startOIDCIdentityLink(
	providerID: string,
	reauthGrant: string
): Promise<void> {
	const returnPath = `${window.location.pathname}${window.location.search}`;
	const { data, error } = await client.POST('/auth/oidc/{provider_id}/link', {
		params: { path: { provider_id: providerID } },
		body: { reauth_grant: reauthGrant, return_path: returnPath, native: IS_CAPACITOR }
	});
	if (error || !data?.authorization_url) {
		throw new Error(error?.detail ?? 'Unable to start identity linking');
	}
	await openAuthorizationURL(data.authorization_url);
}

export async function acquireReauthGrant(
	action: string,
	options: { providerID?: string; hasPasskey?: boolean; password?: string }
): Promise<string | null> {
	const returned = takeReauthGrant(action);
	if (returned) return returned;
	if (options.password) return passwordGrant(action, options.password);
	if (options.hasPasskey) return passkeyGrant(action);
	if (options.providerID) {
		await startOIDCReauth(action, options.providerID);
		return null;
	}
	throw new Error('Add a passkey or link a work sign-in service before continuing.');
}
