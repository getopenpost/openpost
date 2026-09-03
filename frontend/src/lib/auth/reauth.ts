import { browser } from '$app/environment';
import { client } from '$lib/api/client';
import { getPasskeyAssertion } from '$lib/auth/webauthn';
import {
	authQueryKeys,
	isOrganizationAuditQueryKey,
	organizationQueryKeys
} from '@openpost/query-catalog';
import { queryClient } from '$lib/query/client';
import { auth } from '$lib/stores/auth';

const PENDING_ACTION_KEY = 'openpost_reauth_pending_action';
const GRANTS_KEY = 'openpost_reauth_grants';
const GRANT_MAX_AGE_MS = 5 * 60 * 1000;
let oidcReauthRequestSequence = 0;
let oidcIdentityLinkRequestSequence = 0;

interface StoredGrant {
	grant: string;
	expiresAt: number;
}

interface StoredGrants {
	[action: string]: StoredGrant;
}

type StoredGrantValue =
	| string
	| number
	| boolean
	| null
	| StoredGrantValue[]
	| { [key: string]: StoredGrantValue };

function grantFields(value: StoredGrantValue): { [key: string]: StoredGrantValue } | null {
	if (value === null || Array.isArray(value) || Object(value) !== value) return null;
	// SAFETY: The recursive JSON union and checks above establish a non-array object.
	return value as { [key: string]: StoredGrantValue };
}

function parseStoredGrants(value: StoredGrantValue): StoredGrants {
	const fields = grantFields(value);
	if (!fields) return {};
	const grants: StoredGrants = {};
	for (const [action, entry] of Object.entries(fields)) {
		const candidate = grantFields(entry);
		if (!candidate || String(candidate.grant) !== candidate.grant) continue;
		if (!Number.isFinite(candidate.expiresAt)) continue;
		grants[action] = {
			grant: String(candidate.grant),
			expiresAt: Number(candidate.expiresAt)
		};
	}
	return grants;
}

function readGrants(): StoredGrants {
	if (!browser) return {};
	try {
		const value: StoredGrantValue = JSON.parse(sessionStorage.getItem(GRANTS_KEY) ?? '{}');
		return parseStoredGrants(value);
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
	window.location.assign(url);
}

async function startOIDCReauth(
	action: string,
	providerID: string,
	callerIsCurrent: () => boolean
): Promise<void> {
	const identity = auth.captureIdentity();
	if (!identity) throw new Error('Sign in again before verifying your identity.');
	const requestSequence = ++oidcReauthRequestSequence;
	const returnPath = `${window.location.pathname}${window.location.search}`;
	const isCurrentRequest = () =>
		requestSequence === oidcReauthRequestSequence &&
		callerIsCurrent() &&
		auth.isIdentityCurrent(identity) &&
		`${window.location.pathname}${window.location.search}` === returnPath;
	sessionStorage.removeItem(PENDING_ACTION_KEY);
	const { data, error } = await client.POST('/auth/oidc/{provider_id}/reauth', {
		params: { path: { provider_id: providerID } },
		body: { action, return_path: returnPath, native: false }
	});
	if (!isCurrentRequest()) return;
	if (error || !data?.authorization_url) {
		throw new Error(error?.detail ?? 'Unable to start identity verification');
	}
	sessionStorage.setItem(PENDING_ACTION_KEY, action);
	if (!isCurrentRequest()) {
		if (sessionStorage.getItem(PENDING_ACTION_KEY) === action) {
			sessionStorage.removeItem(PENDING_ACTION_KEY);
		}
		return;
	}
	await openAuthorizationURL(data.authorization_url);
}

async function invalidateReauthAuditCaches() {
	await Promise.all([
		queryClient.invalidateQueries({
			queryKey: organizationQueryKeys.instanceAuditRoot(),
			refetchType: 'none'
		}),
		queryClient.invalidateQueries({
			predicate: (query) => isOrganizationAuditQueryKey(query.queryKey),
			refetchType: 'none'
		})
	]);
}

async function auditedGrant(
	grant: string,
	identity: ReturnType<typeof auth.captureIdentity>,
	refreshSecurity = false
) {
	if (auth.isIdentityCurrent(identity)) {
		await Promise.all([
			invalidateReauthAuditCaches(),
			...(refreshSecurity
				? [
						queryClient.invalidateQueries({
							queryKey: authQueryKeys.security(),
							exact: true
						})
					]
				: [])
		]);
	}
	return grant;
}

export async function startOIDCIdentityLink(
	providerID: string,
	reauthGrant: string,
	callerIsCurrent: () => boolean = () => true
): Promise<void> {
	const identity = auth.captureIdentity();
	if (!identity) throw new Error('Sign in again before linking an identity.');
	const requestSequence = ++oidcIdentityLinkRequestSequence;
	const returnPath = `${window.location.pathname}${window.location.search}`;
	const isCurrentRequest = () =>
		requestSequence === oidcIdentityLinkRequestSequence &&
		callerIsCurrent() &&
		auth.isIdentityCurrent(identity) &&
		`${window.location.pathname}${window.location.search}` === returnPath;
	const { data, error } = await client.POST('/auth/oidc/{provider_id}/link', {
		params: { path: { provider_id: providerID } },
		body: { reauth_grant: reauthGrant, return_path: returnPath, native: false }
	});
	if (!isCurrentRequest()) return;
	if (error || !data?.authorization_url) {
		throw new Error(error?.detail ?? 'Unable to start identity linking');
	}
	await openAuthorizationURL(data.authorization_url);
}

export async function acquireReauthGrant(
	action: string,
	options: {
		providerID?: string;
		hasPasskey?: boolean;
		password?: string;
		isCurrent?: () => boolean;
	}
): Promise<string | null> {
	const callerIsCurrent = options.isCurrent ?? (() => true);
	if (!callerIsCurrent()) return null;
	const identity = auth.captureIdentity();
	if (!identity) return null;
	const returned = takeReauthGrant(action);
	if (returned) {
		await auditedGrant(returned, identity);
		return callerIsCurrent() && auth.isIdentityCurrent(identity) ? returned : null;
	}
	if (options.password) {
		const grant = await passwordGrant(action, options.password);
		await auditedGrant(grant, identity);
		return callerIsCurrent() && auth.isIdentityCurrent(identity) ? grant : null;
	}
	if (options.hasPasskey) {
		const grant = await passkeyGrant(action);
		await auditedGrant(grant, identity, true);
		return callerIsCurrent() && auth.isIdentityCurrent(identity) ? grant : null;
	}
	if (options.providerID) {
		await startOIDCReauth(action, options.providerID, callerIsCurrent);
		return null;
	}
	throw new Error('Add a passkey or link a work sign-in service before continuing.');
}
